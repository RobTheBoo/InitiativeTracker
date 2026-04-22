const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class RPGDatabase {
  constructor(dbPath, getImagesPathFn = null) {
    // Assicurati che la directory esista
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.getImagesPath = getImagesPathFn || ((subfolder) => path.join(__dirname, '..', 'public', 'images', subfolder));
    this.initTables();
  }

  initTables() {
    // Tabella stanze
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_modified INTEGER NOT NULL,
        status TEXT DEFAULT 'waiting',
        current_round INTEGER DEFAULT 1,
        combat_started INTEGER DEFAULT 0
      )
    `);

    // Tabella stato stanza (JSON completo)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS room_states (
        room_id TEXT PRIMARY KEY,
        game_state TEXT NOT NULL,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )
    `);

    // Tabella eroi per query veloci
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS heroes (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,
        image_path TEXT,
        initiative INTEGER,
        owner_id TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )
    `);

    // Tabella nemici
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enemies (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,
        image_path TEXT,
        initiative INTEGER,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )
    `);

    // Indici per performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_heroes_room ON heroes(room_id);
      CREATE INDEX IF NOT EXISTS idx_enemies_room ON enemies(room_id);
    `);
  }

  // === GESTIONE STANZE ===

  createRoom(id, name) {
    const stmt = this.db.prepare(`
      INSERT INTO rooms (id, name, created_at, last_modified)
      VALUES (?, ?, ?, ?)
    `);
    
    const now = Date.now();
    stmt.run(id, name, now, now);
    
    // Inizializza stato vuoto
    this.saveRoomState(id, this.getInitialGameState());
    
    return this.getRoom(id);
  }

  getRoom(id) {
    const stmt = this.db.prepare('SELECT * FROM rooms WHERE id = ?');
    return stmt.get(id);
  }

  getAllRooms() {
    const stmt = this.db.prepare('SELECT * FROM rooms ORDER BY last_modified DESC');
    return stmt.all();
  }

  updateRoom(id, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    
    fields.push('last_modified = ?');
    values.push(Date.now());
    values.push(id);
    
    const stmt = this.db.prepare(`
      UPDATE rooms SET ${fields.join(', ')} WHERE id = ?
    `);
    
    stmt.run(...values);
  }

  deleteRoom(id) {
    const stmt = this.db.prepare('DELETE FROM rooms WHERE id = ?');
    stmt.run(id);
  }

  // === STATO STANZA ===

  saveRoomState(roomId, gameState) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO room_states (room_id, game_state)
      VALUES (?, ?)
    `);
    
    stmt.run(roomId, JSON.stringify(gameState));
    
    // Aggiorna timestamp
    this.updateRoom(roomId, {});
  }

  getRoomState(roomId) {
    const stmt = this.db.prepare('SELECT game_state FROM room_states WHERE room_id = ?');
    const result = stmt.get(roomId);
    
    const gameState = result ? JSON.parse(result.game_state) : this.getInitialGameState();
    
    // Assicurati che tutti gli array esistano
    if (!gameState.allies) {
      gameState.allies = [];
    }
    if (!gameState.enemies) {
      gameState.enemies = [];
    }
    if (!gameState.heroes) {
      gameState.heroes = [];
    }
    
    // Assicurati che le immagini degli eroi e dei nemici siano sempre aggiornate
    this.updateHeroImages(gameState);
    this.updateEnemyImages(gameState);
    
    return gameState;
  }

  // Trova immagine per un personaggio
  findCharacterImage(charId, type = 'heroes') {
    const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
    const basePath = this.getImagesPath(type);
    
    for (const ext of extensions) {
      const imagePath = path.join(basePath, charId + ext);
      if (fs.existsSync(imagePath)) {
        // In produzione: se le immagini sono accanto all'EXE, servile come static files
        // In sviluppo: usa percorso diretto
        const { app } = require('electron');
        if (app && app.isPackaged) {
          // Le immagini sono nella cartella dell'EXE, servile come static
          // Ma dobbiamo servirle via API perché non sono in public/
          return `/api/images/${type}/${charId}${ext}`;
        }
        return `/images/${type}/${charId}${ext}`;
      }
    }
    return null;
  }

  // Aggiorna le immagini degli eroi nello stato
  updateHeroImages(gameState) {
    if (!gameState || !gameState.heroes) return;
    
    gameState.heroes.forEach(hero => {
      if (!hero.image) {
        hero.image = this.findCharacterImage(hero.id, 'heroes');
      }
    });
  }

  // Aggiorna le immagini dei nemici nello stato (se hanno un imageId ma non image)
  updateEnemyImages(gameState) {
    if (!gameState || !gameState.enemies) return;
    
    gameState.enemies.forEach(enemy => {
      // Se il nemico ha un imageId ma non ha un'immagine, prova a trovarla
      // Nota: i nemici potrebbero avere imageId nel nome del file immagine
      if (!enemy.image && enemy.name) {
        // Prova a trovare l'immagine basandosi sul nome (normalizzato)
        const normalizedName = enemy.name.toLowerCase().replace(/\s+/g, '');
        enemy.image = this.findCharacterImage(normalizedName, 'enemies');
      }
    });
  }

  getInitialGameState() {
    const state = {
      heroes: [
        { id: 'Achenar', name: 'Achenar', icon: '🧙', image: null, initiative: null, ownerId: null, effects: [] },
        { id: 'Gustav', name: 'Gustav', icon: '⚔️', image: null, initiative: null, ownerId: null, effects: [] },
        { id: 'Leland', name: 'Leland', icon: '🏹', image: null, initiative: null, ownerId: null, effects: [] },
        { id: 'Peat', name: 'Peat', icon: '🛡️', image: null, initiative: null, ownerId: null, effects: [] },
        { id: 'Toco', name: 'Toco', icon: '🗡️', image: null, initiative: null, ownerId: null, effects: [] },
        { id: 'Wilhelm', name: 'Wilhelm', icon: '⚔️', image: null, initiative: null, ownerId: null, effects: [] },
      ],
      enemies: [],
      allies: [],
      summons: [],
      delayedCharacters: [],
      areaEffects: [],
      combatStarted: false,
      currentTurn: 0,
      currentRound: 1,
      turnOrder: [],
      masterId: null
    };
    
    // Carica automaticamente le immagini degli eroi
    this.updateHeroImages(state);
    
    return state;
  }

  // === UTILITY ===

  close() {
    this.db.close();
  }
}

module.exports = RPGDatabase;

