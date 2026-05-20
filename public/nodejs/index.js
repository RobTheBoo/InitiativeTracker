// Hello-world server di prova per il PoC Step 1.
// Gira nel processo Node.js embedded del plugin capacitor-nodejs.
// Verra' sostituito allo Step 2 dal porting di src/server/create-server.js.
//
// Cosa fa:
//   - Apre un Express server su 0.0.0.0:3001 (ascolta su tutte le interfacce
//     di rete del telefono → raggiungibile via http://<IP-LAN>:3001 da altri
//     device sulla stessa Wi-Fi).
//   - GET /health → { ok, hostname, ips, time }
//   - Notifica via bridge channel "node-ready" quando il server e' su.
//
// Note bridge:
//   - 'bridge' e' un modulo built-in del plugin (non serve npm install).
//   - channel.send(eventName, ...args) per inviare al WebView.
//   - channel.addListener(eventName, handler) per ricevere dal WebView.

const os = require('os');
const http = require('http');
const { channel } = require('bridge');

const PORT = 3001;

// Mini-Express manuale (evitiamo di portare ora la dependency Express,
// per minimizzare il superficie di attacco al PoC). Usiamo solo http.
function getLocalIPs() {
  const ips = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) {
        ips.push({ name, address: i.address });
      }
    }
  }
  return ips;
}

const server = http.createServer((req, res) => {
  // Log richiesta (utile in logcat per capire quando arriva traffico)
  console.log(`[Node mobile] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);

  if (req.method === 'GET' && (req.url === '/health' || req.url === '/api/health')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      ok: true,
      service: 'rpg-tracker-mobile-poc',
      hostname: os.hostname(),
      ips: getLocalIPs(),
      time: new Date().toISOString(),
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(
      'RPG Initiative Tracker — server mobile PoC\n' +
      'IPs locali: ' + JSON.stringify(getLocalIPs()) + '\n' +
      'Endpoints: GET /health'
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.on('error', (err) => {
  console.error('[Node mobile] Server error:', err);
  channel.send('node-error', String(err && err.message || err));
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log(`[Node mobile] Server listening on 0.0.0.0:${PORT}`);
  console.log('[Node mobile] IPs locali:', JSON.stringify(ips));
  channel.send('node-ready', { port: PORT, ips });
});

// Listener: il frontend puo' chiedere "ping" e ricevere pong (canale aperto).
channel.addListener('ping', (...args) => {
  console.log('[Node mobile] ping ricevuto:', args);
  channel.send('pong', { args, ips: getLocalIPs(), time: Date.now() });
});
