const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Media } = require('../models');
const { Person, FaceDetection } = require('../models/Face');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { getMediaAbsPath, getFaceAbsPath } = require('../utils/storage');
const faceService = require('../services/faceService');

/**
 * GET /api/faces/status - Check if face recognition is available
 */
const getStatus = asyncHandler(async (req, res) => {
  const available = await faceService.isAvailable();
  res.json({
    face_recognition_available: available,
    message: available
      ? 'Face recognition is ready'
      : 'Models not loaded. Download face-api.js models to ./models directory.',
    models_path: path.resolve(process.env.FACE_MODELS_PATH || './models'),
    models_needed: [
      'ssd_mobilenetv1_model-weights_manifest.json + shard files',
      'face_landmark_68_model-weights_manifest.json + shard files',
      'face_recognition_model-weights_manifest.json + shard files',
    ],
    download_url: 'https://github.com/justadudewhohacks/face-api.js/tree/master/weights',
  });
});

/**
 * POST /api/faces/analyze/:mediaId - Analyze faces in a specific media item
 */
const analyzeMedia = asyncHandler(async (req, res) => {
  const media = await Media.findOne({ where: { id: req.params.mediaId, user_id: req.user.id } });
  if (!media) throw new AppError('Media not found', 404);
  if (media.media_type !== 'photo') throw new AppError('Face recognition only works on photos', 400);

  const available = await faceService.isAvailable();
  if (!available) {
    throw new AppError('Face recognition models not loaded. See GET /api/faces/status', 503);
  }

  const absPath = getMediaAbsPath(req.user.storage_folder, media.stored_filename);
  const detectedFaces = await faceService.detectFaces(absPath);

  if (detectedFaces.length === 0) {
    await media.update({ face_analyzed: true });
    return res.json({ message: 'No faces detected', faces_found: 0 });
  }

  // Get known persons for matching
  const knownPersons = await Person.findAll({
    where: { user_id: req.user.id },
    attributes: ['id', 'name', 'face_descriptor'],
  });

  // Remove old detections for this media
  await FaceDetection.destroy({ where: { media_id: media.id } });

  const savedDetections = [];

  for (const face of detectedFaces) {
    // Try to match with known persons
    const { personId, distance } = faceService.matchPerson(face.descriptor, knownPersons);

    const detection = await FaceDetection.create({
      media_id: media.id,
      user_id: req.user.id,
      person_id: personId,
      box_x: face.box.x,
      box_y: face.box.y,
      box_width: face.box.width,
      box_height: face.box.height,
      face_descriptor: face.descriptor,
      detection_score: face.score,
      face_image_path: null,
      is_confirmed: false,
    });

    savedDetections.push({
      id: detection.id,
      person_id: personId,
      person_name: personId ? knownPersons.find(p => p.id === personId)?.name : null,
      match_distance: distance,
      score: face.score,
      box: face.box,
    });
  }

  await media.update({ face_analyzed: true });

  res.json({
    media_id: media.id,
    faces_found: savedDetections.length,
    detections: savedDetections,
  });
});

/**
 * POST /api/faces/analyze-all - Analyze all unanalyzed photos (background job)
 */
