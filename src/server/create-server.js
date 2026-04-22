// Factory unica per il server HTTP + Socket.IO.
// Usata sia da Electron (electron/main.js) sia dal server headless (server.js).
// Restituisce { app, httpServer, io, roomManager, db, configStore, paths, library, close }

const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const RPGDatabase = require('../../electron/database');
const RoomManager = require('../../electron/room-manager');
const { buildPaths, getLocalIPs, getPrimaryLocalIP } = require('./paths');
const { ConfigStore } = require('./config-store');
const { loadLibrary } = require('./library');
const { startMdns, stopMdns } = require('./mdns');

function createServer(opts = {}) {
  const paths = buildPaths(opts);

  // Config store (con migrazione legacy data/config.json -> app-data/config.json)
  const configStore = new ConfigStore(paths.configPath, {
    legacyPath: path.join(paths.libraryDir, 'config.json')
  });

  // Libreria Pathfinder
  let library = loadLibrary(paths.libraryDir);

  // Database
  const db = new RPGDatabase(paths.dbPath, paths.getImagesPath);

  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/socket.io/'
  });

  const roomManager = new RoomManager(db, io, paths.getImagesPath, () => configStore.load());

  // ----- Middleware globali -----
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Client-Id');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ----- Static -----
  app.use(express.static(paths.publicDir));

  // ----- Health -----
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      version: require('../../package.json').version,
      mode: paths.isPackaged ? 'packaged' : 'dev',
      time: Date.now()
    });
  });

  // ----- Server info (per discovery e per QR) -----
  app.get('/api/server-info', (req, res) => {
    const port = httpServer.address()?.port || opts.port;
    const primaryIp = getPrimaryLocalIP();
    res.json({
      ips: getLocalIPs(),
      primaryIp,
      port,
      hostname: require('os').hostname(),
      mdnsHost: 'rpg-tracker.local',
      appName: 'RPG Initiative Tracker',
      // URL pronto da mostrare in QR (preferisce mDNS hostname per stabilita')
      playerUrl: `http://${primaryIp}:${port}/`,
      tabletUrl: `http://${primaryIp}:${port}/tablet.html`,
      version: require('../../package.json').version
    });
  });

  // ----- QR code immagine PNG per onboarding rapido del telefono -----
  app.get('/api/qr', async (req, res) => {
    try {
      const QRCode = require('qrcode');
      const target = req.query.url || req.query.target;
      const port = httpServer.address()?.port || opts.port;
      const url = target || `http://${getPrimaryLocalIP()}:${port}/`;
      const buf = await QRCode.toBuffer(url, {
        width: parseInt(req.query.size || '320', 10),
        margin: 1,
        color: { dark: '#1a1a2e', light: '#f0c674' }
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.send(buf);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----- Library API -----
  app.get('/api/library', (req, res) => res.json(library));
  app.get('/api/library/conditions', (req, res) => res.json(library.conditions));
  app.get('/api/library/bonus-types', (req, res) => res.json(library.bonusTypes));
  app.get('/api/library/spells', (req, res) => res.json(library.spells));
  app.post('/api/library/reload', (req, res) => {
    library = loadLibrary(paths.libraryDir);
    res.json({ success: true });
  });

  // ----- Image serving (per packaged: immagini fuori da public/) -----
  app.get('/api/images/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    const allowedTypes = ['heroes', 'enemies', 'allies', 'summons'];
    if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'tipo non valido' });
    const safe = path.basename(filename);
    const filePath = path.join(paths.getImagesPath(type), safe);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'non trovata' });
    res.sendFile(filePath);
  });

  // ----- Rooms API -----
  app.get('/api/rooms', (req, res) => {
    res.json(roomManager.getAllRooms());
  });

  app.get('/api/active-room', (req, res) => {
    try {
      const rooms = roomManager.getAllRooms();
      let active = null;
      for (const room of rooms) {
        const state = roomManager.getGameStateForRoom(room.id);
        if (state && state.masterId !== null) { active = room; break; }
      }
      if (active) return res.json({ roomId: active.id, name: active.name });
      if (rooms.length > 0) return res.json({ roomId: rooms[0].id, name: rooms[0].name });
      return res.status(404).json({ error: 'Nessuna stanza disponibile' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/rooms/create', (req, res) => {
    const { name } = req.body || {};
    res.json(roomManager.createRoom(name || 'Stanza'));
  });

  app.delete('/api/rooms/:id', (req, res) => {
    roomManager.deleteRoom(req.params.id);
    res.json({ success: true });
  });

  // ----- Enemy/Ally types (per dropdown nel master) -----
  function readImagesFolder(type) {
    const folder = paths.getImagesPath(type);
    const out = [];
    try {
      if (fs.existsSync(folder)) {
        for (const file of fs.readdirSync(folder)) {
          const ext = path.extname(file).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
            const id = path.basename(file, ext);
            out.push({
              id,
              name: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' '),
              image: paths.toPublicImageUrl(path.join(folder, file))
            });
          }
        }
      }
    } catch (e) {
      console.error('Errore lettura', folder, e.message);
    }
    return out;
  }

  app.get('/api/enemy-types', (req, res) => {
    const cfg = configStore.load();
    const fromConfig = (cfg.enemies || []).filter(e => e.image).map(e => ({ id: e.id, name: e.name, image: e.image }));
    res.json(fromConfig.length > 0 ? fromConfig : readImagesFolder('enemies'));
  });

  app.get('/api/ally-types', (req, res) => {
    const cfg = configStore.load();
    const fromConfig = (cfg.allies || []).filter(a => a.image).map(a => ({ id: a.id, name: a.name, image: a.image }));
    res.json(fromConfig.length > 0 ? fromConfig : readImagesFolder('allies'));
  });

  // ----- Config CRUD (heroes / enemies / allies / summons / effects) -----
  registerConfigRoutes(app, configStore, paths);

  // ----- Socket.IO: clientId persistente per gestione robusta dei reclaim -----
  io.on('connection', (socket) => {
    const clientId = socket.handshake.auth?.clientId || socket.handshake.query?.clientId;
    if (clientId) socket.data.clientId = String(clientId);
    roomManager.handleConnection(socket);
  });

  async function close() {
    try { await stopMdns(); } catch (_) {}
    try { configStore.flush(); } catch (_) {}
    try { db.close(); } catch (_) {}
    try { io.close(); } catch (_) {}
    return new Promise((resolve) => httpServer.close(() => resolve()));
  }

  function listen(port = opts.port || 3001, host = opts.host || '0.0.0.0') {
    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, async () => {
        const addr = httpServer.address();
        // Avvia mDNS in modo non bloccante: se fallisce, il server resta su.
        if (opts.enableMdns !== false) {
          try {
            await startMdns(addr.port, {
              version: require('../../package.json').version,
              hostname: 'rpg-tracker'
            });
          } catch (e) {
            console.warn('⚠️ mDNS non avviato:', e.message);
          }
        }
        resolve({ port: addr.port, host });
      });
    });
  }

  return {
    app,
    httpServer,
    io,
    roomManager,
    db,
    configStore,
    paths,
    library,
    listen,
    close
  };
}

