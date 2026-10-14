require('dotenv').config();
const app = require('./app');
const { sequelize } = require('./config/database');
const { initStorage } = require('./utils/storage');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    // Initialize database connection
    await sequelize.authenticate();
    logger.info('✅ Database connection established');

    // Sync models (alter: true = safe migrations, no data loss)
    await sequelize.sync({ alter: true });
    logger.info('✅ Database models synchronized');

    // Initialize storage directories
    await initStorage();
    logger.info('✅ Storage directories initialized');

    // Synchronize files and initialize real-time storage watcher
    const { syncStorageOnStartup, initStorageWatcher } = require('./services/storageWatcher');
    await syncStorageOnStartup();
    initStorageWatcher();

    // Start server
    app.listen(PORT, () => {
      logger.info(`🚀 PhotoVault API running on http://localhost:${PORT}`);
      logger.info(`📖 API Docs: http://localhost:${PORT}/api/docs`);
      logger.info(`⚙️  Health: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();
