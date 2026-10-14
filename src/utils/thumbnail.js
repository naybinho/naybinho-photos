const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getStorageBase, getThumbnailAbsPath } = require('./storage');
const logger = require('./logger');

const THUMB_WIDTH = parseInt(process.env.THUMBNAIL_WIDTH || '400');
const THUMB_HEIGHT = parseInt(process.env.THUMBNAIL_HEIGHT || '400');

/**
 * Generate a JPEG thumbnail for an image file
 * @param {string} sourcePath - Absolute path to the original image
 * @param {string} storageFolder - User's storage folder name
 * @param {string} storedFilename - The stored filename of the media
 * @returns {string|null} Absolute path to the thumbnail, or null if failed
 */
async function generateImageThumbnail(sourcePath, storageFolder, storedFilename) {
  const thumbPath = getThumbnailAbsPath(storageFolder, storedFilename);
  try {
    await sharp(sourcePath, { failOnError: false, failOn: 'none' })
      .rotate() // auto-rotate based on EXIF orientation
      .resize(THUMB_WIDTH, THUMB_HEIGHT, {
        fit: 'cover',
        position: 'attention', // smart crop
      })
      .jpeg({ quality: 80, progressive: true })
      .toFile(thumbPath);
    return thumbPath;
  } catch (err) {
    logger.warn(`Failed to generate thumbnail for ${storedFilename}: ${err.message}`);
    return null;
  }
}

/**
 * Get cached thumbnail path for video
 */
function getVideoThumbnailPath(mediaId) {
  const thumbDir = path.join(getStorageBase(), '.thumbnails');
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }
  return path.join(thumbDir, `${mediaId}.jpg`);
}

/**
 * Generate a JPEG thumbnail for a video file using FFmpeg and cache it
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
 * Generate a JPEG thumbnail for a video file using FFmpeg
 */
async function generateVideoThumbnail(sourcePath, storageFolder, storedFilename) {
  const thumbPath = getThumbnailAbsPath(storageFolder, storedFilename);
  return extractVideoFrame(sourcePath, thumbPath);
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
  generateImageThumbnail,
  generateVideoThumbnail,
  getVideoThumbnailPath,
  extractVideoFrame,
  getImageDimensions,
  getVideoMetadata,
};