// ----- Routes config CRUD (estratti per non bloatare createServer) -----
function registerConfigRoutes(app, configStore, paths) {
  function makeUploader(subfolder, idField) {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, paths.getImagesPath(subfolder)),
      filename: (req, file, cb) => {
        const id = req.body[idField] || Date.now().toString();
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        cb(null, `${id}${ext}`);
      }
    });
    return multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
  }

  function genericListGet(field) {
    return (req, res) => {
      const cfg = configStore.load();
      res.json(cfg[field] || []);
    };
  }

  function genericCreate(field, defaults = {}) {
    return (req, res) => {
      const { name, icon } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name richiesto' });
      const id = name.toLowerCase().replace(/\s+/g, '-');
      const newItem = { id, name, image: null, ...defaults };
      if (icon) newItem.icon = icon;
      const cfg = configStore.update(c => {
        if (!Array.isArray(c[field])) c[field] = [];
        const idx = c[field].findIndex(x => x.id === id);
        if (idx >= 0) c[field][idx] = { ...c[field][idx], ...newItem };
        else c[field].push(newItem);
        return c;
      });
      res.json(cfg[field].find(x => x.id === id));
    };
  }

  function genericPatch(field) {
    return (req, res) => {
      const id = req.params.id;
      const updates = req.body || {};
      let updated = null;
      configStore.update(c => {
        const idx = (c[field] || []).findIndex(x => x.id === id);
        if (idx >= 0) {
          c[field][idx] = { ...c[field][idx], ...updates };
          updated = c[field][idx];
        }
        return c;
      });
      if (!updated) return res.status(404).json({ error: 'non trovato' });
      res.json({ success: true, item: updated });
    };
  }

  function genericDelete(field, subfolder) {
    return (req, res) => {
      const id = req.params.id;
      configStore.update(c => {
        c[field] = (c[field] || []).filter(x => x.id !== id);
        return c;
      });
      // Rimuovi anche file immagine
      if (subfolder) {
        const folder = paths.getImagesPath(subfolder);
        try {
          for (const file of fs.readdirSync(folder)) {
            const name = path.basename(file, path.extname(file));
            if (name === id) fs.unlinkSync(path.join(folder, file));
          }
        } catch (_) {}
      }
      res.json({ success: true });
    };
  }

  function genericUpload(field, subfolder, idField) {
    const uploader = makeUploader(subfolder, idField);
    return [uploader.single('image'), (req, res) => {
      const id = req.body[idField];
      if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
      // Pulisci versioni con estensioni diverse dello stesso id
      const folder = paths.getImagesPath(subfolder);
      try {
        for (const file of fs.readdirSync(folder)) {
          const name = path.basename(file, path.extname(file));
          if (name === id && path.join(folder, file) !== req.file.path) {
            fs.unlinkSync(path.join(folder, file));
          }
        }
      } catch (_) {}
      const imageUrl = paths.toPublicImageUrl(req.file.path);
      configStore.update(c => {
        if (!Array.isArray(c[field])) c[field] = [];
        const idx = c[field].findIndex(x => x.id === id);
        if (idx >= 0) c[field][idx].image = imageUrl;
        else c[field].push({ id, name: id, image: imageUrl });
        return c;
      });
      res.json({ success: true, image: imageUrl });
    }];
  }

  // Heroes
  app.get('/api/config/heroes', (req, res) => {
    // Heroes ha logica leggermente diversa: include i 6 default + immagini su filesystem
    const cfg = configStore.load();
    const map = new Map();
    (cfg.heroes || []).forEach(h => map.set(h.id, { ...h }));
    const defaults = ['Achenar', 'Gustav', 'Leland', 'Peat', 'Toco', 'Wilhelm'];
    defaults.forEach(name => {
      if (!map.has(name)) map.set(name, { id: name, name, icon: '👤', image: null });
    });
    // Aggiorna con immagini dal filesystem
    const folder = paths.getImagesPath('heroes');
    try {
      if (fs.existsSync(folder)) {
        for (const file of fs.readdirSync(folder)) {
          const ext = path.extname(file).toLowerCase();
          if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) continue;
          const baseName = path.basename(file, ext);
          const matched = Array.from(map.keys()).find(k => k === baseName || file.toLowerCase().startsWith(k.toLowerCase()));
          if (matched) {
            map.get(matched).image = paths.toPublicImageUrl(path.join(folder, file));
          }
        }
      }
    } catch (e) { console.error('Errore lettura heroes:', e.message); }
    res.json(Array.from(map.values()));
  });
  app.post('/api/config/heroes', genericCreate('heroes', { icon: '👤' }));
  app.patch('/api/config/heroes/:id', genericPatch('heroes'));
  app.delete('/api/config/heroes/:id', genericDelete('heroes', 'heroes'));
  app.post('/api/config/heroes/upload', ...genericUpload('heroes', 'heroes', 'heroId'));

  // Enemies
  app.get('/api/config/enemies', genericListGet('enemies'));
  app.post('/api/config/enemies', genericCreate('enemies'));
  app.patch('/api/config/enemies/:id', genericPatch('enemies'));
  app.delete('/api/config/enemies/:id', genericDelete('enemies', 'enemies'));
  app.post('/api/config/enemies/upload', ...genericUpload('enemies', 'enemies', 'enemyId'));

  // Allies
  app.get('/api/config/allies', genericListGet('allies'));
  app.post('/api/config/allies', genericCreate('allies'));
  app.patch('/api/config/allies/:id', genericPatch('allies'));
  app.delete('/api/config/allies/:id', genericDelete('allies', 'allies'));
  app.post('/api/config/allies/upload', ...genericUpload('allies', 'allies', 'allyId'));

  // Summons
  app.get('/api/config/summons', genericListGet('summons'));
  app.post('/api/config/summons', genericCreate('summons'));
  app.patch('/api/config/summons/:id', genericPatch('summons'));
  app.delete('/api/config/summons/:id', genericDelete('summons', 'summons'));
  app.post('/api/config/summons/upload', ...genericUpload('summons', 'summons', 'summonId'));

  // Effects (no immagini)
  app.get('/api/config/effects', genericListGet('effects'));
  app.post('/api/config/effects', genericCreate('effects'));
  app.delete('/api/config/effects/:id', genericDelete('effects', null));
}

module.exports = { createServer };
