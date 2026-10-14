const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getUserStoragePath } = require('../utils/storage');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm', 'video/3gpp', 'video/mpeg'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const userFolder = await getUserStoragePath(req.user.storage_folder);
      cb(null, userFolder);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB || '200')) * 1024 * 1024,
    files: 50, // max files per request
  },
});

module.exports = { upload, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES };
