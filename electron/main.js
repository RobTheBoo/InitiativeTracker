const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const Database = require('./database');
const RoomManager = require('./room-manager');

let mainWindow;
let server;
let io;
let httpServer;
let db;
let roomManager;

// Porta del server
const PORT = 3001; // Cambiata da 3000 a 3001 per evitare conflitti con altri processi

// Helper per ottenere la directory dei dati persistenti
// I dati vengono salvati in una cartella fissa che viene preservata tra le build
function getDataDirectory() {
  if (app.isPackaged) {
    // In produzione: salva in una cartella accanto a dist, così viene preservata tra le build
    // Trova la directory dist e crea app-data accanto
    const exePath = app.getPath('exe');
    const exeDir = path.dirname(exePath);
    // Se siamo in dist/win-unpacked, salva in dist/app-data
    // Altrimenti salva accanto all'EXE (per distribuzione)
    if (exeDir.includes('dist') || exeDir.includes('win-unpacked')) {
      // Siamo nella build, salva in dist/app-data (preservato tra build)
      const distPath = path.resolve(exeDir, '../../app-data');
      if (!fs.existsSync(distPath)) {
        fs.mkdirSync(distPath, { recursive: true });
      }
      return distPath;
    } else {
      // Siamo in distribuzione, salva accanto all'EXE
      return exeDir;
    }
  } else {
    // In sviluppo, usa la root del progetto/app-data
    const devDataPath = path.join(__dirname, '../app-data');
    if (!fs.existsSync(devDataPath)) {
      fs.mkdirSync(devDataPath, { recursive: true });
    }
    return devDataPath;
  }
}

