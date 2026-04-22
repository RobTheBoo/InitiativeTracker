// Endpoint REST per la feature "Importa cartella".
//
//   GET    /api/folder/status            stato corrente (path, lastImport, lastExport, autoExport)
//   POST   /api/folder/config            { folderPath, autoExport } -> aggiorna config
//   POST   /api/folder/test              { folderPath } -> verifica scrittura
//   POST   /api/folder/analyze-import    { folderPath } -> preview import + conflitti
//   POST   /api/folder/import            { folderPath, resolutions } -> applica import
//   POST   /api/folder/export            { folderPath } -> esporta (folderPath opzionale, usa quello salvato)
//
// Espone anche scheduleAutoExport() che il config-store / room-manager possono chiamare.

const path = require('path');
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

  return { store, scheduleAutoExport };
}

module.exports = { registerFolderRoutes };
