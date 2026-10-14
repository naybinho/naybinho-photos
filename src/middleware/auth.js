const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const logger = require('../utils/logger');

/**
 * Middleware to authenticate JWT token and load user
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = await User.findByPk(decoded.userId);
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'User not found or inactive' });
  }

  req.user = user;
  next();
});

/**
 * Middleware to require admin role
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

/**
 * Middleware: user can only access their own resources (or admin can access all)
 */
const requireOwnership = (paramField = 'userId') => (req, res, next) => {
  if (req.user.is_admin) return next();
  const targetId = req.params[paramField] || req.body[paramField];
  if (targetId && targetId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
};

module.exports = { authenticate, requireAdmin, requireOwnership };
