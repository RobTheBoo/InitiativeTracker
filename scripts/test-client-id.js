// Test E2E: verifica che il clientId persistente permetta a un giocatore di
// "ricollegarsi" al proprio personaggio dopo una disconnessione.

const { io } = require('socket.io-client');

const SERVER = process.env.SERVER || 'http://localhost:3099';
const CLIENT_ID = 'test-client-' + Date.now();

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function connect(role) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, {
      auth: { clientId: CLIENT_ID, role },
      transports: ['websocket'],
      reconnection: false
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

(async () => {
  console.log('1. Crea stanza via REST...');
  const res = await fetch(`${SERVER}/api/rooms/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test ClientId' })
  });
  const room = await res.json();
  console.log('   roomId:', room.id);

  console.log('2. Connetti come master (clientId=' + CLIENT_ID + ')...');
  const masterCid = 'master-' + Date.now();
  const master = await new Promise((resolve, reject) => {
    const s = io(SERVER, {
      auth: { clientId: masterCid, role: 'master' },
      transports: ['websocket'],
      reconnection: false
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('master connect timeout')), 3000);
  });
  master.emit('joinRoom', room.id);
  await once(master, 'gameState');
  master.emit('becomeMaster');
  await delay(200);

  console.log('3. Connetti player A con clientId=' + CLIENT_ID + ' e claim Achenar...');
  const player1 = await connect('player');
  player1.emit('joinRoom', room.id);
  await once(player1, 'gameState');
  player1.emit('claimHero', 'Achenar');
  const state1 = await once(player1, 'gameState');
  const heroAfterClaim = state1.heroes.find(h => h.id === 'Achenar');
  console.log('   ownerId:', heroAfterClaim.ownerId);
  console.log('   ownerClientId:', heroAfterClaim.ownerClientId);
  if (heroAfterClaim.ownerClientId !== CLIENT_ID) {
    throw new Error('FAIL: ownerClientId non salvato!');
  }
  console.log('   ✓ ownerClientId salvato');

  console.log('4. Disconnetti player A (simula chiusura tab)...');
  player1.disconnect();
  await delay(500);

  console.log('5. Riconnetti con LO STESSO clientId (simula riapertura tab)...');
  const player2 = await connect('player');
  player2.emit('joinRoom', room.id);

  // Aspetta il messaggio di riattacco
  const reattachPromise = once(player2, 'heroReattached');
  const stateP = once(player2, 'gameState');
  const reattach = await Promise.race([
    reattachPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('No heroReattached event in 2s')), 2000))
  ]);
  console.log('   ✓ heroReattached ricevuto:', reattach);

  await stateP;
  console.log('6. Verifica che claimHero su Achenar funzioni senza errori...');
  player2.emit('claimHero', 'Achenar');
  const state2 = await once(player2, 'gameState');
  const heroFinal = state2.heroes.find(h => h.id === 'Achenar');
  console.log('   nuovo ownerId:', heroFinal.ownerId);
  console.log('   ownerClientId invariato:', heroFinal.ownerClientId);
  if (heroFinal.ownerClientId !== CLIENT_ID) {
    throw new Error('FAIL: ownerClientId perso dopo reattach!');
  }
  console.log('   ✓ Riassociazione completata');

  console.log('\n7. Test "altro client tenta di rubare"...');
  const intruder = await new Promise((resolve, reject) => {
    const s = io(SERVER, {
      auth: { clientId: 'intruder-' + Date.now(), role: 'player' },
      transports: ['websocket'],
      reconnection: false
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
  intruder.emit('joinRoom', room.id);
  await once(intruder, 'gameState');
  let claimError = null;
  intruder.on('heroClaimError', (e) => { claimError = e; });
  intruder.emit('claimHero', 'Achenar');
  await delay(300);
  if (!claimError) throw new Error('FAIL: intruso ha potuto prendere Achenar!');
  console.log('   ✓ Intruso bloccato:', claimError.message);

  // Cleanup
  master.disconnect();
  player2.disconnect();
  intruder.disconnect();
  console.log('\n✅ TUTTI I TEST PASSATI');
  process.exit(0);
})().catch(err => {
  console.error('❌ FAIL:', err.message);
  console.error(err);
  process.exit(1);
});
