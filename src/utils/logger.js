const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve('./logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

function formatMsg(level, msg, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
  return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

const logger = {
  _log(level, msg, meta = {}) {
    if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
    const line = formatMsg(level, msg, meta);
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
    // Append to log file
    const logFile = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFile(logFile, line + '\n', () => {});
  },
  debug(msg, meta) { this._log('debug', msg, meta); },
  info(msg, meta) { this._log('info', msg, meta); },
  warn(msg, meta) { this._log('warn', msg, meta); },
  error(msg, meta) { this._log('error', msg, meta); },
};

module.exports = logger;
