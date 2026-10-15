const router = require('express').Router();
const {
  uploadMedia, listMedia, getMedia, serveMedia, downloadMedia, serveThumbnail, serveShareMedia,
  updateMedia, deleteMedia, bulkDelete, bulkUpdate, geocodeExisting, generateAllThumbnails,
} = require('../controllers/mediaController');
const { authenticate } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

router.use(authenticate);

// Upload (supports 'files' or 'file' field name, up to 50 files)
router.post('/upload', upload.any(), uploadMedia);

// List and search
router.get('/', listMedia);

// Bulk operations
router.post('/bulk-delete', bulkDelete);
router.patch('/bulk-update', bulkUpdate);
router.post('/geocode-existing', geocodeExisting);
router.post('/generate-thumbnails', generateAllThumbnails);

// Single item operations
router.get('/:id', getMedia);
router.get('/:id/file', serveMedia);
router.get('/:id/download', downloadMedia);
router.get('/:id/share', serveShareMedia);
router.get('/:id/thumbnail', serveThumbnail);
router.patch('/:id', updateMedia);
router.delete('/:id', deleteMedia);

module.exports = router;
