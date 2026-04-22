const { generateId, calculateTurnOrder, findInitiativeTies, decrementEffects } = require('./game-logic');
const path = require('path');
const fs = require('fs');

class RoomManager {
  constructor(database, io, getImagesPathFn = null, loadConfigFn = null) {
    this.db = database;
    this.io = io;
    this.activeRooms = new Map(); // roomId -> { gameState, sockets: Set }
    this.getImagesPath = getImagesPathFn || ((subfolder) => path.join(__dirname, '..', 'public', 'images', subfolder));
    this.loadConfig = loadConfigFn || (() => {
      // Fallback: carica da data/config.json se loadConfig non è fornito
      try {
        const configPath = path.join(__dirname, '..', 'data', 'config.json');
        if (fs.existsSync(configPath)) {
          return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
      } catch (e) {
        console.error('Errore caricamento config fallback:', e);
      }
      return { enemies: [], allies: [], heroes: [] };
    });
  }

  // === GESTIONE STANZE ===

  createRoom(name) {
    const id = generateId();
    const room = this.db.createRoom(id, name);
    return room;
  }

  getAllRooms() {
    return this.db.getAllRooms();
  }

  getRoom(roomId) {
    return this.db.getRoom(roomId);
  }

  deleteRoom(roomId) {
    // Disconnetti tutti i client della stanza
    if (this.activeRooms.has(roomId)) {
      const room = this.activeRooms.get(roomId);
      room.sockets.forEach(socketId => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('roomDeleted');
          socket.disconnect();
        }
      });
      this.activeRooms.delete(roomId);
    }
    
