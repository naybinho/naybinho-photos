const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getStorageBase, getThumbnailAbsPath, getThumbnailJpgAbsPath, getThumbnailsDir } = require('./storage');
const logger = require('./logger');

const THUMB_WIDTH = parseInt(process.env.THUMBNAIL_WIDTH || '400');
const THUMB_HEIGHT = parseInt(process.env.THUMBNAIL_HEIGHT || '400');

/**
 * Generate a cached thumbnail on disk for a photo or video
 * Uses WebP for maximum compression and performance, with JPEG fallback
 * @param {string} mediaId - UUID of the media item
 * @param {string} sourcePath - Absolute path to original file
 * @param {string} mediaType - 'photo' or 'video'
 * @returns {Promise<string|null>} Path to created thumbnail file, or null
 */
async function generateMediaThumbnail(mediaId, sourcePath, mediaType = 'photo') {
  if (!fs.existsSync(sourcePath)) return null;

  const thumbDir = getThumbnailsDir();
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }

  if (mediaType === 'photo') {
    const webpPath = getThumbnailAbsPath(mediaId);
    try {
      await sharp(sourcePath, { failOnError: false, failOn: 'none' })
        .rotate()
        .resize(THUMB_WIDTH, THUMB_HEIGHT, {
          fit: 'cover',
          position: 'attention',
        })
        .webp({ quality: 80, effort: 4 })
        .toFile(webpPath);
      return webpPath;
    } catch (err) {
      logger.warn(`WebP thumbnail generation failed for ${mediaId}, falling back to JPEG: ${err.message}`);
      try {
        const jpgPath = getThumbnailJpgAbsPath(mediaId);
        await sharp(sourcePath, { failOnError: false, failOn: 'none' })
          .rotate()
          .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover' })
          .jpeg({ quality: 80, progressive: true })
          .toFile(jpgPath);
        return jpgPath;
      } catch (err2) {
        logger.error(`Thumbnail generation failed completely for ${mediaId}: ${err2.message}`);
        return null;
      }
    }
  }

  if (mediaType === 'video') {
    const jpgPath = getThumbnailJpgAbsPath(mediaId);
    try {
      const generated = await extractVideoFrame(sourcePath, jpgPath);
      if (generated && fs.existsSync(generated)) {
        return generated;
      }
    } catch (err) {
      logger.warn(`Video thumbnail generation failed for ${mediaId}: ${err.message}`);
    }
    return null;
  }

  return null;
}

/**
 * Legacy wrapper: Generate a thumbnail for an image file
 */
async function generateImageThumbnail(sourcePath, storageFolder, storedFilename) {
  return null;
}

/**
 * Get cached thumbnail path for video
 */
function getVideoThumbnailPath(mediaId) {
  return getThumbnailJpgAbsPath(mediaId);
}

/**
 * Generate a thumbnail frame for a video file using FFmpeg and cache it
 */
async function extractVideoFrame(sourcePath, outThumbPath) {
  const ffmpegBin = (() => {
    try {
      return require('@ffmpeg-installer/ffmpeg').path;
    } catch {
      return 'ffmpeg';
    }
  })();

  const { spawn } = require('child_process');

  const tryTimemark = (ss) => new Promise((resolve) => {
    const args = [
      '-ss', ss,
      '-i', sourcePath,
      '-vframes', '1',
      '-q:v', '3',
      '-vf', `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=increase,crop=${THUMB_WIDTH}:${THUMB_HEIGHT}`,
      '-y', outThumbPath,
    ];
    const proc = spawn(ffmpegBin, args);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outThumbPath) && fs.statSync(outThumbPath).size > 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    proc.on('error', (err) => {
      logger.warn(`FFmpeg spawn error for ${sourcePath}: ${err.message}`);
      resolve(false);
    });
  });

  let ok = await tryTimemark('00:00:01');
  if (!ok) ok = await tryTimemark('00:00:00.100');
  if (!ok) ok = await tryTimemark('00:00:00');
  return ok ? outThumbPath : null;
}

/**
 * Legacy wrapper: Generate a thumbnail for a video file
 */
async function generateVideoThumbnail(sourcePath, storageFolder, storedFilename) {
  return null;
}

/**
 * Get image dimensions using sharp
 */
async function getImageDimensions(filePath) {
  try {
    const meta = await sharp(filePath, { failOnError: false, failOn: 'none' }).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * Get video metadata using ffprobe
 */
async function getVideoMetadata(filePath) {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    try {
      const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
      ffmpeg.setFfmpegPath(ffmpegPath);
    } catch (e) {}

    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) return resolve({});
        const videoStream = data.streams?.find(s => s.codec_type === 'video');
        resolve({
          width: videoStream?.width || null,
          height: videoStream?.height || null,
          duration_seconds: data.format?.duration ? parseFloat(data.format.duration) : null,
        });
      });
    });
  } catch {
    return {};
  }
}

module.exports = {
  generateMediaThumbnail,
  generateImageThumbnail,
  generateVideoThumbnail,
  getVideoThumbnailPath,
  extractVideoFrame,
  getImageDimensions,
  getVideoMetadata,
};
