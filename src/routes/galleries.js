const router = require('express').Router();
const { listGalleries, createGallery, getGallery, updateGallery, deleteGallery } = require('../controllers/galleryController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', listGalleries);
router.post('/', createGallery);
router.get('/:id', getGallery);
router.patch('/:id', updateGallery);
router.delete('/:id', deleteGallery);

module.exports = router;
