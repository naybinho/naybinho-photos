const path = require('path');
const fs = require('fs');
const { Op, Sequelize } = require('sequelize');
const { Media, Gallery, Location, Album } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { deleteFileSafe, getMediaAbsPath, getThumbnailAbsPath, getThumbnailJpgAbsPath, deleteThumbnailSafe } = require('../utils/storage');
const { generateMediaThumbnail, getImageDimensions, getVideoMetadata } = require('../utils/thumbnail');
const { extractExif } = require('../utils/exif');
const { ALLOWED_IMAGE_TYPES } = require('../middleware/upload');
const logger = require('../utils/logger');

function extractDateFromFilenameOrStat(filename, filePath) {
  if (filename) {
    const waMatch = filename.match(/(?:IMG|VID|WP|PHOTO|VIDEO)[-_](\d{4})(\d{2})(\d{2})/i);
    if (waMatch) {
      const year = parseInt(waMatch[1], 10);
      const month = parseInt(waMatch[2], 10) - 1;
      const day = parseInt(waMatch[3], 10);
      const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
      if (!isNaN(d.getTime())) return d;
    }
    const genMatch = filename.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
    if (genMatch && parseInt(genMatch[1], 10) >= 1990 && parseInt(genMatch[1], 10) <= 2040) {
      const year = parseInt(genMatch[1], 10);
      const month = parseInt(genMatch[2], 10) - 1;
      const day = parseInt(genMatch[3], 10);
      const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
      if (!isNaN(d.getTime())) return d;
    }
  }
  if (filePath && fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      return stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime;
    } catch {}
  }
  return new Date();
}

/**
 * POST /api/media/upload - Upload one or more media files
 */
const uploadMedia = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }

  // Check user storage quota
  const currentUsed = parseInt(req.user.storage_used_bytes || 0, 10);
  const maxLimit = req.user.max_storage_bytes ? parseInt(req.user.max_storage_bytes, 10) : null;
  const totalUploadSize = req.files.reduce((acc, f) => acc + f.size, 0);

  if (maxLimit && (currentUsed + totalUploadSize > maxLimit)) {
    for (const file of req.files) {
      await deleteFileSafe(file.path).catch(() => {});
    }
    const maxGB = (maxLimit / (1024 * 1024 * 1024)).toFixed(1);
    throw new AppError(`Limite de armazenamento excedido! Sua cota máxima é de ${maxGB} GB.`, 400);
  }

  const { gallery_id, album_id, description } = req.body;

  // Validate gallery belongs to user
  if (gallery_id) {
    const gallery = await Gallery.findOne({ where: { id: gallery_id, user_id: req.user.id } });
    if (!gallery) throw new AppError('Gallery not found', 404);
  }

  const results = [];
  const errors = [];

  for (const file of req.files) {
    try {
      const isPhoto = ALLOWED_IMAGE_TYPES.includes(file.mimetype);
      const mediaType = isPhoto ? 'photo' : 'video';
      const storedFilename = file.filename;
      const absPath = file.path;

      // Extract EXIF for photos
      let exifData = {};
      if (isPhoto) {
        exifData = await extractExif(absPath);
      }

      // Get dimensions
      let dimensions = {};
      if (isPhoto) {
        dimensions = await getImageDimensions(absPath);
      } else {
        dimensions = await getVideoMetadata(absPath);
      }

      // Determine GPS coordinates (from multipart body or parsed EXIF)
      const rawLat = (req.body.latitude !== undefined && req.body.latitude !== null && req.body.latitude !== '')
        ? parseFloat(req.body.latitude)
        : exifData.latitude;
      const rawLng = (req.body.longitude !== undefined && req.body.longitude !== null && req.body.longitude !== '')
        ? parseFloat(req.body.longitude)
        : exifData.longitude;

      const targetLat = (!isNaN(rawLat) && rawLat !== null) ? rawLat : null;
      const targetLng = (!isNaN(rawLng) && rawLng !== null) ? rawLng : null;

      // Reverse geocode with OpenStreetMap if photo has GPS
      let locationId = null;
      if (targetLat !== null && targetLng !== null) {
        try {
          const { reverseGeocodeOSM } = require('../services/osmService');

          // Check if there is already an existing location record close by (within ~300 meters)
          const existing = await Location.findOne({
            where: {
              user_id: req.user.id,
              latitude: { [Op.between]: [targetLat - 0.003, targetLat + 0.003] },
              longitude: { [Op.between]: [targetLng - 0.003, targetLng + 0.003] },
            },
          });

          if (existing) {
            locationId = existing.id;
          } else {
            const osmLoc = await reverseGeocodeOSM(targetLat, targetLng);
            const locName = osmLoc?.name || osmLoc?.city || `Local (${targetLat.toFixed(4)}, ${targetLng.toFixed(4)})`;

            const locRecord = await Location.create({
              user_id: req.user.id,
              name: locName,
              city: osmLoc?.city || null,
              state: osmLoc?.state || null,
              country: osmLoc?.country || null,
              country_code: osmLoc?.country_code || null,
              postal_code: osmLoc?.postal_code || null,
              full_address: osmLoc?.full_address || null,
              latitude: targetLat,
              longitude: targetLng,
            });
            locationId = locRecord.id;
          }
        } catch (osmErr) {
          logger.warn(`Could not reverse geocode photo with OpenStreetMap: ${osmErr.message}`);
          try {
            const fallbackLoc = await Location.create({
              user_id: req.user.id,
              name: `Local GPS (${targetLat.toFixed(4)}, ${targetLng.toFixed(4)})`,
              latitude: targetLat,
              longitude: targetLng,
            });
            locationId = fallbackLoc.id;
          } catch (e2) {}
        }
      }

      const photoDate = exifData.taken_at || extractDateFromFilenameOrStat(file.originalname, absPath) || new Date();

      const media = await Media.create({
        user_id: req.user.id,
        gallery_id: gallery_id || null,
        location_id: locationId,
        original_filename: file.originalname,
        stored_filename: storedFilename,
        file_path: path.join(req.user.storage_folder, storedFilename),
        thumbnail_path: path.join('.thumbnails', `${storedFilename}.webp`),
        mime_type: file.mimetype,
        media_type: mediaType,
        file_size_bytes: file.size,
        width: dimensions.width || null,
        height: dimensions.height || null,
        duration_seconds: dimensions.duration_seconds || null,
        taken_at: photoDate,
        camera_make: exifData.camera_make || null,
        camera_model: exifData.camera_model || null,
        latitude: targetLat,
        longitude: targetLng,
        altitude: exifData.altitude || null,
        description: description || null,
        exif_data: exifData.exif_data || null,
      });

      // Update user storage usage
      await req.user.increment('storage_used_bytes', { by: file.size });

      // Add to album if specified
      if (album_id) {
        const { AlbumMedia } = require('../models');
        await AlbumMedia.create({ album_id, media_id: media.id }).catch(() => {});
      }

      // Pre-generate high-performance WebP thumbnail on disk
      generateMediaThumbnail(media.id, absPath, mediaType).catch((err) => {
        logger.warn(`Background thumbnail generation for ${media.id} failed: ${err.message}`);
      });

      results.push(media);
    } catch (err) {
      errors.push({ filename: file.originalname, error: err.message });
      // Clean up uploaded file on error
      await deleteFileSafe(file.path).catch(() => {});
    }
  }

  res.status(201).json({
    uploaded: results.length,
    failed: errors.length,
    media: results,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/**
 * GET /api/media - List user's media with filters
 */
const listMedia = asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 30, media_type, gallery_id, album_id,
    is_favorite, search, from_date, to_date, order_by = 'taken_at', order_dir = 'DESC',
  } = req.query;

  const where = { user_id: req.user.id };
  const targetType = req.query.media_type || req.query.type;
  if (targetType) {
    if (targetType === 'image' || targetType === 'photo' || targetType === 'photos') {
      where.media_type = 'photo';
    } else if (targetType === 'video' || targetType === 'videos') {
      where.media_type = 'video';
    }
  }
  if (gallery_id) where.gallery_id = gallery_id;
  if (is_favorite !== undefined) where.is_favorite = is_favorite === 'true';
  if (from_date || to_date) {
    where.taken_at = {};
    if (from_date) where.taken_at[Op.gte] = new Date(from_date);
    if (to_date) where.taken_at[Op.lte] = new Date(to_date);
  }
  if (search) {
    where[Op.or] = [
      { original_filename: { [Op.iLike]: `%${search}%` } },
      { title: { [Op.iLike]: `%${search}%` } },
      { description: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const validOrderBy = ['taken_at', 'created_at', 'original_filename', 'file_size_bytes'];
  const validDir = ['ASC', 'DESC'];
  const sortField = validOrderBy.includes(order_by) ? order_by : 'taken_at';
  const sortDir = validDir.includes(order_dir.toUpperCase()) ? order_dir.toUpperCase() : 'DESC';

  const include = [
    { model: Gallery, as: 'gallery', attributes: ['id', 'name'], required: false },
    { model: Location, as: 'location', attributes: ['id', 'name', 'city', 'country'], required: false },
  ];

  // Filter by album (via join)
  if (album_id) {
    const { AlbumMedia } = require('../models');
    include.push({
      model: Album,
      as: 'albums',
      through: { attributes: [] },
      where: { id: album_id },
      required: true,
    });
  }

  const isAll = limit === 'all' || limit === '0' || limit === 0 || limit === -1 || limit === 'unlimited';
  const parsedLimit = isAll ? null : (parseInt(limit) || 60);
  const parsedPage = parseInt(page) || 1;

  let orderClause;
  if (sortField === 'taken_at') {
    orderClause = [
      ['taken_at', sortDir],
      ['created_at', sortDir],
      ['id', 'DESC'],
    ];
  } else {
    orderClause = [
      [sortField, sortDir],
      ['id', 'DESC'],
    ];
  }

  const { count, rows } = await Media.findAndCountAll({
    where,
    attributes: { exclude: ['exif_data'] },
    include,
    limit: parsedLimit || undefined,
    offset: parsedLimit ? (parsedPage - 1) * parsedLimit : undefined,
    order: orderClause,
    distinct: true,
  });

  res.json({
    total: count,
    page: parsedPage,
    limit: parsedLimit || count,
    pages: parsedLimit ? Math.ceil(count / parsedLimit) : 1,
    media: rows,
  });
});

/**
 * GET /api/media/:id - Get single media details
 */
const getMedia = asyncHandler(async (req, res) => {
  const media = await Media.findOne({
    where: { id: req.params.id, user_id: req.user.id },
    include: [
      { model: Gallery, as: 'gallery', required: false },
      { model: Location, as: 'location', required: false },
      { model: Album, as: 'albums', through: { attributes: [] }, required: false },
    ],
  });
  if (!media) throw new AppError('Media not found', 404);
  res.json({ media });
});

/**
 * GET /api/media/:id/file - Stream/serve the original media file
 */
const serveMedia = asyncHandler(async (req, res) => {
  const media = await Media.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!media) throw new AppError('Media not found', 404);

  const absPath = getMediaAbsPath(req.user.storage_folder, media.stored_filename);
  if (!fs.existsSync(absPath)) throw new AppError('File not found on disk', 404);

  const stat = fs.statSync(absPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Streaming support for videos
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': media.mime_type,
    });

    fs.createReadStream(absPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': media.mime_type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400',
    });
    fs.createReadStream(absPath).pipe(res);
  }
});

