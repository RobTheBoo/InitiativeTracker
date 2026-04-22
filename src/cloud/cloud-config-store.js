// Store separato per la configurazione cloud (clientId Azure/Google, mappa file remoti per provider).
// Tenuto separato da config.json per evitare di confondere lo stato di gioco con i settings privati.

const fs = require('fs');
const path = require('path');

const DEFAULT = {
  // Per ogni provider: { clientId, lastSyncAt }
  providers: {
    onedrive: {},
    gdrive: {}
  },
  // remoteFiles[provider][subfolder][filename] = { remoteId, etag, lastSyncedAt }
  remoteFiles: {
    onedrive: { heroes: {}, enemies: {}, allies: {}, summons: {} },
    gdrive: { heroes: {}, enemies: {}, allies: {}, summons: {} }
  },
  lastSyncAt: null
};

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (override && typeof override === 'object') {
    for (const key of Object.keys(override)) {
      const v = override[key];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[key] && typeof base[key] === 'object') {
        out[key] = deepMerge(base[key], v);
      } else {
        out[key] = v;
      }
    }
  }
  return out;
}

class CloudConfigStore {
  constructor(filePath) { this.filePath = filePath; this._cache = null; }
  load() {
    try {
      if (!fs.existsSync(this.filePath)) return JSON.parse(JSON.stringify(DEFAULT));
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      // Migra vecchio formato (singolo provider OneDrive) al nuovo
      if (!data.providers && data.clientId) {
        data.providers = { onedrive: { clientId: data.clientId, lastSyncAt: data.lastSyncAt }, gdrive: {} };
        delete data.clientId;
      }
      const merged = deepMerge(DEFAULT, data);
      // Garantisce sottostrutture per remoteFiles
      for (const p of ['onedrive', 'gdrive']) {
        if (!merged.remoteFiles[p]) merged.remoteFiles[p] = { heroes: {}, enemies: {}, allies: {}, summons: {} };
      }
      this._cache = merged;
      return merged;
    } catch (e) {
      console.error('cloud-config load error:', e.message);
      return JSON.parse(JSON.stringify(DEFAULT));
    }
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
