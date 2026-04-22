// Logica vera di Import/Export verso una cartella locale (anche dentro OneDrive/Drive sincronizzata dall'OS).
//
// Struttura della cartella:
//   <root>/
//     manifest.json          metadati: versione export, timestamp, contenuti
//     README.md              auto-generato, spiega struttura per umani
//     config.json            mirror di app-data/config.json
//     images/
//       heroes/  enemies/  allies/  summons/
//     rooms/
//       <room-id>.json       { room: {...}, gameState: {...} }
//
// Conflitti su Import: la funzione importFolder() restituisce una preview con i
// conflitti (rooms duplicate); il chiamante decide e ripassa la lista in resolutions
// per applicarli con strategia 'overwrite'|'skip'.

const fs = require('fs');
const path = require('path');

const MANIFEST_VERSION = 1;
const SUBFOLDERS = ['heroes', 'enemies', 'allies', 'summons'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

function isFolderUsable(folderPath) {
  if (!folderPath || typeof folderPath !== 'string') return { ok: false, error: 'Path vuoto' };
  try {
    if (!fs.existsSync(folderPath)) {
      // Provo a crearla
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const st = fs.statSync(folderPath);
    if (!st.isDirectory()) return { ok: false, error: 'Il path non è una cartella' };
    // Test scrittura
    const testFile = path.join(folderPath, '.rpg-tracker-write-test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function readManifest(folderPath) {
  const p = path.join(folderPath, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeManifest(folderPath, data) {
  const p = path.join(folderPath, 'manifest.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function copyFileSafe(src, dst) {
  ensureDir(path.dirname(dst));
  const tmp = dst + '.tmp';
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
}

// ========== EXPORT ==========

/**
 * Esporta config + immagini + tutte le rooms verso folderPath.
 * deps: { paths, configStore, db }
 */
async function exportFolder(folderPath, deps) {
  const usable = isFolderUsable(folderPath);
  if (!usable.ok) throw new Error('Cartella non utilizzabile: ' + usable.error);

  const { paths, configStore, db } = deps;
  const result = {
    folderPath,
    configWritten: false,
    images: { copied: 0, skipped: 0, errors: [] },
    rooms: { written: 0, errors: [] },
    warnings: []
  };

  // 1. config.json
  try {
    const cfg = configStore.load();
    fs.writeFileSync(path.join(folderPath, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
    result.configWritten = true;
  } catch (e) {
    throw new Error('Scrittura config.json fallita: ' + e.message);
  }

  // 2. immagini
  for (const sub of SUBFOLDERS) {
    const srcDir = paths.getImagesPath(sub);
    const dstDir = ensureDir(path.join(folderPath, 'images', sub));
    if (!fs.existsSync(srcDir)) continue;
    for (const file of fs.readdirSync(srcDir)) {
      const ext = path.extname(file).toLowerCase();
      if (!IMAGE_EXTS.includes(ext)) continue;
      const src = path.join(srcDir, file);
      const dst = path.join(dstDir, file);
      try {
        // Skip se già identico (size + mtime grossolano)
        if (fs.existsSync(dst)) {
          const a = fs.statSync(src);
          const b = fs.statSync(dst);
          if (a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 1000) {
            result.images.skipped++;
            continue;
          }
        }
        copyFileSafe(src, dst);
        result.images.copied++;
      } catch (e) {
        result.images.errors.push({ file: `${sub}/${file}`, error: e.message });
      }
    }
  }

  // 3. rooms
  const roomsDir = ensureDir(path.join(folderPath, 'rooms'));
  try {
    const rooms = db.getAllRooms();
    for (const room of rooms) {
      try {
        const gameState = db.getRoomState(room.id);
        const payload = {
          schemaVersion: MANIFEST_VERSION,
          exportedAt: Date.now(),
          room,
          gameState
        };
        const dst = path.join(roomsDir, `${safeFilename(room.id)}.json`);
        const tmp = dst + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
        fs.renameSync(tmp, dst);
        result.rooms.written++;
      } catch (e) {
        result.rooms.errors.push({ roomId: room.id, error: e.message });
      }
    }
  } catch (e) {
    result.warnings.push('Lettura stanze fallita: ' + e.message);
  }

  // 4. README.md (sovrascrive sempre, è auto-generato)
  fs.writeFileSync(path.join(folderPath, 'README.md'), generateReadme(), 'utf8');

  // 5. manifest.json
  writeManifest(folderPath, {
    version: MANIFEST_VERSION,
    appName: 'RPG Initiative Tracker',
    exportedAt: Date.now(),
    counts: {
      images: result.images.copied + result.images.skipped,
      rooms: result.rooms.written
    }
  });

  return result;
}

// ========== IMPORT ==========

/**
 * Analizza la cartella e restituisce un piano di import (con conflitti).
 * NON applica niente.
 *
 * Returns: {
 *   manifest, hasConfig, imageCount, rooms: [{id, name, exists, action}]
 * }
 */
function analyzeImport(folderPath, deps) {
  const usable = isFolderUsable(folderPath);
  if (!usable.ok) throw new Error('Cartella non utilizzabile: ' + usable.error);

  const { db } = deps;
  const manifest = readManifest(folderPath);
  const out = {
    folderPath,
    manifest,
    hasConfig: fs.existsSync(path.join(folderPath, 'config.json')),
    imageCount: 0,
    rooms: []
  };

  for (const sub of SUBFOLDERS) {
    const dir = path.join(folderPath, 'images', sub);
    if (!fs.existsSync(dir)) continue;
    out.imageCount += fs.readdirSync(dir).filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase())).length;
  }

  const roomsDir = path.join(folderPath, 'rooms');
  if (fs.existsSync(roomsDir)) {
    const existingIds = new Set(db.getAllRooms().map(r => r.id));
    for (const file of fs.readdirSync(roomsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(path.join(roomsDir, file), 'utf8'));
        const room = payload.room || {};
        if (!room.id) continue;
        out.rooms.push({
          id: room.id,
          name: room.name || room.id,
          file,
          exists: existingIds.has(room.id),
          action: existingIds.has(room.id) ? 'ask' : 'create'
        });
      } catch (_) {}
    }
  }

  return out;
}

/**
 * Applica l'import. resolutions e' una mappa { roomId: 'overwrite'|'skip'|'create' }.
 * Le room non in resolutions con exists=true sono saltate (default safe).
 *
 * Returns: { configImported, imagesCopied, roomsCreated, roomsOverwritten, roomsSkipped, errors }
 */
async function applyImport(folderPath, deps, resolutions = {}) {
  const usable = isFolderUsable(folderPath);
  if (!usable.ok) throw new Error('Cartella non utilizzabile: ' + usable.error);

  const { paths, configStore, db } = deps;
  const result = {
    configImported: false,
    images: { copied: 0, errors: [] },
    rooms: { created: 0, overwritten: 0, skipped: 0, errors: [] }
  };

  // 1. config.json
  const configPath = path.join(folderPath, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const incoming = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      configStore.update(c => {
        // Merge: per ogni array, l'incoming sostituisce per id e aggiunge i nuovi
        for (const key of ['heroes', 'enemies', 'allies', 'summons', 'effects']) {
          const local = Array.isArray(c[key]) ? c[key] : [];
          const remote = Array.isArray(incoming[key]) ? incoming[key] : [];
          const map = new Map(local.map(x => [x.id, x]));
          for (const item of remote) {
            if (item && item.id) map.set(item.id, { ...map.get(item.id), ...item });
          }
          c[key] = Array.from(map.values());
        }
        return c;
      });
      configStore.flush();
      result.configImported = true;
    } catch (e) {
      throw new Error('Lettura config.json fallita: ' + e.message);
    }
  }

  // 2. immagini (sempre sovrascrive, sono "asset")
  for (const sub of SUBFOLDERS) {
    const srcDir = path.join(folderPath, 'images', sub);
    const dstDir = paths.getImagesPath(sub);
    if (!fs.existsSync(srcDir)) continue;
    for (const file of fs.readdirSync(srcDir)) {
      const ext = path.extname(file).toLowerCase();
      if (!IMAGE_EXTS.includes(ext)) continue;
      try {
        copyFileSafe(path.join(srcDir, file), path.join(dstDir, file));
        result.images.copied++;
      } catch (e) {
        result.images.errors.push({ file: `${sub}/${file}`, error: e.message });
      }
    }
  }

  // 3. rooms
  const roomsDir = path.join(folderPath, 'rooms');
  if (fs.existsSync(roomsDir)) {
    const existingIds = new Set(db.getAllRooms().map(r => r.id));
    for (const file of fs.readdirSync(roomsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(path.join(roomsDir, file), 'utf8'));
        const room = payload.room || {};
        if (!room.id) continue;
        const exists = existingIds.has(room.id);
        const decision = resolutions[room.id] || (exists ? 'skip' : 'create');

        if (exists && decision === 'skip') {
          result.rooms.skipped++;
          continue;
        }

        if (exists && decision === 'overwrite') {
          if (payload.gameState) db.saveRoomState(room.id, payload.gameState);
          // Aggiorna metadati (status / round / combat_started se presenti)
          const updates = {};
          if (room.name) updates.name = room.name;
          if (room.status) updates.status = room.status;
          if (typeof room.current_round === 'number') updates.current_round = room.current_round;
          if (typeof room.combat_started === 'number') updates.combat_started = room.combat_started;
          if (Object.keys(updates).length) db.updateRoom(room.id, updates);
          result.rooms.overwritten++;
        } else {
          // create (anche se exists e decision === 'create' è un caso edge)
          if (!exists) {
            db.createRoom(room.id, room.name || 'Stanza importata');
          }
          if (payload.gameState) db.saveRoomState(room.id, payload.gameState);
          result.rooms.created++;
        }
      } catch (e) {
        result.rooms.errors.push({ file, error: e.message });
      }
    }
  }

  return result;
}

// ========== HELPERS ==========

function safeFilename(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_');
}

function generateReadme() {
  return `# RPG Initiative Tracker — Cartella sincronizzata

Questa cartella contiene un export completo dei dati dell'app **RPG Initiative Tracker**.
Puoi tenerla in **OneDrive / Google Drive / Dropbox** e accedere agli stessi dati da più PC.

## Struttura

\`\`\`
.
├── manifest.json        Metadati dell'export (versione, timestamp)
├── config.json          Libreria personaggi (eroi, nemici, alleati, evocazioni, effetti)
├── images/
│   ├── heroes/          Avatar eroi (PNG/JPG/WebP/GIF/SVG)
│   ├── enemies/         Avatar nemici
│   ├── allies/          Avatar PNG / alleati
│   └── summons/         Avatar evocazioni
└── rooms/
    └── <room-id>.json   Una stanza per file (metadati + gameState completo)
\`\`\`

## Come usarla su un altro PC

1. Apri l'app
2. Vai in **Configurazione → Importa**
3. Seleziona questa cartella
4. Click su **Importa**
5. Per le stanze già esistenti localmente l'app chiederà se sovrascrivere

## Auto-export

Se l'opzione **Auto-export** è attiva, l'app aggiorna automaticamente questa cartella
ogni volta che modifichi config o stato delle stanze (debounced 3s).

## Sicurezza

- Le immagini sono file binari originali.
- Il \`config.json\` e i \`rooms/*.json\` sono leggibili a mano (solo testo JSON).
- **Non** modificare \`manifest.json\` a mano — viene rigenerato a ogni export.

> Generato automaticamente da RPG Initiative Tracker. Non modificare a mano questo README.
`;
}

module.exports = {
  isFolderUsable,
  readManifest,
  exportFolder,
  analyzeImport,
  applyImport,
  MANIFEST_VERSION,
  SUBFOLDERS
};