/**
 * GET /api/media/:id/download - Download the original media file
 */
const downloadMedia = asyncHandler(async (req, res) => {
  const media = await Media.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!media) throw new AppError('Media not found', 404);

  const absPath = getMediaAbsPath(req.user.storage_folder, media.stored_filename);
  if (!fs.existsSync(absPath)) throw new AppError('File not found on disk', 404);

  const downloadName = media.original_filename || media.stored_filename;
  res.download(absPath, downloadName);
});

/**
 * GET /api/media/:id/thumbnail - Serve pre-cached disk thumbnail with WebP & ETag
 */
const serveThumbnail = asyncHandler(async (req, res) => {
  const media = await Media.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!media) throw new AppError('Media not found', 404);

  const absPath = getMediaAbsPath(req.user.storage_folder, media.stored_filename);
  if (!fs.existsSync(absPath)) throw new AppError('File not found on disk', 404);

  // 1. Check if pre-cached thumbnail file already exists on disk
  const webpThumb = getThumbnailAbsPath(media.id);
  const jpgThumb = getThumbnailJpgAbsPath(media.id);

  let targetThumb = null;
  let mimeType = 'image/webp';

  if (fs.existsSync(webpThumb) && fs.statSync(webpThumb).size > 0) {
    targetThumb = webpThumb;
    mimeType = 'image/webp';
  } else if (fs.existsSync(jpgThumb) && fs.statSync(jpgThumb).size > 0) {
    targetThumb = jpgThumb;
    mimeType = 'image/jpeg';
  }

  // 2. If not generated yet (e.g. existing/legacy media), generate and save to disk now
  if (!targetThumb) {
    targetThumb = await generateMediaThumbnail(media.id, absPath, media.media_type);
    if (targetThumb && fs.existsSync(targetThumb)) {
      mimeType = targetThumb.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    }
  }

  // 3. Serve the cached file from disk with aggressive caching & ETag support
  if (targetThumb && fs.existsSync(targetThumb)) {
    const stat = fs.statSync(targetThumb);
    const etag = `W/"${stat.size}-${stat.mtimeMs}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': etag,
    });
    return fs.createReadStream(targetThumb).pipe(res);
  }

  // Video fallback SVG if frame extraction is not possible
  if (media.media_type === 'video') {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <rect width="400" height="400" fill="#0f172a"/>
        <circle cx="200" cy="200" r="44" fill="#6366f1" opacity="0.9"/>
        <polygon points="192,182 222,200 192,218" fill="#ffffff"/>
      </svg>
    `.trim());
  }

  // Ultimate fallback: serve original file
  res.setHeader('Content-Type', media.mime_type || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(absPath).pipe(res);
});

