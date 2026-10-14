const exifr = require('exifr');
const logger = require('./logger');

/**
 * Extract EXIF metadata from an image file
 * @param {string} filePath - Absolute path to the image
 * @returns {Object} Parsed EXIF data
 */
async function extractExif(filePath) {
  try {
    const exif = await exifr.parse(filePath, {
      tiff: true,
      xmp: true,
      gps: true,
      iptc: true,
      exif: true,
      all: true,
    });

    if (!exif) return {};

    return {
      taken_at: exif.DateTimeOriginal || exif.DateTime || exif.CreateDate || null,
      camera_make: exif.Make || null,
      camera_model: exif.Model || null,
      latitude: exif.latitude || null,
      longitude: exif.longitude || null,
      altitude: exif.GPSAltitude || null,
      exif_data: {
        iso: exif.ISO,
        exposure_time: exif.ExposureTime,
        f_number: exif.FNumber,
        focal_length: exif.FocalLength,
        flash: exif.Flash,
        white_balance: exif.WhiteBalance,
        orientation: exif.Orientation,
        software: exif.Software,
        lens_model: exif.LensModel,
        width: exif.ImageWidth || exif.ExifImageWidth,
        height: exif.ImageHeight || exif.ExifImageHeight,
      },
    };
  } catch (err) {
    logger.debug(`EXIF extraction failed for ${filePath}: ${err.message}`);
    return {};
  }
}

module.exports = { extractExif };
