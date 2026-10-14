const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
let chokidar = null;
try {
  chokidar = require('chokidar');
} catch (e) {
  logger?.warn('[Storage Watcher] Módulo chokidar não carregado: ' + e.message);
}
const { Op } = require('sequelize');
const { User, Media, Location, AlbumMedia } = require('../models');
const { getStorageBase, deleteThumbnailSafe, cleanOrphanedThumbnails } = require('../utils/storage');
const { generateMediaThumbnail, getImageDimensions, getVideoMetadata } = require('../utils/thumbnail');
const { extractExif } = require('../utils/exif');
const logger = require('../utils/logger');

const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.3gp': 'video/3gpp',
};

let watcherInstance = null;

/**
 * Identify user and relative filename from absolute file path
 */
async function resolveUserAndFile(filePath) {
  const base = getStorageBase();
  const relPath = path.relative(base, filePath);
  const parts = relPath.split(path.sep);

  if (parts.length !== 2) return null; // Only accept storage/<userFolder>/<fileName>

  const [userFolder, fileName] = parts;
  if (fileName.startsWith('.') || fileName.startsWith('~')) return null;

  const user = await User.findOne({
    where: { storage_folder: userFolder },
  }) || await User.findOne({
    where: { username: userFolder },
  });

  if (!user) return null;

  return { user, userFolder, fileName };
}

