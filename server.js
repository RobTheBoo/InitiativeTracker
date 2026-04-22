// Server standalone (headless) - usato per `npm start` e per il deploy su Render/Railway/VPS.
// Riusa la STESSA factory del Master Electron, così non c'è più drift tra le due implementazioni.

const { createServer } = require('./src/server/create-server');

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const server = createServer({ port: PORT, host: HOST });

server.listen(PORT, HOST).then(({ port }) => {
  const ip = server.paths;
  const { getPrimaryLocalIP } = require('./src/server/paths');
  const localIP = getPrimaryLocalIP();
  console.log('');
  console.log('🎲 RPG Initiative Tracker (headless)');
  console.log('');
  console.log(`📍 Locale:  http://localhost:${port}`);
  console.log(`📍 Rete:    http://${localIP}:${port}`);
  console.log('');
  console.log('PROFILI DISPONIBILI:');
  console.log('  /master.html  - Interfaccia Master');
  console.log('  /tablet.html  - Display Tavolo');
  console.log('  /             - Interfaccia Giocatori');
  console.log('');
}).catch((err) => {
  console.error('❌ Avvio server fallito:', err);
  process.exit(1);
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n${signal} ricevuto, chiusura server...`);
  try {
    await server.close();
    console.log('Server chiuso.');
    process.exit(0);
  } catch (e) {
    console.error('Errore chiusura:', e);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
