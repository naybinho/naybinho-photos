const router = require('express').Router();
const { listAlbums, createAlbum, getAlbum, updateAlbum, deleteAlbum, addMediaToAlbum, removeMediaFromAlbum } = require('../controllers/albumController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', listAlbums);
router.post('/', createAlbum);
router.get('/:id', getAlbum);
router.patch('/:id', updateAlbum);
router.delete('/:id', deleteAlbum);
router.post('/:id/media', addMediaToAlbum);
router.delete('/:id/media/:mediaId', removeMediaFromAlbum);

module.exports = router;
