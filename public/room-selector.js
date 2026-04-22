// Room Selector - Frontend
let rooms = [];

// Controlla l'ambiente: Electron o Browser
const isElectron = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.isElectron;
const isBrowser = !isElectron;

// Carica stanze all'avvio
async function loadRooms() {
  try {
    if (isElectron) {
      // Electron: usa le API
      console.log('📋 Caricamento stanze tramite API...');
      rooms = await window.electronAPI.getRooms();
      console.log('✅ Stanze caricate:', rooms.length);
    } else {
      // Browser normale: usa fetch diretto
      const response = await fetch('/api/rooms');
      rooms = await response.json();
    }
    renderRooms();
  } catch (error) {
    console.error('❌ Errore caricamento stanze:', error);
    const errorMsg = error.message || 'Errore sconosciuto';
    showServerError(`❌ Impossibile caricare le stanze.\n\nErrore: ${errorMsg}\n\nVerifica:\n1. IP server corretto\n2. Master avviato\n3. Stessa rete Wi-Fi`);
  }
}

// Rendering lista stanze
function renderRooms() {
  const grid = document.getElementById('rooms-grid');
  const emptyState = document.getElementById('empty-state');

  if (rooms.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  
  grid.innerHTML = rooms.map(room => {
    const createdDate = new Date(room.created_at);
    const status = room.status || 'waiting';
    const statusText = {
      'waiting': 'In attesa',
      'active': 'In corso',
      'completed': 'Completato'
    }[status] || 'In attesa';

    return `
      <div class="room-card" onclick="openRoom('${room.id}')">
        <div class="room-card-header">
          <div>
            <div class="room-name">${room.name}</div>
            <span class="room-status ${status}">${statusText}</span>
          </div>
        </div>
        <div class="room-info">
          📅 Creata: ${createdDate.toLocaleDateString('it-IT')}
        </div>
        <div class="room-info">
          🎲 Round: ${room.current_round || 1}
        </div>
        <div class="room-actions" onclick="event.stopPropagation()">
          <button class="btn small primary" onclick="openRoom('${room.id}')">
            Apri
          </button>
          <button class="btn small danger" onclick="deleteRoom('${room.id}')">
            Elimina
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Crea nuova stanza
async function createRoom() {
  const nameInput = document.getElementById('room-name-input');
  const name = nameInput.value.trim();

  if (!name) {
    alert('Inserisci un nome per la stanza');
    return;
  }

  try {
    if (isElectron) {
      // Electron: usa le API
      await window.electronAPI.createRoom(name);
    } else {
      // Browser normale: usa fetch diretto
      await fetch('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    }

    nameInput.value = '';
    await loadRooms();
  } catch (error) {
    console.error('Errore creazione stanza:', error);
    alert('Errore durante la creazione della stanza');
  }
}

// Apri stanza come master (dal room-selector)
async function openRoom(roomId) {
  try {
    if (isElectron) {
      // Electron: usa le API
      await window.electronAPI.openRoom(roomId, 'master');
    } else {
      // In browser, reindirizza a master.html con query param
      window.location.href = `/master.html?roomId=${roomId}`;
    }
  } catch (error) {
    console.error('Errore apertura stanza:', error);
  }
}

// Elimina stanza
async function deleteRoom(roomId) {
  if (!confirm('Sei sicuro di voler eliminare questa stanza?')) {
    return;
  }

  try {
    if (isElectron) {
      // Electron: usa le API
      await window.electronAPI.deleteRoom(roomId);
    } else {
      // Browser normale: usa fetch diretto
      await fetch(`/api/rooms/${roomId}`, { method: 'DELETE' });
    }

    await loadRooms();
  } catch (error) {
    console.error('Errore eliminazione stanza:', error);
    alert('Errore durante l\'eliminazione della stanza');
  }
}

// Apri pagina configurazione (solo per Master/Electron, non per giocatori mobile)
async function openConfig() {
  // Apri configurazione unificata (stesso menù per tutti)
  try {
    if (window.electronAPI && window.electronAPI.isElectron) {
      // In Electron, apri config.html
      if (window.electronAPI.openConfig) {
        await window.electronAPI.openConfig();
      } else {
        // Fallback: in browser, reindirizza a config.html
        window.location.href = '/config.html';
      }
    } else {
      // In browser/mobile, reindirizza a config.html
      // I tab verranno mostrati/nascosti automaticamente in base al ruolo
      window.location.href = '/config.html';
    }
  } catch (error) {
    console.error('Errore apertura configurazione:', error);
    window.location.href = '/config.html';
  }
}

// Mostra pulsanti configurazione e percorso dati
function setupMasterButtons() {
  // Il pulsante configurazione è sempre visibile (per tutti)
  const configBtn = document.getElementById('config-btn');
  if (configBtn) configBtn.style.display = 'block';
  
  // Il pulsante percorso dati è solo per Master (Electron)
  if (window.electronAPI && window.electronAPI.isElectron) {
    const dataPathBtn = document.getElementById('data-path-btn');
    if (dataPathBtn) dataPathBtn.style.display = 'block';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupMasterButtons);
} else {
  setupMasterButtons();
}

// Mostra percorso dati
async function showDataPath() {
  try {
    if (window.electronAPI && window.electronAPI.getDataPath) {
      const paths = await window.electronAPI.getDataPath();
      let message = '📁 Percorsi dati:\n\n';
      if (paths.isPackaged) {
        message += '📍 Base: ' + paths.basePath + '\n\n';
        message += '🖼️ Immagini: ' + paths.imagesPath + '\n';
        message += '   - heroes/\n';
        message += '   - enemies/\n';
        message += '   - allies/\n\n';
        message += '💾 Database: ' + paths.dbPath + '\n\n';
        message += '⚙️ Config: ' + paths.configPath + '\n\n';
        message += '💡 I file sono nella stessa cartella dell\'eseguibile.';
      } else {
        message += '📍 Base progetto: ' + paths.basePath + '\n\n';
        message += '🖼️ Immagini: ' + paths.imagesPath + '\n\n';
        message += '💾 Database: ' + paths.dbPath + '\n\n';
        message += '⚙️ Config: ' + paths.configPath;
      }
      alert(message);
    } else {
      alert('Questa funzione è disponibile solo nella versione Electron (Master).');
    }
  } catch (error) {
    console.error('Errore recupero percorso:', error);
    alert('Errore nel recupero del percorso dati.');
  }
}

window.showDataPath = showDataPath;

// Carica IP server (stesso URL del tablet, quello a cui si connettono i giocatori)
async function loadServerIP() {
  try {
    const errorDiv = document.getElementById('server-error');
    if (errorDiv) errorDiv.style.display = 'none';
    
    const serverIpElement = document.getElementById('server-ip');
    if (!serverIpElement) {
      console.error('Elemento server-ip non trovato');
      return;
    }

    // Imposta subito un valore di fallback visibile (almeno localhost)
    // così non rimane mai "Caricamento..." se qualcosa va storto
    serverIpElement.textContent = 'http://localhost:3001';
    
    if (isElectron) {
      // Electron: usa le API
      try {
        console.log('🔍 Richiesta IP server...');
        const { ip, port } = await window.electronAPI.getServerIP();
        console.log('✅ IP ricevuto:', ip, port);
        
        // Mostra l'URL completo a cui i giocatori si connettono (stesso del tablet)
        const serverUrl = `http://${ip}:${port}`;
        serverIpElement.textContent = serverUrl;
        console.log('📡 Server URL impostato:', serverUrl);
        
        // Electron non ha bisogno di testare la connessione (è il server stesso)
        if (false) {
          testServerConnection(serverUrl).catch(err => {
            console.warn('⚠️ Test connessione fallito (non critico):', err);
          });
        }
      } catch (error) {
        console.error('❌ Errore caricamento IP:', error);
        // Fallback: mostra almeno localhost
        serverIpElement.textContent = 'http://localhost:3001';
        if (errorDiv) {
          showServerError('Impossibile trovare l\'IP di rete. Usa localhost o inserisci manualmente l\'IP del Master.');
        }
      }
    } else {
      // In browser, usa l'URL corrente
      serverIpElement.textContent = window.location.origin;
    }
  } catch (error) {
    console.error('❌ Errore generale loadServerIP:', error);
    const serverIpElement = document.getElementById('server-ip');
    if (serverIpElement) {
      serverIpElement.textContent = 'Errore';
    }
    const errorDiv = document.getElementById('server-error');
    if (errorDiv) {
      showServerError('Errore nel caricamento dell\'IP del server.');
    }
  }
}

