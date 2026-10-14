const { Location, Media, Gallery } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');

/**
 * GET /api/locations
 */
const listLocations = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const { count, rows } = await Location.findAndCountAll({
    where: { user_id: req.user.id },
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
    order: [['name', 'ASC']],
    include: [
      {
        model: Media,
        as: 'media',
        attributes: ['id', 'media_type', 'original_filename', 'stored_filename', 'thumbnail_path', 'latitude', 'longitude', 'taken_at', 'title', 'mime_type', 'file_size_bytes', 'width', 'height', 'is_favorite', 'camera_make', 'camera_model', 'created_at'],
        required: false,
      },
    ],
    distinct: true,
  });
  res.json({ total: count, page: parseInt(page), limit: parseInt(limit), locations: rows });
});

/**
 * POST /api/locations
 */
const createLocation = asyncHandler(async (req, res) => {
  const { name, description, latitude, longitude, city, state, country, country_code, postal_code, full_address } = req.body;
  if (!name) throw new AppError('name is required', 400);

  const location = await Location.create({
    user_id: req.user.id,
    name, description, latitude, longitude,
    city, state, country, country_code, postal_code, full_address,
  });
  res.status(201).json({ location });
});

/**
 * GET /api/locations/:id
 */
const getLocation = asyncHandler(async (req, res) => {
  const location = await Location.findOne({
    where: { id: req.params.id, user_id: req.user.id },
    include: [
      {
        model: Gallery,
        as: 'galleries',
        attributes: ['id', 'name', 'event_date'],
        required: false,
      },
    ],
  });
  if (!location) throw new AppError('Location not found', 404);
  res.json({ location });
});

/**
 * PATCH /api/locations/:id
 */
const updateLocation = asyncHandler(async (req, res) => {
  const location = await Location.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!location) throw new AppError('Location not found', 404);

  const fields = ['name', 'description', 'latitude', 'longitude', 'city', 'state', 'country', 'country_code', 'postal_code', 'full_address'];
  const updates = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  await location.update(updates);
  res.json({ location });
});

/**
 * DELETE /api/locations/:id
 */
const deleteLocation = asyncHandler(async (req, res) => {
  const location = await Location.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!location) throw new AppError('Location not found', 404);
  await location.destroy();
  res.json({ message: 'Location deleted' });
});

/**
 * GET /api/locations/nearby - Find locations near GPS coordinates
 */
const findNearby = asyncHandler(async (req, res) => {
  const { lat, lng, radius_km = 10 } = req.query;
  if (!lat || !lng) throw new AppError('lat and lng are required', 400);

  const { sequelize } = require('../config/database');
  // Haversine formula approximation
  const locations = await sequelize.query(
    `SELECT *, 
      (6371 * acos(cos(radians(:lat)) * cos(radians(latitude::float)) * cos(radians(longitude::float) - radians(:lng)) 
      + sin(radians(:lat)) * sin(radians(latitude::float)))) AS distance_km
    FROM locations 
    WHERE user_id = :userId
      AND latitude IS NOT NULL AND longitude IS NOT NULL
    HAVING (6371 * acos(cos(radians(:lat)) * cos(radians(latitude::float)) * cos(radians(longitude::float) - radians(:lng)) 
      + sin(radians(:lat)) * sin(radians(latitude::float)))) < :radius
    ORDER BY distance_km ASC
    LIMIT 20`,
    {
      replacements: { lat: parseFloat(lat), lng: parseFloat(lng), userId: req.user.id, radius: parseFloat(radius_km) },
      type: sequelize.QueryTypes.SELECT,
    }
  );
  res.json({ locations });
});

const { reverseGeocodeOSM, searchOSM } = require('../services/osmService');

/**
 * GET /api/locations/reverse-osm - Reverse geocode with OpenStreetMap
 */
const reverseOSM = asyncHandler(async (req, res) => {
  const { lat, lon, lng } = req.query;
  const targetLon = lon || lng;
  if (!lat || !targetLon) throw new AppError('lat and lon are required', 400);

  const result = await reverseGeocodeOSM(parseFloat(lat), parseFloat(targetLon));
  if (!result) throw new AppError('Could not geocode coordinates with OpenStreetMap', 404);
  res.json({ location: result });
});

/**
 * GET /api/locations/search-osm - Search places via OpenStreetMap
 */
const searchOSMLocations = asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });

  const results = await searchOSM(q);
  res.json({ results });
});

/**
 * GET /api/locations/tiles/:z/:x/:y.png - Proxy OpenStreetMap tiles with compliant User-Agent and cache
 */
const serveOSMTile = async (req, res) => {
  const { z, x, y } = req.params;
  const tileUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

  try {
    const upstream = await fetch(tileUrl, {
      headers: {
        'User-Agent': 'PhotoVault-App/1.0 (admin@photovault.local)',
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).end();
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).end();
  }
};

module.exports = {
  listLocations,
  createLocation,
  getLocation,
  updateLocation,
  deleteLocation,
  findNearby,
  reverseOSM,
  searchOSMLocations,
  serveOSMTile,
};
