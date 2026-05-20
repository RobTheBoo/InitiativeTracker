// Endpoint REST per la feature "Importa cartella".
//
// API "vecchia" (cartella unica, mantenuta per retro-compat):
//   GET    /api/folder/status            stato corrente (path, lastImport, lastExport, autoExport)
//   POST   /api/folder/config            { folderPath, autoExport } -> aggiorna config
//   POST   /api/folder/test              { folderPath } -> verifica scrittura
//   POST   /api/folder/analyze-import    { folderPath } -> preview import + conflitti
//   POST   /api/folder/import            { folderPath, resolutions } -> applica import
//   POST   /api/folder/export            { folderPath } -> esporta (folderPath opzionale, usa quello salvato)
//
// API "nuova" 2026-05 (3 sorgenti indipendenti):
//   POST   /api/folder/sources           { imagesPath?, roomsPath?, libraryPath? } -> set
//   GET    /api/folder/sources           -> get correnti + stato file/cartella (esiste? scrivibile?)
//   POST   /api/folder/analyze-sources   { imagesPath?, roomsPath?, libraryPath? } -> preview
//   POST   /api/folder/import-sources    { imagesPath?, roomsPath?, libraryPath?, resolutions? }
//
// API APK Capacitor (upload diretto, l'utente non puo' fornire path locali):
//   POST   /api/folder/upload-images   multipart "files[]" + body { subfolder } -> copia in app-data/images/<sub>/
//   POST   /api/folder/upload-rooms    multipart "files[]"                       -> import nel DB (resolutions opzionali)
//   POST   /api/folder/upload-library  multipart "file" (singolo)                -> merge libreria
//
// Espone anche scheduleAutoExport() che il config-store / room-manager possono chiamare.

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { FolderStore } = require('./folder-store');
const folderSync = require('./folder-sync');

const VALID_SUBS = ['heroes', 'enemies', 'allies', 'summons'];
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

