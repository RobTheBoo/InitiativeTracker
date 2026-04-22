const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// CORS: permette richieste da app Capacitor (capacitor://, file://) e da altri dispositivi in rete
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static('public'));

// === LIBRERIA PATHFINDER 1E ===
function loadLibrary() {
  const library = {
    conditions: [],
    bonusTypes: [],
    spells: []
  };
  
  try {
    const conditionsPath = path.join(__dirname, 'data', 'conditions.json');
    if (fs.existsSync(conditionsPath)) {
      const data = JSON.parse(fs.readFileSync(conditionsPath, 'utf8'));
      library.conditions = data.conditions || [];
    }
  } catch (e) {
    console.error('Errore caricamento conditions.json:', e.message);
  }
  
  try {
    const bonusTypesPath = path.join(__dirname, 'data', 'bonusTypes.json');
    if (fs.existsSync(bonusTypesPath)) {
      const data = JSON.parse(fs.readFileSync(bonusTypesPath, 'utf8'));
      library.bonusTypes = data.bonusTypes || [];
    }
  } catch (e) {
    console.error('Errore caricamento bonusTypes.json:', e.message);
  }
  
  try {
    const spellsPath = path.join(__dirname, 'data', 'spells.json');
    if (fs.existsSync(spellsPath)) {
      const data = JSON.parse(fs.readFileSync(spellsPath, 'utf8'));
      library.spells = data.spells || [];
    }
  } catch (e) {
    console.error('Errore caricamento spells.json:', e.message);
  }
  
  return library;
}

// Carica libreria all'avvio
let pf1eLibrary = loadLibrary();

// Endpoint API per la libreria
app.get('/api/library', (req, res) => {
  res.json(pf1eLibrary);
});

app.get('/api/library/conditions', (req, res) => {
  res.json(pf1eLibrary.conditions);
});

app.get('/api/library/bonus-types', (req, res) => {
  res.json(pf1eLibrary.bonusTypes);
});

app.get('/api/library/spells', (req, res) => {
  res.json(pf1eLibrary.spells);
});

// Ricarica libreria (utile per aggiornamenti runtime)
app.post('/api/library/reload', (req, res) => {
  pf1eLibrary = loadLibrary();
  res.json({ success: true, message: 'Libreria ricaricata' });
});

// Cerca immagine per un personaggio
function findCharacterImage(charId, type = 'heroes') {
  const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
  const basePath = path.join(__dirname, 'public', 'images', type);
  
  for (const ext of extensions) {
    const imagePath = path.join(basePath, charId + ext);
    if (fs.existsSync(imagePath)) {
      return `/images/${type}/${charId}${ext}`;
    }
  }
  return null;
}

// Aggiorna le immagini degli eroi
function updateHeroImages() {
  gameState.heroes.forEach(hero => {
    hero.image = findCharacterImage(hero.id, 'heroes');
  });
}

// Legge i tipi di nemici disponibili dalle immagini nella cartella
function getEnemyTypes() {
  const enemiesPath = path.join(__dirname, 'public', 'images', 'enemies');
  const types = [];
  
  try {
    if (fs.existsSync(enemiesPath)) {
      const files = fs.readdirSync(enemiesPath);
      files.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
          const name = path.basename(file, ext);
          // Capitalize first letter
          const displayName = name.charAt(0).toUpperCase() + name.slice(1);
          types.push({
            id: name,
            name: displayName,
            image: `/images/enemies/${file}`
          });
        }
      });
    }
  } catch (e) {
    console.error('Errore lettura cartella enemies:', e.message);
  }
  
  return types;
}

// Legge i tipi di alleati disponibili dalle immagini nella cartella
function getAllyTypes() {
  const alliesPath = path.join(__dirname, 'public', 'images', 'allies');
  const types = [];
  
  try {
    if (fs.existsSync(alliesPath)) {
      const files = fs.readdirSync(alliesPath);
      files.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
          const name = path.basename(file, ext);
          const displayName = name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');
          types.push({
            id: name,
            name: displayName,
            image: `/images/allies/${file}`
          });
        }
      });
    }
  } catch (e) {
    console.error('Errore lettura cartella allies:', e.message);
  }
  
  return types;
}

