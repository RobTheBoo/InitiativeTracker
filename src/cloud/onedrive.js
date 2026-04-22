// Client minimale per Microsoft Graph + OneDrive Personal usando Device Code Flow.
// Flow:
//   1. POST /devicecode -> { device_code, user_code, verification_uri, expires_in, interval }
//   2. Mostra user_code all'utente che lo digita su microsoft.com/devicelogin
//   3. Polla /token finche' non riceve access_token + refresh_token
//   4. Salva token (in app-data/cloud.json) e li refresha quando scadono
// Scope: Files.ReadWrite offline_access (offline = abilita refresh_token)

const https = require('https');
const fs = require('fs');
const path = require('path');

const TENANT = 'consumers'; // OneDrive Personal (Microsoft account)
const AUTH_HOST = 'login.microsoftonline.com';
const GRAPH_HOST = 'graph.microsoft.com';
const DEFAULT_SCOPES = 'Files.ReadWrite offline_access User.Read';

// Client ID pubblico di default (none e' sempre adatto a tutti):
// L'utente DEVE registrare una sua app Azure AD (gratis) e mettere qui il suo client_id.
// La registrazione e' una-tantum: https://portal.azure.com -> App registrations -> New registration
//  - Supported account types: "Personal Microsoft accounts only"
//  - Redirect URI: NESSUNO (e' device code flow)
//  - Authentication -> Allow public client flows = SI
const FALLBACK_CLIENT_ID = process.env.RPG_AZURE_CLIENT_ID || '';

function postForm(host, pathUrl, body) {
  const formBody = new URLSearchParams(body).toString();
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, path: pathUrl, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formBody)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) return reject(Object.assign(new Error(parsed.error_description || parsed.error || 'http ' + res.statusCode), { code: parsed.error, status: res.statusCode, body: parsed }));
          resolve(parsed);
        } catch (e) { reject(new Error('invalid json: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(formBody);
    req.end();
  });
}

