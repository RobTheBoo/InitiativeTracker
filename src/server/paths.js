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
    // Build "portable" di sviluppo (eseguita da dist/win-unpacked): dati accanto
    // all'EXE per non sporcare userData con dati di test.
    if (exeDir.includes('dist') || exeDir.includes('win-unpacked')) {
      const distDataPath = path.resolve(exeDir, '../../app-data');
      return ensureDir(distDataPath);
    }
    // App installata via NSIS: l'EXE sta in Program Files (read-only per utente
    // standard). Usiamo userData per garantire scrittura senza UAC.
    return ensureDir(opts.electronApp.getPath('userData'));
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

  return {
    dataDir,
    projectRoot,
    isPackaged,
    dbPath: path.join(dataDir, 'rpg-tracker.db'),
    configPath: path.join(dataDir, 'config.json'),
    folderSyncConfigPath: path.join(dataDir, 'folder-sync.json'),
    publicDir: path.join(projectRoot, 'public'),
    libraryDir: path.join(projectRoot, 'data'),
    imagesBase,
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

// Pattern di interfacce "virtuali" che NON vanno mai usate come IP primario
// per il QR code: telefoni dei giocatori sulla Wi-Fi non le raggiungono.
// Ordine di esclusione (case-insensitive): VPN aziendali, Tailscale, ZeroTier,
// Hyper-V virtual switch, WSL, VirtualBox, VMware, Bluetooth PAN.
const VIRTUAL_IFACE_PATTERNS = [
  /tailscale/i,
  /vpn/i,
  /zerotier/i,
  /hyper.?v/i,
  /vethernet/i,
  /wsl/i,
  /virtualbox/i,
  /vmware/i,
  /vmnet/i,
  /loopback/i,
  /bluetooth/i,
  /docker/i
];

// Range RFC1918 "tipici" di rete domestica/ufficio in ordine di preferenza.
// Premiamo 192.168.x.x perche' e' il default di quasi tutti i router consumer.
const HOME_NETWORK_PREFERENCE = [
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./
];

function classifyInterface(name, address) {
  // Score piu' basso = piu' preferibile come IP primario.
  // 0..9 = candidato reale, 10..19 = fallback, >=20 = ultima spiaggia.
  const isVirtual = VIRTUAL_IFACE_PATTERNS.some(rx => rx.test(name));
  const homeIdx = HOME_NETWORK_PREFERENCE.findIndex(rx => rx.test(address));
  if (!isVirtual && homeIdx >= 0) return homeIdx; // 0 = 192.168, 1 = 10.x, 2 = 172.x
  if (!isVirtual) return 9;                       // IP pubblico/non-RFC1918 ma fisica
  if (homeIdx >= 0) return 10 + homeIdx;          // virtuale ma RFC1918 (es. Tailscale 100.x non matcha)
  return 20;                                      // virtuale + range esotico (es. Tailscale 100.64/10)
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({
          name,
          address: iface.address,
          score: classifyInterface(name, iface.address)
        });
      }
    }
  }
  // Ordina per score crescente (migliore prima); a parita' di score mantiene l'ordine OS.
  ips.sort((a, b) => a.score - b.score);
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