/**
 * PATCH /api/media/:id - Update media metadata
 */
const updateMedia = asyncHandler(async (req, res) => {
  const media = await Media.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!media) throw new AppError('Media not found', 404);

  const allowed = ['title', 'description', 'is_favorite', 'is_public', 'gallery_id', 'location_id', 'taken_at', 'latitude', 'longitude'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  // If latitude and longitude are updated, automatically geocode and link Location record
  if (req.body.latitude !== undefined && req.body.longitude !== undefined) {
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      updates.latitude = lat;
      updates.longitude = lng;
      try {
        const { reverseGeocodeOSM } = require('../services/osmService');
        let locRecord = await Location.findOne({
          where: {
            user_id: req.user.id,
            latitude: { [Op.between]: [lat - 0.003, lat + 0.003] },
            longitude: { [Op.between]: [lng - 0.003, lng + 0.003] },
          },
        });
        if (!locRecord) {
          const osmLoc = await reverseGeocodeOSM(lat, lng);
          locRecord = await Location.create({
            user_id: req.user.id,
            name: osmLoc?.name || osmLoc?.city || `Local GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            city: osmLoc?.city || null,
            state: osmLoc?.state || null,
            country: osmLoc?.country || null,
            country_code: osmLoc?.country_code || null,
            postal_code: osmLoc?.postal_code || null,
            full_address: osmLoc?.full_address || null,
            latitude: lat,
            longitude: lng,
          });
        }
        updates.location_id = locRecord.id;
      } catch (e) {}
    }
  }

  await media.update(updates);
  await media.reload(); // Ensure the returned object reflects the updated DB values
  res.json({ media });
});

/**
 * DELETE /api/media/:id - Delete a media file
 */
const deleteMedia = asyncHandler(async (req, res) => {
  const media = await Media.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!media) throw new AppError('Media not found', 404);

  // Delete physical original file and pre-cached thumbnail file
  const absPath = getMediaAbsPath(req.user.storage_folder, media.stored_filename);
  await deleteFileSafe(absPath);
  await deleteThumbnailSafe(media.id, req.user.storage_folder, media.stored_filename);

  // Update storage usage
  await req.user.decrement('storage_used_bytes', { by: media.file_size_bytes });

  await media.destroy();
  res.json({ message: 'Media deleted successfully' });
});

/**
 * POST /api/media/bulk-delete - Delete multiple media items
 */
const bulkDelete = asyncHandler(async (req, res) => {
  const { media_ids } = req.body;
  if (!Array.isArray(media_ids) || media_ids.length === 0) {
    throw new AppError('media_ids array is required', 400);
  }

  const mediaItems = await Media.findAll({ where: { id: media_ids, user_id: req.user.id } });
  let totalBytes = 0;

  for (const media of mediaItems) {
    const absPath = getMediaAbsPath(req.user.storage_folder, media.stored_filename);
    await deleteFileSafe(absPath);
    await deleteThumbnailSafe(media.id, req.user.storage_folder, media.stored_filename);
    totalBytes += parseInt(media.file_size_bytes);
  }

  await Media.destroy({ where: { id: media_ids, user_id: req.user.id } });

  if (totalBytes > 0) {
    await req.user.decrement('storage_used_bytes', { by: totalBytes });
  }

  res.json({ message: `Deleted ${mediaItems.length} media items`, deleted: mediaItems.length });
});

/**
 * PATCH /api/media/bulk-update - Update multiple items (e.g., move to gallery)
 */
const bulkUpdate = asyncHandler(async (req, res) => {
  const { media_ids, updates } = req.body;
  if (!Array.isArray(media_ids) || !updates) {
    throw new AppError('media_ids and updates are required', 400);
  }

  const allowed = ['gallery_id', 'is_favorite', 'is_public', 'location_id'];
  const safeUpdates = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) safeUpdates[k] = updates[k];
  }

  const [count] = await Media.update(safeUpdates, { where: { id: media_ids, user_id: req.user.id } });
  res.json({ message: `Updated ${count} items` });
});

/**
 * POST /api/media/geocode-existing - Retroactively geocode all media that has GPS but no location
 */
const geocodeExisting = asyncHandler(async (req, res) => {
  const path = require('path');
  const { extractExif } = require('../utils/exif');
  const storageRoot = process.env.STORAGE_PATH || './storage';

  // 1. Tentar reextrair EXIF para mídias do usuário que estão sem coordenadas
  const withoutGps = await Media.findAll({
    where: {
      user_id: req.user.id,
      latitude: null,
    },
    limit: 1000,
  });

  for (const m of withoutGps) {
    if (m.file_path) {
      try {
        const fullPath = path.resolve(storageRoot, m.file_path);
        const parsed = await extractExif(fullPath);
        if (parsed.latitude && parsed.longitude) {
          await m.update({
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            altitude: parsed.altitude || m.altitude,
            taken_at: m.taken_at || parsed.taken_at,
            camera_make: m.camera_make || parsed.camera_make,
            camera_model: m.camera_model || parsed.camera_model,
            exif_data: parsed.exif_data || m.exif_data,
          });
        }
      } catch (e) {
        // Ignora erro de leitura individual
      }
    }
  }

  // 2. Buscar mídias com coordenadas GPS que ainda não possuem location_id
  const pending = await Media.findAll({
    where: {
      user_id: req.user.id,
      latitude: { [Op.ne]: null },
      longitude: { [Op.ne]: null },
      location_id: null,
    },
    limit: 1000,
  });

  if (pending.length === 0) {
    return res.json({
      message: 'Nenhuma foto com coordenadas GPS encontrada. As fotos enviadas não possuem metadados GPS embutidos no arquivo EXIF (fotos compartilhadas por WhatsApp, Instagram ou tiradas com a localização do celular desligada não possuem GPS).',
      pending: 0,
    });
  }

  res.json({
    message: `Iniciando geocodificação de ${pending.length} mídias com coordenadas GPS encontradas.`,
    pending: pending.length,
  });

  // Run in background
  setImmediate(async () => {
    const { reverseGeocodeOSM } = require('../services/osmService');
    let success = 0;
    let failed = 0;

    for (const media of pending) {
      try {
        const lat = parseFloat(media.latitude);
        const lng = parseFloat(media.longitude);

        // Check if there is already an existing location record close by (within ~300 meters)
        let locRecord = await Location.findOne({
          where: {
            user_id: media.user_id,
            latitude: { [Op.between]: [lat - 0.003, lat + 0.003] },
            longitude: { [Op.between]: [lng - 0.003, lng + 0.003] },
          },
        });

        if (!locRecord) {
          // Rate-limit: Nominatim allows max 1 req/sec
          await new Promise(r => setTimeout(r, 1100));

          const osmLoc = await reverseGeocodeOSM(lat, lng);
          const locName = osmLoc?.name || osmLoc?.city || `Local GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

          locRecord = await Location.create({
            user_id: media.user_id,
            name: locName,
            city: osmLoc?.city || null,
            state: osmLoc?.state || null,
            country: osmLoc?.country || null,
            country_code: osmLoc?.country_code || null,
            postal_code: osmLoc?.postal_code || null,
            full_address: osmLoc?.full_address || null,
            latitude: lat,
            longitude: lng,
          });
        }

        await media.update({ location_id: locRecord.id });
        success++;
        logger.info(`[Geocode] Localização vinculada para mídia ${media.id}: ${locRecord.name}`);
      } catch (err) {
        failed++;
        logger.warn(`[Geocode] Falhou para mídia ${media.id}: ${err.message}`);
      }
    }

    logger.info(`[Geocode] Concluído: ${success} geocodificados, ${failed} falhas.`);
  });
});