const analyzeAll = asyncHandler(async (req, res) => {
  const available = await faceService.isAvailable();
  if (!available) throw new AppError('Face recognition models not loaded', 503);

  let pendingCount = await Media.count({
    where: { user_id: req.user.id, media_type: 'photo', face_analyzed: false },
  });

  let reanalyzeAll = false;
  if (pendingCount === 0) {
    pendingCount = await Media.count({
      where: { user_id: req.user.id, media_type: 'photo' },
    });
    reanalyzeAll = true;
  }

  if (pendingCount === 0) {
    return res.json({
      message: 'Nenhuma foto encontrada para análise facial. Faça upload de fotos primeiro.',
      pending: 0,
    });
  }

  // Return immediately and process in background
  res.json({
    message: `Iniciando análise facial de ${pendingCount} fotos em segundo plano.`,
    pending: pendingCount,
  });

  // Process in background (fire and forget)
  setImmediate(async () => {
    const { getStorageBase } = require('../utils/storage');
    const storageBase = getStorageBase();

    const pendingMedia = await Media.findAll({
      where: {
        user_id: req.user.id,
        media_type: 'photo',
        ...(reanalyzeAll ? {} : { face_analyzed: false }),
      },
      limit: 500,
    });

    const knownPersons = await Person.findAll({
      where: { user_id: req.user.id },
      attributes: ['id', 'name', 'face_descriptor'],
    });

    let totalFacesFound = 0;

    for (const media of pendingMedia) {
      try {
        const absPath = media.file_path
          ? path.resolve(storageBase, media.file_path)
          : getMediaAbsPath(req.user.storage_folder, media.stored_filename);

        if (!fs.existsSync(absPath)) continue;

        const faces = await faceService.detectFaces(absPath);
        await FaceDetection.destroy({ where: { media_id: media.id } });

        for (const face of faces) {
          const { personId } = faceService.matchPerson(face.descriptor, knownPersons);
          await FaceDetection.create({
            media_id: media.id,
            user_id: req.user.id,
            person_id: personId,
            box_x: face.box.x,
            box_y: face.box.y,
            box_width: face.box.width,
            box_height: face.box.height,
            face_descriptor: face.descriptor,
            detection_score: face.score,
            face_image_path: null,
          });
          totalFacesFound++;
        }

        await media.update({ face_analyzed: true });
      } catch (err) {
        console.error(`Error processing ${media.id}: ${err.message}`);
      }
    }

    console.log(`[Face Recognition] Concluído: ${totalFacesFound} rostos detectados em ${pendingMedia.length} fotos.`);
  });
});

/**
 * GET /api/faces/persons - List all known persons
 */
const listPersons = asyncHandler(async (req, res) => {
  const persons = await Person.findAll({
    where: { user_id: req.user.id },
    order: [['name', 'ASC']],
  });
  res.json({ persons });
});

/**
 * POST /api/faces/persons - Create a new person
 */
const createPerson = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) throw new AppError('name is required', 400);

  const person = await Person.create({
    user_id: req.user.id,
    name,
    description,
  });
  res.status(201).json({ person });
});

/**
 * GET /api/faces/persons/:id - Get person and their photos
 */
const getPerson = asyncHandler(async (req, res) => {
  const person = await Person.findOne({
    where: { id: req.params.id, user_id: req.user.id },
    include: [
      {
        model: FaceDetection,
        as: 'detections',
        include: [{ model: Media, as: 'media', attributes: ['id', 'thumbnail_path', 'taken_at'] }],
        limit: 50,
        order: [['created_at', 'DESC']],
      },
    ],
  });
  if (!person) throw new AppError('Person not found', 404);
  res.json({ person });
});

/**
 * PATCH /api/faces/persons/:id - Update person name/description
 */
const updatePerson = asyncHandler(async (req, res) => {
  const person = await Person.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!person) throw new AppError('Person not found', 404);

  const { name, description } = req.body;
  await person.update({ name, description });
  res.json({ person });
});

/**
 * DELETE /api/faces/persons/:id
 */
const deletePerson = asyncHandler(async (req, res) => {
  const person = await Person.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!person) throw new AppError('Person not found', 404);
  await person.destroy();
  res.json({ message: 'Person deleted' });
});

/**
 * POST /api/faces/detections/:id/assign - Assign a face detection to a person
 */
const assignFace = asyncHandler(async (req, res) => {
  const { person_id } = req.body;
  const detection = await FaceDetection.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!detection) throw new AppError('Detection not found', 404);

  if (person_id) {
    const person = await Person.findOne({ where: { id: person_id, user_id: req.user.id } });
    if (!person) throw new AppError('Person not found', 404);

    // Update person's face descriptor with this detection's descriptor (for better matching)
    if (detection.face_descriptor) {
      await person.update({
        face_descriptor: detection.face_descriptor,
        cover_face_image_path: detection.face_image_path,
      });
    }
    await person.increment('photo_count');
  }

  await detection.update({ person_id: person_id || null, is_confirmed: true });
  res.json({ message: 'Face assigned successfully', detection });
});

