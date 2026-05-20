// Entry point del server Node.js embedded nell'APK Master.
// Gira sotto Capacitor-NodeJS plugin (nodejs-mobile runtime, Node 18 base).
//
// Cosa fa all'avvio:
//   1. Risolve la directory dati scrivibile via bridge.getDataPath().
//   2. Sceglie il binario nativo di better-sqlite3 in base a process.arch
//      (sqlite-prebuilds/android-{arm,arm64,x64}/better_sqlite3.node).
//   3. Crea un server unico via src/server/create-server.js (lo stesso usato
//      da Electron e dal server headless), passando le opts mobile-friendly.
//   4. Ascolta su 0.0.0.0:3001 -> raggiungibile da altri device sulla LAN
//      con http://<IP-LAN-del-telefono>:3001.
//
// IMPORTANTE: i file in `<APK assets>/public/nodejs/` sono read-only.
// Tutto il dato persistente (DB, config.json, immagini upload) DEVE finire
// in dataDir = bridge.getDataPath() che e' la sandbox app scrivibile.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { channel, getDataPath } = require('bridge');

// ----------------------------------------------------------------------------
// Logging helper: il plugin Capacitor-NodeJS inoltra stdout a logcat sotto
// il tag "NodeJS-Engine"; aggiungiamo prefisso visibile per filtrare.
// ----------------------------------------------------------------------------
const log = (...args) => console.log('[RPG mobile]', ...args);
const logErr = (...args) => console.error('[RPG mobile]', ...args);

log('Boot start, process.arch=', process.arch, 'platform=', process.platform);

// ----------------------------------------------------------------------------
// 1. Data directory writable
// ----------------------------------------------------------------------------
const dataDir = getDataPath();
log('dataDir =', dataDir);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ----------------------------------------------------------------------------
// 2. better-sqlite3 native binding per la giusta architettura Android.
// ----------------------------------------------------------------------------
const sqliteBinding = path.join(
  __dirname,
  'sqlite-prebuilds',
  `android-${process.arch}`,
  'better_sqlite3.node'
);
log('sqliteBinding =', sqliteBinding, 'exists=', fs.existsSync(sqliteBinding));
if (!fs.existsSync(sqliteBinding)) {
  logErr(
    'ERRORE: nessun prebuilt better-sqlite3 trovato per process.arch=',
    process.arch,
    '. Disponibili:',
    fs.readdirSync(path.join(__dirname, 'sqlite-prebuilds'))
  );
}

// ----------------------------------------------------------------------------
// 3. Avvio server condiviso. publicDir punta agli assets dell'APK (read-only),
//    libraryDir punta ai dati Pathfinder bundlati. Entrambe risolte rispetto
//    a __dirname dell'index.js.
// ----------------------------------------------------------------------------
let createServer;
try {
  createServer = require('./src/server/create-server').createServer;
} catch (err) {
  logErr('Caricamento create-server fallito:', err && err.stack || err);
  channel.send('node-error', String(err));
  return;
}

const APP_VERSION = (() => {
  try {
    return require('./app-package.json').version;
  } catch (_) {
    return '0.0.0-mobile';
  }
})();

const PORT = 3001;
const HOST = '0.0.0.0';

let server;
try {
  server = createServer({
    port: PORT,
    host: HOST,
    appVersion: APP_VERSION,
    mobile: true,
    dataDir,
    // I file HTML/CSS/JS della webapp sono copiati da BUILDA-APK in
    // public/nodejs/webapp/ -> finiscono in <files>/nodejs/public/webapp/
    // dentro l'APK (il plugin estrae nodeDir nell'app data dir, gli altri
    // file di webDir restano negli assets read-only).
    publicDir: path.join(__dirname, 'webapp'),
    libraryDir: path.join(__dirname, 'data'),
    dbOptions: { nativeBinding: sqliteBinding },
    // mDNS richiede syscalls UDP multicast: il toolkit nodejs-mobile non
    // sempre le supporta, e in ogni caso non e' essenziale per il flusso
    // QR-code che usiamo per l'onboarding mobile. Disabilitato.
    enableMdns: false,
  });
} catch (err) {
  logErr('createServer ha lanciato eccezione:', err && err.stack || err);
  channel.send('node-error', String(err && err.message || err));
  return;
}

server.listen(PORT, HOST)
  .then(({ port }) => {
    const ips = getLocalIPs();
    log(`Server listening on ${HOST}:${port}`);
    log('IPs locali:', JSON.stringify(ips));
    channel.send('node-ready', { port, ips, version: APP_VERSION });
  })
  .catch((err) => {
    logErr('listen() failed:', err && err.stack || err);
    channel.send('node-error', String(err && err.message || err));
  });

// ----------------------------------------------------------------------------
// Bridge utility: il frontend puo' chiedere "get-server-info" per ricevere
// l'URL completo da mostrare nel QR di onboarding.
// ----------------------------------------------------------------------------
channel.addListener('get-server-info', () => {
  channel.send('server-info', {
    port: PORT,
    ips: getLocalIPs(),
    version: APP_VERSION,
  });
});

function getLocalIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) {
        out.push({ name, address: i.address });
      }
    }
  }
  return out;
}
