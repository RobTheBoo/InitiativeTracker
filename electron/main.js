// Electron main process - thin wrapper sopra src/server/create-server.js.
// Tutta la logica HTTP / Socket.IO / config / DB sta in src/server/.
// Qui restano solo: BrowserWindow, IPC, lifecycle dell'app desktop.

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { createServer } = require('../src/server/create-server');
const { getPrimaryLocalIP, getLocalIPs } = require('../src/server/paths');

let mainWindow = null;
let server = null;
const PORT = parseInt(process.env.PORT || '3001', 10);

function createWindow() {
  const localIP = getPrimaryLocalIP();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    icon: path.join(__dirname, '../public/icon.png'),
    title: 'RPG Initiative Tracker'
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

  mainWindow.loadFile('public/room-selector.html');

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startServer() {
  server = createServer({
    port: PORT,
    host: '0.0.0.0',
    electronApp: app
  });

  try {
    const { port } = await server.listen(PORT, '0.0.0.0');
    const localIP = getPrimaryLocalIP();
    console.log(`✅ Server avviato: http://${localIP}:${port}`);
    console.log(`✅ Server (loopback): http://localhost:${port}`);

    if (mainWindow) {
      mainWindow.webContents.send('server-started', { ip: localIP, port });
    }
  } catch (err) {
    console.error('❌ ERRORE AVVIO SERVER:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Porta ${PORT} già in uso!`);
    }
    if (mainWindow) {
      mainWindow.webContents.send('server-error', { error: err.message, code: err.code });
    }
  }
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
    let page = 'public/master.html';
    if (role === 'player') page = 'public/index.html';
    else if (role === 'tablet') page = 'public/tablet.html';
    mainWindow.loadFile(page, { query: { roomId } });
    return { success: true };
  });

  ipcMain.handle('get-server-ip', async () => {
    return { ip: getPrimaryLocalIP(), ips: getLocalIPs(), port: PORT };
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
    mainWindow.loadFile('public/room-selector.html');
    return { success: true };
  });

  ipcMain.handle('open-config', async () => {
    mainWindow.loadFile('public/config.html');
    return { success: true };
  });

  ipcMain.handle('folder:pick', async (event, opts = {}) => {
    const defaultPath = opts.defaultPath || (server && server.paths && server.paths.dataDir) || undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || 'Seleziona cartella per Importa/Esporta',
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, folderPath: result.filePaths[0] };
  });
}

app.whenReady().then(async () => {
  createWindow();
  await startServer();
  setupIPCHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  if (server) {
    try { await server.close(); } catch (_) {}
  }
});