    this.db.deleteRoom(roomId);
  }

  // === GESTIONE SOCKET ===

  handleConnection(socket) {
    console.log('Nuovo client:', socket.id);

    // Join stanza
    socket.on('joinRoom', (roomId) => {
      this.handleJoinRoom(socket, roomId);
    });

    // Diventa master
    socket.on('becomeMaster', () => {
      this.handleBecomeMaster(socket);
    });

    // Eventi di gioco
    this.setupGameEvents(socket);

    // Disconnessione
    socket.on('disconnect', () => {
      this.handleDisconnect(socket);
    });
  }

  handleJoinRoom(socket, roomId) {
    const room = this.db.getRoom(roomId);
    if (!room) {
      socket.emit('error', 'Stanza non trovata');
      return;
    }

    // Se il socket era già in un'altra stanza, rimuovilo
    if (socket.roomId && socket.roomId !== roomId) {
      this.handleDisconnect(socket);
    }

    // Carica stato stanza
    if (!this.activeRooms.has(roomId)) {
      const gameState = this.db.getRoomState(roomId);
      // Assicurati che tutti gli array esistano
      if (!gameState.allies) gameState.allies = [];
      if (!gameState.summons) gameState.summons = [];
      // Verifica se il masterId salvato corrisponde a un socket ancora connesso
      // Se non c'è, resetta il masterId (potrebbe essere un vecchio master disconnesso)
      if (gameState.masterId) {
        const masterSocket = this.io.sockets.sockets.get(gameState.masterId);
        if (!masterSocket) {
          // Il master salvato non è più connesso, resetta
          gameState.masterId = null;
          console.log(`⚠️ MasterId resettato per stanza ${roomId} (master non più connesso)`);
          this.db.saveRoomState(roomId, gameState);
        }
      }
      this.activeRooms.set(roomId, {
        gameState,
        sockets: new Set()
      });
    } else {
      // Stanza già attiva, verifica se il master è ancora connesso
      const activeRoom = this.activeRooms.get(roomId);
      if (activeRoom.gameState.masterId) {
        // Verifica se il socket master è ancora nella stanza
        const masterSocket = this.io.sockets.sockets.get(activeRoom.gameState.masterId);
        if (!masterSocket || !activeRoom.sockets.has(activeRoom.gameState.masterId)) {
          // Master non più connesso, resetta
          activeRoom.gameState.masterId = null;
          console.log(`⚠️ MasterId resettato per stanza ${roomId} (master non più connesso)`);
          this.broadcastToRoom(roomId);
          this.saveRoomState(roomId);
        }
      }
    }

    const activeRoom = this.activeRooms.get(roomId);
    activeRoom.sockets.add(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;

    // Invia stato corrente
    socket.emit('gameState', activeRoom.gameState);
    console.log(`Client ${socket.id} joined room ${roomId}`);
  }

  handleBecomeMaster(socket) {
    if (!socket.roomId) {
      // Se non c'è roomId, potrebbe essere una connessione senza stanza
      // In questo caso, non possiamo diventare master
      console.warn(`Socket ${socket.id} ha tentato di diventare master senza roomId`);
      socket.emit('error', 'Devi essere in una stanza per diventare master');
      return;
    }
    
    const activeRoom = this.activeRooms.get(socket.roomId);
    if (!activeRoom) {
      console.warn(`Socket ${socket.id} ha tentato di diventare master in una stanza non attiva`);
      socket.emit('error', 'Stanza non attiva');
      return;
    }

    // Verifica se il client è Electron (solo Electron può diventare master)
    // Controlla se il socket ha una proprietà che indica che è Electron
    // In alternativa, possiamo verificare se la richiesta viene da localhost
    // Per ora, assumiamo che solo le connessioni da localhost possano diventare master
    // (questo è un controllo di sicurezza base, ma non perfetto)
    const isLocalhost = socket.handshake.address === '127.0.0.1' || 
                       socket.handshake.address === '::1' ||
                       socket.handshake.address === '::ffff:127.0.0.1' ||
                       socket.handshake.headers.host?.includes('localhost') ||
                       socket.handshake.headers.origin?.includes('localhost');
    
    if (!isLocalhost) {
      console.warn(`Socket ${socket.id} ha tentato di diventare master da un client non Electron (${socket.handshake.address})`);
      socket.emit('error', 'Solo il Master (applicazione Electron) può accedere alla vista Master. I giocatori devono usare la vista Giocatore.');
      return;
    }

    // Verifica se c'è un master e se è ancora connesso
    if (activeRoom.gameState.masterId && activeRoom.gameState.masterId !== socket.id) {
      // Verifica se il master è ancora connesso
      const masterSocket = this.io.sockets.sockets.get(activeRoom.gameState.masterId);
      if (masterSocket && activeRoom.sockets.has(activeRoom.gameState.masterId)) {
        // C'è già un master diverso e connesso
        socket.emit('error', 'Master già connesso');
        return;
      } else {
        // Il master salvato non è più connesso, resetta
        console.log(`⚠️ MasterId ${activeRoom.gameState.masterId} non più connesso, reset`);
        activeRoom.gameState.masterId = null;
        this.broadcastToRoom(socket.roomId);
        this.saveRoomState(socket.roomId);
      }
    }

    // Se il masterId è già questo socket, non fare nulla (riconnessione)
    if (activeRoom.gameState.masterId === socket.id) {
      console.log(`Master ${socket.id} già connesso, invio stato aggiornato`);
      socket.emit('gameState', activeRoom.gameState);
      return;
    }

    activeRoom.gameState.masterId = socket.id;
    this.broadcastToRoom(socket.roomId);
    this.saveRoomState(socket.roomId);
    console.log(`Socket ${socket.id} è diventato master della stanza ${socket.roomId}`);
  }

  handleDisconnect(socket) {
    if (!socket.roomId) return;

    const activeRoom = this.activeRooms.get(socket.roomId);
    if (!activeRoom) return;

    // Rimuovi socket
    activeRoom.sockets.delete(socket.id);

    // Se era il master, resetta masterId
    if (activeRoom.gameState.masterId === socket.id) {
      activeRoom.gameState.masterId = null;
      console.log(`Master ${socket.id} disconnesso da room ${socket.roomId}`);
      this.broadcastToRoom(socket.roomId);
      this.saveRoomState(socket.roomId);
    }

    // NON rilasciare automaticamente gli eroi - rimangono nel combattimento
    // Il master può liberarli manualmente se necessario
    // I giocatori possono riconnettersi e riprendere il loro eroe
    console.log(`Client ${socket.id} disconnesso da room ${socket.roomId} - eroi mantenuti nel combattimento`);
  }

  // === EVENTI DI GIOCO ===

  setupGameEvents(socket) {
    // Eroi
    socket.on('claimHero', (heroId) => this.handleClaimHero(socket, heroId));
    socket.on('releaseHero', (heroId) => this.handleReleaseHero(socket, heroId));
    socket.on('renameHero', (data) => this.handleRenameHero(socket, data));
    socket.on('setHeroInitiative', (data) => this.handleSetHeroInitiative(socket, data));

    // Nemici
    socket.on('addEnemy', (data) => this.handleAddEnemy(socket, data));
    socket.on('removeEnemy', (enemyId) => this.handleRemoveEnemy(socket, enemyId));
    socket.on('setEnemyInitiative', (data) => this.handleSetEnemyInitiative(socket, data));

    // Alleati
    socket.on('addAlly', (data) => this.handleAddAlly(socket, data));
    socket.on('removeAlly', (allyId) => this.handleRemoveAlly(socket, allyId));
    socket.on('setAllyInitiative', (data) => this.handleSetAllyInitiative(socket, data));

    // Effetti
    socket.on('addEffect', (data) => this.handleAddEffect(socket, data));
    socket.on('removeEffect', (data) => this.handleRemoveEffect(socket, data));
    socket.on('addAreaEffect', (data) => this.handleAddAreaEffect(socket, data));
    socket.on('removeAreaEffect', (effectId) => this.handleRemoveAreaEffect(socket, effectId));
    
    // Evocazioni
    socket.on('addSummon', (data) => this.handleAddSummon(socket, data));
    socket.on('removeSummon', (summonId) => this.handleRemoveSummon(socket, summonId));
    socket.on('setSummonInitiative', (data) => this.handleSetSummonInitiative(socket, data));

    // Combattimento
    socket.on('startCombat', () => this.handleStartCombat(socket));
    socket.on('nextTurn', () => this.handleNextTurn(socket));
    socket.on('prevTurn', () => this.handlePrevTurn(socket));
    socket.on('stopCombat', () => this.handleStopCombat(socket));
    socket.on('resetAll', () => this.handleResetAll(socket));

    // Ritardi
    socket.on('delayCharacter', (charId) => this.handleDelayCharacter(socket, charId));
    socket.on('undelayCharacter', (charId) => this.handleUndelayCharacter(socket, charId));
    socket.on('undelayCharacterWithPosition', (data) => this.handleUndelayCharacterWithPosition(socket, data));
    
    // Iniziative uguali
    socket.on('setInitiativeOrder', (data) => this.handleSetInitiativeOrder(socket, data));
  }

  // Handler individuali (implementazione completa dal server.js)
  
  handleClaimHero(socket, heroId) {
    console.log(`🎯 handleClaimHero chiamato: socket=${socket.id}, heroId=${heroId}`);
    const gs = this.getGameState(socket);
    if (!gs) {
      console.error('❌ handleClaimHero: gameState non disponibile');
      return;
    }

    const hero = gs.heroes.find(h => h.id === heroId);
    if (!hero) {
      console.error(`❌ handleClaimHero: eroe ${heroId} non trovato`);
      socket.emit('heroClaimError', { heroId, message: 'Eroe non trovato' });
      return;
    }
    
    console.log(`👤 Eroe trovato: ${hero.name}, ownerId attuale: ${hero.ownerId}`);
    
    // Se è libero o è già del giocatore, assegnaglielo
    if (!hero.ownerId || hero.ownerId === socket.id) {
      hero.ownerId = socket.id;
      this.broadcastAndSave(socket.roomId);
      console.log(`✅ ${socket.id} ha scelto ${hero.name}`);
      return;
    }
    
    // Se è occupato, verifica se il socket precedente è ancora connesso
    const activeRoom = this.activeRooms.get(socket.roomId);
    if (activeRoom && activeRoom.sockets.has(hero.ownerId)) {
      // Il socket precedente è ancora connesso, quindi l'eroe è davvero occupato
      console.log(`⚠️ Eroe ${heroId} già posseduto da ${hero.ownerId} (ancora connesso)`);
      socket.emit('heroClaimError', { heroId, message: 'Eroe già occupato' });
    } else {
      // Il socket precedente non è più connesso, permetti di riprendere l'eroe
      console.log(`🔄 Socket ${hero.ownerId} non più connesso, permesso di riprendere ${hero.name}`);
      hero.ownerId = socket.id;
      this.broadcastAndSave(socket.roomId);
      console.log(`✅ ${socket.id} ha ripreso ${hero.name} (socket precedente disconnesso)`);
    }
  }

  handleReleaseHero(socket, heroId) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    const hero = gs.heroes.find(h => h.id === heroId);
    // Permetti al master di liberare qualsiasi eroe, oppure al proprietario di liberare il proprio
    if (hero && (hero.ownerId === socket.id || socket.id === gs.masterId)) {
      hero.ownerId = null;
      hero.initiative = null;
      hero.effects = []; // Pulisci anche gli effetti quando il master libera l'eroe
      this.broadcastAndSave(socket.roomId);
      console.log(`🔓 Eroe ${hero.name} liberato da ${socket.id === gs.masterId ? 'master' : 'proprietario'}`);
    }
  }

  handleRenameHero(socket, { heroId, name }) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    const hero = gs.heroes.find(h => h.id === heroId);
    if (hero && (hero.ownerId === socket.id || socket.id === gs.masterId)) {
      hero.name = name;
      this.broadcastAndSave(socket.roomId);
    }
  }

  handleSetHeroInitiative(socket, { heroId, initiative }) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    const hero = gs.heroes.find(h => h.id === heroId);
    if (hero && (hero.ownerId === socket.id || socket.id === gs.masterId)) {
      hero.initiative = parseInt(initiative);
      hero.initiativeOrder = null;
      // Se il combattimento è già iniziato, ricalcola il turnOrder per includere l'eroe
      if (gs.combatStarted) {
        const ties = findInitiativeTies(gs);
        if (ties.length > 0) {
          this.io.to(gs.masterId).emit('resolveInitiativeTies', ties);
        } else {
          gs.turnOrder = calculateTurnOrder(gs);
          // Aggiusta currentTurn se necessario
          if (gs.currentTurn >= gs.turnOrder.length && gs.turnOrder.length > 0) {
            gs.currentTurn = 0;
          }
        }
      }
      
      this.broadcastAndSave(socket.roomId);
    }
  }

  // Trova immagine per un nemico
  findEnemyImage(imageId) {
    if (!imageId || imageId === 'default' || imageId === '') return null;
    
    // Prima prova a trovare nel config (usa il percorso corretto)
    try {
      const config = this.loadConfig();
      if (config.enemies) {
        const enemy = config.enemies.find(e => e.id === imageId);
        if (enemy && enemy.image) {
          console.log('✅ Immagine nemico trovata nel config:', imageId, enemy.image);
          return enemy.image;
        }
      }
    } catch (e) {
      console.error('❌ Errore lettura config per immagine nemico:', e);
    }
    
    // Fallback: cerca nelle immagini
    const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
    const basePath = this.getImagesPath('enemies');
    
    for (const ext of extensions) {
      const imagePath = path.join(basePath, imageId + ext);
      if (fs.existsSync(imagePath)) {
        const { app } = require('electron');
        if (app && app.isPackaged) {
          return `/api/images/enemies/${imageId}${ext}`;
        }
        return `/images/enemies/${imageId}${ext}`;
      }
    }
    console.log('⚠️ Immagine nemico non trovata:', imageId);
    return null;
  }

  handleAddEnemy(socket, { name, initiative, icon, imageId }) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) return;

    const enemyId = generateId();
    const enemy = {
      id: enemyId,
      name: name || 'Nemico',
      icon: icon || '👹',
      image: (imageId && imageId !== 'default' && imageId !== '') ? this.findEnemyImage(imageId) : null,
      initiative: parseInt(initiative) || 0,
      isEnemy: true,
      effects: []
    };
    gs.enemies.push(enemy);

    if (gs.combatStarted) {
      gs.turnOrder = calculateTurnOrder(gs);
    }

    this.broadcastAndSave(socket.roomId);
  }

  handleRemoveEnemy(socket, enemyId) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) return;

    gs.enemies = gs.enemies.filter(e => e.id !== enemyId);
    
    if (gs.combatStarted) {
      gs.turnOrder = calculateTurnOrder(gs);
      if (gs.currentTurn >= gs.turnOrder.length) {
        gs.currentTurn = 0;
      }
    }

    this.broadcastAndSave(socket.roomId);
  }

  handleSetEnemyInitiative(socket, { enemyId, initiative }) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) return;

    const enemy = gs.enemies.find(e => e.id === enemyId);
    if (enemy) {
      enemy.initiative = parseInt(initiative);
      enemy.initiativeOrder = null;
      if (gs.combatStarted) {
        gs.turnOrder = calculateTurnOrder(gs);
      }
      
      this.broadcastAndSave(socket.roomId);
    }
  }

  findAllyImage(imageId) {
    if (!imageId || imageId === 'default' || imageId === '') return null;
    
    // Prima prova a trovare nel config (usa il percorso corretto)
    try {
      const config = this.loadConfig();
      if (config.allies) {
        const ally = config.allies.find(a => a.id === imageId);
        if (ally && ally.image) {
          console.log('✅ Immagine alleato trovata nel config:', imageId, ally.image);
          return ally.image;
        }
      }
    } catch (e) {
      console.error('❌ Errore lettura config per immagine alleato:', e);
    }
    
    // Fallback: cerca nelle immagini
    const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
    const basePath = this.getImagesPath('allies');
    
    for (const ext of extensions) {
      const imagePath = path.join(basePath, imageId + ext);
      if (fs.existsSync(imagePath)) {
        const { app } = require('electron');
        if (app && app.isPackaged) {
          return `/api/images/allies/${imageId}${ext}`;
        }
        return `/images/allies/${imageId}${ext}`;
      }
    }
    console.log('⚠️ Immagine alleato non trovata:', imageId);
    return null;
  }

  handleAddAlly(socket, { name, initiative, imageId }) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) {
      console.log('⚠️ handleAddAlly: non master o gameState null');
      return;
    }

    // Assicurati che allies esista
    if (!gs.allies) {
      gs.allies = [];
    }

    const allyId = generateId();
    const ally = {
      id: allyId,
      name: name || 'Alleato',
      icon: '🤝',
      image: (imageId && imageId !== 'default' && imageId !== '') ? this.findAllyImage(imageId) : null,
      initiative: parseInt(initiative) || 0,
      isAlly: true,
      effects: []
    };
    
    console.log('➕ Aggiungo alleato:', ally);
    gs.allies.push(ally);
    console.log('📋 Allies dopo aggiunta:', gs.allies.length, gs.allies);

    if (gs.combatStarted) {
      gs.turnOrder = calculateTurnOrder(gs);
    }

    this.broadcastAndSave(socket.roomId);
    console.log('✅ Alleato aggiunto e broadcast inviato');
  }

  handleRemoveAlly(socket, allyId) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) return;

    gs.allies = gs.allies.filter(a => a.id !== allyId);
    
    if (gs.combatStarted) {
      gs.turnOrder = calculateTurnOrder(gs);
      if (gs.currentTurn >= gs.turnOrder.length) {
        gs.currentTurn = 0;
      }
    }

    this.broadcastAndSave(socket.roomId);
  }

  handleSetAllyInitiative(socket, { allyId, initiative }) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) return;

    const ally = gs.allies.find(a => a.id === allyId);
    if (ally) {
      ally.initiative = parseInt(initiative);
      ally.initiativeOrder = null;
      if (gs.combatStarted) {
        gs.turnOrder = calculateTurnOrder(gs);
      }
      
      this.broadcastAndSave(socket.roomId);
    }
  }

  handleAddEffect(socket, { targetId, effect }) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    // Cerca il target in heroes, enemies, allies E summons
    const target = [...gs.heroes, ...gs.enemies, ...gs.allies, ...(gs.summons || [])].find(c => c.id === targetId);
    if (!target) {
      console.warn(`⚠️ Target ${targetId} non trovato per aggiungere effetto`);
      return;
    }

    // Verifica permessi: master può sempre, altrimenti solo se è il proprietario
    const hero = gs.heroes.find(h => h.id === targetId);
    const summon = (gs.summons || []).find(s => s.id === targetId);
    const canEdit = socket.id === gs.masterId || 
                    (hero && hero.ownerId === socket.id) || 
                    (summon && summon.createdBy === socket.id);

    if (canEdit) {
      if (!target.effects) {
        target.effects = [];
      }
      target.effects.push({
        id: generateId(),
        name: effect.name,
        isBonus: effect.isBonus,
        remainingRounds: parseInt(effect.duration),
        createdBy: socket.id
      });
      console.log(`✅ Effetto "${effect.name}" aggiunto a ${target.name} (${targetId})`);
      this.broadcastAndSave(socket.roomId);
    } else {
      console.warn(`⚠️ Permessi insufficienti per aggiungere effetto a ${targetId}`);
    }
  }

  handleRemoveEffect(socket, { targetId, effectId }) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    // Cerca il target in heroes, enemies, allies E summons
    const target = [...gs.heroes, ...gs.enemies, ...gs.allies, ...(gs.summons || [])].find(c => c.id === targetId);
    if (!target) return;

    // Verifica permessi: master può sempre, altrimenti solo se è il proprietario
    const hero = gs.heroes.find(h => h.id === targetId);
    const summon = (gs.summons || []).find(s => s.id === targetId);
    const canEdit = socket.id === gs.masterId || 
                    (hero && hero.ownerId === socket.id) || 
                    (summon && summon.createdBy === socket.id);

    if (canEdit) {
      target.effects = target.effects.filter(e => e.id !== effectId);
      this.broadcastAndSave(socket.roomId);
    }
  }

  handleAddAreaEffect(socket, { name, duration }) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    // Trova il nome del creatore
    let creatorName = 'Sconosciuto';
    const hero = gs.heroes.find(h => h.ownerId === socket.id);
    if (hero) {
      creatorName = hero.name;
    } else if (socket.id === gs.masterId) {
      creatorName = 'Master';
    }

    gs.areaEffects.push({
      id: generateId(),
      name,
      remainingRounds: parseInt(duration),
      createdBy: socket.id,
      creatorName
    });

    this.broadcastAndSave(socket.roomId);
  }

  handleRemoveAreaEffect(socket, effectId) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    const effect = gs.areaEffects.find(e => e.id === effectId);
    if (effect && (effect.createdBy === socket.id || socket.id === gs.masterId)) {
      gs.areaEffects = gs.areaEffects.filter(e => e.id !== effectId);
      this.broadcastAndSave(socket.roomId);
    }
  }

  // === EVOCAZIONI ===

  findSummonImage(summonId) {
    try {
      const config = this.loadConfig();
      if (config.summons && Array.isArray(config.summons)) {
        const summon = config.summons.find(s => s.id === summonId);
        if (summon && summon.image) {
          // Se l'immagine è un percorso relativo, convertilo in URL
          if (summon.image.startsWith('/')) {
            return summon.image;
          }
          return `/api/images/summons/${path.basename(summon.image)}`;
        }
      }
    } catch (e) {
      console.error('Errore caricamento config per evocazione:', e);
    }
    return null;
  }

  handleAddSummon(socket, { summonId, name, image, initiative, duration }) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    // Assicurati che summons esista
    if (!gs.summons) {
      gs.summons = [];
    }

    const newSummonId = generateId();
    const summonImage = image || (summonId ? this.findSummonImage(summonId) : null);
    
    const summon = {
      id: newSummonId,
      summonId: summonId, // ID del tipo di evocazione dal config
      name: name || 'Evocazione',
      icon: '🔮',
      image: summonImage,
      initiative: parseInt(initiative) || null,
      duration: parseInt(duration) || 1, // Durata in round
      remainingRounds: parseInt(duration) || 1,
      effects: [],
      createdBy: socket.id,
      isSummon: true, // Marca come evocazione
      ownerId: socket.id // Il creatore controlla l'evocazione
    };

    gs.summons.push(summon);

    if (gs.combatStarted && summon.initiative !== null) {
      gs.turnOrder = calculateTurnOrder(gs);
    }

    this.broadcastAndSave(socket.roomId);
  }

  handleRemoveSummon(socket, summonId) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    // Solo il creatore o il master può rimuovere
    const summon = gs.summons.find(s => s.id === summonId);
    if (summon && (summon.createdBy === socket.id || socket.id === gs.masterId)) {
      gs.summons = gs.summons.filter(s => s.id !== summonId);
      
      if (gs.combatStarted) {
        gs.turnOrder = calculateTurnOrder(gs);
      }
      
      this.broadcastAndSave(socket.roomId);
    }
  }

  handleSetSummonInitiative(socket, { summonId, initiative }) {
    const gs = this.getGameState(socket);
    if (!gs) return;

    const summon = gs.summons.find(s => s.id === summonId);
    if (summon && (summon.createdBy === socket.id || socket.id === gs.masterId)) {
      summon.initiative = parseInt(initiative) || null;
      summon.initiativeOrder = null;
      if (gs.combatStarted) {
        gs.turnOrder = calculateTurnOrder(gs);
      }
      
      this.broadcastAndSave(socket.roomId);
    }
  }

  handleStartCombat(socket) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) return;

    // Include eroi con iniziativa (anche se non hanno ownerId - master può impostarla)
    const heroesWithInit = gs.heroes.filter(h => h.initiative !== null);
    const readyEnemies = gs.enemies.filter(e => e.initiative !== null);
    const readyAllies = gs.allies.filter(a => a.initiative !== null);
    const readySummons = (gs.summons || []).filter(s => s.initiative !== null);

    if (heroesWithInit.length > 0 || readyEnemies.length > 0 || readyAllies.length > 0 || readySummons.length > 0) {
      const ties = findInitiativeTies(gs);

      if (ties.length > 0) {
        this.io.to(gs.masterId).emit('resolveInitiativeTies', ties);
      } else {
        gs.turnOrder = calculateTurnOrder(gs);
        gs.currentTurn = 0;
        gs.currentRound = 1;
        gs.combatStarted = true;
        this.broadcastAndSave(socket.roomId);
        this.io.to(socket.roomId).emit('combatStarted');
      }
    }
  }

  handleNextTurn(socket) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId || !gs.combatStarted) return;

    if (gs.turnOrder.length === 0) return;

    gs.currentTurn++;

    if (gs.currentTurn >= gs.turnOrder.length) {
      gs.currentTurn = 0;
      gs.currentRound++;
      decrementEffects(gs);
      this.io.to(socket.roomId).emit('newRound', gs.currentRound);
    }

    this.broadcastAndSave(socket.roomId);
  }

  handlePrevTurn(socket) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId || !gs.combatStarted) return;

    if (gs.turnOrder.length === 0) return;

    gs.currentTurn--;

    if (gs.currentTurn < 0) {
      gs.currentTurn = gs.turnOrder.length - 1;
      if (gs.currentRound > 1) {
        gs.currentRound--;
      }
    }

    this.broadcastAndSave(socket.roomId);
  }

  handleStopCombat(socket) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) return;

    gs.combatStarted = false;
    gs.currentTurn = 0;
    this.broadcastAndSave(socket.roomId);
  }

  handleResetAll(socket) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) return;

    gs.heroes.forEach(h => {
      h.ownerId = null;
      h.initiative = null;
      h.effects = [];
    });
    gs.enemies = [];
    gs.allies = [];
    gs.areaEffects = [];
    gs.delayedCharacters = [];
    gs.combatStarted = false;
    gs.currentTurn = 0;
    gs.currentRound = 1;
    gs.turnOrder = [];

    this.broadcastAndSave(socket.roomId);
  }

  handleDelayCharacter(socket, charId) {
    const gs = this.getGameState(socket);
    if (!gs || !gs.combatStarted) return;

    const charIndex = gs.turnOrder.findIndex(c => c.id === charId);
    if (charIndex === -1) return;

    const character = gs.turnOrder[charIndex];

    const isMaster = socket.id === gs.masterId;
    const isOwner = character.ownerId === socket.id;
    const isCurrentTurn = charIndex === gs.currentTurn;

    if (!isCurrentTurn) return;
    if (!isMaster && !isOwner) return;

    gs.turnOrder.splice(charIndex, 1);
    gs.delayedCharacters.push({
      ...character,
      originalInitiative: character.initiative,
      delayedFromIndex: charIndex
    });

    const originalChar = [...gs.heroes, ...gs.enemies, ...gs.allies, ...(gs.summons || [])].find(c => c.id === charId);
    if (originalChar) {
      originalChar.initiative = null;
    }

    if (gs.currentTurn >= gs.turnOrder.length && gs.turnOrder.length > 0) {
      gs.currentTurn = 0;
    }

    this.broadcastAndSave(socket.roomId);
  }

  handleUndelayCharacter(socket, charId) {
    const gs = this.getGameState(socket);
    if (!gs || !gs.combatStarted) return;

    const delayedIndex = gs.delayedCharacters.findIndex(c => c.id === charId);
    if (delayedIndex === -1) return;

    const character = gs.delayedCharacters[delayedIndex];
    
    const isMaster = socket.id === gs.masterId;
    const originalChar = [...gs.heroes, ...gs.enemies, ...gs.allies, ...(gs.summons || [])].find(c => c.id === charId);
    if (!originalChar) return;
    
    const isOwner = originalChar.ownerId === socket.id;
    if (!isMaster && !isOwner) return;

    // Calcola l'iniziativa base del turno corrente
    let newInitiative = character.originalInitiative;
    if (gs.turnOrder.length > 0 && gs.currentTurn < gs.turnOrder.length) {
      newInitiative = Math.floor(gs.turnOrder[gs.currentTurn].initiative);
    } else if (gs.turnOrder.length > 0) {
      newInitiative = Math.floor(gs.turnOrder[gs.turnOrder.length - 1].initiative);
    }

    // Assegna l'iniziativa intera al rientrante e azzera ordine tie
    originalChar.initiative = newInitiative;
    originalChar.initiativeOrder = null;

    gs.delayedCharacters.splice(delayedIndex, 1);

    // Controlla se ci sono tie da risolvere (il rientrante con init intera crea un tie)
    const ties = findInitiativeTies(gs);
    if (ties.length > 0) {
      this.io.to(gs.masterId).emit('resolveInitiativeTies', ties);
    } else {
      gs.turnOrder = calculateTurnOrder(gs);
    }

    this.broadcastAndSave(socket.roomId);
  }

  handleUndelayCharacterWithPosition(socket, { charId }) {
    // Non più utilizzato - il master decide l'ordine via popup
    // Redirige a handleUndelayCharacter per compatibilità
    this.handleUndelayCharacter(socket, charId);
  }

  handleSetInitiativeOrder(socket, { initiative, orderedIds }) {
    const gs = this.getGameState(socket);
    if (!gs || socket.id !== gs.masterId) return;
    const allChars = [...gs.heroes, ...gs.enemies, ...gs.allies, ...(gs.summons || [])];
    orderedIds.forEach((id, index) => {
      const char = allChars.find(c => c.id == id);
      if (char) {
        char.initiativeOrder = index + 1;
        char.initiative = parseInt(initiative);
      }
    });
    const ties = findInitiativeTies(gs);

    if (ties.length > 0) {
      this.io.to(gs.masterId).emit('resolveInitiativeTies', ties);
    } else {
      if (!gs.combatStarted) {
        gs.turnOrder = calculateTurnOrder(gs);
        gs.currentTurn = 0;
        gs.currentRound = 1;
        gs.combatStarted = true;
        this.broadcastAndSave(socket.roomId);
        this.io.to(socket.roomId).emit('combatStarted');
      } else {
        gs.turnOrder = calculateTurnOrder(gs);
        this.broadcastAndSave(socket.roomId);
      }
    }
  }

  // === UTILITY ===

  getGameState(socket) {
    if (!socket.roomId) return null;
    const activeRoom = this.activeRooms.get(socket.roomId);
    return activeRoom ? activeRoom.gameState : null;
  }

  getGameStateForRoom(roomId) {
    const activeRoom = this.activeRooms.get(roomId);
    if (activeRoom) {
      return activeRoom.gameState;
    }
    // Se la stanza non è attiva, prova a caricarla dal database
    return this.db.getRoomState(roomId);
  }

  broadcastToRoom(roomId) {
    const activeRoom = this.activeRooms.get(roomId);
    if (activeRoom) {
      const gs = activeRoom.gameState;
      
      // Crea una copia dello stato per ogni socket nella stanza
      activeRoom.sockets.forEach(socketId => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket) return;
        
        const isMaster = socket.id === gs.masterId;
        
        // Se non è il master, filtra i nemici ritardati
        let filteredState = { ...gs };
        if (!isMaster && gs.delayedCharacters) {
          filteredState = {
            ...gs,
            delayedCharacters: gs.delayedCharacters.filter(char => 
              !char.isEnemy // Mostra solo eroi e alleati ritardati ai giocatori
            )
          };
        }
        
        socket.emit('gameState', filteredState);
      });
    }
  }

  broadcastAndSave(roomId) {
    this.broadcastToRoom(roomId);
    this.saveRoomState(roomId);
  }

  saveRoomState(roomId) {
    const activeRoom = this.activeRooms.get(roomId);
    if (activeRoom) {
      this.db.saveRoomState(roomId, activeRoom.gameState);
    }
  }
}

module.exports = RoomManager;
