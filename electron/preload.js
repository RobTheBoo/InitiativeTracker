const { contextBridge, ipcRenderer } = require('electron');

// Espone API sicure al renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Gestione stanze
  getRooms: () => ipcRenderer.invoke('get-rooms'),
  createRoom: (name) => ipcRenderer.invoke('create-room', name),
  deleteRoom: (roomId) => ipcRenderer.invoke('delete-room', roomId),
  openRoom: (roomId, role) => ipcRenderer.invoke('open-room', roomId, role),
  backToRooms: () => ipcRenderer.invoke('back-to-rooms'),
  openConfig: () => ipcRenderer.invoke('open-config'),
  
  // Info server
  getServerIP: () => ipcRenderer.invoke('get-server-ip'),
  
  // Percorso dati
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  
  // Folder picker per Importa/Esporta cartella sincronizzata
  pickFolder: (opts) => ipcRenderer.invoke('folder:pick', opts || {}),
  
  // Eventi
  onServerStarted: (callback) => ipcRenderer.on('server-started', (event, data) => callback(data)),
  
  // Check se siamo in Electron
  isElectron: true
});

