// Electron main process - thin wrapper sopra src/server/create-server.js.
// Tutta la logica HTTP / Socket.IO / config / DB sta in src/server/.
// Qui restano solo: BrowserWindow, IPC, lifecycle dell'app desktop.

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { createServer } = require('../src/server/create-server');
const { getPrimaryLocalIP, getLocalIPs } = require('../src/server/paths');

let mainWindow = null;
let server = null;

// Porta preferita da env (compat) o 3001 di default. Se occupata proviamo i
// successivi fino a MAX_PORT_ATTEMPTS. Il port effettivo bindato sta in
// `actualPort` (usato da pageUrl per far puntare la finestra al server giusto).
const PREFERRED_PORT = parseInt(process.env.PORT || '3001', 10);
const MAX_PORT_ATTEMPTS = 10;
let actualPort = PREFERRED_PORT;

// URL base http:// del server interno: tutte le pagine vengono caricate via questo
// URL invece che via file:// — cosi' fetch('/api/..') e <img src="/api/qr..">
// si risolvono correttamente sull'Express server senza piu' bisogno di hack.
function pageUrl(htmlFile) {
  return `http://localhost:${actualPort}/${htmlFile}`;
}

function focusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Su Windows il primo click dopo loadURL va sprecato per portare focus al
  // chrome della finestra invece che al renderer. Forziamo show + focus per
  // far si' che gli input HTML siano editabili al primo click reale.
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
}

