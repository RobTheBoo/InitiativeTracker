// Test endpoint cloud (struttura, no auth reale).
// Verifica che i 2 provider (onedrive, gdrive) siano gestiti correttamente.

const SERVER = process.env.SERVER || 'http://localhost:3099';
let pass = 0, fail = 0;
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const STEP = '\x1b[36m▶\x1b[0m';

function ok(m) { pass++; console.log('  ' + PASS + ' ' + m); }
function bad(m) { fail++; console.log('  ' + FAIL + ' ' + m); }
function step(m) { console.log('\n' + STEP + ' ' + m); }
function assert(cond, label) { if (cond) ok(label); else bad(label); }

async function api(path, opts = {}) {
  const res = await fetch(SERVER + path, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  TEST endpoint cloud (multi-provider)');
  console.log('═══════════════════════════════════════════════════════════');

  step('1. /api/cloud/status iniziale: entrambi i provider esposti');
  const s1 = await api('/api/cloud/status');
  assert(s1.ok, 'status risponde');
  assert(s1.data.providers?.onedrive, 'provider onedrive presente');
  assert(s1.data.providers?.gdrive, 'provider gdrive presente');
  // Non assumiamo che siano "non configurati" perche' i test possono essere ri-eseguiti
  // su uno stesso data dir; verifichiamo solo che la struttura sia corretta.
  assert(typeof s1.data.providers.onedrive.configured === 'boolean', 'onedrive ha campo configured');
  assert(typeof s1.data.providers.gdrive.configured === 'boolean', 'gdrive ha campo configured');

  step('2. Salva clientId OneDrive');
  const c1 = await api('/api/cloud/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'onedrive', clientId: '11111111-1111-1111-1111-111111111111' })
  });
  assert(c1.ok && c1.data.success, 'OneDrive clientId salvato');

  step('3. Salva clientId Google Drive');
  const c2 = await api('/api/cloud/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gdrive', clientId: '999999999-fakegoogle.apps.googleusercontent.com' })
  });
  assert(c2.ok && c2.data.success, 'Google Drive clientId salvato');

  step('4. /api/cloud/status: entrambi configurati, nessuno connesso');
  const s2 = await api('/api/cloud/status');
  assert(s2.data.providers.onedrive.configured === true, 'onedrive configurato');
  assert(s2.data.providers.onedrive.connected === false, 'onedrive non connesso');
  assert(s2.data.providers.gdrive.configured === true, 'gdrive configurato');
  assert(s2.data.providers.gdrive.connected === false, 'gdrive non connesso');

  step('5. Validazione provider: provider sconosciuto rifiutato');
  const c3 = await api('/api/cloud/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'dropbox', clientId: 'whatever' })
  });
  assert(c3.status === 400, 'POST /config con provider sconosciuto -> 400');

  step('6. /api/cloud/auth/start onedrive con fake clientId -> errore Microsoft (atteso)');
  const a1 = await api('/api/cloud/auth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'onedrive' })
  });
  assert(a1.status === 500 && /not a valid|AADSTS|invalid/i.test(a1.data.error || ''), 'Microsoft contattato e ha rifiutato il fake clientId');

  step('7. /api/cloud/auth/start gdrive: deve avviare loopback server e tornare authUrl');
  const a2 = await api('/api/cloud/auth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gdrive' })
  });
  assert(a2.ok, 'auth/start gdrive risponde 200');
  assert(typeof a2.data.sessionId === 'string', 'sessionId restituito');
  assert(typeof a2.data.verificationUri === 'string' && a2.data.verificationUri.startsWith('https://accounts.google.com'), 'verificationUri valido di Google');
  assert(a2.data.verificationUri.includes('redirect_uri=http%3A%2F%2F127.0.0.1%3A'), 'redirect_uri = loopback 127.0.0.1');
  assert(a2.data.verificationUri.includes('code_challenge='), 'PKCE challenge presente');
  assert(a2.data.verificationUri.includes('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file'), 'scope drive.file presente (minimo necessario)');
  assert(a2.data.userCode === '(apri il link)', 'userCode placeholder per loopback flow');

  step('8. /api/cloud/auth/status sessione gdrive');
  const st = await api('/api/cloud/auth/status/' + a2.data.sessionId);
  assert(st.ok, 'status sessione risponde');
  assert(st.data.status === 'pending', 'status = pending');
  assert(st.data.provider === 'gdrive', 'provider = gdrive');

  step('9. Sync senza connessione: deve dare errore esplicito per provider');
  const sy1 = await api('/api/cloud/sync?provider=onedrive', { method: 'POST' });
  assert(sy1.status === 400 && sy1.data.error?.includes('non connesso'), 'sync onedrive: errore "non connesso"');
  const sy2 = await api('/api/cloud/sync?provider=gdrive', { method: 'POST' });
  assert(sy2.status === 400 && sy2.data.error?.includes('non connesso'), 'sync gdrive: errore "non connesso"');

  step('10. Push senza connessione: stesso comportamento');
  const ph1 = await api('/api/cloud/push?provider=onedrive', { method: 'POST' });
  assert(ph1.status === 400, 'push onedrive: 400 atteso');
  const ph2 = await api('/api/cloud/push?provider=gdrive', { method: 'POST' });
  assert(ph2.status === 400, 'push gdrive: 400 atteso');

  step('11. Disconnect: idempotente');
  const d1 = await api('/api/cloud/auth/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gdrive' })
  });
  assert(d1.ok && d1.data.success, 'disconnect gdrive OK (anche se mai connesso)');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  RISULTATI: ${pass} passati, ${fail} falliti`);
  console.log('═══════════════════════════════════════════════════════════');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