/**
 * GET /api/faces/unidentified - Get face detections not yet assigned to a person
 */
const listUnidentified = asyncHandler(async (req, res) => {
  const { page = 1, limit = 30 } = req.query;
  const { count, rows } = await FaceDetection.findAndCountAll({
    where: { user_id: req.user.id, person_id: null },
    include: [{ model: Media, as: 'media', attributes: ['id', 'thumbnail_path', 'taken_at', 'title', 'original_filename', 'stored_filename'] }],
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
    order: [['created_at', 'DESC']],
  });
  res.json({ total: count, page: parseInt(page), limit: parseInt(limit), detections: rows });
});

/**
 * GET /api/faces/person-face/:id - Serve a face image crop on-the-fly from the single original photo
 */
const serveFaceImage = asyncHandler(async (req, res) => {
  const detection = await FaceDetection.findOne({
    where: { id: req.params.id, user_id: req.user.id },
    include: [{ model: Media, as: 'media' }],
  });
  if (!detection || !detection.media) throw new AppError('Face image not found', 404);

  const absPath = getMediaAbsPath(req.user.storage_folder, detection.media.stored_filename);
  if (!fs.existsSync(absPath)) throw new AppError('Original photo not found on disk', 404);

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=604800');

  if (detection.box_width && detection.box_height) {
    try {
      const sharp = require('sharp');
      const meta = await sharp(absPath, { failOnError: false, failOn: 'none' }).metadata().catch(() => null);

      let left = Math.max(0, Math.round(detection.box_x || 0));
      let top = Math.max(0, Math.round(detection.box_y || 0));
      let width = Math.max(10, Math.round(detection.box_width));
      let height = Math.max(10, Math.round(detection.box_height));

      if (meta && meta.width && meta.height) {
        if (left >= meta.width) left = 0;
        if (top >= meta.height) top = 0;
        width = Math.min(width, meta.width - left);
        height = Math.min(height, meta.height - top);
      }

      if (width > 0 && height > 0) {
        const stream = sharp(absPath, { failOnError: false, failOn: 'none' })
          .extract({ left, top, width, height })
          .resize(200, 200, { fit: 'cover' })
          .jpeg({ quality: 85 });
        stream.on('error', () => {
          fs.createReadStream(absPath).pipe(res);
        });
        return stream.pipe(res);
      }
    } catch {
      return fs.createReadStream(absPath).pipe(res);
    }
  }

  fs.createReadStream(absPath).pipe(res);
});

/**
 * GET /api/faces/clusters - List face clusters (persons and unidentified faces)
 */
const listClusters = asyncHandler(async (req, res) => {
  const persons = await Person.findAll({
    where: { user_id: req.user.id },
    include: [{
      model: FaceDetection,
      as: 'detections',
      attributes: ['id', 'media_id', 'box_x', 'box_y', 'box_width', 'box_height'],
      limit: 1,
    }],
    order: [['photo_count', 'DESC'], ['name', 'ASC']],
  });

  const unidentifiedCount = await FaceDetection.count({
    where: { user_id: req.user.id, person_id: null },
  });

  const clusters = persons.map(p => ({
    id: p.id,
    name: p.name,
    face_count: p.photo_count || (p.detections ? p.detections.length : 0),
    cover_detection_id: p.detections && p.detections[0] ? p.detections[0].id : null,
  }));

  if (unidentifiedCount > 0) {
    const coverDetection = await FaceDetection.findOne({
      where: { user_id: req.user.id, person_id: null },
      attributes: ['id'],
      order: [['created_at', 'DESC']],
    });

    clusters.push({
      id: 'unidentified',
      name: 'Rostos não identificados',
      face_count: unidentifiedCount,
      cover_detection_id: coverDetection ? coverDetection.id : null,
      is_unidentified: true,
    });
  }

  res.json({ clusters, total: clusters.length });
});

module.exports = {
  getStatus, analyzeMedia, analyzeAll,
  listPersons, createPerson, getPerson, updatePerson, deletePerson,
  assignFace, listUnidentified, serveFaceImage, listClusters,
};
