const { Album, Media, AlbumMedia } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');

/**
 * GET /api/albums
 */
const listAlbums = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const { count, rows } = await Album.findAndCountAll({
    where: { user_id: req.user.id },
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
    order: [['sort_order', 'ASC'], ['created_at', 'DESC']],
    include: [
      {
        model: Media,
        as: 'media',
        attributes: ['id', 'thumbnail_path', 'media_type'],
        through: { attributes: [] },
        required: false,
      },
    ],
    distinct: true,
  });

  res.json({
    total: count,
    page: parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(count / parseInt(limit)),
    albums: rows,
  });
});

/**
 * POST /api/albums
 */
const createAlbum = asyncHandler(async (req, res) => {
  const { name, description, is_public = false, sort_order = 0 } = req.body;
  if (!name) throw new AppError('name is required', 400);

  const album = await Album.create({
    user_id: req.user.id,
    name,
    description,
    is_public,
    sort_order,
  });

  res.status(201).json({ album });
});

/**
 * GET /api/albums/:id
 */
const getAlbum = asyncHandler(async (req, res) => {
  const album = await Album.findOne({
    where: { id: req.params.id, user_id: req.user.id },
    include: [
      {
        model: Media,
        as: 'media',
        through: { attributes: ['sort_order'] },
        order: [['taken_at', 'DESC']],
        required: false,
      },
    ],
  });
  if (!album) throw new AppError('Album not found', 404);
  res.json({ album });
});

/**
 * PATCH /api/albums/:id
 */
const updateAlbum = asyncHandler(async (req, res) => {
  const album = await Album.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!album) throw new AppError('Album not found', 404);

  const { name, description, is_public, sort_order } = req.body;
  await album.update({ name, description, is_public, sort_order });
  res.json({ album });
});

/**
 * DELETE /api/albums/:id
 */
const deleteAlbum = asyncHandler(async (req, res) => {
  const album = await Album.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!album) throw new AppError('Album not found', 404);
  await album.destroy();
  res.json({ message: 'Album deleted' });
});

/**
 * POST /api/albums/:id/media - Add media items to album
 */
const addMediaToAlbum = asyncHandler(async (req, res) => {
  const { media_ids } = req.body;
  if (!Array.isArray(media_ids) || media_ids.length === 0) {
    throw new AppError('media_ids array is required', 400);
  }

  const album = await Album.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!album) throw new AppError('Album not found', 404);

  // Verify all media belong to user
  const validMedia = await Media.findAll({
    where: { id: media_ids, user_id: req.user.id },
    attributes: ['id'],
  });

  const validIds = validMedia.map(m => m.id);
  const records = validIds.map((media_id, idx) => ({
    album_id: album.id,
    media_id,
    sort_order: idx,
  }));

  // Use bulk create with ignore duplicates
  await AlbumMedia.bulkCreate(records, { ignoreDuplicates: true });

  res.json({ message: `Added ${validIds.length} items to album`, added: validIds });
});

/**
 * DELETE /api/albums/:id/media/:mediaId - Remove media from album
 */
const removeMediaFromAlbum = asyncHandler(async (req, res) => {
  const album = await Album.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!album) throw new AppError('Album not found', 404);

  const deleted = await AlbumMedia.destroy({
    where: { album_id: album.id, media_id: req.params.mediaId },
  });
  if (!deleted) throw new AppError('Media not found in album', 404);

  res.json({ message: 'Media removed from album' });
});

module.exports = { listAlbums, createAlbum, getAlbum, updateAlbum, deleteAlbum, addMediaToAlbum, removeMediaFromAlbum };
