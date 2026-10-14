const router = require('express').Router();
const {
  getStatus, analyzeMedia, analyzeAll,
  listPersons, createPerson, getPerson, updatePerson, deletePerson,
  assignFace, listUnidentified, serveFaceImage, listClusters,
} = require('../controllers/faceController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Status
router.get('/status', getStatus);

// Face clusters (combined persons and groups)
router.get('/clusters', listClusters);

// Person management
router.get('/persons', listPersons);
router.post('/persons', createPerson);
router.get('/persons/:id', getPerson);
router.patch('/persons/:id', updatePerson);
router.delete('/persons/:id', deletePerson);

// Analysis
router.post('/analyze/:mediaId', analyzeMedia);
router.post('/analyze-all', analyzeAll);

// Face detections
router.get('/unidentified', listUnidentified);
router.post('/detections/:id/assign', assignFace);
router.get('/face-image/:id', serveFaceImage);

module.exports = router;
