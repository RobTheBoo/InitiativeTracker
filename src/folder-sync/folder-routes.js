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
// Espone anche scheduleAutoExport() che il config-store / room-manager possono chiamare.

const path = require('path');
const fs = require('fs');
const { FolderStore } = require('./folder-store');
const folderSync = require('./folder-sync');

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
