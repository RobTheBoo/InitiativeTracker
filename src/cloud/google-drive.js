// Client minimale per Google Drive API v3 usando OAuth 2.0 Loopback Flow + PKCE.
// Niente client_secret: PKCE rende il flow sicuro per app pubbliche/desktop.
//
// Setup utente (una-tantum, gratis):
//  1. console.cloud.google.com -> crea progetto
//  2. APIs & Services -> Library -> abilita "Google Drive API"
//  3. APIs & Services -> Credentials -> Create -> OAuth client ID
//     - Application type: Desktop app
//     - Copia il Client ID (NON il secret, non serve)
//  4. OAuth consent screen -> External -> aggiungi il tuo email come test user
//
// Scope usato: drive.file (limitato ai SOLI file creati dall'app, NON tutto Drive).
// E' lo scope piu' stretto possibile: l'utente non rischia mai di esporre altri file.

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API_HOST = 'www.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function postForm(url, body) {
  const u = new URL(url);
  const formBody = new URLSearchParams(body).toString();
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: u.host, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formBody)
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d || '{}');
          if (res.statusCode >= 400) return reject(Object.assign(new Error(j.error_description || j.error || 'http ' + res.statusCode), { status: res.statusCode, body: j }));
          resolve(j);
        } catch (e) { reject(new Error('invalid json: ' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(formBody); req.end();
  });
}

function apiRequest({ method = 'GET', path: pathUrl, headers = {}, body = null, raw = false, accessToken, host = API_HOST }) {
  return new Promise((resolve, reject) => {
    const opts = {
      method, host, path: pathUrl,
      headers: { Authorization: 'Bearer ' + accessToken, ...headers }
    };
    if (body && !raw) {
      opts.headers['Content-Type'] = 'application/json';
      const buf = Buffer.from(JSON.stringify(body));
      opts.headers['Content-Length'] = buf.length;
    } else if (body && raw) {
      opts.headers['Content-Length'] = body.length;
    }
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode === 204) return resolve(null);
        const ct = res.headers['content-type'] || '';
        if (ct.includes('application/json')) {
          let parsed;
          try { parsed = JSON.parse(buf.toString()); } catch (_) { parsed = { raw: buf.toString() }; }
          if (res.statusCode >= 400) return reject(Object.assign(new Error(parsed.error?.message || parsed.error_description || ('drive ' + res.statusCode)), { status: res.statusCode, body: parsed }));
          resolve(parsed);
        } else {
          if (res.statusCode >= 400) return reject(Object.assign(new Error('drive ' + res.statusCode), { status: res.statusCode }));
          resolve(buf);
        }
      });
    });
    req.on('error', reject);
    if (body && !raw) req.write(JSON.stringify(body));
    else if (body && raw) req.write(body);
    req.end();
  });
}

class FileTokenStore {
  constructor(filePath) { this.filePath = filePath; }
  load() { try { return fs.existsSync(this.filePath) ? JSON.parse(fs.readFileSync(this.filePath, 'utf8')) : null; } catch (_) { return null; } }
  save(data) {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
  clear() { try { fs.unlinkSync(this.filePath); } catch (_) {} }
}

class GoogleDriveClient {
  constructor({ clientId, tokenStore }) {
    this.clientId = clientId || process.env.RPG_GOOGLE_CLIENT_ID || null;
    this.tokenStore = tokenStore;
    // Cache cartella radice "RPG Initiative Tracker" + sottocartelle
    this._folderIds = {};
    // Stato in-memory dei flow di auth pending (PKCE verifier + loopback server)
    // Esposto con identificatori opachi: il chiamante li tiene per pollare
    this._pending = new Map();
  }

  isConfigured() { return !!this.clientId; }
  isConnected() {
    const t = this.tokenStore.load();
    return !!(t && t.refresh_token);
  }

  // Avvia OAuth Loopback Flow + PKCE.
  // Ritorna un descriptor che il server espone alla UI; il polling controlla _pending.
  async startDeviceCode() {
    if (!this.clientId) throw new Error('Google clientId non configurato.');

    const { verifier, challenge } = pkcePair();
    const state = base64url(crypto.randomBytes(16));

    // Avvia un listener loopback su porta libera (Google permette sia http://127.0.0.1:<port> sia http://localhost:<port>)
    const { server, port } = await new Promise((resolve, reject) => {
      const srv = http.createServer();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => resolve({ server: srv, port: srv.address().port }));
    });
    const redirectUri = `http://127.0.0.1:${port}`;