function createWindow() {
  const localIP = getPrimaryLocalIP();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false, // mostriamo dopo ready-to-show per evitare flash bianco e focus bug
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      spellcheck: false
    },
    icon: path.join(__dirname, '../public/icon.png'),
    title: 'RPG Initiative Tracker'
  });

  mainWindow.once('ready-to-show', focusWindow);
  // loadFile successivi (cambio pagina): rimettiamo focus sul renderer.
  mainWindow.webContents.on('did-finish-load', focusWindow);

  // Safety net: se entro 8s non abbiamo mai visto ready-to-show (e.g. server
  // down, DNS bloccato, loadURL in timeout) mostriamo comunque la finestra
  // cosi' l'utente vede ALMENO l'error page invece di pensare che l'app sia
  // rotta / non installata.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('⚠️ ready-to-show non arrivato dopo 8s: mostro la finestra comunque.');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 8000);

  // Se il caricamento della pagina fallisce (server morto, porta sbagliata,
  // ecc.) mostriamo una pagina di errore inline invece di una finestra vuota.
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    // -3 = ABORTED (es. redirect interno), lo ignoriamo.
    if (errorCode === -3) return;
    console.error(`❌ did-fail-load [${errorCode}] ${errorDescription} @ ${validatedURL}`);
    mainWindow.loadURL(buildErrorPageDataUrl(errorCode, errorDescription, validatedURL));
    if (!mainWindow.isVisible()) mainWindow.show();
  });

  // CSP: permette connessioni a localhost e all'IP della rete locale
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* http://${localIP}:* https://cdn.socket.io https://fonts.googleapis.com https://fonts.gstatic.com data: blob:; ` +
          `img-src 'self' data: blob: http://localhost:* http://${localIP}:*; ` +
          "font-src 'self' https://fonts.gstatic.com; " +
          `connect-src 'self' http://localhost:* http://${localIP}:* ws://localhost:* ws://${localIP}:* wss://localhost:* wss://${localIP}:*`
        ]
      }
    });
  });

  // Pulizia cache HTTP del renderer per evitare che vecchi room-selector.js / CSS
  // restino in cache dopo un update dell'app installata (causava QR sparito e
  // stili vecchi sopravvissuti agli upgrade).
  mainWindow.webContents.session.clearCache().catch(() => {});

  mainWindow.loadURL(pageUrl('room-selector.html'));

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildErrorPageDataUrl(code, description, url) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const html = `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"><title>Errore — RPG Initiative Tracker</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:#1a1a2e;color:#e8e8f0;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
  .wrap{max-width:640px;margin:10vh auto;padding:2rem;background:#23233a;
    border-radius:12px;border:1px solid #3a3a5a;box-shadow:0 8px 32px rgba(0,0,0,.5)}
  h1{color:#f0c674;margin-top:0}
  code{background:#0f0f1e;padding:2px 6px;border-radius:4px;color:#c5c5ff}
  ul{line-height:1.8}
  .btn{display:inline-block;margin-top:1rem;padding:.6rem 1.2rem;background:#f0c674;
    color:#1a1a2e;border-radius:6px;text-decoration:none;font-weight:bold;cursor:pointer;border:none}
</style></head>
<body><div class="wrap">
<h1>Impossibile avviare il server interno</h1>
<p>RPG Initiative Tracker non è riuscito a caricare la sua pagina iniziale.</p>
<p><strong>Dettagli tecnici:</strong><br>
Codice: <code>${safe(code)}</code><br>
Descrizione: <code>${safe(description)}</code><br>
URL: <code>${safe(url)}</code></p>
<p><strong>Cause più comuni:</strong></p>
<ul>
  <li>Un altro processo (spesso <code>node.exe</code> rimasto aperto da una sessione di sviluppo) sta usando la porta <code>${actualPort}</code>.</li>
  <li>Un firewall o antivirus blocca <code>localhost</code>.</li>
  <li>Una istanza zombie dell'app è rimasta viva in background.</li>
</ul>
<p><strong>Cosa fare:</strong></p>
<ul>
  <li>Apri il Task Manager e chiudi eventuali processi <em>Node.js</em> o <em>RPG Initiative Tracker</em>.</li>
  <li>Da PowerShell (come admin): <code>Get-Process node, "RPG Initiative Tracker" | Stop-Process -Force</code></li>
  <li>Riavvia l'applicazione.</li>
</ul>
<button class="btn" onclick="location.reload()">Riprova</button>
</div></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

async function startServer() {
  server = createServer({
    port: PREFERRED_PORT,
    host: '0.0.0.0',
    electronApp: app
  });

  // Loop di retry su porte consecutive: se 3001 e' occupata proviamo 3002..3010
  // cosi' l'app si apre comunque e l'utente non vede una finestra morta.
  let lastErr = null;
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = PREFERRED_PORT + i;
    try {
      const result = await server.listen(port, '0.0.0.0');
      actualPort = result.port;
      const localIP = getPrimaryLocalIP();
      console.log(`✅ Server avviato: http://${localIP}:${actualPort}`);
      console.log(`✅ Server (loopback): http://localhost:${actualPort}`);
      if (actualPort !== PREFERRED_PORT) {
        console.warn(`⚠️ Porta ${PREFERRED_PORT} era occupata, usata ${actualPort} come fallback.`);
      }
      if (mainWindow) {
        mainWindow.webContents.send('server-started', { ip: localIP, port: actualPort });
      }
      return true;
    } catch (err) {
      lastErr = err;
      if (err.code !== 'EADDRINUSE') break; // errore non-porta: fail-fast
      console.warn(`⚠️ Porta ${port} occupata, provo la successiva...`);
      // httpServer dopo un listen fallito va "rigenerato": re-creiamo tutta
      // la factory (altrimenti il socket resta in stato di errore).
      try { await server.close(); } catch (_) {}
      server = createServer({ port: PREFERRED_PORT, host: '0.0.0.0', electronApp: app });
    }
  }

  // Se siamo qui tutte le porte erano occupate (o c'e' stato un altro errore).
  console.error('❌ ERRORE AVVIO SERVER:', lastErr);
  const msg = lastErr && lastErr.code === 'EADDRINUSE'
    ? `Tutte le porte da ${PREFERRED_PORT} a ${PREFERRED_PORT + MAX_PORT_ATTEMPTS - 1} sono occupate.\n\nProbabilmente un processo node.exe è rimasto acceso in background (spesso da una sessione di sviluppo).\n\nApri il Task Manager, chiudi tutti i processi "Node.js" e "RPG Initiative Tracker", poi riavvia l'applicazione.`
    : `Errore inaspettato: ${lastErr ? lastErr.message : 'sconosciuto'}`;
  dialog.showErrorBox('RPG Initiative Tracker — Impossibile avviare', msg);
  return false; // caller: non creare la finestra, basta quittare
}

