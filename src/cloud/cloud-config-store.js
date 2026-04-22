// Store separato per la configurazione cloud (clientId Azure, scelte di sync, mappa file remoti).
// Tenuto separato da config.json per evitare di confondere lo stato di gioco con i settings privati.

const fs = require('fs');
const path = require('path');

const DEFAULT = {
  provider: null, // 'onedrive' | null
  clientId: null,
  // Mappa: localFileName -> { remoteId, etag, lastSyncedAt }
  remoteFiles: {
    heroes: {},
    enemies: {},
    allies: {},
    summons: {}
  },
  lastSyncAt: null
};

class CloudConfigStore {
  constructor(filePath) { this.filePath = filePath; this._cache = null; }
  load() {
    try {
      if (!fs.existsSync(this.filePath)) return { ...DEFAULT, remoteFiles: { ...DEFAULT.remoteFiles } };
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const merged = { ...DEFAULT, ...data, remoteFiles: { ...DEFAULT.remoteFiles, ...(data.remoteFiles || {}) } };
      this._cache = merged;
      return merged;
    } catch (_) { return { ...DEFAULT, remoteFiles: { ...DEFAULT.remoteFiles } }; }
  }
  update(mutator) {
    const cur = this.load();
    const next = mutator(cur) || cur;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    this._cache = next;
    return next;
  }
}

module.exports = { CloudConfigStore };
