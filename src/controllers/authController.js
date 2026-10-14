const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { User } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { getUserStoragePath } = require('../utils/storage');

/**
 * POST /api/auth/setup
 * Create the first admin user (only works when no users exist)
 */
const setup = asyncHandler(async (req, res) => {
  const userCount = await User.count();
  if (userCount > 0) {
    throw new AppError('Setup already completed. An admin user already exists.', 403);
  }

  const { username, email, password, display_name } = req.body;
  if (!username || !email || !password) {
    throw new AppError('username, email and password are required', 400);
  }
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const storageFolder = username.trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '_');
  const user = await User.create({
    username,
    email,
    password_hash: password,
    display_name: display_name || username,
    is_admin: true,
    storage_folder: storageFolder,
  });

  // Create the user's storage directory
  await getUserStoragePath(storageFolder);

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  res.status(201).json({
    message: '✅ Admin user created successfully!',
    token,
    user: user.toSafeJSON(),
  });
});

/**
 * GET /api/auth/setup-status
 * Check if setup has been completed
 */
const setupStatus = asyncHandler(async (req, res) => {
  const userCount = await User.count();
  res.json({
    setup_completed: userCount > 0,
    needs_setup: userCount === 0,
    needsSetup: userCount === 0,
    user_count: userCount,
    message: userCount > 0
      ? 'System is configured. Please login.'
      : 'First time setup required. POST /api/auth/setup to create admin user.',
  });
});

/**
 * POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    throw new AppError('username and password are required', 400);
  }

  // Find by username or email
  const user = await User.findOne({
    where: {
      [require('sequelize').Op.or]: [{ username }, { email: username }],
    },
  });

  if (!user || !user.is_active) {
    throw new AppError('Invalid credentials', 401);
  }

  const valid = await user.validatePassword(password);
  if (!valid) {
    throw new AppError('Invalid credentials', 401);
  }

  // Update last login
  await user.update({ last_login_at: new Date() });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  res.json({
    token,
    user: user.toSafeJSON(),
  });
});

/**
 * POST /api/auth/refresh
 * Returns a new token if the current one is still valid
 */
const refresh = asyncHandler(async (req, res) => {
  const token = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
  res.json({ token, user: req.user.toSafeJSON() });
});

/**
 * GET /api/auth/me
 */
const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
});

/**
 * POST /api/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    throw new AppError('current_password and new_password are required', 400);
  }
  if (new_password.length < 8) {
    throw new AppError('New password must be at least 8 characters', 400);
  }

  const valid = await req.user.validatePassword(current_password);
  if (!valid) {
    throw new AppError('Current password is incorrect', 401);
  }

  await req.user.update({ password_hash: new_password });
  res.json({ message: 'Password updated successfully' });
});

module.exports = { setup, setupStatus, login, refresh, me, changePassword };
