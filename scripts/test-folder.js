// Test endpoint /api/folder/* (folder sync).
// Verifica: status, config, test, export, analyze-import, import (con resolutions).
// Richiede server in ascolto su SERVER (default http://localhost:3099).

const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVER = process.env.SERVER || 'http://localhost:3099';
let pass = 0, fail = 0;
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const STEP = '\x1b[36m▶\x1b[0m';

function ok(m) { pass++; console.log('  ' + PASS + ' ' + m); }
function bad(m) { fail++; console.log('  ' + FAIL + ' ' + m); }
function step(m) { console.log('\n' + STEP + ' ' + m); }
function assert(cond, label) { if (cond) ok(label); else bad(label); }

async function api(p, opts = {}) {
  const res = await fetch(SERVER + p, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function postJson(p, body) {
  return api(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
}

function rmRf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
}

(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  TEST endpoint folder-sync (Importa cartella)');
  console.log('═══════════════════════════════════════════════════════════');

  const tmpRoot = path.join(os.tmpdir(), 'rpg-folder-test-' + Date.now());

  step('1. /api/folder/status risponde');
  const s1 = await api('/api/folder/status');
  assert(s1.ok, 'status risponde 200');
  assert(s1.data.hasOwnProperty('folderPath'), 'campo folderPath presente');
  assert(s1.data.hasOwnProperty('autoExport'), 'campo autoExport presente');

  step('2. /api/folder/test su path inesistente: viene creato e ok=true');
  const t1 = await postJson('/api/folder/test', { folderPath: tmpRoot });
  assert(t1.ok && t1.data.ok === true, 'test ritorna ok per cartella creabile');
  assert(fs.existsSync(tmpRoot), 'cartella effettivamente creata sul disco');

  step('3. /api/folder/test rifiuta path vuoto');
  const t2 = await postJson('/api/folder/test', { folderPath: '' });
  assert(t2.status === 400, 'POST /test con path vuoto -> 400');

  step('4. /api/folder/config salva path + autoExport');
  const c1 = await postJson('/api/folder/config', { folderPath: tmpRoot, autoExport: false });
  assert(c1.ok && c1.data.success, 'config salvato');
  assert(c1.data.config.folderPath === tmpRoot, 'config.folderPath ritornato');
  assert(c1.data.config.autoExport === false, 'config.autoExport = false ritornato');

  step('5. /api/folder/status riflette il config salvato');
  const s2 = await api('/api/folder/status');
  assert(s2.data.folderPath === tmpRoot, 'status.folderPath = path salvato');
  assert(s2.data.autoExport === false, 'status.autoExport = false');
  assert(s2.data.folderUsable && s2.data.folderUsable.ok === true, 'folderUsable.ok = true');

  step('6. /api/folder/export crea manifest + config.json + README + images + rooms');
  const e1 = await postJson('/api/folder/export', {});
  assert(e1.ok, 'export risponde 200');
  assert(e1.data.configWritten === true, 'config.json scritto');
  assert(typeof e1.data.images === 'object', 'risposta contiene blocco images');
  assert(typeof e1.data.rooms === 'object', 'risposta contiene blocco rooms');
  assert(fs.existsSync(path.join(tmpRoot, 'manifest.json')), 'manifest.json esiste');
  assert(fs.existsSync(path.join(tmpRoot, 'config.json')), 'config.json esiste');
  assert(fs.existsSync(path.join(tmpRoot, 'README.md')), 'README.md esiste');
  assert(fs.existsSync(path.join(tmpRoot, 'images', 'heroes')), 'images/heroes/ esiste');
  assert(fs.existsSync(path.join(tmpRoot, 'rooms')), 'rooms/ esiste');

  step('7. manifest.json ha schema corretto');
  const manifest = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'manifest.json'), 'utf8'));
  assert(manifest.version === 1, 'manifest.version = 1');
  assert(manifest.appName === 'RPG Initiative Tracker', 'manifest.appName corretto');
  assert(typeof manifest.exportedAt === 'number', 'manifest.exportedAt timestamp');
  assert(typeof manifest.counts === 'object', 'manifest.counts presente');

  step('8. /api/folder/analyze-import legge manifest e contenuti');
  const a1 = await postJson('/api/folder/analyze-import', {});
  assert(a1.ok, 'analyze-import risponde 200');
  assert(a1.data.manifest && a1.data.manifest.version === 1, 'analysis.manifest letto');
  assert(a1.data.hasConfig === true, 'analysis.hasConfig = true (export appena scritto)');
  assert(Array.isArray(a1.data.rooms), 'analysis.rooms è array');
  // Le rooms appena esportate esistono già nel DB → tutte 'exists: true'
  if (a1.data.rooms.length > 0) {
    assert(a1.data.rooms.every(r => r.exists === true), 'tutte le rooms esportate sono "esistenti"');
    assert(a1.data.rooms.every(r => r.action === 'ask'), 'action = ask per esistenti');
  } else {
    ok('nessuna room (ok in DB vuoto)');
  }

  step('9. /api/folder/import senza resolutions: salta tutte le room esistenti');
  const i1 = await postJson('/api/folder/import', {});
  assert(i1.ok, 'import risponde 200');
  assert(i1.data.configImported === true, 'config importato');
  assert(typeof i1.data.images === 'object', 'risposta contiene images');
  assert(typeof i1.data.rooms === 'object', 'risposta contiene rooms');
  if (a1.data.rooms.length > 0) {
    assert(i1.data.rooms.skipped === a1.data.rooms.length, 'tutte le rooms esistenti saltate (default safe)');
    assert(i1.data.rooms.overwritten === 0, 'zero overwrite senza resolutions');
  } else {
    ok('skip-test n/a (nessuna room)');
  }

  step('10. /api/folder/import con resolutions=overwrite: sovrascrive');
  if (a1.data.rooms.length > 0) {
    const resolutions = {};
    a1.data.rooms.forEach(r => { resolutions[r.id] = 'overwrite'; });
    const i2 = await postJson('/api/folder/import', { resolutions });
    assert(i2.ok, 'import risponde 200');
    assert(i2.data.rooms.overwritten === a1.data.rooms.length, 'tutte le rooms sovrascritte');
    assert(i2.data.rooms.skipped === 0, 'nessuno skip');
  } else {
    ok('overwrite-test n/a');
  }

  step('11. analyze-import su path non configurato: errore esplicito');
  // Reset config a null
  await postJson('/api/folder/config', { folderPath: '' });
  const a2 = await postJson('/api/folder/analyze-import', {});
  assert(a2.status === 400 && /non configurato/i.test(a2.data.error || ''), 'errore "non configurato"');

  // Cleanup config + cartella temp
  rmRf(tmpRoot);
  await postJson('/api/folder/config', { folderPath: '', autoExport: true });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  RISULTATI: ${pass} passati, ${fail} falliti`);
  console.log('═══════════════════════════════════════════════════════════');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
