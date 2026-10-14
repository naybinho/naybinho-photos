const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const UPDATE_DIR = path.resolve(__dirname, '../../atualizacao');

// Ensure directory exists
if (!fs.existsSync(UPDATE_DIR)) {
  try {
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
  } catch {}
}

const { execSync } = require('child_process');

let cachedAaptPath = null;
function getAaptPath() {
  if (cachedAaptPath !== null) return cachedAaptPath;
  const sdkDir = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'build-tools');
  if (fs.existsSync(sdkDir)) {
    try {
      const versions = fs.readdirSync(sdkDir).sort().reverse();
      for (const v of versions) {
        const candidate = path.join(sdkDir, v, 'aapt.exe');
        if (fs.existsSync(candidate)) {
          cachedAaptPath = candidate;
          return cachedAaptPath;
        }
      }
    } catch {}
  }
  cachedAaptPath = '';
  return cachedAaptPath;
}

const apkCache = new Map();
function getApkMetadata(apkFilePath, mtimeMs) {
  const cached = apkCache.get(apkFilePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.info;
  }

  const info = { versionCode: 0, versionName: '' };
  const aapt = getAaptPath();
  if (aapt && fs.existsSync(apkFilePath)) {
    try {
      const output = execSync(`"${aapt}" dump badging "${apkFilePath}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000,
      });
      const match = output.match(/package:\s+name='[^']+'\s+versionCode='(\d+)'\s+versionName='([^']+)'/);
      if (match) {
        info.versionCode = parseInt(match[1], 10) || 0;
        info.versionName = match[2] || '';
      }
    } catch (e) {
      console.warn('[AppUpdate] Failed to dump badging for APK:', e.message);
    }
  }

  apkCache.set(apkFilePath, { mtimeMs, info });
  return info;
}

function parseSemver(v) {
  if (!v) return [0, 0, 0];
  const parts = String(v).replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareSemver(v1, v2) {
  const [a1, b1, c1] = parseSemver(v1);
  const [a2, b2, c2] = parseSemver(v2);
  if (a1 !== a2) return a1 - a2;
  if (b1 !== b2) return b1 - b2;
  return c1 - c2;
}

function getAvailableApks() {
  if (!fs.existsSync(UPDATE_DIR)) return [];
  const files = fs.readdirSync(UPDATE_DIR);
  const apks = [];
  for (const file of files) {
    if (file.toLowerCase().endsWith('.apk')) {
      const fullPath = path.join(UPDATE_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        apks.push({
          filename: file,
          fullPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          updatedAt: stat.mtime.toISOString(),
        });
      } catch {}
    }
  }
  // Sort by newest modified time
  apks.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return apks;
}

/**
 * GET /api/app/update/check
 * Query params: versionCode (int), versionName (string), timestamp (number)
 */
router.get('/check', (req, res) => {
  const apks = getAvailableApks();
  if (apks.length === 0) {
    return res.json({
      hasUpdate: false,
      message: 'Nenhum arquivo APK encontrado na pasta atualizacao',
    });
  }

  const latestApk = apks[0];

  // Check version.json in atualizacao folder if exists
  let versionInfo = {};
  const versionFile = path.join(UPDATE_DIR, 'version.json');
  if (fs.existsSync(versionFile)) {
    try {
      versionInfo = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    } catch {}
  }

  // Inspect the actual APK file directly
  const apkMeta = getApkMetadata(latestApk.fullPath, latestApk.mtimeMs);

  const targetVersionCode = Math.max(apkMeta.versionCode || 0, versionInfo.versionCode || 0);
  const targetVersionName = (versionInfo.versionName && compareSemver(versionInfo.versionName, apkMeta.versionName) >= 0)
    ? versionInfo.versionName
    : (apkMeta.versionName || versionInfo.versionName || ('Atualização ' + new Date(latestApk.mtimeMs).toLocaleDateString('pt-BR')));
  const releaseNotes = versionInfo.notes || 'Nova versão disponível com melhorias e correções.';

  const clientVersionCode = parseInt(req.query.currentVersionCode || req.query.versionCode || '0', 10);
  const clientVersionName = String(req.query.currentVersionName || req.query.versionName || '').trim();
  const clientTimestamp = parseInt(req.query.currentTimestamp || req.query.timestamp || '0', 10);

  let hasUpdate = false;

  // Verificação precisa da versão
  if (targetVersionCode > 0 && clientVersionCode > 0) {
    // Oficial: versionCode do servidor DEVE ser estritamente maior que o instalado
    hasUpdate = targetVersionCode > clientVersionCode;
  } else if (targetVersionName && clientVersionName) {
    // Fallback: comparação semântica de versionName (ex: 1.0.3 > 1.0.2)
    hasUpdate = compareSemver(targetVersionName, clientVersionName) > 0;
  } else if (clientTimestamp > 0 && targetVersionCode === 0) {
    // Fallback por timestamp somente se não houver version code
    hasUpdate = latestApk.mtimeMs > (clientTimestamp + 5000);
  } else {
    // Se não há dados do cliente suficientes para confirmar que é antigo, não força update
    hasUpdate = false;
  }

  res.json({
    hasUpdate,
    filename: latestApk.filename,
    fileSize: latestApk.size,
    timestamp: Math.round(latestApk.mtimeMs),
    updatedAt: latestApk.updatedAt,
    versionCode: targetVersionCode,
    versionName: targetVersionName,
    notes: releaseNotes,
    downloadUrl: '/api/app/update/download?file=' + encodeURIComponent(latestApk.filename),
    clientVersionCode,
    clientVersionName,
  });
});

/**
 * GET /api/app/update/download
 * Download the latest APK
 */
router.get('/download', (req, res) => {
  const apks = getAvailableApks();
  if (apks.length === 0) {
    return res.status(404).json({ error: 'Nenhum APK disponível para download na pasta atualizacao' });
  }

  const requestedFile = req.query.file;
  let targetApk = apks[0];
  if (requestedFile) {
    const found = apks.find(a => a.filename === requestedFile);
    if (found) targetApk = found;
  }

  const filePath = path.join(UPDATE_DIR, targetApk.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo APK não encontrado' });
  }

  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="${targetApk.filename}"`);
  res.setHeader('Content-Length', targetApk.size);
  res.setHeader('Cache-Control', 'no-cache');

  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
