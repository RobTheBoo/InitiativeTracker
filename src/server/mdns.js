// Pubblica il server in mDNS/Bonjour per discovery automatico sulla LAN.
// I telefoni possono cercare il servizio "_rpg-initiative._tcp" oppure
// risolvere direttamente l'hostname "rpg-tracker.local" (zero-config).

let bonjourInstance = null;
let publishedService = null;

async function startMdns(port, opts = {}) {
  if (publishedService) return publishedService;

  let Bonjour;
  try {
    Bonjour = require('bonjour-service').Bonjour;
  } catch (e) {
    console.warn('⚠️  bonjour-service non installato, mDNS disabilitato:', e.message);
    return null;
  }

  try {
    bonjourInstance = new Bonjour();
    publishedService = bonjourInstance.publish({
      name: opts.name || 'RPG Initiative Tracker',
      type: 'rpg-initiative',
      protocol: 'tcp',
      port,
      txt: {
        version: opts.version || '1.0.0',
        path: '/',
        master: opts.masterPath || '/master.html',
        tablet: opts.tabletPath || '/tablet.html'
      },
      host: opts.hostname || 'rpg-tracker'
    });

    publishedService.on('error', (err) => {
      console.warn('⚠️  mDNS errore:', err.message);
    });

    console.log(`🌐 mDNS attivo: rpg-tracker.local:${port} (servizio _rpg-initiative._tcp)`);
    return publishedService;
  } catch (e) {
    console.warn('⚠️  mDNS non disponibile:', e.message);
    return null;
  }
}

async function stopMdns() {
  if (publishedService) {
    try { publishedService.stop(); } catch (_) {}
    publishedService = null;
  }
  if (bonjourInstance) {
    try { bonjourInstance.destroy(); } catch (_) {}
    bonjourInstance = null;
  }
}

module.exports = { startMdns, stopMdns };
