// Centralizza tutti i path: data dir, config, db, immagini.
// Funziona sia in modalità Electron (packaged o dev) sia headless (server.js).

const path = require('path');
const fs = require('fs');
const os = require('os');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

/**
 * Risolve la directory dati persistente.
 *
 * Ordine di precedenza:
 *  1. ENV `RPG_DATA_DIR` (override esplicito, utile per test/CI)
 *  2. Modalità Electron packaged: cartella accanto all'EXE (o in dist/app-data per dev-builds)
 *  3. Modalità Electron dev: <project>/app-data
 *  4. Headless / standalone server: <project>/app-data
 *
 * IMPORTANTE: la cartella NON deve risiedere su OneDrive: SQLite WAL può corrompersi
 * con sync in background. Se rileviamo un path che contiene "OneDrive" emettiamo un warn.
 */
function resolveDataDir(opts = {}) {
  if (process.env.RPG_DATA_DIR) {
    return ensureDir(process.env.RPG_DATA_DIR);
  }

  // Se siamo in Electron e l'app e' packaged
  if (opts.electronApp && opts.electronApp.isPackaged) {
    const exeDir = path.dirname(opts.electronApp.getPath('exe'));
    if (exeDir.includes('dist') || exeDir.includes('win-unpacked')) {
      const distDataPath = path.resolve(exeDir, '../../app-data');
      return ensureDir(distDataPath);
    }
    return ensureDir(exeDir);
  }

  // Dev / headless: usa <project>/app-data
  const projectRoot = opts.projectRoot || path.resolve(__dirname, '..', '..');
  return ensureDir(path.join(projectRoot, 'app-data'));
}

function warnIfOnOneDrive(dataDir) {
  if (/onedrive/i.test(dataDir)) {
    console.warn('');
    console.warn('⚠️  ATTENZIONE: i dati persistenti sono in una cartella OneDrive.');
    console.warn('   Il database SQLite (WAL) può corrompersi con sync in background.');
    console.warn('   Suggerito: imposta RPG_DATA_DIR su una cartella locale (es. %LOCALAPPDATA%/RPG-Initiative-Tracker)');
    console.warn(`   Path attuale: ${dataDir}`);
    console.warn('');
  }
}

function buildPaths(opts = {}) {
  const dataDir = resolveDataDir(opts);
  warnIfOnOneDrive(dataDir);

  const projectRoot = opts.projectRoot || path.resolve(__dirname, '..', '..');

  // In sviluppo (non packaged) le immagini possono restare in public/images per
  // sviluppo veloce; in packaged stanno in app-data/images.
  const isPackaged = !!(opts.electronApp && opts.electronApp.isPackaged);
  const imagesBase = isPackaged
    ? path.join(dataDir, 'images')
    : path.join(projectRoot, 'public', 'images');

  ensureDir(imagesBase);
  ['heroes', 'enemies', 'allies', 'summons'].forEach(sub => ensureDir(path.join(imagesBase, sub)));

  // Cache OneDrive: sempre in dataDir (mai in OneDrive!)
  const cloudCacheDir = ensureDir(path.join(dataDir, 'cloud-cache'));

  return {
    dataDir,
    projectRoot,
    isPackaged,
    dbPath: path.join(dataDir, 'rpg-tracker.db'),
    configPath: path.join(dataDir, 'config.json'),
    cloudConfigPath: path.join(dataDir, 'cloud.json'),
    publicDir: path.join(projectRoot, 'public'),
    libraryDir: path.join(projectRoot, 'data'),
    imagesBase,
    cloudCacheDir,
    getImagesPath: (subfolder) => ensureDir(path.join(imagesBase, subfolder)),
    /**
     * URL pubblico relativo per servire un'immagine ai client.
     * In packaged usiamo `/api/images/...` perché le immagini sono fuori da public/.
     * In dev usiamo `/images/...` perché stanno in public/images.
     */
    toPublicImageUrl: (absoluteFilePath) => {
      const subfolder = path.basename(path.dirname(absoluteFilePath));
      const filename = path.basename(absoluteFilePath);
      if (isPackaged) return `/api/images/${subfolder}/${filename}`;
      return `/images/${subfolder}/${filename}`;
    }
  };
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

function getPrimaryLocalIP() {
  const ips = getLocalIPs();
  return ips.length > 0 ? ips[0].address : 'localhost';
}

module.exports = {
  buildPaths,
  resolveDataDir,
  ensureDir,
  getLocalIPs,
  getPrimaryLocalIP
};