// Testa la connessione al server
async function testServerConnection(serverUrl) {
  try {
    console.log('🔍 Test connessione a:', serverUrl);
    const response = await fetch(`${serverUrl}/api/rooms`, {
      method: 'GET',
      signal: AbortSignal.timeout(60000) // Timeout 60 secondi per mobile
    });
    
    if (response.ok) {
      const errorDiv = document.getElementById('server-error');
      if (errorDiv) errorDiv.style.display = 'none';
      console.log('✅ Connessione al server OK');
      return true;
    } else {
      throw new Error(`Server risponde con status ${response.status}`);
    }
  } catch (error) {
    console.error('❌ Errore connessione server:', error);
    if (error.name === 'AbortError') {
      throw new Error('Timeout: il server non risponde. Verifica l\'IP e che il Master sia avviato.');
    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('Impossibile raggiungere il server. Verifica:\n1. IP corretto\n2. Master avviato\n3. Stessa rete Wi-Fi\n4. Firewall non blocca la porta 3000');
    } else {
      throw error;
    }
  }
}

// Mostra errore server
function showServerError(message) {
  const errorDiv = document.getElementById('server-error');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
}

// Connetti manualmente al server
async function connectToServer() {
  const input = document.getElementById('manual-server-input');
  const errorDiv = document.getElementById('server-error');
  let serverUrl = input.value.trim();
  
  if (!serverUrl) {
    alert('Inserisci l\'IP del server (es: 192.168.1.27:3000)');
    return;
  }
  
  // Mostra messaggio di connessione
  if (errorDiv) {
    errorDiv.textContent = '🔄 Connessione in corso...';
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#ffd700';
  }
  
  // Aggiungi http:// se mancante
  if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
    serverUrl = `http://${serverUrl}`;
  }
  
  // Aggiungi porta se mancante
  if (!serverUrl.includes(':')) {
    serverUrl = `${serverUrl}:3000`;
  }
  
  console.log('🔌 Tentativo connessione a:', serverUrl);
  
  try {
    // Testa la connessione
    console.log('📡 Test connessione...');
    await testServerConnection(serverUrl);
    console.log('✅ Test connessione OK');
    
    // Salva in localStorage
    localStorage.setItem('serverUrl', serverUrl);
    console.log('💾 Server URL salvato in localStorage:', serverUrl);
    
    // Aggiorna display
    document.getElementById('server-ip').textContent = serverUrl;
    input.value = '';
    
    // Nascondi errori
    if (errorDiv) {
      errorDiv.style.display = 'none';
    }
    
    // Ricarica stanze
    console.log('📋 Ricarico stanze...');
    await loadRooms();
    console.log('✅ Stanze caricate');
    
    // In browser, ricarica la pagina per applicare il nuovo IP a tutti i socket
    if (!isElectron) {
      alert('✅ Connesso al server con successo!\n\nLa pagina verrà ricaricata per applicare la connessione.');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } else {
      alert('✅ Connesso al server con successo!');
    }
  } catch (error) {
    console.error('❌ Errore connessione:', error);
    showServerError('❌ Impossibile connettersi al server.\n\nVerifica:\n1. IP corretto (es: 192.168.1.27:3000)\n2. Master avviato\n3. Stessa rete Wi-Fi\n4. Firewall Windows disabilitato');
  }
}