function graphRequest({ method = 'GET', url, headers = {}, body = null, raw = false, accessToken }) {
  return new Promise((resolve, reject) => {
    const isAbs = /^https?:\/\//.test(url);
    const u = isAbs ? new URL(url) : new URL('https://' + GRAPH_HOST + '/v1.0' + url);
    const opts = {
      method,
      host: u.host,
      path: u.pathname + u.search,
      headers: {
        Authorization: 'Bearer ' + accessToken,
        ...headers
      }
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
          if (res.statusCode >= 400) return reject(Object.assign(new Error(parsed.error?.message || 'graph ' + res.statusCode), { status: res.statusCode, body: parsed }));
          resolve(parsed);
        } else {
          if (res.statusCode >= 400) return reject(Object.assign(new Error('graph ' + res.statusCode), { status: res.statusCode }));
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

class OneDriveClient {
  constructor({ clientId, tokenStore, scopes }) {
    this.clientId = clientId || FALLBACK_CLIENT_ID;
    this.scopes = scopes || DEFAULT_SCOPES;
    this.tokenStore = tokenStore;
  }

  isConfigured() { return !!this.clientId; }
  isConnected() {
    const t = this.tokenStore.load();
    return !!(t && t.refresh_token);
  }

  // Avvia device code flow. Ritorna immediatamente con i dati per l'utente.
  // Restituisce anche un Promise (poll) che si risolve quando l'utente autorizza.
  async startDeviceCode() {
    if (!this.clientId) throw new Error('Microsoft Azure clientId non configurato. Vai in Configurazione → Cloud per impostarlo.');
    const resp = await postForm(AUTH_HOST, `/${TENANT}/oauth2/v2.0/devicecode`, {
      client_id: this.clientId,
      scope: this.scopes
    });
    return resp; // { device_code, user_code, verification_uri, expires_in, interval, message }
  }

  async pollDeviceCode(deviceCode, intervalSec, expiresIn, onProgress) {
    const start = Date.now();
    let interval = (intervalSec || 5) * 1000;
    while ((Date.now() - start) / 1000 < (expiresIn || 900)) {
      await new Promise(r => setTimeout(r, interval));
      try {
        const resp = await postForm(AUTH_HOST, `/${TENANT}/oauth2/v2.0/token`, {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: this.clientId,
          device_code: deviceCode
        });
        // Successo: salva token
        this._saveTokens(resp);
        return resp;
      } catch (err) {
        // Errori attesi durante il polling
        if (err.code === 'authorization_pending') {
          if (onProgress) onProgress('pending');
          continue;
        }
        if (err.code === 'slow_down') {
          interval += 5000;
          continue;
        }
        if (err.code === 'authorization_declined') throw new Error('Accesso rifiutato');
        if (err.code === 'expired_token') throw new Error('Codice scaduto, riprova');
        throw err;
      }
    }
    throw new Error('Timeout autorizzazione');
  }

  _saveTokens(tokenResp) {
    const stored = {
      access_token: tokenResp.access_token,
      refresh_token: tokenResp.refresh_token,
      expires_at: Date.now() + (tokenResp.expires_in - 60) * 1000,
      scope: tokenResp.scope,
      token_type: tokenResp.token_type
    };
    this.tokenStore.save(stored);
    return stored;
  }

  async _getValidAccessToken() {
    const t = this.tokenStore.load();
    if (!t) throw new Error('OneDrive non connesso');
    if (t.access_token && Date.now() < t.expires_at - 5000) return t.access_token;
    if (!t.refresh_token) throw new Error('Refresh token mancante, riconnetti OneDrive');
    const refreshed = await postForm(AUTH_HOST, `/${TENANT}/oauth2/v2.0/token`, {
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: t.refresh_token,
      scope: this.scopes
    });
    return this._saveTokens(refreshed).access_token;
  }

  async disconnect() {
    this.tokenStore.clear();
  }

  async whoAmI() {
    const accessToken = await this._getValidAccessToken();
    return graphRequest({ url: '/me', accessToken });
  }

  async getDriveQuota() {
    const accessToken = await this._getValidAccessToken();
    const drive = await graphRequest({ url: '/me/drive', accessToken });
    return drive.quota || null;
  }

  // Risolve (creandolo se serve) il path "Apps/RPG Initiative Tracker/<subfolder>"
  // OneDrive supporta il path-based addressing che ci semplifica la vita.
  async ensureAppFolder(subfolder) {
    const accessToken = await this._getValidAccessToken();
    const base = 'Apps/RPG Initiative Tracker';
    const fullPath = subfolder ? `${base}/${subfolder}` : base;
    // Crea ricorsivamente: GET, se 404 crea
    try {
      const item = await graphRequest({ url: `/me/drive/root:/${encodeURIComponent(fullPath)}`, accessToken });
      return item;
    } catch (err) {
      if (err.status !== 404) throw err;
      // Crea le componenti del path una alla volta (root e' implicito)
      const parts = fullPath.split('/').filter(Boolean);
      let parentPath = '';
      let lastItem = null;
      for (const part of parts) {
        const tryPath = parentPath ? `${parentPath}/${part}` : part;
        try {
          lastItem = await graphRequest({ url: `/me/drive/root:/${encodeURIComponent(tryPath)}`, accessToken });
        } catch (e404) {
          // Crea
          const parentEndpoint = parentPath ? `/me/drive/root:/${encodeURIComponent(parentPath)}:/children` : '/me/drive/root/children';
          lastItem = await graphRequest({
            method: 'POST',
            url: parentEndpoint,
            accessToken,
            body: { name: part, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }
          });
        }
        parentPath = tryPath;
      }
      return lastItem;
    }
  }

  async listFolder(subfolder) {
    const accessToken = await this._getValidAccessToken();
    const folder = await this.ensureAppFolder(subfolder);
    const items = [];
    let next = `/me/drive/items/${folder.id}/children?$select=id,name,size,file,folder,@microsoft.graph.downloadUrl,eTag,lastModifiedDateTime`;
    while (next) {
      const page = await graphRequest({ url: next, accessToken });
      for (const item of (page.value || [])) {
        if (item.file) items.push({
          id: item.id,
          name: item.name,
          size: item.size,
          mime: item.file.mimeType,
          downloadUrl: item['@microsoft.graph.downloadUrl'],
          etag: item.eTag,
          lastModified: item.lastModifiedDateTime
        });
      }
      next = page['@odata.nextLink'] || null;
    }
    return items;
  }

  // Upload <= 4MB usa endpoint semplice. Sopra usa upload session (chunked).
  async uploadFile(subfolder, filename, buffer, mimeType) {
    const accessToken = await this._getValidAccessToken();
    await this.ensureAppFolder(subfolder);
    const remotePath = `Apps/RPG Initiative Tracker/${subfolder}/${filename}`;

    if (buffer.length <= 4 * 1024 * 1024) {
      const item = await graphRequest({
        method: 'PUT',
        url: `/me/drive/root:/${encodeURIComponent(remotePath)}:/content`,
        accessToken,
        headers: { 'Content-Type': mimeType || 'application/octet-stream' },
        body: buffer,
        raw: true
      });
      return item;
    }

    // Upload session per file grandi
    const session = await graphRequest({
      method: 'POST',
      url: `/me/drive/root:/${encodeURIComponent(remotePath)}:/createUploadSession`,
      accessToken,
      body: { item: { '@microsoft.graph.conflictBehavior': 'replace' } }
    });
    const uploadUrl = session.uploadUrl;
    const chunkSize = 5 * 1024 * 1024; // 5MB
    let offset = 0;
    let lastResp = null;
    while (offset < buffer.length) {
      const end = Math.min(offset + chunkSize, buffer.length);
      const chunk = buffer.slice(offset, end);
      lastResp = await new Promise((resolve, reject) => {
        const u = new URL(uploadUrl);
        const req = https.request({
          host: u.host, path: u.pathname + u.search, method: 'PUT',
          headers: {
            'Content-Length': chunk.length,
            'Content-Range': `bytes ${offset}-${end - 1}/${buffer.length}`
          }
        }, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (_) { resolve(null); }
          });
        });
        req.on('error', reject);
        req.write(chunk);
        req.end();
      });
      offset = end;
    }
    return lastResp;
  }

  async downloadFile(itemId) {
    const accessToken = await this._getValidAccessToken();
    return graphRequest({ url: `/me/drive/items/${itemId}/content`, accessToken });
  }

  async deleteFile(itemId) {
    const accessToken = await this._getValidAccessToken();
    await graphRequest({ method: 'DELETE', url: `/me/drive/items/${itemId}`, accessToken });
  }
}

// Token store su disco (file json con perms 0600 quando supportato)
class FileTokenStore {
  constructor(filePath) { this.filePath = filePath; }
  load() {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (_) { return null; }
  }
  save(data) {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
  clear() {
    try { fs.unlinkSync(this.filePath); } catch (_) {}
  }
}

module.exports = { OneDriveClient, FileTokenStore, FALLBACK_CLIENT_ID };
