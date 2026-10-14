const router = require('express').Router();
const {
  listLocations, createLocation, getLocation, updateLocation, deleteLocation, findNearby,
  reverseOSM, searchOSMLocations, serveOSMTile,
} = require('../controllers/locationController');
const { authenticate } = require('../middleware/auth');

// Public OSM Tile proxy (Leaflet map tiles don't send auth headers)
router.get('/tiles/:z/:x/:y.png', serveOSMTile);

router.use(authenticate);

router.get('/reverse-osm', reverseOSM);
router.get('/search-osm', searchOSMLocations);
router.get('/nearby', findNearby);
router.get('/', listLocations);
router.post('/', createLocation);
router.get('/:id', getLocation);
router.patch('/:id', updateLocation);
router.delete('/:id', deleteLocation);

module.exports = router;