function registerFolderRoutes(app, paths, configStore, db) {
  const store = new FolderStore(path.join(paths.dataDir, 'folder-sync.json'));
  const deps = { paths, configStore, db };

  // Auto-export debounced
  let autoExportTimer = null;
  const AUTO_EXPORT_DEBOUNCE_MS = 3000;

  function scheduleAutoExport(reason = 'change') {
    const cfg = store.load();
    if (!cfg.autoExport || !cfg.folderPath) return;
    if (autoExportTimer) clearTimeout(autoExportTimer);
    autoExportTimer = setTimeout(async () => {
      autoExportTimer = null;
      try {
        const result = await folderSync.exportFolder(cfg.folderPath, deps);
        store.update(c => { c.lastExportAt = Date.now(); return c; });
        const totalErr = result.images.errors.length + result.rooms.errors.length;
        if (totalErr === 0) {
          console.log(`📤 Auto-export OK (${reason}): ${result.rooms.written} stanze, ${result.images.copied} img copiate, ${result.images.skipped} img skip`);
        } else {
          console.warn(`⚠️  Auto-export con ${totalErr} errori (${reason}). Verifica permessi cartella.`);
        }
      } catch (e) {
        console.warn('⚠️  Auto-export fallito:', e.message);
      }
    }, AUTO_EXPORT_DEBOUNCE_MS);
  }

  // ----- Status -----
  app.get('/api/folder/status', (req, res) => {
    const cfg = store.load();
    let folderUsable = null;
    let manifest = null;
    if (cfg.folderPath) {
      folderUsable = folderSync.isFolderUsable(cfg.folderPath);
      if (folderUsable.ok) manifest = folderSync.readManifest(cfg.folderPath);
    }
    res.json({
      folderPath: cfg.folderPath,
      autoExport: cfg.autoExport,
      lastImportAt: cfg.lastImportAt,
      lastExportAt: cfg.lastExportAt,
      folderUsable,
      manifest
    });
  });

  // ----- Set config -----
  app.post('/api/folder/config', (req, res) => {
    const { folderPath, autoExport } = req.body || {};
    const next = store.update(c => {
      if (typeof folderPath === 'string') c.folderPath = folderPath.trim() || null;
      if (typeof autoExport === 'boolean') c.autoExport = autoExport;
      return c;
    });
    res.json({ success: true, config: next });
  });

  // ----- Test -----
  app.post('/api/folder/test', (req, res) => {
    const { folderPath } = req.body || {};
    if (!folderPath) return res.status(400).json({ error: 'folderPath richiesto' });
    const result = folderSync.isFolderUsable(folderPath);
    res.json(result);
  });

  // ----- Setup one-shot intelligente -----
  // Comportamento:
  //   - Se la cartella e' VUOTA (no manifest): scaffold + export locale + salva path.
  //   - Se la cartella ha GIA' un manifest (export esistente da un altro PC):
  //     scaffold + salva path MA NON esporta (non vogliamo sovrascrivere i dati
  //     remoti con lo stato vuoto locale). Ritorna existingDataDetected: true
  //     cosi' il frontend chiede "vuoi importarli?".
  //
  // Body:
  //   { folderPath, autoExport?:bool=true, forceExport?:bool=false }
  //   forceExport=true forza l'export anche se esiste un manifest (override esplicito).
  // Returns:
  //   { ok, folderPath, structureCreated, existingDataDetected, manifest, exportResult? }
  app.post('/api/folder/setup', async (req, res) => {
    const folderPath = (req.body && req.body.folderPath || '').trim();
    const autoExport = req.body && typeof req.body.autoExport === 'boolean' ? req.body.autoExport : true;
    const forceExport = !!(req.body && req.body.forceExport);
    if (!folderPath) return res.status(400).json({ error: 'folderPath richiesto' });

    try {
      const usable = folderSync.isFolderUsable(folderPath);
      if (!usable.ok) return res.status(400).json({ error: usable.error });

      const structure = folderSync.scaffoldFolder(folderPath);
      const manifest = folderSync.readManifest(folderPath);
      const existingDataDetected = !!manifest;

      // SAFETY: se ci sono dati esistenti e l'utente non ha forzato, NON esportiamo.
      // Cosi' il frontend puo' chiedere "vuoi importarli?" senza distruggere i remoti.
      const shouldExport = forceExport || !existingDataDetected;

      let exportResult = null;
      if (shouldExport) {
        exportResult = await folderSync.exportFolder(folderPath, deps);
      }

      store.update(c => {
        c.folderPath = folderPath;
        c.autoExport = autoExport;
        if (shouldExport) c.lastExportAt = Date.now();
        return c;
      });

      res.json({
        ok: true,
        folderPath,
        structureCreated: structure,
        existingDataDetected,
        manifest,
        exportResult
      });
    } catch (e) {
      console.error('❌ /api/folder/setup:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ----- Analyze import (preview, no side effect) -----
  app.post('/api/folder/analyze-import', (req, res) => {
    const folderPath = (req.body && req.body.folderPath) || store.load().folderPath;
    if (!folderPath) return res.status(400).json({ error: 'folderPath non configurato' });
    try {
      const analysis = folderSync.analyzeImport(folderPath, deps);
      res.json(analysis);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----- Apply import -----
  app.post('/api/folder/import', async (req, res) => {
    const folderPath = (req.body && req.body.folderPath) || store.load().folderPath;
    const resolutions = (req.body && req.body.resolutions) || {};
    if (!folderPath) return res.status(400).json({ error: 'folderPath non configurato' });
    try {
      const result = await folderSync.applyImport(folderPath, deps, resolutions);
      store.update(c => { c.lastImportAt = Date.now(); return c; });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----- Export manuale -----
  app.post('/api/folder/export', async (req, res) => {
    const folderPath = (req.body && req.body.folderPath) || store.load().folderPath;
    if (!folderPath) return res.status(400).json({ error: 'folderPath non configurato' });
    try {
      const result = await folderSync.exportFolder(folderPath, deps);
      store.update(c => { c.lastExportAt = Date.now(); return c; });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== API NUOVA (3 sorgenti indipendenti) =====

  // Helper: testa se un path esiste / è leggibile / e' del tipo giusto.
  function probePath(p, kind /* 'dir'|'file' */) {
    if (!p) return { path: null, ok: null, missing: false, message: 'non configurato' };
    try {
      if (!fs.existsSync(p)) return { path: p, ok: false, missing: true, message: 'non esiste' };
      const st = fs.statSync(p);
      if (kind === 'dir' && !st.isDirectory()) return { path: p, ok: false, missing: false, message: 'non e\' una cartella' };
      if (kind === 'file' && !st.isFile()) return { path: p, ok: false, missing: false, message: 'non e\' un file' };
      return { path: p, ok: true, missing: false };
    } catch (e) {
      return { path: p, ok: false, missing: false, message: e.message };
    }
  }

  app.get('/api/folder/sources', (req, res) => {
    const cfg = store.load();
    res.json({
      sources: {
        imagesPath: cfg.imagesPath || null,
        roomsPath: cfg.roomsPath || null,
        libraryPath: cfg.libraryPath || null
      },
      probes: {
        images: probePath(cfg.imagesPath, 'dir'),
        rooms: probePath(cfg.roomsPath, 'dir'),
        library: probePath(cfg.libraryPath, 'file')
      },
      lastImportAt: cfg.lastImportAt,
      lastExportAt: cfg.lastExportAt,
      autoExport: cfg.autoExport
    });
  });

  app.post('/api/folder/sources', (req, res) => {
    const body = req.body || {};
    const next = store.update(c => {
      // Solo i campi presenti vengono aggiornati. Per cancellare un puntamento
      // si manda esplicitamente "" (stringa vuota) che verra' normalizzata a null.
      if ('imagesPath' in body) c.imagesPath = (body.imagesPath || '').toString().trim() || null;
      if ('roomsPath' in body) c.roomsPath = (body.roomsPath || '').toString().trim() || null;
      if ('libraryPath' in body) c.libraryPath = (body.libraryPath || '').toString().trim() || null;
      return c;
    });
    res.json({ success: true, sources: { imagesPath: next.imagesPath, roomsPath: next.roomsPath, libraryPath: next.libraryPath } });
  });

  app.post('/api/folder/analyze-sources', (req, res) => {
    const body = req.body || {};
    const cfg = store.load();
    const sources = {
      imagesPath: body.imagesPath || cfg.imagesPath || null,
      roomsPath: body.roomsPath || cfg.roomsPath || null,
      libraryPath: body.libraryPath || cfg.libraryPath || null
    };
    try {
      const analysis = folderSync.analyzeImportSources(sources, deps);
      res.json(analysis);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== APK upload endpoints =====
  // Su APK Capacitor l'utente non puo' fornire path POSIX delle proprie cartelle:
  // li' usiamo il file-picker nativo, leggiamo i file nella WebView, e li
  // facciamo upload qui via multipart. Il server li scrive nelle stesse posizioni
  // che usa applyImportSources(), garantendo lo stesso comportamento end-to-end.

  // Multer in-memory: i file passano per RAM, scriviamo noi su disco
  // (vogliamo controllare la directory di destinazione sub-by-sub).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 MB per file (avatar, json) — abbondante
      files: 200                  // max 200 file per upload
    }
  });

  app.post('/api/folder/upload-images', upload.array('files', 200), async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Nessun file caricato' });
    const subfolder = (req.body && req.body.subfolder) || '';
    const sub = VALID_SUBS.includes(subfolder) ? subfolder : 'heroes';
    const dstDir = paths.getImagesPath(sub);

    const result = { copied: 0, errors: [], target: dstDir };
    for (const f of files) {
      try {
        const ext = path.extname(f.originalname).toLowerCase();
        if (!IMG_EXTS.has(ext)) {
          result.errors.push({ file: f.originalname, error: 'estensione non supportata' });
          continue;
        }
        // Stesso nome -> sovrascrive (politica voluta dall'utente).
        const dst = path.join(dstDir, f.originalname);
        const tmp = dst + '.tmp';
        fs.writeFileSync(tmp, f.buffer);
        fs.renameSync(tmp, dst);
        result.copied++;
      } catch (e) {
        result.errors.push({ file: f.originalname, error: e.message });
      }
    }
    store.update(c => { c.lastImportAt = Date.now(); return c; });
    res.json(result);
  });

  app.post('/api/folder/upload-rooms', upload.array('files', 200), async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Nessun file caricato' });
    let resolutions = {};
    try { resolutions = req.body && req.body.resolutions ? JSON.parse(req.body.resolutions) : {}; }
    catch (_) { resolutions = {}; }

    const result = { created: 0, overwritten: 0, skipped: 0, errors: [] };
    const existingIds = new Set(db.getAllRooms().map(r => r.id));
    for (const f of files) {
      try {
        if (!f.originalname.toLowerCase().endsWith('.json')) {
          result.errors.push({ file: f.originalname, error: 'non e\' un .json' });
          continue;
        }
        const payload = JSON.parse(f.buffer.toString('utf8'));
        const room = payload.room || {};
        if (!room.id) {
          result.errors.push({ file: f.originalname, error: 'manca room.id' });
          continue;
        }
        const exists = existingIds.has(room.id);
        const decision = resolutions[room.id] || (exists ? 'skip' : 'create');
        if (exists && decision === 'skip') { result.skipped++; continue; }
        if (exists && decision === 'overwrite') {
          if (payload.gameState) db.saveRoomState(room.id, payload.gameState);
          const updates = {};
          if (room.name) updates.name = room.name;
          if (room.status) updates.status = room.status;
          if (typeof room.current_round === 'number') updates.current_round = room.current_round;
          if (typeof room.combat_started === 'number') updates.combat_started = room.combat_started;
          if (Object.keys(updates).length) db.updateRoom(room.id, updates);
          result.overwritten++;
        } else {
          if (!exists) db.createRoom(room.id, room.name || 'Stanza importata');
          if (payload.gameState) db.saveRoomState(room.id, payload.gameState);
          result.created++;
        }
      } catch (e) {
        result.errors.push({ file: f.originalname, error: e.message });
      }
    }
    store.update(c => { c.lastImportAt = Date.now(); return c; });
    res.json(result);
  });

  app.post('/api/folder/upload-library', upload.single('file'), async (req, res) => {
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Nessun file caricato' });
    if (!f.originalname.toLowerCase().endsWith('.json')) {
      return res.status(400).json({ error: 'Atteso un file .json (config / libreria personaggi)' });
    }
    try {
      const incoming = JSON.parse(f.buffer.toString('utf8'));
      configStore.update(c => {
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
      if (typeof configStore.flush === 'function') configStore.flush();
      store.update(c => { c.lastImportAt = Date.now(); return c; });
      const counts = {
        heroes: Array.isArray(incoming.heroes) ? incoming.heroes.length : 0,
        enemies: Array.isArray(incoming.enemies) ? incoming.enemies.length : 0,
        allies: Array.isArray(incoming.allies) ? incoming.allies.length : 0,
        summons: Array.isArray(incoming.summons) ? incoming.summons.length : 0,
        effects: Array.isArray(incoming.effects) ? incoming.effects.length : 0
      };
      res.json({ imported: true, counts });
    } catch (e) {
      res.status(400).json({ error: 'JSON non valido: ' + e.message });
    }
  });

  app.post('/api/folder/import-sources', async (req, res) => {
    const body = req.body || {};
    const cfg = store.load();
    const sources = {
      imagesPath: body.imagesPath || cfg.imagesPath || null,
      roomsPath: body.roomsPath || cfg.roomsPath || null,
      libraryPath: body.libraryPath || cfg.libraryPath || null
    };
    const resolutions = body.resolutions || {};
    try {
      const result = await folderSync.applyImportSources(sources, deps, resolutions);
      store.update(c => {
        c.lastImportAt = Date.now();
        // Salva i path usati come "ultimi configurati" anche se passati ad-hoc nel body.
        if (body.persist !== false) {
          if (sources.imagesPath) c.imagesPath = sources.imagesPath;
          if (sources.roomsPath) c.roomsPath = sources.roomsPath;
          if (sources.libraryPath) c.libraryPath = sources.libraryPath;
        }
        return c;
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return { store, scheduleAutoExport };
}

module.exports = { registerFolderRoutes };
