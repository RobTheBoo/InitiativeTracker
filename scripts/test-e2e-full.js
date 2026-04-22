// E2E completo: simula una partita reale con master + 2 player + tablet.
// Esercita tutto il backend (socket events, REST, persistenza, clientId, mDNS, QR).

const { io } = require('socket.io-client');

const SERVER = process.env.SERVER || 'http://localhost:3099';
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const STEP = '\x1b[36m▶\x1b[0m';

let passed = 0;
let failed = 0;

function log(m) { process.stdout.write(m + '\n'); }
function step(m) { log(`\n${STEP} ${m}`); }
function ok(m) { passed++; log(`  ${PASS} ${m}`); }
function fail(m) { failed++; log(`  ${FAIL} ${m}`); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function assert(cond, label) { if (cond) ok(label); else fail(label); }

function connect(opts) {
  return new Promise((resolve, reject) => {
    const s = io(SERVER, {
      auth: opts.auth || {},
      transports: ['websocket'],
      reconnection: false,
      forceNew: true
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 4000);
  });
}

function once(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${event}`)), timeout);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

// "Spia": un nuovo socket che entra nella stanza solo per leggere lo stato corrente.
async function readState(roomId) {
  const spy = await connect({ auth: { clientId: 'spy-' + Date.now() + '-' + Math.random(), role: 'spectator' } });
  spy.emit('joinRoom', roomId);
  const state = await once(spy, 'gameState');
  spy.disconnect();
  return state;
}

(async () => {
  log('═══════════════════════════════════════════════════════════');
  log('  E2E TEST COMPLETO - RPG Initiative Tracker');
  log('  Server: ' + SERVER);
  log('═══════════════════════════════════════════════════════════');

  // ─── 1. Health ─────────────────────────────────────────────────────────
  step('1. Health check del server');
  const h = await fetch(`${SERVER}/api/health`).then(r => r.json());
  assert(h.ok === true, 'Server risponde');
  assert(typeof h.version === 'string', 'Versione: ' + h.version);

  // ─── 2. Server info ────────────────────────────────────────────────────
  step('2. Server info per discovery');
  const info = await fetch(`${SERVER}/api/server-info`).then(r => r.json());
  assert(info.primaryIp, 'primaryIp = ' + info.primaryIp);
  assert(Array.isArray(info.ips), 'lista IP esposta');
  assert(info.mdnsHost === 'rpg-tracker.local', 'mDNS host = rpg-tracker.local');
  assert(info.playerUrl?.startsWith('http'), 'playerUrl pronto per QR');

  // ─── 3. QR PNG ─────────────────────────────────────────────────────────
  step('3. Generazione QR code');
  const qrRes = await fetch(`${SERVER}/api/qr?url=http://test:3001/`);
  const qrBuf = Buffer.from(await qrRes.arrayBuffer());
  assert(qrRes.headers.get('content-type') === 'image/png', 'Content-Type = image/png');
  assert(qrBuf.length > 500, `QR PNG (${qrBuf.length} bytes)`);
  assert(qrBuf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), 'PNG signature valida');

  // ─── 4. Library ────────────────────────────────────────────────────────
  step('4. Libreria Pathfinder 1E');
  const lib = await fetch(`${SERVER}/api/library`).then(r => r.json());
  assert(Array.isArray(lib.conditions) && lib.conditions.length > 0, `${lib.conditions.length} condizioni`);
  assert(Array.isArray(lib.bonusTypes), `${lib.bonusTypes.length} tipi bonus`);

  // ─── 5. Crea stanza ────────────────────────────────────────────────────
  step('5. Creazione stanza');
  const room = await fetch(`${SERVER}/api/rooms/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dungeon E2E Test' })
  }).then(r => r.json());
  assert(room.id && room.name === 'Dungeon E2E Test', `Stanza creata: ${room.id}`);
  const rooms = await fetch(`${SERVER}/api/rooms`).then(r => r.json());
  assert(rooms.find(r => r.id === room.id), 'Stanza presente in /api/rooms');

  // ─── 6. Master ─────────────────────────────────────────────────────────
  step('6. Master si connette e joina la stanza');
  const masterCid = 'master-' + Date.now();
  const master = await connect({ auth: { clientId: masterCid, role: 'master' } });
  master.emit('joinRoom', room.id);
  let s = await once(master, 'gameState');
  assert(s.heroes.length === 6, '6 eroi default');
  master.emit('becomeMaster');
  await delay(300);
  s = await readState(room.id);
  assert(s.masterId === master.id, 'Master assegnato');

  // ─── 7. 2 player ───────────────────────────────────────────────────────
  step('7. 2 giocatori si connettono e prendono eroi');
  const p1Cid = 'player1-' + Date.now();
  const p2Cid = 'player2-' + Date.now();
  const p1 = await connect({ auth: { clientId: p1Cid, role: 'player' } });
  const p2 = await connect({ auth: { clientId: p2Cid, role: 'player' } });
  p1.emit('joinRoom', room.id); await once(p1, 'gameState');
  p2.emit('joinRoom', room.id); await once(p2, 'gameState');

  p1.emit('claimHero', 'Achenar');
  await delay(200);
  p2.emit('claimHero', 'Gustav');
  await delay(200);

  s = await readState(room.id);
  const ach = s.heroes.find(h => h.id === 'Achenar');
  const gus = s.heroes.find(h => h.id === 'Gustav');
  assert(ach.ownerId === p1.id, 'Achenar ownerId = player1');
  assert(gus.ownerId === p2.id, 'Gustav ownerId = player2');
  assert(ach.ownerClientId === p1Cid, 'Achenar ownerClientId persistente');
  assert(gus.ownerClientId === p2Cid, 'Gustav ownerClientId persistente');

  // ─── 8. Iniziative ─────────────────────────────────────────────────────
  step('8. Set iniziative eroi');
  p1.emit('setHeroInitiative', { heroId: 'Achenar', initiative: 18 });
  p2.emit('setHeroInitiative', { heroId: 'Gustav', initiative: 14 });
  await delay(200);
  s = await readState(room.id);
  assert(s.heroes.find(h => h.id === 'Achenar').initiative === 18, 'Achenar init = 18');
  assert(s.heroes.find(h => h.id === 'Gustav').initiative === 14, 'Gustav init = 14');

  // ─── 9. Master aggiunge nemici/alleati ─────────────────────────────────
  step('9. Master aggiunge 2 nemici e 1 alleato');
  master.emit('addEnemy', { name: 'Goblin', initiative: 15, icon: '👹' });
  master.emit('addEnemy', { name: 'Orco', initiative: 12, icon: '👺' });
  master.emit('addAlly', { name: 'Aragorn', initiative: 16 });
  await delay(300);
  s = await readState(room.id);
  assert(s.enemies.length === 2, `${s.enemies.length} nemici`);
  assert(s.allies.length === 1, `${s.allies.length} alleati`);
  assert(s.enemies[0].name === 'Goblin' && s.enemies[1].name === 'Orco', 'Nomi nemici corretti');
  assert(s.allies[0].name === 'Aragorn', 'Nome alleato corretto');

  // ─── 10. Inizia combattimento ──────────────────────────────────────────
  step('10. Inizia combattimento');
  master.emit('startCombat');
  await delay(300);
  s = await readState(room.id);
  assert(s.combatStarted, 'combatStarted = true');
  assert(s.currentRound === 1, 'currentRound = 1');
  assert(s.turnOrder.length === 5, `${s.turnOrder.length}/5 entita' nel turn order`);
  assert(s.turnOrder[0].initiative === 18, 'Primo turno: init 18 (Achenar)');
  assert(s.turnOrder[s.turnOrder.length - 1].initiative === 12, 'Ultimo turno: init 12 (Orco)');

  // ─── 11. Effetti ───────────────────────────────────────────────────────
  step('11. Effetti su personaggi');
  p1.emit('addEffect', { targetId: 'Achenar', effect: { name: 'Furia', isBonus: true, duration: 3 } });
  const goblinId = s.enemies[0].id;
  master.emit('addEffect', { targetId: goblinId, effect: { name: 'Spaventato', isBonus: false, duration: 2 } });
  await delay(300);
  s = await readState(room.id);
  const achE = s.heroes.find(h => h.id === 'Achenar');
  assert(achE.effects.length === 1 && achE.effects[0].name === 'Furia', 'Effetto Furia su Achenar');
  assert(s.enemies.find(e => e.id === goblinId).effects.length === 1, 'Effetto Spaventato sul Goblin');

  // ─── 12. Effetti area ──────────────────────────────────────────────────
  step('12. Effetto ad area');
  p1.emit('addAreaEffect', { name: 'Nebbia Oscura', duration: 4 });
  await delay(200);
  s = await readState(room.id);
  assert(s.areaEffects.length === 1, 'Effetto area presente');
  assert(s.areaEffects[0].name === 'Nebbia Oscura', 'Nome corretto');

  // ─── 13. nextTurn x 5 -> nuovo round, decremento durate ────────────────
  step('13. Avanzamento turni: nextTurn x 5 -> nuovo round');
  for (let i = 0; i < 5; i++) {
    master.emit('nextTurn');
    await delay(120);
  }
  s = await readState(room.id);
  assert(s.currentRound === 2, `Round avanzato a ${s.currentRound}`);
  // Furia 3->2, Spaventato 2->1, Nebbia 4->3
  const ach2 = s.heroes.find(h => h.id === 'Achenar');
  assert(ach2.effects[0].remainingRounds === 2, `Furia residuo: ${ach2.effects[0].remainingRounds} (atteso 2)`);
  assert(s.areaEffects[0].remainingRounds === 3, `Nebbia residuo: ${s.areaEffects[0].remainingRounds} (atteso 3)`);

  // ─── 14. prevTurn ──────────────────────────────────────────────────────
  step('14. prevTurn (torna indietro)');
  const turnBefore = s.currentTurn;
  master.emit('prevTurn');
  await delay(200);
  s = await readState(room.id);
  assert(s.currentTurn !== turnBefore, `currentTurn cambiato (${turnBefore} -> ${s.currentTurn})`);

  // ─── 15. Disconnect+riconnect con stesso clientId ──────────────────────
  step('15. Player 1 disconnette e riconnette con stesso clientId');
  p1.disconnect();
  await delay(400);
  const p1Re = await connect({ auth: { clientId: p1Cid, role: 'player' } });
  p1Re.emit('joinRoom', room.id);
  const reattach = await once(p1Re, 'heroReattached', 2000).catch(() => null);
  assert(reattach && reattach.heroId === 'Achenar', 'heroReattached emesso per Achenar');
  s = await readState(room.id);
  const ach3 = s.heroes.find(h => h.id === 'Achenar');
  assert(ach3.ownerId === p1Re.id, 'Nuovo socket assegnato come owner');
  assert(ach3.ownerClientId === p1Cid, 'ownerClientId invariato');
  assert(ach3.effects.length === 1, 'Effetti del personaggio mantenuti');

  // ─── 16. Intruso bloccato ──────────────────────────────────────────────
  step('16. Intruso prova a rubare Achenar -> deve essere bloccato');
  const intruder = await connect({ auth: { clientId: 'intruder-' + Date.now(), role: 'player' } });
  intruder.emit('joinRoom', room.id);
  await once(intruder, 'gameState');
  let intruderError = null;
  intruder.on('heroClaimError', (e) => { intruderError = e; });
  intruder.emit('claimHero', 'Achenar');
  await delay(400);
  assert(intruderError !== null, 'heroClaimError ricevuto');
  s = await readState(room.id);
  assert(s.heroes.find(h => h.id === 'Achenar').ownerClientId === p1Cid, 'Achenar resta a player1');

  // ─── 17. Tablet ────────────────────────────────────────────────────────
  step('17. Tablet si connette');
  const tablet = await connect({ auth: { clientId: 'tablet-' + Date.now(), role: 'tablet' } });
  tablet.emit('joinRoom', room.id);
  s = await once(tablet, 'gameState');
  assert(s.combatStarted === true, 'Tablet riceve combatStarted');
  assert(s.turnOrder.length === 5, 'Tablet vede turn order completo');
  assert(s.areaEffects.length === 1, 'Tablet vede effetti area');

  // ─── 18. Stop+reset ────────────────────────────────────────────────────
  step('18. Stop combat + reset');
  master.emit('stopCombat');
  await delay(200);
  s = await readState(room.id);
  assert(s.combatStarted === false, 'combatStarted = false');

  master.emit('resetAll');
  await delay(300);
  s = await readState(room.id);
  assert(s.enemies.length === 0, 'Nemici resettati');
  assert(s.allies.length === 0, 'Alleati resettati');
  assert(s.heroes.every(h => h.ownerId === null), 'Tutti gli eroi liberati');

  // ─── 19. Persistenza ───────────────────────────────────────────────────
  step('19. Persistenza: stanza esiste ancora in DB');
  const roomsAfter = await fetch(`${SERVER}/api/rooms`).then(r => r.json());
  assert(roomsAfter.find(r => r.id === room.id), 'Stanza ancora persistita su SQLite');

  // ─── 20. Cleanup ───────────────────────────────────────────────────────
  step('20. Cleanup');
  await fetch(`${SERVER}/api/rooms/${room.id}`, { method: 'DELETE' });
  ok('Stanza eliminata');

  master.disconnect();
  p1Re.disconnect();
  p2.disconnect();
  intruder.disconnect();
  tablet.disconnect();

  log('\n═══════════════════════════════════════════════════════════');
  log(`  RISULTATI: ${passed} passati, ${failed} falliti`);
  log('═══════════════════════════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  log('\n' + FAIL + ' ECCEZIONE: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});
