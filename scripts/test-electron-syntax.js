// Verifica che electron/main.js sia sintatticamente valido e che richieda solo
// moduli installati. Non avvia Electron (richiede display) ma fa il require di
// tutto il grafo che NON dipende da electron stesso.

const fs = require('fs');
const path = require('path');

let ok = 0, fail = 0;
function pass(m) { ok++; console.log('  \x1b[32m✓\x1b[0m ' + m); }
function err(m, e) { fail++; console.log('  \x1b[31m✗\x1b[0m ' + m + (e ? ': ' + e.message : '')); }

console.log('═══════════════════════════════════════════════════════════');
console.log('  Verifica statica electron/main.js + dipendenze server');
console.log('═══════════════════════════════════════════════════════════\n');

// 1. Sintassi
console.log('▶ 1. Sintassi');
try {
  new Function(fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8'));
  pass('electron/main.js parsing OK');
} catch (e) { err('electron/main.js syntax error', e); }

try {
  new Function(fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8'));
  pass('electron/preload.js parsing OK');
} catch (e) { err('electron/preload.js syntax error', e); }

// 2. Tutti i moduli che createServer richiede (no electron)
console.log('\n▶ 2. Caricamento dipendenze server');
const mods = [
  '../src/server/create-server',
  '../src/server/paths',
  '../src/server/config-store',
  '../src/server/library',
  '../src/server/mdns',
  '../src/folder-sync/folder-store',
  '../src/folder-sync/folder-sync',
  '../src/folder-sync/folder-routes',
  '../electron/database',
  '../electron/room-manager',
  '../electron/game-logic'
];
for (const m of mods) {
  try { require(m); pass(m); } catch (e) { err(m, e); }
}

// 3. createServer puo' essere costruito senza Electron
console.log('\n▶ 3. createServer({}) senza Electron');
try {
  const { createServer } = require('../src/server/create-server');
  const srv = createServer({ port: 0, host: '127.0.0.1', enableMdns: false, projectRoot: path.join(__dirname, '..') });
  pass('createServer() ritorna { app, httpServer, io, roomManager, db, ... }');
  pass('paths.dataDir = ' + srv.paths.dataDir);
  pass('paths.dbPath = ' + srv.paths.dbPath);
  // Cleanup
  srv.close().then(() => {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  RISULTATI: ${ok} passati, ${fail} falliti`);
    console.log('═══════════════════════════════════════════════════════════');
    process.exit(fail > 0 ? 1 : 0);
  });
} catch (e) { err('createServer instantiation', e); process.exit(1); }
