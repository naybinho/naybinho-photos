const { Gallery, Media, Album, Location } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');

/**
 * GET /api/galleries
 */
const listGalleries = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, album_id } = req.query;
  const where = { user_id: req.user.id };
  if (album_id) where.album_id = album_id;

  const { count, rows } = await Gallery.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
    order: [['event_date', 'DESC'], ['created_at', 'DESC']],
    include: [
      { model: Album, as: 'album', attributes: ['id', 'name'], required: false },
      { model: Location, as: 'location', attributes: ['id', 'name', 'city', 'country'], required: false },
    ],
  });

  res.json({
    total: count,
    page: parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(count / parseInt(limit)),
    galleries: rows,
  });
});

/**
 * POST /api/galleries
 */
const createGallery = asyncHandler(async (req, res) => {
  const { name, description, album_id, event_date, location_id, is_public = false } = req.body;
  if (!name) throw new AppError('name is required', 400);

  // Validate album belongs to user if provided
  if (album_id) {
    const album = await Album.findOne({ where: { id: album_id, user_id: req.user.id } });
    if (!album) throw new AppError('Album not found', 404);
  }

  const gallery = await Gallery.create({
    user_id: req.user.id,
    name,
    description,
    album_id: album_id || null,
    event_date: event_date || null,
    location_id: location_id || null,
    is_public,
  });

  res.status(201).json({ gallery });
});

/**
 * GET /api/galleries/:id
 */
const getGallery = asyncHandler(async (req, res) => {
  const gallery = await Gallery.findOne({
    where: { id: req.params.id, user_id: req.user.id },
    include: [
      { model: Album, as: 'album', attributes: ['id', 'name'], required: false },
      { model: Location, as: 'location', required: false },
      {
        model: Media,
        as: 'media',
        order: [['taken_at', 'DESC']],
        required: false,
      },
    ],
  });
  if (!gallery) throw new AppError('Gallery not found', 404);
  res.json({ gallery });
});

/**
 * PATCH /api/galleries/:id
 */
const updateGallery = asyncHandler(async (req, res) => {
  const gallery = await Gallery.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!gallery) throw new AppError('Gallery not found', 404);

  const { name, description, album_id, event_date, location_id, is_public } = req.body;
  await gallery.update({ name, description, album_id, event_date, location_id, is_public });
  res.json({ gallery });
});

/**
 * DELETE /api/galleries/:id
 */
const deleteGallery = asyncHandler(async (req, res) => {
  const gallery = await Gallery.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!gallery) throw new AppError('Gallery not found', 404);
  await gallery.destroy();
  res.json({ message: 'Gallery deleted' });
});

module.exports = { listGalleries, createGallery, getGallery, updateGallery, deleteGallery };