// Helper per ottenere la directory dell'EXE (per compatibilità)
function getExeDirectory() {
  if (app.isPackaged) {
    const exePath = app.getPath('exe');
    return path.dirname(exePath);
  } else {
    return path.dirname(process.execPath);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    icon: path.join(__dirname, '../public/icon.png'),
    title: 'RPG Initiative Tracker'
  });

  // Imposta Content Security Policy per ridurre i warning
  // Ottieni l'IP della rete locale per includerlo nel CSP
  const networkInterfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(networkInterfaces)) {
    for (const iface of networkInterfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }
  
  // CSP: permette connessioni a localhost e all'IP della rete locale
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* http://${localIP}:* https://cdn.socket.io https://fonts.googleapis.com https://fonts.gstatic.com data: blob:; ` +
          `img-src 'self' data: blob: http://localhost:* http://${localIP}:*; ` +
          "font-src 'self' https://fonts.gstatic.com; " +
          `connect-src 'self' http://localhost:* http://${localIP}:* ws://localhost:* ws://${localIP}:* wss://localhost:* wss://${localIP}:*`
        ]
      }
    });
  });

  // Carica la pagina di selezione stanze
  mainWindow.loadFile('public/room-selector.html');

  // DevTools in sviluppo
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer() {
  const expressApp = express();
  httpServer = http.createServer(expressApp);
  
  // CORS: permette richieste da app Capacitor (capacitor://, file://) e da altri dispositivi in rete
  expressApp.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
  
  // Helper per determinare il percorso delle immagini
  function getImagesPath(subfolder) {
    if (app.isPackaged) {
      // In produzione: salva nella cartella dati persistente
      const dataDir = getDataDirectory();
      return path.join(dataDir, 'images', subfolder);
    } else {
      // In sviluppo, usa la cartella public/images del progetto
      return path.join(__dirname, '../public/images', subfolder);
    }
  }
  
  // Helper per ottenere l'URL pubblico delle immagini
  function getImageUrl(filePath) {
    if (app.isPackaged) {
      // In produzione, le immagini sono in userData, servile via API
      const filename = path.basename(filePath);
      const type = path.basename(path.dirname(filePath));
      return `/api/images/${type}/${filename}`;
    } else {
      // In sviluppo, usa il percorso pubblico normale
      const relativePath = filePath.replace(path.join(__dirname, '../public'), '');
      return relativePath.replace(/\\/g, '/');
    }
  }
  
  // Configura Socket.IO con CORS e path
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    path: "/socket.io/"
  });

  // Serve static files
  expressApp.use(express.static(path.join(__dirname, '../public')));
  
  // Endpoint per servire immagini
  // In produzione: immagini accanto all'EXE (non in public/)
  // In sviluppo: serve anche via API per coerenza (immagini sono in public/images/)
  expressApp.get('/api/images/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    const imagePath = path.join(getImagesPath(type), filename);
    console.log('🔍 Richiesta immagine:', type, filename);
    console.log('   - Percorso completo:', imagePath);
    console.log('   - File esiste?', fs.existsSync(imagePath));
    if (fs.existsSync(imagePath)) {
      res.sendFile(imagePath);
    } else {
      console.log('   - ❌ Immagine non trovata!');
      res.status(404).json({ error: 'Immagine non trovata', path: imagePath });
    }
  });
  
  // Middleware per parsing JSON e form data
  // IMPORTANTE: urlencoded deve essere PRIMA di multer per leggere i campi del form
  expressApp.use(express.urlencoded({ extended: true }));
  expressApp.use(express.json());
  
  // Log iniziale per debug
  console.log('🚀 StartServer - app.isPackaged:', app.isPackaged);
  if (app.isPackaged) {
    const exeDir = getExeDirectory();
    console.log('📁 StartServer - Directory EXE determinata:', exeDir);
    const imagesPath = getImagesPath('heroes');
    console.log('📁 StartServer - Percorso immagini:', imagesPath);
  }
  
  // Inizializza database e room manager
  let dbPath;
  if (app.isPackaged) {
    // In produzione, salva nella cartella dati persistente
    const dataDir = getDataDirectory();
    dbPath = path.join(dataDir, 'rpg-tracker.db');
    console.log('💾 StartServer - Percorso database:', dbPath);
  } else {
    // In sviluppo, usa la cartella app-data del progetto
    const dataDir = getDataDirectory();
    dbPath = path.join(dataDir, 'rpg-tracker.db');
  }
  db = new Database(dbPath, getImagesPath);
  
  // Passa loadConfig al RoomManager per gestire correttamente i percorsi delle immagini
  // loadConfig viene definita più avanti, quindi la passiamo come funzione
  roomManager = new RoomManager(db, io, getImagesPath, () => {
    return loadConfig();
  });

  // API Endpoints
  expressApp.get('/api/rooms', (req, res) => {
    const rooms = roomManager.getAllRooms();
    res.json(rooms);
  });

  // API: Ottieni la prima stanza attiva (per tablet)
  expressApp.get('/api/active-room', (req, res) => {
    try {
      const rooms = roomManager.getAllRooms();
      // Trova la prima stanza attiva (con master connesso) o la prima stanza disponibile
      let activeRoom = null;
      
      for (const room of rooms) {
        const roomState = roomManager.getGameStateForRoom(room.id);
        if (roomState && roomState.masterId !== null) {
          activeRoom = room;
          break;
        }
      }
      
      if (activeRoom) {
        res.json({ roomId: activeRoom.id, name: activeRoom.name });
      } else if (rooms.length > 0) {
        // Se non c'è una stanza attiva, restituisci la prima disponibile
        res.json({ roomId: rooms[0].id, name: rooms[0].name });
      } else {
        res.status(404).json({ error: 'Nessuna stanza disponibile' });
      }
    } catch (error) {
      console.error('Errore ottenimento stanza attiva:', error);
      res.status(500).json({ error: 'Errore server' });
    }
  });

  expressApp.post('/api/rooms/create', express.json(), (req, res) => {
    const { name } = req.body;
    const room = roomManager.createRoom(name);
    res.json(room);
  });

  expressApp.delete('/api/rooms/:id', (req, res) => {
    roomManager.deleteRoom(req.params.id);
    res.json({ success: true });
  });

  // API per tipi di nemici (dal config)
  expressApp.get('/api/enemy-types', (req, res) => {
    const config = loadConfig();
    const types = [];
    
    // Carica nemici dal config
    if (config.enemies && config.enemies.length > 0) {
      config.enemies.forEach(enemy => {
        if (enemy.image) {
          types.push({
            id: enemy.id,
            name: enemy.name,
            image: enemy.image
          });
        }
      });
    }
    
    // Fallback: se non ci sono nemici nel config, leggi dalle immagini
    if (types.length === 0) {
      const enemiesPath = getImagesPath('enemies');
      try {
        if (fs.existsSync(enemiesPath)) {
          const files = fs.readdirSync(enemiesPath);
          files.forEach(file => {
            const ext = path.extname(file).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
              const name = path.basename(file, ext);
              const imageUrl = app.isPackaged 
                ? `/api/images/enemies/${file}` 
                : `/images/enemies/${file}`;
              types.push({
                id: name,
                name: name.charAt(0).toUpperCase() + name.slice(1),
                image: imageUrl
              });
            }
          });
        }
      } catch (e) {
        console.error('❌ Errore lettura cartella enemies:', e.message);
      }
    }
    
    console.log('📦 Tipi nemici restituiti:', types);
    res.json(types);
  });

  // API per tipi di alleati (dal config)
  expressApp.get('/api/ally-types', (req, res) => {
    const config = loadConfig();
    const types = [];
    
    // Carica alleati dal config
    if (config.allies && config.allies.length > 0) {
      config.allies.forEach(ally => {
        if (ally.image) {
          types.push({
            id: ally.id,
            name: ally.name,
            image: ally.image
          });
        }
      });
    }
    
    // Fallback: se non ci sono alleati nel config, leggi dalle immagini
    if (types.length === 0) {
      const alliesPath = getImagesPath('allies');
      try {
        if (fs.existsSync(alliesPath)) {
          const files = fs.readdirSync(alliesPath);
          files.forEach(file => {
            const ext = path.extname(file).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
              const name = path.basename(file, ext);
              const filePath = path.join(alliesPath, file);
              types.push({
                id: name,
                name: name.charAt(0).toUpperCase() + name.slice(1),
                image: getImageUrl(filePath)
              });
            }
          });
        }
      } catch (e) {
        console.error('❌ Errore lettura cartella allies:', e.message);
      }
    }
    
    console.log('📦 Tipi alleati restituiti:', types);
    res.json(types);
  });

  // Configurazione multer per upload immagini eroi
  const heroStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = getImagesPath('heroes');
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      console.log('📁 Upload hero path:', uploadPath);
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const heroId = req.body.heroId || Date.now().toString();
      const ext = path.extname(file.originalname);
      const filename = `${heroId}${ext}`;
      cb(null, filename);
    }
  });
  const uploadHero = multer({ storage: heroStorage });

  // Configurazione multer per upload immagini nemici
  const enemyStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = getImagesPath('enemies');
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      console.log('📁 Upload enemy path:', uploadPath);
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const enemyId = req.body.enemyId || Date.now().toString();
      const ext = path.extname(file.originalname);
      const filename = `${enemyId}${ext}`;
      cb(null, filename);
    }
  });
  const uploadEnemy = multer({ storage: enemyStorage });

  // Configurazione multer per upload immagini NPC
  const allyStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = getImagesPath('allies');
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      console.log('📁 Upload ally path:', uploadPath);
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const allyId = req.body.allyId || Date.now().toString();
      const ext = path.extname(file.originalname);
      const filename = `${allyId}${ext}`;
      cb(null, filename);
    }
  });
  const uploadAlly = multer({ storage: allyStorage });

  // API Configurazione Eroi
  expressApp.get('/api/config/heroes', (req, res) => {
    const config = loadConfig();
    const heroesPath = getImagesPath('heroes');
    const heroesMap = new Map();
    
    // Carica eroi dal config
    config.heroes.forEach(hero => {
      heroesMap.set(hero.id, { ...hero });
    });
    
    // Aggiungi eroi di default se non presenti
    const defaultHeroes = ['Achenar', 'Gustav', 'Leland', 'Peat', 'Toco', 'Wilhelm'];
    defaultHeroes.forEach(heroName => {
      if (!heroesMap.has(heroName)) {
        heroesMap.set(heroName, {
          id: heroName,
          name: heroName,
          icon: '👤',
          image: null
        });
      }
    });
    
    // Aggiorna con immagini esistenti
    try {
      if (fs.existsSync(heroesPath)) {
        const files = fs.readdirSync(heroesPath);
        files.forEach(file => {
          const ext = path.extname(file).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
            const name = path.basename(file, ext);
            if (heroesMap.has(name)) {
              const filePath = path.join(heroesPath, file);
              heroesMap.get(name).image = getImageUrl(filePath);
            } else {
              // Cerca per nome parziale (es: "Achenar" in "Achenar.jpeg")
              const matchingHero = Array.from(heroesMap.keys()).find(h => 
                file.toLowerCase().startsWith(h.toLowerCase())
              );
              if (matchingHero) {
                const filePath = path.join(heroesPath, file);
                heroesMap.get(matchingHero).image = getImageUrl(filePath);
              }
            }
          }
        });
      }
    } catch (e) {
      console.error('Errore caricamento eroi:', e);
    }
    
    res.json(Array.from(heroesMap.values()));
  });

  expressApp.post('/api/config/heroes', express.json(), (req, res) => {
    const { name, icon } = req.body;
    const config = loadConfig();
    const heroId = name;
    
    const newHero = {
      id: heroId,
      name,
      icon: icon || '👤',
      image: null
    };
    
    // Aggiungi o aggiorna nel config
    const index = config.heroes.findIndex(h => h.id === heroId);
    if (index >= 0) {
      config.heroes[index] = { ...config.heroes[index], ...newHero };
    } else {
      config.heroes.push(newHero);
    }
    
    saveConfig(config);
    res.json(newHero);
  });

  expressApp.patch('/api/config/heroes/:id', express.json(), (req, res) => {
    const config = loadConfig();
    const heroId = req.params.id;
    const updates = req.body;
    
    const index = config.heroes.findIndex(h => h.id === heroId);
    if (index >= 0) {
      config.heroes[index] = { ...config.heroes[index], ...updates };
      saveConfig(config);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Eroe non trovato' });
    }
  });

  expressApp.post('/api/config/heroes/upload', uploadHero.single('image'), (req, res) => {
    const heroId = req.body.heroId;
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }
    
    // Se heroId è disponibile e il file è stato salvato con un timestamp, rinomina il file
    let finalFilePath = req.file.path;
    if (heroId && req.file.filename !== `${heroId}${path.extname(req.file.filename)}`) {
      const heroesPath = getImagesPath('heroes');
      const newFileName = `${heroId}${path.extname(req.file.filename)}`;
      const newFilePath = path.join(heroesPath, newFileName);
      
      try {
        // Elimina file vecchio se esiste (con stesso heroId ma estensione diversa)
        const existingFiles = fs.readdirSync(heroesPath);
        existingFiles.forEach(file => {
          const nameWithoutExt = path.basename(file, path.extname(file));
          if (nameWithoutExt === heroId && file !== newFileName) {
            const oldPath = path.join(heroesPath, file);
            if (fs.existsSync(oldPath)) {
              fs.unlinkSync(oldPath);
              console.log('🗑️ Rimosso file vecchio:', oldPath);
            }
          }
        });
        
        // Rinomina il file
        if (fs.existsSync(finalFilePath)) {
          fs.renameSync(finalFilePath, newFilePath);
          finalFilePath = newFilePath;
          console.log('✅ File rinominato da', req.file.filename, 'a', newFileName);
        }
      } catch (error) {
        console.error('❌ Errore durante rinomina file:', error);
        // Continua con il file originale se la rinomina fallisce
      }
    }
    
    const imagePath = getImageUrl(finalFilePath);
    console.log('📤 Upload hero image:');
    console.log('   - Hero ID dal body:', heroId);
    console.log('   - File originale:', req.file.filename);
    console.log('   - File finale:', path.basename(finalFilePath));
    console.log('   - File salvato in:', finalFilePath);
    console.log('   - File esiste?', fs.existsSync(finalFilePath));
    console.log('   - Image URL:', imagePath);
    console.log('   - App packaged?', app.isPackaged);
    const config = loadConfig();
    
    // Aggiorna l'eroe esistente con l'immagine
    const index = config.heroes.findIndex(h => h.id === heroId);
    if (index >= 0) {
      config.heroes[index].image = imagePath;
      saveConfig(config);
    } else {
      // Se l'eroe non esiste, crealo
      config.heroes.push({
        id: heroId,
        name: heroId,
        icon: '👤',
        image: imagePath
      });
      saveConfig(config);
    }
    
    res.json({ success: true, image: imagePath });
  });

  expressApp.delete('/api/config/heroes/:id', (req, res) => {
    const heroId = req.params.id;
    const config = loadConfig();
    
    // Rimuovi dal config
    config.heroes = config.heroes.filter(h => h.id !== heroId);
    saveConfig(config);
    
    // Elimina anche il file immagine se esiste
    const heroesPath = getImagesPath('heroes');
    try {
      if (fs.existsSync(heroesPath)) {
        const files = fs.readdirSync(heroesPath);
        files.forEach(file => {
          const name = path.basename(file, path.extname(file));
          if (name === heroId || file.toLowerCase().startsWith(heroId.toLowerCase())) {
            const filePath = path.join(heroesPath, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        });
      }
    } catch (e) {
      console.error('Errore eliminazione file immagine:', e);
    }
    
    res.json({ success: true });
  });

  
  // Helper per ottenere l'URL pubblico delle immagini
  function getImageUrl(filePath) {
    if (app.isPackaged) {
      // In produzione, le immagini sono nella cartella dati, servile via API
      return `/api/images/${path.basename(path.dirname(filePath))}/${path.basename(filePath)}`;
    } else {
      // In sviluppo, usa il percorso pubblico normale
      const relativePath = filePath.replace(path.join(__dirname, '../public'), '');
      return relativePath.replace(/\\/g, '/');
    }
  }

  // File di configurazione per nemici ed eroi
  // In produzione salva nella cartella dati persistente, in sviluppo usa app-data
  let configPath;
  if (app.isPackaged) {
    // In produzione, salva nella cartella dati persistente
    const dataDir = getDataDirectory();
    configPath = path.join(dataDir, 'config.json');
  } else {
    // In sviluppo, usa la cartella app-data del progetto
    const dataDir = getDataDirectory();
    configPath = path.join(dataDir, 'config.json');
  }
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // Se siamo in produzione e il file non esiste, copia quello di sviluppo se presente
  if (app.isPackaged && !fs.existsSync(configPath)) {
    const devConfigPath = path.join(__dirname, '../data/config.json');
    if (fs.existsSync(devConfigPath)) {
      try {
        fs.copyFileSync(devConfigPath, configPath);
        console.log('📋 Config migrato da sviluppo a produzione');
      } catch (e) {
        console.error('❌ Errore migrazione config:', e);
      }
    }
  }
  
  console.log('📁 Config path:', configPath, 'isPackaged:', app.isPackaged);

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('📖 loadConfig - enemies:', config.enemies?.length || 0, 'allies:', config.allies?.length || 0, 'heroes:', config.heroes?.length || 0);
        if (config.enemies) {
          console.log('📖 loadConfig - IDs enemies:', config.enemies.map(e => e.id));
        }
        return config;
      }
    } catch (e) {
      console.error('❌ Errore caricamento config:', e);
    }
    console.log('📖 loadConfig - file non trovato, ritorno default');
    return { enemies: [], heroes: [] };
  }

  function saveConfig(config) {
    try {
      console.log('💾 saveConfig chiamato, path:', configPath);
      console.log('💾 Config da salvare - enemies:', config.enemies?.length || 0, 'allies:', config.allies?.length || 0, 'heroes:', config.heroes?.length || 0);
      if (config.enemies) {
        console.log('💾 IDs enemies da salvare:', config.enemies.map(e => e.id));
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      console.log('✅ Config salvato con successo');
      
      // Verifica immediata
      const verify = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('✅ Verifica lettura - enemies salvati:', verify.enemies?.length || 0, 'allies:', verify.allies?.length || 0);
      if (verify.enemies) {
        console.log('✅ Verifica lettura - IDs enemies:', verify.enemies.map(e => e.id));
      }
    } catch (e) {
      console.error('❌ Errore salvataggio config:', e);
    }
  }

  // API Configurazione Nemici
  expressApp.get('/api/config/enemies', (req, res) => {
    const config = loadConfig();
    if (!config.enemies) config.enemies = [];
    
    console.log('📥 GET /api/config/enemies - Enemies restituiti:', config.enemies.length);
    console.log('📋 IDs enemies:', config.enemies.map(e => e.id));
    
    // Carica solo dal config, non dalle immagini (per evitare duplicati)
    res.json(config.enemies);
  });

  expressApp.post('/api/config/enemies', express.json(), (req, res) => {
    const { name } = req.body;
    console.log('📥 POST /api/config/enemies - Nome ricevuto:', name);
    
    const config = loadConfig();
    if (!config.enemies) config.enemies = [];
    
    const enemyId = name.toLowerCase().replace(/\s+/g, '-');
    console.log('🆔 Enemy ID generato:', enemyId);
    console.log('📋 Enemies esistenti:', config.enemies.length, config.enemies.map(e => e.id));
    
    const newEnemy = {
      id: enemyId,
      name,
      image: null
    };
    
    // Aggiungi o aggiorna nel config
    const index = config.enemies.findIndex(e => e.id === enemyId);
    if (index >= 0) {
      console.log('⚠️ Enemy già esistente, aggiorno:', index);
      config.enemies[index] = { ...config.enemies[index], ...newEnemy };
    } else {
      console.log('➕ Aggiungo nuovo enemy:', newEnemy);
      config.enemies.push(newEnemy);
    }
    
    console.log('💾 Salvataggio config, enemies ora:', config.enemies.length);
    saveConfig(config);
    
    // Verifica che sia stato salvato
    const verifyConfig = loadConfig();
    console.log('✅ Verifica dopo salvataggio, enemies:', verifyConfig.enemies?.length || 0);
    
    console.log('📤 Invio risposta con enemy:', newEnemy);
    res.json(newEnemy);
  });

  expressApp.patch('/api/config/enemies/:id', express.json(), (req, res) => {
    const config = loadConfig();
    const enemyId = req.params.id;
    const updates = req.body;
    
    const index = config.enemies.findIndex(e => e.id === enemyId);
    if (index >= 0) {
      config.enemies[index] = { ...config.enemies[index], ...updates };
      saveConfig(config);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Nemico non trovato' });
    }
  });

  expressApp.post('/api/config/enemies/upload', uploadEnemy.single('image'), (req, res) => {
    const enemyId = req.body.enemyId;
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }
    
    const imagePath = getImageUrl(req.file.path);
    console.log('📤 Upload enemy image - file path:', req.file.path, 'image URL:', imagePath);
    const config = loadConfig();
    if (!config.enemies) config.enemies = [];
    
    // Cerca il nemico esistente per ID
    const index = config.enemies.findIndex(e => e.id === enemyId);
    if (index >= 0) {
      // Aggiorna il nemico esistente con l'immagine
      config.enemies[index].image = imagePath;
      saveConfig(config);
    } else {
      // Se il nemico non esiste, NON crearlo qui - deve essere creato prima con addNewEnemy
      return res.status(404).json({ error: 'Nemico non trovato. Crea prima il nemico.' });
    }
    
    res.json({ success: true, image: imagePath });
  });

  expressApp.delete('/api/config/enemies/:id', (req, res) => {
    const enemyId = req.params.id;
    const config = loadConfig();
    
    // Rimuovi dal config
    config.enemies = config.enemies.filter(e => e.id !== enemyId);
    saveConfig(config);
    
    // Elimina anche il file immagine se esiste
    const enemiesPath = getImagesPath('enemies');
    try {
      if (fs.existsSync(enemiesPath)) {
        const files = fs.readdirSync(enemiesPath);
        files.forEach(file => {
          const name = path.basename(file, path.extname(file));
          if (name === enemyId) {
            const filePath = path.join(enemiesPath, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        });
      }
    } catch (e) {
      console.error('Errore eliminazione file immagine:', e);
    }
    
    res.json({ success: true });
  });

  // API Configurazione NPC
  expressApp.get('/api/config/allies', (req, res) => {
    const config = loadConfig();
    if (!config.allies) config.allies = [];
    
    console.log('📥 GET /api/config/allies - Allies restituiti:', config.allies.length);
    console.log('📋 IDs allies:', config.allies.map(a => a.id));
    
    // Carica solo dal config, non dalle immagini (per evitare duplicati)
    res.json(config.allies);
  });

  expressApp.post('/api/config/allies', express.json(), (req, res) => {
    const { name } = req.body;
    console.log('📥 POST /api/config/allies - Nome ricevuto:', name);
    
    const config = loadConfig();
    if (!config.allies) config.allies = [];
    
    const allyId = name.toLowerCase().replace(/\s+/g, '-');
    console.log('🆔 Ally ID generato:', allyId);
    console.log('📋 Allies esistenti:', config.allies.length, config.allies.map(a => a.id));
    
    const newAlly = {
      id: allyId,
      name,
      image: null
    };
    
    // Aggiungi o aggiorna nel config
    const index = config.allies.findIndex(a => a.id === allyId);
    if (index >= 0) {
      console.log('⚠️ Ally già esistente, aggiorno:', index);
      config.allies[index] = { ...config.allies[index], ...newAlly };
    } else {
      console.log('➕ Aggiungo nuovo ally:', newAlly);
      config.allies.push(newAlly);
    }
    
    console.log('💾 Salvataggio config, allies ora:', config.allies.length);
    saveConfig(config);
    
    // Verifica che sia stato salvato
    const verifyConfig = loadConfig();
    console.log('✅ Verifica dopo salvataggio, allies:', verifyConfig.allies?.length || 0);
    
    res.json(newAlly);
  });

  expressApp.patch('/api/config/allies/:id', express.json(), (req, res) => {
    const config = loadConfig();
    if (!config.allies) config.allies = [];
    const allyId = req.params.id;
    const updates = req.body;
    
    const index = config.allies.findIndex(a => a.id === allyId);
    if (index >= 0) {
      config.allies[index] = { ...config.allies[index], ...updates };
      saveConfig(config);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'NPC non trovato' });
    }
  });

  expressApp.post('/api/config/allies/upload', uploadAlly.single('image'), (req, res) => {
    const allyId = req.body.allyId;
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }
    
    const imagePath = getImageUrl(req.file.path);
    console.log('📤 Upload ally image - file path:', req.file.path, 'image URL:', imagePath);
    const config = loadConfig();
    if (!config.allies) config.allies = [];
    
    // Cerca il NPC esistente per ID
    const index = config.allies.findIndex(a => a.id === allyId);
    if (index >= 0) {
      // Aggiorna il NPC esistente con l'immagine
      config.allies[index].image = imagePath;
      saveConfig(config);
    } else {
      // Se il NPC non esiste, NON crearlo qui - deve essere creato prima con addNewAlly
      return res.status(404).json({ error: 'NPC non trovato. Crea prima il NPC.' });
    }
    
    res.json({ success: true, image: imagePath });
  });

  expressApp.delete('/api/config/allies/:id', (req, res) => {
    const allyId = req.params.id;
    const config = loadConfig();
    if (!config.allies) config.allies = [];
    
    // Rimuovi dal config
    config.allies = config.allies.filter(a => a.id !== allyId);
    saveConfig(config);
    
    // Elimina anche il file immagine se esiste
    const alliesPath = getImagesPath('allies');
    try {
      if (fs.existsSync(alliesPath)) {
        const files = fs.readdirSync(alliesPath);
        files.forEach(file => {
          const name = path.basename(file, path.extname(file));
          if (name === allyId) {
            const filePath = path.join(alliesPath, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        });
      }
    } catch (e) {
      console.error('Errore eliminazione file immagine:', e);
    }
    
    res.json({ success: true });
  });

  // API Configurazione Effetti
  expressApp.get('/api/config/effects', (req, res) => {
    const config = loadConfig();
    if (!config.effects) config.effects = [];
    res.json(config.effects);
  });

  expressApp.post('/api/config/effects', express.json(), (req, res) => {
    const { name } = req.body;
    const config = loadConfig();
    if (!config.effects) config.effects = [];
    
    const effectId = name.toLowerCase().replace(/\s+/g, '-');
    const newEffect = {
      id: effectId,
      name
    };
    
    // Aggiungi o aggiorna nel config
    const index = config.effects.findIndex(e => e.id === effectId);
    if (index >= 0) {
      config.effects[index] = { ...config.effects[index], ...newEffect };
    } else {
      config.effects.push(newEffect);
    }
    
    saveConfig(config);
    res.json(newEffect);
  });

  expressApp.delete('/api/config/effects/:id', (req, res) => {
    const effectId = req.params.id;
    const config = loadConfig();
    if (!config.effects) config.effects = [];
    
    config.effects = config.effects.filter(e => e.id !== effectId);
    saveConfig(config);
    res.json({ success: true });
  });

  // API Configurazione Evocazioni (per giocatori)
  expressApp.get('/api/config/summons', (req, res) => {
    const config = loadConfig();
    if (!config.summons) config.summons = [];
    res.json(config.summons);
  });

  expressApp.post('/api/config/summons', express.json(), (req, res) => {
    const { name } = req.body;
    const config = loadConfig();
    if (!config.summons) config.summons = [];
    
    const summonId = name.toLowerCase().replace(/\s+/g, '-');
    const newSummon = {
      id: summonId,
      name,
      image: null
    };
    
    const index = config.summons.findIndex(s => s.id === summonId);
    if (index >= 0) {
      config.summons[index] = { ...config.summons[index], ...newSummon };
    } else {
      config.summons.push(newSummon);
    }
    
    saveConfig(config);
    res.json(newSummon);
  });

  expressApp.patch('/api/config/summons/:id', express.json(), (req, res) => {
    const config = loadConfig();
    const summonId = req.params.id;
    const updates = req.body;
    
    if (!config.summons) config.summons = [];
    
    const index = config.summons.findIndex(s => s.id === summonId);
    if (index >= 0) {
      config.summons[index] = { ...config.summons[index], ...updates };
      saveConfig(config);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Evocazione non trovata' });
    }
  });

  expressApp.delete('/api/config/summons/:id', (req, res) => {
    const summonId = req.params.id;
    const config = loadConfig();
    if (!config.summons) config.summons = [];
    
    config.summons = config.summons.filter(s => s.id !== summonId);
    saveConfig(config);
    
    // Elimina anche il file immagine se esiste
    const summonsPath = getImagesPath('summons');
    try {
      if (fs.existsSync(summonsPath)) {
        const files = fs.readdirSync(summonsPath);
        files.forEach(file => {
          const name = path.basename(file, path.extname(file));
          if (name === summonId) {
            const filePath = path.join(summonsPath, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        });
      }
    } catch (e) {
      console.error('Errore eliminazione file immagine evocazione:', e);
    }
    
    res.json({ success: true });
  });

  // Upload immagine evocazione
  const uploadSummon = multer({
    dest: (req, file, cb) => {
      const summonsPath = getImagesPath('summons');
      if (!fs.existsSync(summonsPath)) {
        fs.mkdirSync(summonsPath, { recursive: true });
      }
      cb(null, summonsPath);
    },
    limits: { fileSize: 5 * 1024 * 1024 }
  });

  expressApp.post('/api/config/summons/upload', uploadSummon.single('image'), (req, res) => {
    const summonId = req.body.summonId;
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }
    
    const imagePath = getImageUrl(req.file.path);
    const config = loadConfig();
    if (!config.summons) config.summons = [];
    
    const index = config.summons.findIndex(s => s.id === summonId);
    if (index >= 0) {
      config.summons[index].image = imagePath;
      saveConfig(config);
    } else {
      return res.status(404).json({ error: 'Evocazione non trovata. Crea prima l\'evocazione.' });
    }
    
    res.json({ success: true, image: imagePath });
  });

  // Socket.io - gestito dal RoomManager
  io.on('connection', (socket) => {
    console.log('Client connesso:', socket.id);
    roomManager.handleConnection(socket);
  });

  // Avvia server
  // Ascolta su tutte le interfacce di rete (0.0.0.0) per permettere connessioni da altri dispositivi
  httpServer.listen(PORT, '0.0.0.0', () => {
    const networkInterfaces = os.networkInterfaces();
    let localIP = 'localhost';
    
    for (const name of Object.keys(networkInterfaces)) {
      for (const iface of networkInterfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIP = iface.address;
          break;
        }
      }
    }
    
    console.log(`✅ Server avviato con successo su http://${localIP}:${PORT}`);
    console.log(`✅ Server in ascolto su http://localhost:${PORT}`);
    
    // Invia IP al renderer
    if (mainWindow) {
      mainWindow.webContents.send('server-started', {
        ip: localIP,
        port: PORT
      });
    }
  }).on('error', (err) => {
    console.error('❌ ERRORE AVVIO SERVER:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Porta ${PORT} già in uso!`);
      console.error('   Soluzione: chiudi altre istanze dell\'app o cambia porta');
    } else {
      console.error('   Errore:', err.message);
    }
    
    // Mostra un messaggio all'utente
    if (mainWindow) {
      mainWindow.webContents.send('server-error', {
        error: err.message,
        code: err.code
      });
    }
  });
}

// Setup IPC Handlers (chiamato dopo startServer)
function setupIPCHandlers() {
  ipcMain.handle('get-rooms', async () => {
    if (!roomManager) throw new Error('RoomManager non inizializzato');
    return roomManager.getAllRooms();
  });

  ipcMain.handle('create-room', async (event, name) => {
    if (!roomManager) throw new Error('RoomManager non inizializzato');
    return roomManager.createRoom(name);
  });

  ipcMain.handle('delete-room', async (event, roomId) => {
    if (!roomManager) throw new Error('RoomManager non inizializzato');
    roomManager.deleteRoom(roomId);
    return { success: true };
  });

  ipcMain.handle('open-room', async (event, roomId, role = 'master') => {
    // Determina quale pagina aprire in base al ruolo
    let page = 'public/master.html';
    
    if (role === 'player') {
      page = 'public/index.html';
    } else if (role === 'tablet') {
      page = 'public/tablet.html';
    }
    // role === 'master' è il default
    
    // Apri la pagina con la stanza selezionata
    mainWindow.loadFile(page, {
      query: { roomId }
    });
    return { success: true };
  });

  ipcMain.handle('get-server-ip', async () => {
    const networkInterfaces = os.networkInterfaces();
    let localIP = 'localhost';
    
    for (const name of Object.keys(networkInterfaces)) {
      for (const iface of networkInterfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIP = iface.address;
          break;
        }
      }
    }
    
    return { ip: localIP, port: PORT };
  });

  ipcMain.handle('get-data-path', async () => {
    const dataDir = getDataDirectory();
    if (app.isPackaged) {
      // In produzione: percorso nella cartella dati persistente
      return {
        basePath: dataDir,
        imagesPath: path.join(dataDir, 'images'),
        dbPath: path.join(dataDir, 'rpg-tracker.db'),
        configPath: path.join(dataDir, 'config.json'),
        isPackaged: true
      };
    } else {
      // In sviluppo
      return {
        basePath: path.join(__dirname, '..'),
        imagesPath: path.join(__dirname, '../public/images'),
        dbPath: path.join(dataDir, 'rpg-tracker.db'),
        configPath: path.join(dataDir, 'config.json'),
        isPackaged: false
      };
    }
  });

  ipcMain.handle('back-to-rooms', async () => {
    mainWindow.loadFile('public/room-selector.html');
    return { success: true };
  });

  ipcMain.handle('open-config', async () => {
    mainWindow.loadFile('public/config.html');
    return { success: true };
  });
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  startServer();
  setupIPCHandlers(); // Setup handlers dopo l'inizializzazione

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Chiudi il server
  if (httpServer) {
    httpServer.close();
  }
  
  // Chiudi database
  if (db) {
    db.close();
  }
});

