const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error(`${err.name}: ${err.message}`, { stack: err.stack, url: req.originalUrl });

  // Sequelize validation error
  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    const errors = err.errors.map(e => ({ field: e.path, message: e.message }));
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large', maxSize: `${process.env.MAX_FILE_SIZE_MB || 200}MB` });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field' });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }

  // Known app errors
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Generic
  return res.status(500).json({
    error: 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
  });
};

class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

module.exports = { errorHandler, AppError };