// Riprova network discovery
async function retryDiscovery() {
  const errorDiv = document.getElementById('server-error');
  errorDiv.style.display = 'none';
  document.getElementById('server-ip').textContent = 'Ricerca in corso...';
  
  // Nessuna azione necessaria (solo per browser/Electron ora)
  if (false) {
    try {
      // Forza nuova ricerca
      localStorage.removeItem('serverUrl');
      
      const { ip, port } = await window.electronAPI.getServerIP();
      const serverUrl = `http://${ip}:${port}`;
      
      await testServerConnection(serverUrl);
      document.getElementById('server-ip').textContent = serverUrl;
      
      // Ricarica stanze
      await loadRooms();
    } catch (error) {
      console.error('Errore discovery:', error);
      showServerError('⚠️ Server non trovato automaticamente. Inserisci manualmente l\'IP del Master.');
      document.getElementById('server-ip').textContent = 'Non trovato';
    }
  }
}

// Event Listeners
const createRoomBtn = document.getElementById('create-room-btn');
if (createRoomBtn) createRoomBtn.addEventListener('click', createRoom);

const roomNameInput = document.getElementById('room-name-input');
if (roomNameInput) {
  roomNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createRoom();
  });
}

// Event listeners per connessione server (solo se i pulsanti esistono nell'HTML)
const connectServerBtn = document.getElementById('connect-server-btn');
if (connectServerBtn) connectServerBtn.addEventListener('click', connectToServer);
const retryDiscoveryBtn = document.getElementById('retry-discovery-btn');
if (retryDiscoveryBtn) retryDiscoveryBtn.addEventListener('click', retryDiscovery);
const manualServerInput = document.getElementById('manual-server-input');
if (manualServerInput) {
  manualServerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') connectToServer();
  });
}

// Se siamo in Electron, ascolta evento server avviato
if (isElectron) {
  window.electronAPI.onServerStarted((data) => {
    console.log('📡 Evento server-started ricevuto:', data);
    const serverIpElement = document.getElementById('server-ip');
    if (serverIpElement) {
      const serverUrl = `http://${data.ip}:${data.port}`;
      serverIpElement.textContent = serverUrl;
      console.log('✅ Server IP aggiornato:', serverUrl);
      
      // Nascondi eventuali errori
      const errorDiv = document.getElementById('server-error');
      if (errorDiv) errorDiv.style.display = 'none';
    }
  });
}

// Inizializzazione
loadRooms();

// Carica IP server con retry multipli per assicurarsi che il server sia avviato
let ipLoadAttempts = 0;
const maxAttempts = 5;

function tryLoadServerIP() {
  ipLoadAttempts++;
  const serverIpElement = document.getElementById('server-ip');
  
  // Assicurati che almeno localhost sia sempre visibile
  if (serverIpElement && serverIpElement.textContent === 'Caricamento...') {
    serverIpElement.textContent = 'http://localhost:3001';
  }
  
  if (isElectron && window.electronAPI && window.electronAPI.getServerIP) {
    loadServerIP().catch(err => {
      console.warn('⚠️ Tentativo caricamento IP fallito:', err);
      if (ipLoadAttempts < maxAttempts) {
        setTimeout(tryLoadServerIP, 1000);
      }
    });
  } else if (ipLoadAttempts < maxAttempts) {
    // Se Electron API non è ancora disponibile, riprova
    setTimeout(tryLoadServerIP, 500);
  }
}

// Primo tentativo immediato
tryLoadServerIP();

