// Endpoint REST per la gestione di OneDrive e sync immagini.
// Disegnato per essere "transparent": l'utente fa upload come oggi (POST multipart),
// se OneDrive e' connesso il file va anche su cloud, se non lo e' funziona tutto come prima.

const fs = require('fs');
const path = require('path');
const { OneDriveClient, FileTokenStore } = require('./onedrive');
const { CloudConfigStore } = require('./cloud-config-store');

function registerCloudRoutes(app, paths, configStore) {
  const cloudStore = new CloudConfigStore(paths.cloudConfigPath);
  const tokenStore = new FileTokenStore(path.join(paths.dataDir, 'cloud-tokens.json'));

  function getClient() {
    const cfg = cloudStore.load();
    return new OneDriveClient({
      clientId: cfg.clientId || process.env.RPG_AZURE_CLIENT_ID || null,
      tokenStore
    });
  }

  // Stato sintetico per la UI
  app.get('/api/cloud/status', async (req, res) => {
    const cfg = cloudStore.load();
    const client = getClient();
    const status = {
      provider: 'onedrive',
      configured: client.isConfigured(),
      connected: client.isConnected(),
      clientIdSource: cfg.clientId ? 'config' : (process.env.RPG_AZURE_CLIENT_ID ? 'env' : 'missing'),
      lastSyncAt: cfg.lastSyncAt
    };
    if (status.connected) {
      try {
        const me = await client.whoAmI();
        status.account = { displayName: me.displayName, mail: me.mail || me.userPrincipalName };
        const quota = await client.getDriveQuota();
        if (quota) status.quota = { used: quota.used, total: quota.total, remaining: quota.remaining };
      } catch (e) {
        status.connectionError = e.message;
      }
    }
    res.json(status);
  });

  // Imposta il clientId Azure (azione una-tantum)
  app.post('/api/cloud/config', (req, res) => {
    const { clientId } = req.body || {};
    if (typeof clientId !== 'string' || clientId.length < 8) return res.status(400).json({ error: 'clientId non valido' });
    cloudStore.update(c => { c.clientId = clientId.trim(); return c; });
    res.json({ success: true });
  });

  // ----- Device code flow -----
  // Ogni device-code ha il suo poll in-memory. Lo identifichiamo con session id.
  const pendingFlows = new Map(); // sessionId -> { promise, status, deviceCode }

  app.post('/api/cloud/auth/start', async (req, res) => {
    try {
      const client = getClient();
      if (!client.isConfigured()) return res.status(400).json({ error: 'clientId Azure non configurato' });
      const dc = await client.startDeviceCode();
      const sessionId = require('crypto').randomBytes(16).toString('hex');
      const flow = { status: 'pending', error: null, account: null };
      pendingFlows.set(sessionId, flow);
      // Avvia poll in background
      client.pollDeviceCode(dc.device_code, dc.interval, dc.expires_in)
        .then(async () => {
          flow.status = 'success';
          try {
            const me = await client.whoAmI();
            flow.account = { displayName: me.displayName, mail: me.mail || me.userPrincipalName };
          } catch (_) {}
          // Pulisci dopo 5 min
          setTimeout(() => pendingFlows.delete(sessionId), 5 * 60 * 1000);
        })
        .catch(err => {
          flow.status = 'error';
          flow.error = err.message;
          setTimeout(() => pendingFlows.delete(sessionId), 5 * 60 * 1000);
        });
      res.json({
        sessionId,
        userCode: dc.user_code,
        verificationUri: dc.verification_uri,
        message: dc.message,
        expiresIn: dc.expires_in
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/cloud/auth/status/:sessionId', (req, res) => {
    const flow = pendingFlows.get(req.params.sessionId);
    if (!flow) return res.status(404).json({ error: 'sessione sconosciuta o scaduta' });
    res.json(flow);
  });

  app.post('/api/cloud/auth/disconnect', async (req, res) => {
    try {
      const client = getClient();
      await client.disconnect();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----- Sync: scarica da OneDrive le immagini mancanti localmente -----
  app.post('/api/cloud/sync', async (req, res) => {
    try {
      const client = getClient();
      if (!client.isConnected()) return res.status(400).json({ error: 'OneDrive non connesso' });

      const subfolders = ['heroes', 'enemies', 'allies', 'summons'];
      const result = { downloaded: [], skipped: [], errors: [] };

      for (const sub of subfolders) {
        const remoteList = await client.listFolder(sub);
        const localFolder = paths.getImagesPath(sub);
        for (const item of remoteList) {
          const localPath = path.join(localFolder, item.name);
          const cloudCfg = cloudStore.load();
          const tracked = cloudCfg.remoteFiles[sub]?.[item.name];
          if (fs.existsSync(localPath) && tracked && tracked.etag === item.etag) {
            result.skipped.push(`${sub}/${item.name}`);
            continue;
          }
          try {
            const buf = await client.downloadFile(item.id);
            fs.writeFileSync(localPath, buf);
            cloudStore.update(c => {
              if (!c.remoteFiles[sub]) c.remoteFiles[sub] = {};
              c.remoteFiles[sub][item.name] = { remoteId: item.id, etag: item.etag, lastSyncedAt: Date.now() };
              return c;
            });
            result.downloaded.push(`${sub}/${item.name}`);
          } catch (e) {
            result.errors.push({ file: `${sub}/${item.name}`, error: e.message });
          }
        }
      }
      cloudStore.update(c => { c.lastSyncAt = Date.now(); return c; });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----- Push: carica TUTTE le immagini locali verso OneDrive (utile primo setup) -----
  app.post('/api/cloud/push', async (req, res) => {
    try {
      const client = getClient();
      if (!client.isConnected()) return res.status(400).json({ error: 'OneDrive non connesso' });
      const subfolders = ['heroes', 'enemies', 'allies', 'summons'];
      const result = { uploaded: [], errors: [] };
      for (const sub of subfolders) {
        const folder = paths.getImagesPath(sub);
        if (!fs.existsSync(folder)) continue;
        for (const filename of fs.readdirSync(folder)) {
          const local = path.join(folder, filename);
          if (!fs.statSync(local).isFile()) continue;
          try {
            const buf = fs.readFileSync(local);
            const item = await client.uploadFile(sub, filename, buf, mimeForExt(path.extname(filename)));
            cloudStore.update(c => {
              if (!c.remoteFiles[sub]) c.remoteFiles[sub] = {};
              c.remoteFiles[sub][filename] = { remoteId: item.id, etag: item.eTag, lastSyncedAt: Date.now() };
              return c;
            });
            result.uploaded.push(`${sub}/${filename}`);
          } catch (e) {
            result.errors.push({ file: `${sub}/${filename}`, error: e.message });
          }
        }
      }
      cloudStore.update(c => { c.lastSyncAt = Date.now(); return c; });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Hook per upload integrato: chiamato dalle route di upload esistenti.
  // Se OneDrive e' connesso, carica anche su cloud (best-effort, fail-soft).
  async function pushSingleFile(subfolder, filename, absolutePath) {
    try {
      const client = getClient();
      if (!client.isConnected()) return null;
      const buf = fs.readFileSync(absolutePath);
      const item = await client.uploadFile(subfolder, filename, buf, mimeForExt(path.extname(filename)));
      cloudStore.update(c => {
        if (!c.remoteFiles[subfolder]) c.remoteFiles[subfolder] = {};
        c.remoteFiles[subfolder][filename] = { remoteId: item.id, etag: item.eTag, lastSyncedAt: Date.now() };
        return c;
      });
      return item;
    } catch (e) {
      console.warn(`⚠️  Push OneDrive fallito per ${subfolder}/${filename}:`, e.message);
      return null;
    }
  }

  return { cloudStore, getClient, pushSingleFile };
}

function mimeForExt(ext) {
  const e = (ext || '').toLowerCase();
  switch (e) {
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

module.exports = { registerCloudRoutes };
