/**
 * Face Recognition Service using @vladmandic/face-api with WebAssembly backend
 * 
 * This service handles:
 * 1. Loading face-api.js models from ./models or package distribution
 * 2. Detecting faces in images using Sharp to convert images to tensors
 * 3. Computing face descriptors (128-dim embedding vectors)
 * 4. Matching faces against known persons
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const logger = require('../utils/logger');

const MODELS_PATH = path.resolve(process.env.FACE_MODELS_PATH || './models');
const PKG_MODELS_PATH = path.resolve(__dirname, '../../node_modules/@vladmandic/face-api/model');
const DETECTION_THRESHOLD = parseFloat(process.env.FACE_DETECTION_THRESHOLD || '0.5');
const RECOGNITION_THRESHOLD = 0.6; // Euclidean distance threshold for same-person match

let faceapi = null;
let modelsLoaded = false;
let loadPromise = null;

/**
 * Lazy-initialize face-api with WebAssembly backend and load weights
 */
async function loadModels() {
  if (modelsLoaded) return true;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');

      // Initialize backend
      await faceapi.tf.ready();

      // Find models directory
      let effectiveModelsPath = MODELS_PATH;
      const manifestFile = 'ssd_mobilenetv1_model-weights_manifest.json';

      if (!fs.existsSync(path.join(MODELS_PATH, manifestFile))) {
        if (fs.existsSync(path.join(PKG_MODELS_PATH, manifestFile))) {
          effectiveModelsPath = PKG_MODELS_PATH;
        } else {
          logger.warn(`Face recognition models not found in ${MODELS_PATH} or ${PKG_MODELS_PATH}`);
          return false;
        }
      }

      await faceapi.nets.ssdMobilenetv1.loadFromDisk(effectiveModelsPath);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(effectiveModelsPath);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(effectiveModelsPath);

      modelsLoaded = true;
      logger.info(`✅ Face recognition models loaded successfully from ${effectiveModelsPath} (backend: ${faceapi.tf.getBackend()})`);
      return true;
    } catch (err) {
      logger.error(`Face recognition model loading failed: ${err.message}`);
      return false;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/**
 * Detect faces in an image file and return descriptors + bounding boxes
 * @param {string} imagePath - Absolute path to the image
 * @returns {Array} Array of { box, descriptor, score }
 */
async function detectFaces(imagePath) {
  const ready = await loadModels();
  if (!ready || !faceapi) {
    return [];
  }

  let tensor = null;
  try {
    // Decode image to raw 3-channel RGB buffer using sharp
    const { data, info } = await sharp(imagePath)
      .rotate() // respect EXIF orientation
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    tensor = faceapi.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');

    const detections = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: DETECTION_THRESHOLD }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    return detections.map(det => ({
      box: {
        x: Math.round(det.detection.box.x),
        y: Math.round(det.detection.box.y),
        width: Math.round(det.detection.box.width),
        height: Math.round(det.detection.box.height),
      },
      descriptor: Array.from(det.descriptor),
      score: det.detection.score,
    }));
  } catch (err) {
    logger.error(`Face detection failed for ${imagePath}: ${err.message}`);
    return [];
  } finally {
    if (tensor) {
      try { tensor.dispose(); } catch {}
    }
  }
}

/**
 * Crop and save a face region from an image
 * @param {string} imagePath - Absolute path to the original image
 * @param {Object} box - { x, y, width, height }
 * @param {string} outputPath - Absolute path to save the cropped face
 */
async function cropFace(imagePath, box, outputPath) {
  try {
    const padding = 20; // add some padding around the face
    const meta = await sharp(imagePath).metadata();
    const left = Math.max(0, Math.floor((box.x || 0) - padding));
    const top = Math.max(0, Math.floor((box.y || 0) - padding));
    const width = Math.min((meta.width || 800) - left, Math.ceil((box.width || 100) + padding * 2));
    const height = Math.min((meta.height || 800) - top, Math.ceil((box.height || 100) + padding * 2));

    await sharp(imagePath)
      .rotate()
      .extract({ left, top, width, height })
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    return true;
  } catch (err) {
    logger.warn(`Face crop failed: ${err.message}`);
    return false;
  }
}

/**
 * Compute Euclidean distance between two face descriptor vectors
 */
function descriptorDistance(d1, d2) {
  if (!d1 || !d2 || d1.length !== d2.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < d1.length; i++) {
    sum += (d1[i] - d2[i]) ** 2;
  }
  return Math.sqrt(sum);
}

/**
 * Find the best matching person for a given face descriptor
 * @param {Array<number>} descriptor - 128-dim face embedding
 * @param {Array<{id, face_descriptor}>} persons - Known persons with descriptors
 * @returns {{ personId: string|null, distance: number }}
 */
function matchPerson(descriptor, persons) {
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const person of persons) {
    if (!person.face_descriptor) continue;
    const dist = descriptorDistance(descriptor, person.face_descriptor);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = person;
    }
  }

  if (bestMatch && bestDistance <= RECOGNITION_THRESHOLD) {
    return { personId: bestMatch.id, distance: bestDistance };
  }

  return { personId: null, distance: bestDistance };
}

/**
 * Automatically analyze faces in a photo and save detections
 * @param {Object} media - Sequelize Media instance
 * @param {Object} user - User object with id and storage_folder
 */
async function processMediaFaces(media, user) {
  if (!media || media.media_type !== 'photo') return;

  try {
    const { Person, FaceDetection } = require('../models/Face');
    const { getStorageBase, getMediaAbsPath } = require('../utils/storage');
    const fs = require('fs');

    const available = await isAvailable();
    if (!available) {
      logger.warn('[Face Auto] Modelos de reconhecimento facial não disponíveis.');
      return;
    }

    const storageBase = getStorageBase();
    const absPath = media.file_path
      ? path.resolve(storageBase, media.file_path)
      : getMediaAbsPath(user.storage_folder, media.stored_filename);

    if (!fs.existsSync(absPath)) {
      logger.warn(`[Face Auto] Arquivo não encontrado no disco: ${absPath}`);
      return;
    }

    const detectedFaces = await detectFaces(absPath);
    await FaceDetection.destroy({ where: { media_id: media.id } });

    if (detectedFaces.length > 0) {
      const knownPersons = await Person.findAll({
        where: { user_id: user.id },
        attributes: ['id', 'name', 'face_descriptor'],
      });

      for (const face of detectedFaces) {
        const { personId } = matchPerson(face.descriptor, knownPersons);
        await FaceDetection.create({
          media_id: media.id,
          user_id: user.id,
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
      }
      logger.info(`✨ [Face Auto] ${detectedFaces.length} rostos identificados na foto ${media.original_filename} (@${user.username || user.id})`);
    } else {
      logger.info(`[Face Auto] Nenhum rosto detectado na foto ${media.original_filename}`);
    }

    await media.update({ face_analyzed: true });
  } catch (err) {
    logger.error(`[Face Auto] Erro ao processar foto ${media.id}: ${err.message}`);
  }
}

/**
 * Check if face recognition is available (models loaded)
 */
async function isAvailable() {
  return loadModels();
}

module.exports = {
  loadModels,
  detectFaces,
  cropFace,
  matchPerson,
  descriptorDistance,
  isAvailable,
  processMediaFaces,
  RECOGNITION_THRESHOLD,
};
