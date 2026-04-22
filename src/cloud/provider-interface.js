// Interfaccia comune per i provider cloud (OneDrive, Google Drive, futuri).
// Ogni provider deve esporre questi metodi:
//
//   isConfigured()             -> bool: il client/app è stato registrato dall'utente
//   isConnected()              -> bool: l'utente ha autorizzato e abbiamo refresh_token
//   startDeviceCode()          -> { user_code, verification_uri, expires_in, interval, _opaque }
//   pollDeviceCode(opaque)     -> Promise<void> (risolve quando autorizzato)
//   disconnect()               -> rimuove token locali
//   whoAmI()                   -> { displayName, mail }
//   getQuota()                 -> { used, total, remaining } | null
//   ensureAppFolder(sub)       -> assicura che esista la cartella, ritorna metadata
//   listFolder(sub)            -> [{ id, name, size, mime, downloadUrl, etag, lastModified }]
//   uploadFile(sub, name, buf, mime) -> { id, eTag/etag }
//   downloadFile(id)           -> Buffer
//   deleteFile(id)             -> void
//
// I provider che non supportano device code flow (es. Google Drive non lo offre per OAuth user)
// usano OAuth loopback: avviano un server HTTP locale temporaneo su 127.0.0.1:<port>,
// aprono il browser, ricevono il code, scambiano il token. L'API esposta resta la stessa
// dal punto di vista del frontend: startDeviceCode -> pollDeviceCode.

class CloudProviderError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

module.exports = { CloudProviderError };
