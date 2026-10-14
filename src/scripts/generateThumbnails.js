/**
 * Script de Geração de Miniaturas em Lote (Backfill)
 * Gera miniaturas WebP de alta performance em disco para todas as fotos existentes no banco.
 * Uso: node src/scripts/generateThumbnails.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Media, User } = require('../models');
const { sequelize } = require('../config/database');
const { getMediaAbsPath, getThumbnailAbsPath, getThumbnailJpgAbsPath, initStorage } = require('../utils/storage');
const { generateMediaThumbnail } = require('../utils/thumbnail');
const logger = require('../utils/logger');

async function run() {
  try {
    await initStorage();
    await sequelize.authenticate();
    logger.info('🚀 Conectado ao banco de dados. Buscando mídias...');

    const allMedia = await Media.findAll({
      attributes: ['id', 'stored_filename', 'media_type', 'user_id'],
      include: [{ model: User, as: 'owner', attributes: ['id', 'storage_folder', 'username'] }],
    });

    logger.info(`Total de mídias encontradas no banco: ${allMedia.length}`);

    let generated = 0;
    let skipped = 0;
    let missingOriginal = 0;

    for (let i = 0; i < allMedia.length; i++) {
      const media = allMedia[i];
      const storageFolder = media.owner?.storage_folder || media.owner?.username;
      if (!storageFolder) {
        skipped++;
        continue;
      }

      const webpThumb = getThumbnailAbsPath(media.id);
      const jpgThumb = getThumbnailJpgAbsPath(media.id);

      // Se já possui miniatura em disco, pula
      if (fs.existsSync(webpThumb) || fs.existsSync(jpgThumb)) {
        skipped++;
        continue;
      }

      const absOriginal = getMediaAbsPath(storageFolder, media.stored_filename);
      if (!fs.existsSync(absOriginal)) {
        missingOriginal++;
        continue;
      }

      try {
        const thumb = await generateMediaThumbnail(media.id, absOriginal, media.media_type);
        if (thumb) {
          generated++;
          if (generated % 10 === 0 || generated === 1) {
            logger.info(`[${i + 1}/${allMedia.length}] Miniatura gerada: ${media.stored_filename}`);
          }
        }
      } catch (err) {
        logger.warn(`Falha na miniatura ${media.id}: ${err.message}`);
      }
    }

    logger.info('=============================================');
    logger.info(`✅ Concluído!`);
    logger.info(`Novas miniaturas geradas: ${generated}`);
    logger.info(`Já possuíam miniaturas: ${skipped}`);
    if (missingOriginal > 0) {
      logger.info(`Originais ausentes no disco: ${missingOriginal}`);
    }
    logger.info('=============================================');
    process.exit(0);
  } catch (err) {
    logger.error(`Erro na execução do script: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

run();