/**
 * POST /api/media/generate-thumbnails - Pre-generate missing thumbnails for user's media
 */
const generateAllThumbnails = asyncHandler(async (req, res) => {
  const where = { user_id: req.user.id };
  const allMedia = await Media.findAll({
    where,
    attributes: ['id', 'file_path', 'stored_filename', 'media_type', 'user_id'],
  });

  res.json({
    message: `Iniciando verificação e geração de miniaturas em segundo plano para ${allMedia.length} arquivos.`,
    total: allMedia.length,
  });

  setImmediate(async () => {
    let generated = 0;
    for (const m of allMedia) {
      try {
        const webpThumb = getThumbnailAbsPath(m.id);
        const jpgThumb = getThumbnailJpgAbsPath(m.id);
        if (!fs.existsSync(webpThumb) && !fs.existsSync(jpgThumb)) {
          const absPath = getMediaAbsPath(req.user.storage_folder, m.stored_filename);
          if (fs.existsSync(absPath)) {
            await generateMediaThumbnail(m.id, absPath, m.media_type);
            generated++;
          }
        }
      } catch (err) {
        logger.warn(`Erro ao gerar miniatura para ${m.id}: ${err.message}`);
      }
    }
    logger.info(`[Thumbnails Batch] Processamento concluído: ${generated} miniaturas geradas.`);
  });
});

module.exports = {
  uploadMedia, listMedia, getMedia, serveMedia, downloadMedia, serveThumbnail,
  updateMedia, deleteMedia, bulkDelete, bulkUpdate, geocodeExisting, generateAllThumbnails,
};