    const authUrl = AUTH_URL + '?' + new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state
    }).toString();

    const sessionId = crypto.randomBytes(8).toString('hex');

    // Quando arriva la callback, scambia il code per token e chiudi il server
    const completion = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { server.close(); } catch (_) {}
        reject(new Error('Timeout autorizzazione (5 min)'));
      }, 5 * 60 * 1000);

      server.on('request', async (req, res) => {
        try {
          const u = new URL(req.url, redirectUri);
          if (u.pathname !== '/' && u.pathname !== '/callback') {
            res.writeHead(404); res.end('not found'); return;
          }
          const code = u.searchParams.get('code');
          const recvState = u.searchParams.get('state');
          const errParam = u.searchParams.get('error');
          if (errParam) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<html><body style="background:#0d0d14;color:#e8e6e3;font-family:sans-serif;padding:40px;text-align:center"><h2>❌ Autorizzazione rifiutata</h2><p>${errParam}</p><p>Puoi chiudere questa scheda.</p></body></html>`);
            clearTimeout(timeout);
            try { server.close(); } catch (_) {}
            return reject(new Error(errParam));
          }
          if (!code || recvState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body><h2>Stato non valido</h2></body></html>');
            return;
          }
          // Scambia code -> token
          const token = await postForm(TOKEN_URL, {
            grant_type: 'authorization_code',
            client_id: this.clientId,
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri
          });
          this._saveTokens(token);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html><body style="background:#0d0d14;color:#e8e6e3;font-family:sans-serif;padding:40px;text-align:center">
            <h2>✅ Connesso!</h2>
            <p>Puoi chiudere questa scheda e tornare all'app.</p></body></html>`);
          clearTimeout(timeout);
          try { server.close(); } catch (_) {}
          resolve();
        } catch (e) {
          try { res.writeHead(500); res.end('error'); } catch (_) {}
          clearTimeout(timeout);
          try { server.close(); } catch (_) {}
          reject(e);
        }
      });
    });

    // Track in pending map for polling
    const pending = { status: 'pending', error: null, completion };
    this._pending.set(sessionId, pending);
    completion.then(() => { pending.status = 'success'; })
              .catch(err => { pending.status = 'error'; pending.error = err.message; });
    // Auto-cleanup dopo 10 min
    setTimeout(() => this._pending.delete(sessionId), 10 * 60 * 1000);

    return {
      _opaque: sessionId,
      authUrl,
      verificationUri: authUrl,        // Lo presentiamo come "URL da aprire"
      user_code: '(apri il link)',     // Compat con UI OneDrive: mostriamo "(apri il link)"
      expires_in: 300,
      interval: 2,
      message: 'Apri il link nel browser, accetta i permessi. Verrai rediretto su 127.0.0.1.'
    };
  }

  async pollDeviceCode(opaqueSessionId) {
    const p = this._pending.get(opaqueSessionId);
    if (!p) throw new Error('Sessione sconosciuta o scaduta');
    return p.completion; // Risolve quando l'utente autorizza, rejecta su timeout/errore
  }

  _saveTokens(tokenResp) {
    const cur = this.tokenStore.load() || {};
    const merged = {
      access_token: tokenResp.access_token,
      // Google a volte non rimanda il refresh_token in refresh; conserva quello vecchio
      refresh_token: tokenResp.refresh_token || cur.refresh_token,
      expires_at: Date.now() + (tokenResp.expires_in - 60) * 1000,
      scope: tokenResp.scope,
      token_type: tokenResp.token_type
    };
    this.tokenStore.save(merged);
    return merged;
  }

  async _getValidAccessToken() {
    const t = this.tokenStore.load();
    if (!t) throw new Error('Google Drive non connesso');
    if (t.access_token && Date.now() < t.expires_at - 5000) return t.access_token;
    if (!t.refresh_token) throw new Error('Refresh token mancante, riconnetti');
    const refreshed = await postForm(TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: t.refresh_token
    });
    return this._saveTokens(refreshed).access_token;
  }

  async disconnect() {
    const t = this.tokenStore.load();
    if (t && t.refresh_token) {
      try { await postForm(REVOKE_URL, { token: t.refresh_token }); } catch (_) {}
    }
    this.tokenStore.clear();
    this._folderIds = {};
  }

  async whoAmI() {
    const accessToken = await this._getValidAccessToken();
    const me = await apiRequest({ path: '/oauth2/v2/userinfo', accessToken });
    return { displayName: me.name, mail: me.email, picture: me.picture };
  }

  async getQuota() {
    const accessToken = await this._getValidAccessToken();
    const about = await apiRequest({ path: '/drive/v3/about?fields=storageQuota', accessToken });
    const q = about.storageQuota || {};
    if (!q.limit) return null;
    return {
      used: parseInt(q.usage || '0', 10),
      total: parseInt(q.limit, 10),
      remaining: parseInt(q.limit, 10) - parseInt(q.usage || '0', 10)
    };
  }

  // Trova o crea la cartella "RPG Initiative Tracker" e le sottocartelle.
  // drive.file scope significa che vediamo solo file/cartelle creati dalla nostra app.
  async ensureAppFolder(subfolder) {
    const accessToken = await this._getValidAccessToken();
    const cacheKey = subfolder || '__root__';
    if (this._folderIds[cacheKey]) return { id: this._folderIds[cacheKey], name: subfolder || 'RPG Initiative Tracker' };

    // Trova root
    let rootId = this._folderIds.__root__;
    if (!rootId) {
      const q = "mimeType='application/vnd.google-apps.folder' and name='RPG Initiative Tracker' and trashed=false";
      const search = await apiRequest({ path: `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, accessToken });
      if (search.files && search.files.length > 0) {
        rootId = search.files[0].id;
      } else {
        const created = await apiRequest({
          method: 'POST', path: '/drive/v3/files', accessToken,
          body: { name: 'RPG Initiative Tracker', mimeType: 'application/vnd.google-apps.folder' }
        });
        rootId = created.id;
      }
      this._folderIds.__root__ = rootId;
    }

    if (!subfolder) return { id: rootId, name: 'RPG Initiative Tracker' };

    // Trova sottocartella sotto root
    const q2 = `mimeType='application/vnd.google-apps.folder' and name='${subfolder}' and '${rootId}' in parents and trashed=false`;
    const sub = await apiRequest({ path: `/drive/v3/files?q=${encodeURIComponent(q2)}&fields=files(id,name)`, accessToken });
    let subId;
    if (sub.files && sub.files.length > 0) {
      subId = sub.files[0].id;
    } else {
      const created = await apiRequest({
        method: 'POST', path: '/drive/v3/files', accessToken,
        body: { name: subfolder, mimeType: 'application/vnd.google-apps.folder', parents: [rootId] }
      });
      subId = created.id;
    }
    this._folderIds[cacheKey] = subId;
    return { id: subId, name: subfolder };
  }

  async listFolder(subfolder) {
    const accessToken = await this._getValidAccessToken();
    const folder = await this.ensureAppFolder(subfolder);
    const items = [];
    let pageToken = null;
    do {
      const q = `'${folder.id}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
      const url = `/drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,size,mimeType,md5Checksum,modifiedTime)&pageSize=1000` + (pageToken ? `&pageToken=${pageToken}` : '');
      const page = await apiRequest({ path: url, accessToken });
      for (const f of (page.files || [])) {
        items.push({
          id: f.id,
          name: f.name,
          size: parseInt(f.size || '0', 10),
          mime: f.mimeType,
          downloadUrl: null, // Drive richiede auth nel download, lo facciamo via API
          etag: f.md5Checksum || f.modifiedTime, // usiamo md5 come "etag"
          lastModified: f.modifiedTime
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  async uploadFile(subfolder, filename, buffer, mimeType) {
    const accessToken = await this._getValidAccessToken();
    const folder = await this.ensureAppFolder(subfolder);

    // Cerca esistente per replace
    const q = `'${folder.id}' in parents and name='${filename.replace(/'/g, "\\'")}' and trashed=false`;
    const search = await apiRequest({ path: `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, accessToken });
    const existingId = search.files?.[0]?.id;

    // Upload multipart: metadata + content in una sola request
    const boundary = '-------rpg-tracker-boundary-' + crypto.randomBytes(8).toString('hex');
    const metadata = existingId
      ? { name: filename }
      : { name: filename, parents: [folder.id] };

    const bodyParts = [
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
      Buffer.from(JSON.stringify(metadata)),
      Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ];
    const body = Buffer.concat(bodyParts);

    const path = existingId
      ? `/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,md5Checksum,modifiedTime`
      : `/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum,modifiedTime`;
    const method = existingId ? 'PATCH' : 'POST';

    const out = await apiRequest({
      method, path, accessToken,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body, raw: true
    });
    return { id: out.id, eTag: out.md5Checksum || out.modifiedTime };
  }

  async downloadFile(itemId) {
    const accessToken = await this._getValidAccessToken();
    return apiRequest({ path: `/drive/v3/files/${itemId}?alt=media`, accessToken });
  }

  async deleteFile(itemId) {
    const accessToken = await this._getValidAccessToken();
    await apiRequest({ method: 'DELETE', path: `/drive/v3/files/${itemId}`, accessToken });
  }
}

module.exports = { GoogleDriveClient, FileTokenStore };
