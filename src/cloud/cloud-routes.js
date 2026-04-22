// Endpoint REST per la gestione dei provider cloud (OneDrive, Google Drive).
// Il design e' provider-agnostic: gli endpoint accettano ?provider=onedrive|gdrive,
// l'utente puo' connettere entrambi indipendentemente.
//
// L'auto-push degli upload (pushSingleFile) carica su TUTTI i provider connessi.
// Il sync (pull) viene fatto su un provider alla volta scelto dall'utente.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OneDriveClient, FileTokenStore: OneDriveTokenStore } = require('./onedrive');
const { GoogleDriveClient, FileTokenStore: GoogleTokenStore } = require('./google-drive');
const { CloudConfigStore } = require('./cloud-config-store');

const PROVIDERS = ['onedrive', 'gdrive'];

function registerCloudRoutes(app, paths, configStore) {
  const cloudStore = new CloudConfigStore(paths.cloudConfigPath);

  const tokenStores = {
    onedrive: new OneDriveTokenStore(path.join(paths.dataDir, 'cloud-tokens-onedrive.json')),
    gdrive: new GoogleTokenStore(path.join(paths.dataDir, 'cloud-tokens-gdrive.json'))
  };

  // Manteniamo i client istanziati una volta sola: i loro flow di auth pending vivono in-memory
  let clientCache = {};
  function getClient(provider) {
    if (clientCache[provider]) return clientCache[provider];
    const cfg = cloudStore.load();
    const providerCfg = cfg.providers?.[provider] || {};
    if (provider === 'onedrive') {
      clientCache[provider] = new OneDriveClient({
        clientId: providerCfg.clientId || process.env.RPG_AZURE_CLIENT_ID || null,
        tokenStore: tokenStores[provider]
      });
    } else if (provider === 'gdrive') {
      clientCache[provider] = new GoogleDriveClient({
        clientId: providerCfg.clientId || process.env.RPG_GOOGLE_CLIENT_ID || null,
        tokenStore: tokenStores[provider]
      });
    } else {
      throw new Error('provider sconosciuto: ' + provider);
    }
    return clientCache[provider];
  }

  function invalidateClientCache(provider) {
    delete clientCache[provider];
  }

  // ----- Stato globale di tutti i provider -----
  app.get('/api/cloud/status', async (req, res) => {
    const cfg = cloudStore.load();
    const out = {
      providers: {},
      lastSyncAt: cfg.lastSyncAt
    };
    for (const p of PROVIDERS) {
      const client = getClient(p);
      const providerCfg = cfg.providers?.[p] || {};
      const ps = {
        configured: client.isConfigured(),
        connected: client.isConnected(),
        clientIdSource: providerCfg.clientId ? 'config' : (process.env[p === 'onedrive' ? 'RPG_AZURE_CLIENT_ID' : 'RPG_GOOGLE_CLIENT_ID'] ? 'env' : 'missing'),
        lastSyncAt: cfg.providers?.[p]?.lastSyncAt || null
      };
      if (ps.connected) {
        try {
          const me = await client.whoAmI();
          ps.account = me;
          const q = (typeof client.getQuota === 'function') ? await client.getQuota() : (typeof client.getDriveQuota === 'function' ? await client.getDriveQuota() : null);
          if (q) ps.quota = { used: q.used, total: q.total, remaining: q.remaining };
        } catch (e) {
          ps.connectionError = e.message;
        }
      }
      out.providers[p] = ps;
    }
    res.json(out);
  });

  // Setup: salva clientId per un provider
  app.post('/api/cloud/config', (req, res) => {
    const { provider, clientId } = req.body || {};
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'provider non valido' });
    if (typeof clientId !== 'string' || clientId.length < 8) return res.status(400).json({ error: 'clientId non valido' });
    cloudStore.update(c => {
      if (!c.providers) c.providers = {};
      if (!c.providers[provider]) c.providers[provider] = {};
      c.providers[provider].clientId = clientId.trim();
      return c;
    });
    invalidateClientCache(provider);
    res.json({ success: true });
  });

  // ----- Auth flow (uniforme tra OneDrive e Google) -----
  // Manteniamo le sessioni di flow per provider per non incrociare gli opaque sessionId
  const pendingFlows = new Map(); // sessionId -> { provider, status, error, account, opaque }

  app.post('/api/cloud/auth/start', async (req, res) => {
    const provider = req.body?.provider || req.query.provider;
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'provider non valido' });
    try {
      const client = getClient(provider);
      if (!client.isConfigured()) return res.status(400).json({ error: `clientId ${provider} non configurato` });
      const dc = await client.startDeviceCode();
      const sessionId = crypto.randomBytes(16).toString('hex');
      const flow = { provider, status: 'pending', error: null, account: null, opaque: dc._opaque || dc.device_code };
      pendingFlows.set(sessionId, flow);

      // Polling in background
      client.pollDeviceCode(flow.opaque, dc.interval, dc.expires_in)
        .then(async () => {
          flow.status = 'success';
          try {
            const me = await client.whoAmI();
            flow.account = me;
          } catch (_) {}
          setTimeout(() => pendingFlows.delete(sessionId), 5 * 60 * 1000);
        })
        .catch(err => {
          flow.status = 'error';
          flow.error = err.message;
          setTimeout(() => pendingFlows.delete(sessionId), 5 * 60 * 1000);
        });

      res.json({
        sessionId,
        provider,
        userCode: dc.user_code || dc.userCode,
        verificationUri: dc.verification_uri || dc.verificationUri || dc.authUrl,
        message: dc.message,
        expiresIn: dc.expires_in,
        // Per Google diamo anche l'authUrl direttamente cosi' possiamo aprirlo automaticamente
        authUrl: dc.authUrl || null
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/cloud/auth/status/:sessionId', (req, res) => {
    const flow = pendingFlows.get(req.params.sessionId);
    if (!flow) return res.status(404).json({ error: 'sessione sconosciuta o scaduta' });
    res.json({ status: flow.status, error: flow.error, account: flow.account, provider: flow.provider });
  });

  app.post('/api/cloud/auth/disconnect', async (req, res) => {
    const provider = req.body?.provider || req.query.provider;
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'provider non valido' });
    try {
      const client = getClient(provider);
      await client.disconnect();
      invalidateClientCache(provider);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----- Sync e Push (per provider specifico) -----
  app.post('/api/cloud/sync', async (req, res) => {
    const provider = req.body?.provider || req.query.provider;
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'provider non valido' });
    try {
      const client = getClient(provider);
      if (!client.isConnected()) return res.status(400).json({ error: `${provider} non connesso` });

      const subfolders = ['heroes', 'enemies', 'allies', 'summons'];
      const result = { provider, downloaded: [], skipped: [], errors: [] };

      for (const sub of subfolders) {
        const remoteList = await client.listFolder(sub);
        const localFolder = paths.getImagesPath(sub);
        for (const item of remoteList) {
          const localPath = path.join(localFolder, item.name);
          const cloudCfg = cloudStore.load();
          const tracked = cloudCfg.remoteFiles?.[provider]?.[sub]?.[item.name];
          if (fs.existsSync(localPath) && tracked && tracked.etag === item.etag) {
            result.skipped.push(`${sub}/${item.name}`);
            continue;
          }
          try {
            const buf = await client.downloadFile(item.id);
            fs.writeFileSync(localPath, buf);
            cloudStore.update(c => {
              if (!c.remoteFiles) c.remoteFiles = {};
              if (!c.remoteFiles[provider]) c.remoteFiles[provider] = {};
              if (!c.remoteFiles[provider][sub]) c.remoteFiles[provider][sub] = {};
              c.remoteFiles[provider][sub][item.name] = { remoteId: item.id, etag: item.etag, lastSyncedAt: Date.now() };
              return c;
            });
            result.downloaded.push(`${sub}/${item.name}`);
          } catch (e) {
            result.errors.push({ file: `${sub}/${item.name}`, error: e.message });
          }
        }
      }
      cloudStore.update(c => {
        if (!c.providers) c.providers = {};
        if (!c.providers[provider]) c.providers[provider] = {};
        c.providers[provider].lastSyncAt = Date.now();
        c.lastSyncAt = Date.now();
        return c;
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/cloud/push', async (req, res) => {
    const provider = req.body?.provider || req.query.provider;
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'provider non valido' });
    try {
      const client = getClient(provider);
      if (!client.isConnected()) return res.status(400).json({ error: `${provider} non connesso` });
      const subfolders = ['heroes', 'enemies', 'allies', 'summons'];
      const result = { provider, uploaded: [], errors: [] };
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
              if (!c.remoteFiles) c.remoteFiles = {};
              if (!c.remoteFiles[provider]) c.remoteFiles[provider] = {};
              if (!c.remoteFiles[provider][sub]) c.remoteFiles[provider][sub] = {};
              c.remoteFiles[provider][sub][filename] = { remoteId: item.id, etag: item.eTag, lastSyncedAt: Date.now() };
              return c;
            });
            result.uploaded.push(`${sub}/${filename}`);
          } catch (e) {
            result.errors.push({ file: `${sub}/${filename}`, error: e.message });
          }
        }
      }
      cloudStore.update(c => {
        if (!c.providers) c.providers = {};
        if (!c.providers[provider]) c.providers[provider] = {};
        c.providers[provider].lastSyncAt = Date.now();
        c.lastSyncAt = Date.now();
        return c;
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Hook auto-upload: chiamato dalle route di upload immagini.
  // Pusha verso TUTTI i provider connessi (best-effort, fail-soft).
  async function pushSingleFile(subfolder, filename, absolutePath) {
    const buf = fs.readFileSync(absolutePath);
    const mime = mimeForExt(path.extname(filename));
    const results = {};
    for (const p of PROVIDERS) {
      try {
        const client = getClient(p);
        if (!client.isConnected()) { results[p] = 'skipped (not connected)'; continue; }
        const item = await client.uploadFile(subfolder, filename, buf, mime);
        cloudStore.update(c => {
          if (!c.remoteFiles) c.remoteFiles = {};
          if (!c.remoteFiles[p]) c.remoteFiles[p] = {};
          if (!c.remoteFiles[p][subfolder]) c.remoteFiles[p][subfolder] = {};
          c.remoteFiles[p][subfolder][filename] = { remoteId: item.id, etag: item.eTag, lastSyncedAt: Date.now() };
          return c;
        });
        results[p] = 'ok';
      } catch (e) {
        console.warn(`⚠️  Push ${p} fallito per ${subfolder}/${filename}:`, e.message);
        results[p] = 'error: ' + e.message;
      }
    }
    return results;
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
