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
}

/**
 * Delete a file safely (no error if doesn't exist)
 */
async function deleteFileSafe(filePath) {
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
 * Build absolute path for a thumbnail (uses the single original file)
 */
function getThumbnailAbsPath(storageFolder, storedFilename) {
  return path.join(getStorageBase(), storageFolder, storedFilename);
}

/**
 * Build absolute path for a face crop
 */
function getFaceAbsPath(storageFolder, faceFilename) {
  return path.join(getStorageBase(), storageFolder, 'faces', faceFilename);
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
  getUserStoragePath,
  deleteUserStorageFolder,
  initStorage,
  deleteFileSafe,
  getFileSize,
  getMediaAbsPath,
  getThumbnailAbsPath,
  getFaceAbsPath,
};
