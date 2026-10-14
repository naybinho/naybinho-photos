const { v4: uuidv4 } = require('uuid');
const { User } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { getUserStoragePath } = require('../utils/storage');

/**
 * GET /api/users - List all users (admin only)
 */
const listUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, is_active } = req.query;
  const where = {};
  if (is_active !== undefined) where.is_active = is_active === 'true';

  const { count, rows } = await User.findAndCountAll({
    where,
    attributes: { exclude: ['password_hash'] },
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
    order: [['created_at', 'DESC']],
  });

  res.json({
    total: count,
    page: parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(count / parseInt(limit)),
    users: rows,
  });
});

/**
 */
const createUser = asyncHandler(async (req, res) => {
  const { username, email, password, display_name, is_admin = false, max_storage_gb, max_storage_bytes } = req.body;
  if (!username || !email || !password) {
    throw new AppError('username, email and password are required', 400);
  }
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const storageFolder = username.trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '_');

  let storageLimit = null;
  if (max_storage_bytes !== undefined) {
    storageLimit = max_storage_bytes ? Number(max_storage_bytes) : null;
  } else if (max_storage_gb !== undefined) {
    storageLimit = Number(max_storage_gb) > 0 ? Math.round(Number(max_storage_gb) * 1024 * 1024 * 1024) : null;
  }

  const user = await User.create({
    username,
    email,
    password_hash: password,
    display_name: display_name || username,
    is_admin: Boolean(is_admin),
    storage_folder: storageFolder,
    max_storage_bytes: storageLimit,
  });

  // Create the user's storage directory
  await getUserStoragePath(storageFolder);

  res.status(201).json({
    message: 'User created successfully',
    user: user.toSafeJSON(),
  });
});

/**
 * GET /api/users/:id - Get user details
 */
const getUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Non-admin users can only view themselves
  if (!req.user.is_admin && req.user.id !== id) {
    throw new AppError('Access denied', 403);
  }

  const user = await User.findByPk(id, {
    attributes: { exclude: ['password_hash'] },
  });
  if (!user) throw new AppError('User not found', 404);

  res.json({ user });
});

/**
 * PATCH /api/users/:id - Update user
 */
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Non-admin users can only update themselves
  if (!req.user.is_admin && req.user.id !== id) {
    throw new AppError('Acesso negado', 403);
  }

  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuário não encontrado', 404);

  const allowed = ['display_name', 'email'];
  if (req.user.is_admin) {
    allowed.push('is_active', 'is_admin', 'username', 'max_storage_bytes');
  }

  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  // Prevent admin from removing their own admin status or deactivating themselves
  if (req.user.id === id) {
    if (updates.is_admin === false) {
      throw new AppError('Você não pode remover seu próprio privilégio de administrador', 400);
    }
    if (updates.is_active === false) {
      throw new AppError('Você não pode desativar sua própria conta', 400);
    }
  }

  // Password update (optional)
  if (req.body.password && typeof req.body.password === 'string' && req.body.password.trim()) {
    const pwd = req.body.password.trim();
    if (pwd.length < 6) {
      throw new AppError('A senha deve ter no mínimo 6 caracteres', 400);
    }
    updates.password_hash = pwd;
  }

  if (req.user.is_admin && req.body.max_storage_gb !== undefined) {
    const gb = Number(req.body.max_storage_gb);
    updates.max_storage_bytes = gb > 0 ? Math.round(gb * 1024 * 1024 * 1024) : null;
  }

  await user.update(updates);
  res.json({ message: 'Usuário atualizado com sucesso', user: user.toSafeJSON() });
});

/**
 * DELETE /api/users/:id - Delete user (admin only, cannot delete self)
 * Accepts query or body: delete_files (boolean)
 */
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (req.user.id === id) {
    throw new AppError('Você não pode excluir sua própria conta de administrador', 400);
  }

  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuário não encontrado', 404);

  const shouldDeleteFiles = req.query.delete_files === 'true' || req.body.delete_files === true;
  const storageFolder = user.storage_folder;

  // If requested, also physically delete the user storage folder and all its files from disk
  if (shouldDeleteFiles && storageFolder) {
    const { deleteUserStorageFolder } = require('../utils/storage');
    await deleteUserStorageFolder(storageFolder);
  }

  // Delete user from database (cascades to all associated Media, Albums, Galleries, etc.)
  await user.destroy();

  res.json({
    message: shouldDeleteFiles
      ? 'Usuário e todos os arquivos em disco foram excluídos permanentemente.'
      : 'Usuário excluído com sucesso. A pasta e os arquivos em disco foram preservados.',
    deleted_files: shouldDeleteFiles,
  });
});

/**
 * GET /api/users/:id/stats - Storage and media stats for a user
 */
const getUserStats = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!req.user.is_admin && req.user.id !== id) {
    throw new AppError('Access denied', 403);
  }

  const { Media, Album, Gallery } = require('../models');
  const { sequelize } = require('../config/database');

  const [mediaStats] = await sequelize.query(
    `SELECT 
      COUNT(*) as total_media,
      COUNT(*) FILTER (WHERE media_type = 'photo') as total_photos,
      COUNT(*) FILTER (WHERE media_type = 'video') as total_videos,
      COALESCE(SUM(file_size_bytes), 0) as storage_used_bytes
    FROM media WHERE user_id = :userId`,
    { replacements: { userId: id }, type: sequelize.QueryTypes.SELECT }
  );

  const albumCount = await Album.count({ where: { user_id: id } });
  const galleryCount = await Gallery.count({ where: { user_id: id } });

  res.json({
    user_id: id,
    media: {
      total: parseInt(mediaStats.total_media),
      photos: parseInt(mediaStats.total_photos),
      videos: parseInt(mediaStats.total_videos),
    },
    storage_used_bytes: parseInt(mediaStats.storage_used_bytes),
    storage_used_mb: (parseInt(mediaStats.storage_used_bytes) / 1024 / 1024).toFixed(2),
    albums: albumCount,
    galleries: galleryCount,
  });
});

module.exports = { listUsers, createUser, getUser, updateUser, deleteUser, getUserStats };