function setupIPCHandlers() {
  ipcMain.handle('get-rooms', async () => {
    if (!server) throw new Error('Server non inizializzato');
    return server.roomManager.getAllRooms();
  });

  ipcMain.handle('create-room', async (event, name) => {
    if (!server) throw new Error('Server non inizializzato');
    return server.roomManager.createRoom(name);
  });

  ipcMain.handle('delete-room', async (event, roomId) => {
    if (!server) throw new Error('Server non inizializzato');
    server.roomManager.deleteRoom(roomId);
    return { success: true };
  });

  ipcMain.handle('open-room', async (event, roomId, role = 'master') => {
    let page = 'master.html';
    if (role === 'player') page = 'index.html';
    else if (role === 'tablet') page = 'tablet.html';
    mainWindow.loadURL(pageUrl(page) + `?roomId=${encodeURIComponent(roomId)}`);
    return { success: true };
  });

  ipcMain.handle('get-server-ip', async () => {
    return { ip: getPrimaryLocalIP(), ips: getLocalIPs(), port: actualPort };
  });

  ipcMain.handle('get-data-path', async () => {
    if (!server) throw new Error('Server non inizializzato');
    const p = server.paths;
    return {
      basePath: p.dataDir,
      imagesPath: p.imagesBase,
      dbPath: p.dbPath,
      configPath: p.configPath,
      isPackaged: p.isPackaged
    };
  });

  ipcMain.handle('open-data-folder', async () => {
    if (!server) throw new Error('Server non inizializzato');
    await shell.openPath(server.paths.dataDir);
    return { success: true };
  });

  ipcMain.handle('back-to-rooms', async () => {
    mainWindow.loadURL(pageUrl('room-selector.html'));
    return { success: true };
  });

  ipcMain.handle('open-config', async () => {
    mainWindow.loadURL(pageUrl('config.html'));
    return { success: true };
  });

  ipcMain.handle('folder:pick', async (event, opts = {}) => {
    // Default path: la "cartella di lavoro del programma" (userData, dove gia'
    // vivono images/{heroes,enemies,allies,summons}, rooms/, config.json).
    // Da li' l'utente puo' o confermarla o navigare verso una sottocartella di
    // OneDrive/Drive per condividere i dati su piu' PC.
    const defaultPath = opts.defaultPath || (server && server.paths && server.paths.dataDir) || undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || 'Popola cartella di lavoro',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Usa questa cartella'
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, folderPath: result.filePaths[0] };
  });
}

app.whenReady().then(async () => {
  // Server PRIMA della finestra: dobbiamo poter loadURL su http://localhost:PORT.
  const ok = await startServer();
  if (!ok) {
    // startServer() ha gia' mostrato un dialog. Esci subito senza finestra.
    app.exit(1);
    return;
  }
  setupIPCHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Shutdown pulito: blocca app.quit() finche' il server non ha rilasciato
// le porte / socket / handle DB. Senza questo, su Windows il processo
// "RPG Initiative Tracker.exe" puo' restare vivo dopo la chiusura della
// finestra (socket.io connesse + better-sqlite3 handle), bloccando il
// successivo installer di un upgrade.
let isQuitting = false;
app.on('before-quit', (event) => {
  if (isQuitting || !server) return;
  event.preventDefault();
  isQuitting = true;
  (async () => {
    try { await server.close(); } catch (_) {}
    // hard exit per sicurezza (max 2s)
    setTimeout(() => process.exit(0), 2000).unref();
    app.quit();
  })();
});
