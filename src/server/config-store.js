// Wrapper transazionale per config.json:
// - lettura atomica
// - scrittura atomica via tempfile + rename (no file corrotto su crash)
// - debounce per evitare 50 write/secondo durante upload bulk
// - migration automatica da formato vecchio (data/config.json) se presente

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  enemies: [],
  allies: [],
  heroes: [],
  effects: [],
  summons: []
};

class ConfigStore {
  constructor(configPath, opts = {}) {
    this.configPath = configPath;
    this.legacyPath = opts.legacyPath || null;
    this.debounceMs = opts.debounceMs ?? 250;
    this._pendingWrite = null;
    this._cache = null;
    this._lastReadAt = 0;
    this._migrate();
  }

  _migrate() {
    if (fs.existsSync(this.configPath)) return;
    if (this.legacyPath && fs.existsSync(this.legacyPath)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(this.legacyPath, 'utf8'));
        const merged = { ...DEFAULT_CONFIG, ...legacy };
        this._writeNow(merged);
        console.log('📋 Config migrato da', this.legacyPath, '→', this.configPath);
      } catch (e) {
        console.error('❌ Migrazione config fallita:', e.message);
      }
    }
  }

  load() {
    // Read-after-write coherence: se c'e' una scrittura debounced in coda
    // (o solo una mutazione in-memory non ancora flushed), restituiamo lo
    // stato in-memory invece di quello su disco. Senza questo, una GET
    // immediatamente dopo una POST tornerebbe dati vecchi e l'UI mostrerebbe
    // la modifica solo dopo refresh manuale.
    if (this._cache && this._pendingWrite) {
      return this._cache;
    }
    try {
      if (!fs.existsSync(this.configPath)) {
        // Se non esiste su disco ma abbiamo un cache valido, preferiamolo
        return this._cache ? this._cache : { ...DEFAULT_CONFIG };
      }
      const raw = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw);
      // Garantisce sempre tutti i campi
      const cfg = { ...DEFAULT_CONFIG, ...parsed };
      ['enemies', 'allies', 'heroes', 'effects', 'summons'].forEach(k => {
        if (!Array.isArray(cfg[k])) cfg[k] = [];
      });
      this._cache = cfg;
      this._lastReadAt = Date.now();
      return cfg;
    } catch (e) {
      console.error('❌ Errore lettura config:', e.message);
      return this._cache || { ...DEFAULT_CONFIG };
    }
  }

  /** Modifica la config con una funzione (modello "transaction") e schedula salvataggio. */
  update(mutator) {
    const current = this.load();
    const next = mutator(current) || current;
    this._cache = next;
    this._scheduleWrite(next);
    return next;
  }

  /** Scrive immediatamente, senza debounce. Usato in shutdown. */
  flush() {
    if (this._pendingWrite) {
      clearTimeout(this._pendingWrite.timer);
      this._writeNow(this._pendingWrite.data);
      this._pendingWrite = null;
    }
  }

  _scheduleWrite(data) {
    if (this._pendingWrite) {
      clearTimeout(this._pendingWrite.timer);
    }
    this._pendingWrite = {
      data,
      timer: setTimeout(() => {
        try {
          this._writeNow(this._pendingWrite.data);
        } catch (e) {
          console.error('❌ Errore scrittura config:', e.message);
        } finally {
          this._pendingWrite = null;
        }
      }, this.debounceMs)
    };
  }

  _writeNow(data) {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = this.configPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.configPath);
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG };
