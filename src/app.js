const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const albumRoutes = require('./routes/albums');
const galleryRoutes = require('./routes/galleries');
const mediaRoutes = require('./routes/media');
const locationRoutes = require('./routes/locations');
const swaggerRoutes = require('./routes/swagger');
const appUpdateRoutes = require('./routes/appUpdate');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow media streaming
}));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public')));
app.use('/atualizacao', express.static(path.join(__dirname, '../atualizacao')));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000,
  skip: (req) => {
    const url = req.originalUrl || req.url || '';
    // Never rate limit map tiles, thumbnails, media files, or local development
    return (
      process.env.NODE_ENV === 'development' ||
      url.includes('/tiles/') ||
      url.includes('/thumbnail') ||
      url.includes('/file')
    );
  },
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// HTTP logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    service: 'PhotoVault API',
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/albums', albumRoutes);
app.use('/api/galleries', galleryRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/app/update', appUpdateRoutes);
app.use('/api/docs', swaggerRoutes);

// SPA fallback for frontend navigation (compatible with Express 5)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, '../public/index.html'));
  }
  next();
});

// 404 handler for API routes
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

module.exports = app;
