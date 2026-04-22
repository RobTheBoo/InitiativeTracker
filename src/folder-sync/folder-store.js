// Persistenza della configurazione folder-sync (path della cartella + timestamps).
// File: app-data/folder-sync.json
//
// Schema:
// {
//   "folderPath": "C:/Users/x/OneDrive/RPG-Tracker",
//   "autoExport": true,
//   "lastImportAt": 1729619200000,
//   "lastExportAt": 1729619200000
// }

const fs = require('fs');
const path = require('path');

const DEFAULT = {
  folderPath: null,
  autoExport: true,
  lastImportAt: null,
  lastExportAt: null
};

class FolderStore {
  constructor(storePath) {
    this.storePath = storePath;
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return { ...DEFAULT };
      const raw = fs.readFileSync(this.storePath, 'utf8');
      return { ...DEFAULT, ...JSON.parse(raw) };
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

module.exports = { FolderStore, DEFAULT };