function extractDateFromFilename(fileName) {
  if (!fileName) return null;
  const waMatch = fileName.match(/(?:IMG|VID|WP|PHOTO|VIDEO)[-_](\d{4})(\d{2})(\d{2})/i);
  if (waMatch) {
    const year = parseInt(waMatch[1], 10);
    const month = parseInt(waMatch[2], 10) - 1;
    const day = parseInt(waMatch[3], 10);
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if (!isNaN(d.getTime())) return d;
  }
  const genMatch = fileName.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (genMatch && parseInt(genMatch[1], 10) >= 1990 && parseInt(genMatch[1], 10) <= 2040) {
    const year = parseInt(genMatch[1], 10);
    const month = parseInt(genMatch[2], 10) - 1;
    const day = parseInt(genMatch[3], 10);
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Handle a new file added to storage
 */
async function handleFileAdded(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_MAP[ext];
    if (!mimeType) return; // Ignore non-media files

    const resolved = await resolveUserAndFile(filePath);
    if (!resolved) return;
    const { user, fileName } = resolved;

    // Check if media is already registered
    const existing = await Media.findOne({
      where: {
        user_id: user.id,
        stored_filename: fileName,
      },
    });

    if (existing) return; // Already in DB

    // Ensure file exists and read stats
    const stat = await fs.stat(filePath);
    if (stat.size === 0) return;

    const isPhoto = mimeType.startsWith('image/');
    const mediaType = isPhoto ? 'photo' : 'video';

    // Extract metadata
    let dimensions = {};
    let exifData = {};

    if (isPhoto) {
      dimensions = await getImageDimensions(filePath);
      exifData = await extractExif(filePath);
    } else {
      dimensions = await getVideoMetadata(filePath);
    }

    // Geocode GPS if available
    let locationId = null;
    if (exifData.latitude && exifData.longitude) {
      try {
        const targetLat = parseFloat(exifData.latitude);
        const targetLng = parseFloat(exifData.longitude);

        // Check if there is already an existing location record close by (within ~300 meters)
        let locRecord = await Location.findOne({
          where: {
            user_id: user.id,
            latitude: { [Op.between]: [targetLat - 0.003, targetLat + 0.003] },
            longitude: { [Op.between]: [targetLng - 0.003, targetLng + 0.003] },
          },
        });

        if (!locRecord) {
          const { reverseGeocodeOSM } = require('./osmService');
          const osmLoc = await reverseGeocodeOSM(targetLat, targetLng);
          const locName = osmLoc?.name || osmLoc?.city || `Local GPS (${targetLat.toFixed(4)}, ${targetLng.toFixed(4)})`;

          locRecord = await Location.create({
            user_id: user.id,
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
        }
        locationId = locRecord.id;
      } catch (err) {
        logger.warn(`[Sync] Geocoding falhou para ${fileName}: ${err.message}`);
        try {
          const fallbackLoc = await Location.create({
            user_id: user.id,
            name: `Local GPS (${parseFloat(exifData.latitude).toFixed(4)}, ${parseFloat(exifData.longitude).toFixed(4)})`,
            latitude: parseFloat(exifData.latitude),
            longitude: parseFloat(exifData.longitude),
          });
          locationId = fallbackLoc.id;
        } catch (e2) {}
      }
    }

    const fileDate = exifData.taken_at || extractDateFromFilename(fileName) || stat.birthtime || stat.mtime || new Date();

    // Register media in database
    const media = await Media.create({
      user_id: user.id,
      location_id: locationId,
      original_filename: fileName,
      stored_filename: fileName,
      file_path: path.join(user.storage_folder, fileName),
      thumbnail_path: path.join(user.storage_folder, fileName),
      mime_type: mimeType,
      media_type: mediaType,
      file_size_bytes: stat.size,
      width: dimensions.width || null,
      height: dimensions.height || null,
      duration_seconds: dimensions.duration_seconds || null,
      taken_at: fileDate,
      camera_make: exifData.camera_make || null,
      camera_model: exifData.camera_model || null,
      latitude: exifData.latitude || null,
      longitude: exifData.longitude || null,
      altitude: exifData.altitude || null,
      exif_data: exifData.exif_data || null,
    });

    // Update storage used bytes
    await user.increment('storage_used_bytes', { by: stat.size });

    logger.info(`📸 [Sync] Arquivo adicionado manualmente no disco importado com sucesso: ${fileName} (@${user.username})`);

    // Pre-generate WebP thumbnail on disk
    generateMediaThumbnail(media.id, filePath, mediaType).catch((thumbErr) => {
      logger.warn(`[Sync] Falha ao pré-gerar miniatura para ${fileName}: ${thumbErr.message}`);
    });
  } catch (err) {
    logger.error(`[Sync] Erro ao sincronizar arquivo adicionado ${filePath}:`, err);
  }
}

/**
 * Handle a file removed from storage
 */
async function handleFileRemoved(filePath) {
  try {
    const resolved = await resolveUserAndFile(filePath);
    if (!resolved) return;
    const { user, userFolder, fileName } = resolved;

    const media = await Media.findOne({
      where: {
        user_id: user.id,
        stored_filename: fileName,
      },
    });

    if (!media) return; // Not in DB or already deleted

    // Remove relations and delete physical thumbnail from disk
    await AlbumMedia.destroy({ where: { media_id: media.id } }).catch(() => {});
    await deleteThumbnailSafe(media.id, userFolder, fileName);

    // Decrement storage
    const fileSize = parseInt(media.file_size_bytes || 0, 10);
    if (fileSize > 0) {
      await user.decrement('storage_used_bytes', { by: fileSize }).catch(() => {});
    }

    await media.destroy();

    logger.info(`🗑️ [Sync] Arquivo excluído no disco detectado. Registro e miniatura removidos: ${fileName} (@${user.username})`);
  } catch (err) {
    logger.error(`[Sync] Erro ao sincronizar arquivo removido ${filePath}:`, err);
  }
}

/**
 * Scan and synchronize all existing files on server startup
 */
async function syncStorageOnStartup() {
  try {
    const base = getStorageBase();
    if (!fsSync.existsSync(base)) return;

    const userFolders = await fs.readdir(base);
    for (const folder of userFolders) {
      const folderPath = path.join(base, folder);
      const stat = await fs.stat(folderPath).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;

      const user = await User.findOne({
        where: { storage_folder: folder },
      }) || await User.findOne({
        where: { username: folder },
      });

      if (!user) continue;

      // 1. Check all disk files -> add to DB if missing
      const files = await fs.readdir(folderPath);
      const diskFilenames = new Set();

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const fStat = await fs.stat(filePath).catch(() => null);
        if (!fStat || fStat.isDirectory()) continue;

        const ext = path.extname(file).toLowerCase();
        if (!MIME_MAP[ext]) continue;

        diskFilenames.add(file);

        const existsInDb = await Media.findOne({
          where: { user_id: user.id, stored_filename: file },
        });

        if (!existsInDb) {
          logger.info(`[Sync Startup] Encontrado arquivo não cadastrado: ${file} para @${user.username}. Cadastrando...`);
          await handleFileAdded(filePath);
        }
      }

      // 2. Check all DB media for user -> delete if not on disk
      const allDbMedia = await Media.findAll({
        where: { user_id: user.id },
      });

      for (const media of allDbMedia) {
        if (!diskFilenames.has(media.stored_filename)) {
          logger.info(`[Sync Startup] Arquivo ${media.stored_filename} não existe no disco. Removendo do banco e miniatura...`);
          await AlbumMedia.destroy({ where: { media_id: media.id } }).catch(() => {});
          await deleteThumbnailSafe(media.id, folder, media.stored_filename);
          const fileSize = parseInt(media.file_size_bytes || 0, 10);
          if (fileSize > 0) {
            await user.decrement('storage_used_bytes', { by: fileSize }).catch(() => {});
          }
          await media.destroy();
        }
      }
    }

    // 3. Clean up any orphaned thumbnails on disk
    const allRemainingMedia = await Media.findAll({ attributes: ['id'] });
    const validIds = allRemainingMedia.map(m => m.id);
    const cleaned = await cleanOrphanedThumbnails(validIds);
    if (cleaned > 0) {
      logger.info(`[Sync Startup] ${cleaned} miniaturas órfãs removidas do disco.`);
    }
  } catch (err) {
    logger.error('[Sync Startup] Erro durante sincronização inicial do storage:', err);
  }
}

/**
 * Start watching storage directory for real-time additions and deletions
 */
function initStorageWatcher() {
  if (!chokidar) {
    logger.warn('[Storage Watcher] Monitoramento contínuo em tempo real desativado (chokidar indisponível).');
    return;
  }
  const base = getStorageBase();

  watcherInstance = chokidar.watch(base, {
    depth: 2,
    ignoreInitial: true,
    persistent: true,
    ignored: [/(^|[/\\])\.thumbnails/, /(^|[/\\])\./],
    awaitWriteFinish: {
      stabilityThreshold: 1500,
      pollInterval: 300,
    },
  });

  watcherInstance.on('add', (filePath) => {
    handleFileAdded(filePath);
  });

  watcherInstance.on('unlink', (filePath) => {
    handleFileRemoved(filePath);
  });

  logger.info(`👀 [Storage Watcher] Monitorando alterações automáticas em: ${base}`);
}

module.exports = {
  initStorageWatcher,
  syncStorageOnStartup,
  handleFileAdded,
  handleFileRemoved,
};