// Endpoint per ottenere i tipi di nemici
app.get('/api/enemy-types', (req, res) => {
  res.json(getEnemyTypes());
});

// Endpoint per ottenere i tipi di alleati
app.get('/api/ally-types', (req, res) => {
  res.json(getAllyTypes());
});

// API stanze: server standalone ha una sola "partita" (compatibile con app mobile/APK)
app.get('/api/rooms', (req, res) => {
  res.json([{ id: 'default', name: 'Partita' }]);
});

// Tipi di bonus/malus (caricati dalla libreria)
function getBonusTypeNames() {
  return pf1eLibrary.bonusTypes.map(bt => bt.name);
}

// Stato del gioco
const gameState = {
  // Personaggi giocanti (eroi)
  heroes: [
    { id: 'Achenar', name: 'Achenar', icon: '🧙', image: null, initiative: null, ownerId: null, effects: [] },
    { id: 'Gustav', name: 'Gustav', icon: '⚔️', image: null, initiative: null, ownerId: null, effects: [] },
    { id: 'Leland', name: 'Leland', icon: '🏹', image: null, initiative: null, ownerId: null, effects: [] },
    { id: 'Peat', name: 'Peat', icon: '🛡️', image: null, initiative: null, ownerId: null, effects: [] },
    { id: 'Toco', name: 'Toco', icon: '🗡️', image: null, initiative: null, ownerId: null, effects: [] },
    { id: 'Wilhelm', name: 'Wilhelm', icon: '⚔️', image: null, initiative: null, ownerId: null, effects: [] },
  ],
  // Nemici (gestiti dal master)
  enemies: [],
  // Alleati NPC (gestiti dal master)
  allies: [],
  // Personaggi in ritardo (temporaneamente fuori dal combattimento)
  delayedCharacters: [],
  // Effetti ad area attivi
  areaEffects: [],
  // Stato combattimento
  combatStarted: false,
  currentTurn: 0,
  currentRound: 1,
  turnOrder: [],
  // ID del master
  masterId: null
};

// Genera ID unico
function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Ottieni IP locale
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Decrementa durata effetti e rimuovi quelli scaduti
function decrementEffects() {
  // Effetti sui personaggi
  [...gameState.heroes, ...gameState.enemies, ...gameState.allies].forEach(char => {
    char.effects = char.effects.filter(effect => {
      effect.remainingRounds--;
      return effect.remainingRounds > 0;
    });
  });
  
  // Effetti ad area
  gameState.areaEffects = gameState.areaEffects.filter(effect => {
    effect.remainingRounds--;
    return effect.remainingRounds > 0;
  });
}

// Calcola ordine turni (iniziativa intera + initiativeOrder per pari merito)
function calculateTurnOrder() {
  const allChars = [
    ...gameState.heroes.filter(h => h.ownerId && h.initiative !== null),
    ...gameState.enemies.filter(e => e.initiative !== null),
    ...gameState.allies.filter(a => a.initiative !== null),
    ...(gameState.summons || []).filter(s => s.initiative !== null)
  ];
  return allChars.sort((a, b) => {
    const aInit = Number(a.initiative);
    const bInit = Number(b.initiative);
    if (aInit !== bInit) return bInit - aInit;
    const aOrder = a.initiativeOrder != null ? a.initiativeOrder : 999;
    const bOrder = b.initiativeOrder != null ? b.initiativeOrder : 999;
    return aOrder - bOrder;
  });
}

// Trova gruppi con stessa iniziativa (intera) da ordinare dal master
function findInitiativeTies() {
  const allChars = [
    ...gameState.heroes.filter(h => h.ownerId && h.initiative !== null),
    ...gameState.enemies.filter(e => e.initiative !== null),
    ...gameState.allies.filter(a => a.initiative !== null),
    ...(gameState.summons || []).filter(s => s.initiative !== null)
  ];
  const groups = {};
  allChars.forEach(char => {
    const init = Number(char.initiative);
    const key = Math.floor(init);
    if (!groups[key]) groups[key] = [];
    groups[key].push(char);
  });
  const ties = [];
  Object.keys(groups).forEach(base => {
    const chars = groups[base];
    if (chars.length > 1)
      ties.push({ initiative: parseInt(base), characters: chars });
  });
  return ties;
}

