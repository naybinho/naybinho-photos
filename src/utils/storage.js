const fs = require('fs').promises;
const path = require('path');

const STORAGE_BASE = process.env.STORAGE_PATH || './storage';

/**
 * Returns the absolute path for the storage base directory
 */
function getStorageBase() {
  return path.resolve(STORAGE_BASE);
}

/**
 * Returns the absolute path for a user's storage folder
 */
async function getUserStoragePath(storageFolder) {
  const userPath = path.join(getStorageBase(), storageFolder);
  await fs.mkdir(userPath, { recursive: true });
  return userPath;
}

/**
 * Initialize all required storage directories
 */
async function initStorage() {
  const base = getStorageBase();
  await fs.mkdir(base, { recursive: true });
  await fs.mkdir(path.join(base, '.thumbnails'), { recursive: true });
}

/**
 * Delete a file safely (no error if doesn't exist)
 */
async function deleteFileSafe(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Get file size in bytes
 */
async function getFileSize(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size;
}

/**
 * Build absolute path for a stored media file
 */
function getMediaAbsPath(storageFolder, storedFilename) {
  return path.join(getStorageBase(), storageFolder, storedFilename);
}

/**
 * Directory where pre-rendered thumbnails are stored
 */
function getThumbnailsDir() {
  return path.join(getStorageBase(), '.thumbnails');
}

/**
 * Build absolute path for a WebP thumbnail
 */
function getThumbnailAbsPath(mediaId) {
  return path.join(getThumbnailsDir(), `${mediaId}.webp`);
}

/**
 * Build absolute path for a JPEG thumbnail (fallback)
 */
function getThumbnailJpgAbsPath(mediaId) {
  return path.join(getThumbnailsDir(), `${mediaId}.jpg`);
}

/**
 * Safely delete thumbnail files (.webp and .jpg) for a media item
 */
async function deleteThumbnailSafe(mediaId, storageFolder, storedFilename) {
  if (mediaId) {
    await deleteFileSafe(getThumbnailAbsPath(mediaId));
    await deleteFileSafe(getThumbnailJpgAbsPath(mediaId));
  }
  if (storageFolder && storedFilename) {
    // Also clean up any legacy user-folder based thumbnail if it existed
    const legacyThumb = path.join(getStorageBase(), storageFolder, '.thumbnails', `${storedFilename}.webp`);
    await deleteFileSafe(legacyThumb);
  }
}

/**
 * Clean up orphaned thumbnails that have no corresponding media
 */
async function cleanOrphanedThumbnails(validMediaIds) {
  try {
    const thumbDir = getThumbnailsDir();
    const files = await fs.readdir(thumbDir);
    const validSet = new Set(validMediaIds || []);
    let deletedCount = 0;

    for (const file of files) {
      const id = path.parse(file).name;
      if (!validSet.has(id)) {
        await deleteFileSafe(path.join(thumbDir, file));
        deletedCount++;
      }
    }
    return deletedCount;
  } catch (err) {
    return 0;
  }
}

/**
 * Safely delete user storage folder and all its files
 */
async function deleteUserStorageFolder(storageFolder) {
  if (!storageFolder || storageFolder === '.' || storageFolder === '..') return;
  const userPath = path.join(getStorageBase(), storageFolder);
  const resolvedBase = path.resolve(getStorageBase());
  const resolvedUser = path.resolve(userPath);
  if (!resolvedUser.startsWith(resolvedBase) || resolvedUser === resolvedBase) {
    throw new Error('Caminho de pasta inválido');
  }
  try {
    await fs.rm(userPath, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  getStorageBase,
  getThumbnailsDir,
  getUserStoragePath,
  deleteUserStorageFolder,
  initStorage,
  deleteFileSafe,
  getFileSize,
  getMediaAbsPath,
  getThumbnailAbsPath,
  getThumbnailJpgAbsPath,
  deleteThumbnailSafe,
  cleanOrphanedThumbnails,
};
