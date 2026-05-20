// Persistenza della configurazione folder-sync.
// File: app-data/folder-sync.json
//
// Schema 2026-05 (3 sorgenti indipendenti):
// {
//   "imagesPath":  "C:/Users/x/RPG/images",   // cartella con sub heroes/enemies/...
//   "roomsPath":   "C:/Users/x/RPG/rooms",    // cartella con <id>.json per ogni stanza
//   "libraryPath": "C:/Users/x/RPG/config.json", // FILE singolo con personaggi+effetti
//   "autoExport": true,
//   "lastImportAt": 1729619200000,
//   "lastExportAt": 1729619200000,
//
//   // Legacy (compat con installazioni < 2026-05). Se presente e i 3 path
//   // nuovi sono null/undefined, viene derivato a runtime in path:
//   //   imagesPath  = <folderPath>/images
//   //   roomsPath   = <folderPath>/rooms
//   //   libraryPath = <folderPath>/config.json
//   "folderPath": "C:/Users/x/OneDrive/RPG-Tracker"
// }

const fs = require('fs');
const path = require('path');

const DEFAULT = {
  imagesPath: null,
  roomsPath: null,
  libraryPath: null,
  autoExport: true,
  lastImportAt: null,
  lastExportAt: null,
  // legacy
  folderPath: null
};

// Ricava i 3 path nuovi da una vecchia config con solo `folderPath`.
// Idempotente: se i nuovi ci sono gia' non li tocca.
function migrateLegacy(cfg) {
  if (cfg.folderPath && !cfg.imagesPath && !cfg.roomsPath && !cfg.libraryPath) {
    cfg.imagesPath = path.join(cfg.folderPath, 'images');
    cfg.roomsPath = path.join(cfg.folderPath, 'rooms');
    cfg.libraryPath = path.join(cfg.folderPath, 'config.json');
  }
  return cfg;
}

class FolderStore {
  constructor(storePath) {
    this.storePath = storePath;
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return { ...DEFAULT };
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const cfg = { ...DEFAULT, ...JSON.parse(raw) };
      return migrateLegacy(cfg);
    } catch (e) {
      console.error('❌ Errore lettura folder-sync.json:', e.message);
      return { ...DEFAULT };
    }
  }

  update(mutator) {
    const current = this.load();
    const next = mutator(current) || current;
    this._writeNow(next);
    return next;
  }

  _writeNow(data) {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = this.storePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.storePath);
  }
}

module.exports = { FolderStore, DEFAULT, migrateLegacy };