// Invia stato a tutti
function broadcastState() {
  updateHeroImages(); // Aggiorna immagini prima di inviare
  
  // Invia stato filtrato a ogni socket
  io.sockets.sockets.forEach((socket) => {
    const isMaster = socket.id === gameState.masterId;
    
    let filteredState = {
      ...gameState,
      bonusTypes: getBonusTypeNames()
    };
    
    // Se non è il master, filtra i nemici ritardati
    if (!isMaster && gameState.delayedCharacters) {
      filteredState = {
        ...filteredState,
        delayedCharacters: gameState.delayedCharacters.filter(char => 
          !char.isEnemy // Mostra solo eroi e alleati ritardati ai giocatori
        )
      };
    }
    
    socket.emit('gameState', filteredState);
  });
}

io.on('connection', (socket) => {
  console.log('Utente connesso:', socket.id);
  
  // Invia stato iniziale
  updateHeroImages();
  const isMaster = socket.id === gameState.masterId;
  let filteredState = {
    ...gameState,
    bonusTypes: getBonusTypeNames()
  };
  
  // Se non è il master, filtra i nemici ritardati
  if (!isMaster && gameState.delayedCharacters) {
    filteredState = {
      ...filteredState,
      delayedCharacters: gameState.delayedCharacters.filter(char => 
        !char.isEnemy // Mostra solo eroi e alleati ritardati ai giocatori
      )
    };
  }
  
  socket.emit('gameState', filteredState);
  
  // joinRoom: server standalone ha una sola partita; accetta qualsiasi roomId e invia stato
  socket.on('joinRoom', (roomId) => {
    const isMaster = socket.id === gameState.masterId;
    let filtered = {
      ...gameState,
      bonusTypes: getBonusTypeNames()
    };
    if (!isMaster && gameState.delayedCharacters) {
      filtered = {
        ...filtered,
        delayedCharacters: gameState.delayedCharacters.filter(c => !c.isEnemy)
      };
    }
    socket.emit('gameState', filtered);
    console.log('Client', socket.id, 'entrato in stanza', roomId);
  });
  
  // === SELEZIONE PROFILO ===
  
  // Diventa Master
  socket.on('becomeMaster', () => {
    if (!gameState.masterId) {
      gameState.masterId = socket.id;
      broadcastState();
      console.log('Master connesso:', socket.id);
    } else {
      socket.emit('error', 'Un Master è già connesso');
    }
  });
  
  // === GESTIONE PERSONAGGI (Giocatori) ===
  
  // Seleziona personaggio
  // Comportamento: se il personaggio è già preso da un altro socket, lo "rubiamo"
  // chiudendo la sessione precedente. Manteniamo aperta la sessione attuale.
  socket.on('claimHero', (heroId) => {
    const hero = gameState.heroes.find(h => h.id === heroId);
    if (!hero) return;

    // Se è già nostro, niente da fare
    if (hero.ownerId === socket.id) return;

    // Se è preso da un altro socket: assegna a noi PRIMA, poi disconnetti il vecchio.
    // L'ordine è importante: il disconnect handler libera l'eroe solo se il proprio
    // socket.id risulta ancora ownerId, quindi cambiando owner prima evitiamo race.
    const previousOwnerId = hero.ownerId;
    hero.ownerId = socket.id;

    if (previousOwnerId && previousOwnerId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(previousOwnerId);
      if (oldSocket) {
        try {
          oldSocket.emit('characterTakenOver', { heroId, heroName: hero.name });
          // Diamo un tick al client per ricevere l'evento prima di chiuderlo
          setTimeout(() => {
            try { oldSocket.disconnect(true); } catch (_) {}
          }, 100);
        } catch (_) {}
      }
      console.log(`${socket.id} ha preso ${hero.name} sostituendo ${previousOwnerId}`);
    } else {
      console.log(`${socket.id} ha scelto ${hero.name}`);
    }

    broadcastState();
  });
  
  // Rilascia personaggio
  socket.on('releaseHero', (heroId) => {
    const hero = gameState.heroes.find(h => h.id === heroId);
    if (hero && hero.ownerId === socket.id) {
      hero.ownerId = null;
      hero.initiative = null;
      hero.effects = [];
      broadcastState();
    }
  });
  
  // Rinomina personaggio
  socket.on('renameHero', ({ heroId, name }) => {
    const hero = gameState.heroes.find(h => h.id === heroId);
    if (hero && (hero.ownerId === socket.id || socket.id === gameState.masterId)) {
      hero.name = name;
      broadcastState();
    }
  });
  
  // Imposta iniziativa eroe
  socket.on('setHeroInitiative', ({ heroId, initiative }) => {
    const hero = gameState.heroes.find(h => h.id === heroId);
    if (hero && (hero.ownerId === socket.id || socket.id === gameState.masterId)) {
      hero.initiative = parseInt(initiative);
      hero.initiativeOrder = null;
      broadcastState();
      console.log(`${hero.name} ha iniziativa ${initiative}`);
    }
  });
  
  // === GESTIONE NEMICI (Solo Master) ===
  
  // Aggiungi nemico
  socket.on('addEnemy', ({ name, initiative, icon, imageId }) => {
    if (socket.id === gameState.masterId) {
      const enemyId = generateId();
      const enemy = {
        id: enemyId,
        name: name || 'Nemico',
        icon: icon || '👹',
        image: imageId ? findCharacterImage(imageId, 'enemies') : null,
        initiative: parseInt(initiative) || 0,
        isEnemy: true,
        effects: []
      };
      gameState.enemies.push(enemy);
      
      // Se combattimento in corso, ricalcola ordine turni
      if (gameState.combatStarted) {
        gameState.turnOrder = calculateTurnOrder();
      }
      
      broadcastState();
      console.log(`Nemico aggiunto: ${enemy.name}`);
    }
  });
  
  // === GESTIONE ALLEATI NPC (Solo Master) ===
  
  // Aggiungi alleato
  socket.on('addAlly', ({ name, initiative, imageId }) => {
    if (socket.id === gameState.masterId) {
      const allyId = generateId();
      const ally = {
        id: allyId,
        name: name || 'Alleato',
        icon: '🛡️',
        image: imageId ? findCharacterImage(imageId, 'allies') : '/images/allies/ally-default.svg',
        initiative: parseInt(initiative) || 0,
        isAlly: true,
        effects: []
      };
      gameState.allies.push(ally);
      
      // Se combattimento in corso, ricalcola ordine turni
      if (gameState.combatStarted) {
        gameState.turnOrder = calculateTurnOrder();
      }
      
      broadcastState();
      console.log(`Alleato aggiunto: ${ally.name}`);
    }
  });
  
  // Rimuovi alleato
  socket.on('removeAlly', (allyId) => {
    if (socket.id === gameState.masterId) {
      gameState.allies = gameState.allies.filter(a => a.id !== allyId);
      // Ricalcola ordine turni se in combattimento
      if (gameState.combatStarted) {
        gameState.turnOrder = calculateTurnOrder();
        if (gameState.currentTurn >= gameState.turnOrder.length) {
          gameState.currentTurn = 0;
        }
      }
      broadcastState();
      console.log(`Alleato rimosso: ${allyId}`);
    }
  });
  
  // Modifica iniziativa alleato
  socket.on('setAllyInitiative', ({ allyId, initiative }) => {
    if (socket.id === gameState.masterId) {
      const ally = gameState.allies.find(a => a.id === allyId);
      if (ally) {
        ally.initiative = parseInt(initiative);
        ally.initiativeOrder = null;
        // Se combattimento in corso, ricalcola ordine turni
        if (gameState.combatStarted) {
          gameState.turnOrder = calculateTurnOrder();
        }
        broadcastState();
      }
    }
  });
  
  // === GESTIONE RITARDO (Delay) ===
  
  // Ritarda un personaggio (eroe, nemico o alleato)
  socket.on('delayCharacter', (charId) => {
    if (!gameState.combatStarted) return;
    
    // Trova il personaggio nell'ordine turni
    const charIndex = gameState.turnOrder.findIndex(c => c.id === charId);
    if (charIndex === -1) return;
    
    const character = gameState.turnOrder[charIndex];
    
    // Verifica permessi:
    // - Master può ritardare chiunque solo se è il loro turno
    // - Giocatore può ritardare solo se stesso e solo se è il suo turno
    const isMaster = socket.id === gameState.masterId;
    const isOwner = character.ownerId === socket.id;
    const isCurrentTurn = charIndex === gameState.currentTurn;
    
    if (!isCurrentTurn) return; // Può ritardare solo nel suo turno
    if (!isMaster && !isOwner) return; // Deve essere il master o il proprietario
    
    // Rimuovi dall'ordine turni e aggiungi ai ritardati
    gameState.turnOrder.splice(charIndex, 1);
    gameState.delayedCharacters.push({
      ...character,
      originalInitiative: character.initiative,
      delayedFromIndex: charIndex
    });
    
    // Annulla l'iniziativa del personaggio originale
    const originalChar = [...gameState.heroes, ...gameState.enemies, ...gameState.allies, ...(gameState.summons || [])].find(c => c.id === charId);
    if (originalChar) {
      originalChar.initiative = null;
    }
    
    // Aggiusta currentTurn se necessario
    if (gameState.currentTurn >= gameState.turnOrder.length && gameState.turnOrder.length > 0) {
      gameState.currentTurn = 0;
    }
    
    broadcastState();
    console.log(`Personaggio ${character.name} ritardato`);
  });
  
  // Rientra dopo il ritardo - il master decide l'ordine via popup
  socket.on('undelayCharacter', (charId) => {
    if (!gameState.combatStarted) return;
    
    const delayedIndex = gameState.delayedCharacters.findIndex(c => c.id === charId);
    if (delayedIndex === -1) return;
    
    const character = gameState.delayedCharacters[delayedIndex];
    
    const isMaster = socket.id === gameState.masterId;
    const originalChar = [...gameState.heroes, ...gameState.enemies, ...gameState.allies, ...(gameState.summons || [])].find(c => c.id === charId);
    if (!originalChar) return;
    
    const isOwner = originalChar.ownerId === socket.id;
    if (!isMaster && !isOwner) return;
    
    // Calcola l'iniziativa base del turno corrente
    let newInitiative = character.originalInitiative;
    if (gameState.turnOrder.length > 0 && gameState.currentTurn < gameState.turnOrder.length) {
      newInitiative = Math.floor(gameState.turnOrder[gameState.currentTurn].initiative);
    } else if (gameState.turnOrder.length > 0) {
      newInitiative = Math.floor(gameState.turnOrder[gameState.turnOrder.length - 1].initiative);
    }
    
    // Assegna l'iniziativa intera al rientrante e azzera ordine tie
    originalChar.initiative = newInitiative;
    originalChar.initiativeOrder = null;
    
    // Rimuovi dai ritardati
    gameState.delayedCharacters.splice(delayedIndex, 1);
    
    // Controlla se ci sono tie da risolvere (il rientrante con init intera crea un tie)
    const ties = findInitiativeTies();
    
    if (ties.length > 0) {
      io.to(gameState.masterId).emit('resolveInitiativeTies', ties);
    } else {
      gameState.turnOrder = calculateTurnOrder();
    }
    
    broadcastState();
    console.log(`Personaggio ${character.name} rientrato con iniziativa ${newInitiative}`);
  });
  
  // Rimuovi nemico
  socket.on('removeEnemy', (enemyId) => {
    if (socket.id === gameState.masterId) {
      gameState.enemies = gameState.enemies.filter(e => e.id !== enemyId);
      // Ricalcola ordine turni se in combattimento
      if (gameState.combatStarted) {
        gameState.turnOrder = calculateTurnOrder();
        if (gameState.currentTurn >= gameState.turnOrder.length) {
          gameState.currentTurn = 0;
        }
      }
      broadcastState();
      console.log(`Nemico rimosso: ${enemyId}`);
    }
  });
  
  // Modifica iniziativa nemico
  socket.on('setEnemyInitiative', ({ enemyId, initiative }) => {
    if (socket.id === gameState.masterId) {
      const enemy = gameState.enemies.find(e => e.id === enemyId);
      if (enemy) {
        enemy.initiative = parseInt(initiative);
        enemy.initiativeOrder = null;
        // Se combattimento in corso, ricalcola ordine turni
        if (gameState.combatStarted) {
          gameState.turnOrder = calculateTurnOrder();
        }
        broadcastState();
      }
    }
  });
  
  // === GESTIONE EFFETTI ===
  
  // Aggiungi effetto a personaggio
  socket.on('addEffect', ({ targetId, effect }) => {
    const target = [...gameState.heroes, ...gameState.enemies, ...gameState.allies].find(c => c.id === targetId);
    if (!target) return;
    
    // Verifica permessi: il giocatore può aggiungere solo a sé stesso, il master a tutti
    const hero = gameState.heroes.find(h => h.id === targetId);
    const canEdit = socket.id === gameState.masterId || (hero && hero.ownerId === socket.id);
    
    if (canEdit) {
      target.effects.push({
        id: generateId(),
        name: effect.name,
        type: effect.type,
        isBonus: effect.isBonus !== false, // default true se non specificato
        remainingRounds: parseInt(effect.duration),
        createdBy: socket.id
      });
      broadcastState();
      console.log(`Effetto "${effect.name}" aggiunto a ${target.name}`);
    }
  });
  
  // Rimuovi effetto da personaggio
  socket.on('removeEffect', ({ targetId, effectId }) => {
    const target = [...gameState.heroes, ...gameState.enemies, ...gameState.allies].find(c => c.id === targetId);
    if (!target) return;
    
    const hero = gameState.heroes.find(h => h.id === targetId);
    const canEdit = socket.id === gameState.masterId || (hero && hero.ownerId === socket.id);
    
    if (canEdit) {
      target.effects = target.effects.filter(e => e.id !== effectId);
      broadcastState();
    }
  });
  
  // === EFFETTI AD AREA ===
  
  // Aggiungi effetto ad area
  socket.on('addAreaEffect', ({ name, duration }) => {
    // Sia giocatori che master possono aggiungere effetti ad area
    const hero = gameState.heroes.find(h => h.ownerId === socket.id);
    if (hero || socket.id === gameState.masterId) {
      gameState.areaEffects.push({
        id: generateId(),
        name: name,
        remainingRounds: parseInt(duration),
        createdBy: socket.id,
        creatorName: hero ? hero.name : 'Master'
      });
      broadcastState();
      console.log(`Effetto ad area "${name}" aggiunto`);
    }
  });
  
  // Rimuovi effetto ad area
  socket.on('removeAreaEffect', (effectId) => {
    const effect = gameState.areaEffects.find(e => e.id === effectId);
    if (effect && (effect.createdBy === socket.id || socket.id === gameState.masterId)) {
      gameState.areaEffects = gameState.areaEffects.filter(e => e.id !== effectId);
      broadcastState();
    }
  });
  
  // === GESTIONE COMBATTIMENTO ===
  
  // Inizia combattimento
  socket.on('startCombat', () => {
    if (socket.id === gameState.masterId) {
      const claimedHeroes = gameState.heroes.filter(h => h.ownerId && h.initiative !== null);
      const readyEnemies = gameState.enemies.filter(e => e.initiative !== null);
      
      if (claimedHeroes.length > 0 || readyEnemies.length > 0) {
        // Controlla se ci sono iniziative duplicate
        const ties = findInitiativeTies();
        
        if (ties.length > 0) {
          // Invia richiesta al master per risolvere i tie
          io.to(gameState.masterId).emit('resolveInitiativeTies', ties);
        } else {
          // Nessun tie, inizia normalmente
          gameState.turnOrder = calculateTurnOrder();
          gameState.currentTurn = 0;
          gameState.currentRound = 1;
          gameState.combatStarted = true;
          broadcastState();
          io.emit('combatStarted');
          console.log('Combattimento iniziato! Round 1');
        }
      }
    }
  });
  
  // Risolvi ordine iniziative uguali - assegna initiativeOrder (1, 2, 3...)
  socket.on('setInitiativeOrder', ({ initiative, orderedIds }) => {
    if (socket.id !== gameState.masterId) return;
    const allChars = [...gameState.heroes, ...gameState.enemies, ...gameState.allies];
    if (gameState.summons) allChars.push(...gameState.summons);
    orderedIds.forEach((id, index) => {
      const char = allChars.find(c => c.id == id);
      if (char) {
        char.initiativeOrder = index + 1;
        char.initiative = parseInt(initiative);
      }
    });
    const ties = findInitiativeTies();
    if (ties.length > 0) {
      io.to(gameState.masterId).emit('resolveInitiativeTies', ties);
    } else {
      if (!gameState.combatStarted) {
        gameState.turnOrder = calculateTurnOrder();
        gameState.currentTurn = 0;
        gameState.currentRound = 1;
        gameState.combatStarted = true;
        broadcastState();
        io.emit('combatStarted');
        console.log('Combattimento iniziato! Round 1');
      } else {
        gameState.turnOrder = calculateTurnOrder();
        broadcastState();
      }
    }
  });
  
  // Turno successivo
  socket.on('nextTurn', () => {
    if (socket.id === gameState.masterId && gameState.combatStarted && gameState.turnOrder.length > 0) {
      gameState.currentTurn++;
      
      // Se abbiamo completato un round
      if (gameState.currentTurn >= gameState.turnOrder.length) {
        gameState.currentTurn = 0;
        gameState.currentRound++;
        decrementEffects();
        io.emit('newRound', gameState.currentRound);
        console.log(`Nuovo Round: ${gameState.currentRound}`);
      }
      
      broadcastState();
    }
  });
  
  // Turno precedente
  socket.on('prevTurn', () => {
    if (socket.id === gameState.masterId && gameState.combatStarted && gameState.turnOrder.length > 0) {
      gameState.currentTurn--;
      
      if (gameState.currentTurn < 0) {
        gameState.currentTurn = gameState.turnOrder.length - 1;
        if (gameState.currentRound > 1) {
          gameState.currentRound--;
        }
      }
      
      broadcastState();
    }
  });
  
  // Ferma combattimento
  socket.on('stopCombat', () => {
    if (socket.id === gameState.masterId) {
      gameState.combatStarted = false;
      gameState.currentTurn = 0;
      gameState.currentRound = 1;
      gameState.turnOrder = [];
      broadcastState();
      console.log('Combattimento terminato');
    }
  });
  
  // Reset completo
  socket.on('resetAll', () => {
    if (socket.id === gameState.masterId) {
      gameState.heroes.forEach(h => {
        h.ownerId = null;
        h.initiative = null;
        h.effects = [];
      });
      gameState.enemies = [];
      gameState.allies = [];
      gameState.areaEffects = [];
      gameState.combatStarted = false;
      gameState.currentTurn = 0;
      gameState.currentRound = 1;
      gameState.turnOrder = [];
      broadcastState();
      console.log('Reset completo');
    }
  });
  
  // === DISCONNESSIONE ===
  
  socket.on('disconnect', () => {
    console.log('Utente disconnesso:', socket.id);
    
    // Se era il master
    if (socket.id === gameState.masterId) {
      gameState.masterId = null;
      console.log('Master disconnesso');
    }
    
    // Rilascia personaggi
    gameState.heroes.forEach(h => {
      if (h.ownerId === socket.id) {
        h.ownerId = null;
        h.initiative = null;
        h.effects = [];
      }
    });
    
    broadcastState();
  });
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  const localIP = getLocalIP();
  console.log('');
  console.log('🎲 RPG Initiative Tracker avviato!');
  console.log('');
  console.log(`📍 Locale:    http://localhost:${PORT}`);
  console.log(`📍 Rete:      http://${localIP}:${PORT}`);
  console.log('');
  console.log('PROFILI DISPONIBILI:');
  console.log('  /master.html  - Interfaccia Master');
  console.log('  /tablet.html  - Display Tavolo');
  console.log('  /            - Interfaccia Giocatori');
  console.log('');
  console.log('📚 LIBRERIA PATHFINDER 1E:');
  console.log(`  ${pf1eLibrary.conditions.length} condizioni`);
  console.log(`  ${pf1eLibrary.bonusTypes.length} tipi di bonus`);
  console.log(`  ${pf1eLibrary.spells.length} incantesimi`);
  console.log('');
  console.log('API: /api/library, /api/library/conditions, /api/library/spells');
  console.log('');
});
