// OpenStreetMap Nominatim Service
const logger = require('../utils/logger');

/**
 * Reverse geocode GPS coordinates to human-readable address using OpenStreetMap Nominatim
 */
async function reverseGeocodeOSM(latitude, longitude) {
  if (!latitude || !longitude) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PhotoVault-App/1.0 (Photos Self-Hosted App)',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      logger.warn(`OpenStreetMap reverse geocode returned HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data || !data.address) return null;

    const addr = data.address;
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || null;
    const state = addr.state || addr.region || null;
    const country = addr.country || null;
    const country_code = addr.country_code ? addr.country_code.toUpperCase() : null;
    const postal_code = addr.postcode || null;
    const name = addr.road || addr.suburb || city || (data.display_name ? data.display_name.split(',')[0] : 'Local');

    return {
      name,
      city,
      state,
      country,
      country_code,
      postal_code,
      full_address: data.display_name || null,
      osm_id: data.osm_id || null,
      osm_type: data.osm_type || null,
      osm_url: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`,
    };
  } catch (err) {
    logger.error('OpenStreetMap reverse geocoding error:', err.message);
    return null;
  }
}

/**
 * Search locations using OpenStreetMap Nominatim
 */
async function searchOSM(query) {
  if (!query || !query.trim()) return [];

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query.trim())}&addressdetails=1&limit=10`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PhotoVault-App/1.0 (Photos Self-Hosted App)',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    return data.map((item) => {
      const addr = item.address || {};
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      return {
        name: item.name || addr.road || addr.city || (item.display_name ? item.display_name.split(',')[0] : 'Local'),
        latitude: lat,
        longitude: lon,
        city: addr.city || addr.town || addr.village || addr.municipality || null,
        state: addr.state || null,
        country: addr.country || null,
        country_code: addr.country_code ? addr.country_code.toUpperCase() : null,
        postal_code: addr.postcode || null,
        full_address: item.display_name || null,
        osm_url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`,
      };
    });
  } catch (err) {
    logger.error('OpenStreetMap search error:', err.message);
    return [];
  }
}

module.exports = {
  reverseGeocodeOSM,
  searchOSM,
};
