// Vista Giocatore - app.js

// Evita schermata bianca: se Socket.IO non è caricato (es. WebView Android), mostra errore
if (typeof io === 'undefined') {
  document.body.innerHTML = '<div style="padding:20px;font-family:sans-serif;text-align:center;color:#fff;background:#111;">' +
    '<h2>Errore caricamento</h2><p>Socket.IO non disponibile. Controlla che il file socket.io.min.js sia presente.</p></div>';
  throw new Error('Socket.IO non caricato');
}

// Definisci connectToServerHandler PRIMA di tutto, così è disponibile immediatamente
window.connectToServerHandler = async function(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Trova gli elementi quando necessario (potrebbero non esistere ancora)
  const ipInput = document.getElementById('server-ip-input');
  const connectBtn = document.getElementById('connect-ip-btn');
  const statusDiv = document.getElementById('server-ip-status');
  const debugArea = document.getElementById('debug-area');
  const debugContent = document.getElementById('debug-content');
  
  if (!ipInput) {
    alert('⚠️ Campo IP non trovato. Ricarica la pagina.');
    return;
  }
  
  if (!connectBtn) {
    alert('⚠️ Pulsante Connetti non trovato. Ricarica la pagina.');
    return;
  }
  
  const serverInput = ipInput.value.trim();
  
  if (!serverInput) {
    alert('⚠️ Inserisci l\'IP del server (es: 192.168.1.27:3001)');
    return;
  }
  
  // Mostra stato di connessione
  if (statusDiv) {
    statusDiv.innerHTML = '<span style="color: #ffd700;">🔄 Connessione in corso...</span>';
  }
  
  try {
    // Costruisci URL completo
    let serverUrl = serverInput;
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = `http://${serverUrl}`;
    }
    
    // Assicurati che ci sia la porta (Electron usa 3001)
    try {
      const u = new URL(serverUrl);
      if (!u.port || u.port === '') {
        serverUrl = u.origin + ':' + '3001' + (u.pathname !== '/' ? u.pathname : '');
      }
    } catch (_) {
      if (!serverUrl.match(/:\d+$/)) serverUrl = serverUrl.replace(/\/?$/, '') + ':3001';
    }
    
    console.log('🔌 Tentativo connessione a:', serverUrl);
    if (debugContent) {
      debugContent.textContent = `🔄 Connessione a: ${serverUrl}\n(attendi fino a 15 sec...)`;
    }
    
    // Testa la connessione (timeout 15s per reti lente)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(`${serverUrl}/api/rooms`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Server risponde con status ${response.status}`);
    }
    
    // Salva URL e vai alla pagina con param ?server= per creare il socket con URL corretto
    localStorage.setItem('serverUrl', serverUrl);
    console.log('💾 Server URL salvato, ricarico per connettere il socket:', serverUrl);
    
    if (statusDiv) {
      statusDiv.innerHTML = `<span style="color: #51cf66;">✅ Connesso! Ricarico...</span>`;
    }
    if (debugContent) {
      debugContent.textContent = `✅ Connesso a: ${serverUrl}\n🔄 Ricarico per attivare la connessione...`;
    }
    
    window.location.search = '?server=' + encodeURIComponent(serverUrl);
    
  } catch (error) {
    console.error('❌ Errore connessione:', error);
    
    const isFailedFetch = (error.message || '').toLowerCase().includes('failed to fetch');
    const shortMsg = isFailedFetch
      ? 'Rete non raggiungibile (vedi sotto)'
      : (error.message || 'Impossibile connettersi');
    
    if (statusDiv) {
      statusDiv.innerHTML = `<span style="color: #ff6b6b;">❌ ${shortMsg}</span>`;
    }
    
    if (debugContent) {
      let errorMsg = `❌ Errore connessione\n`;
      errorMsg += `URL tentato: ${serverUrl}\n`;
      if (error.name === 'AbortError') {
        errorMsg += `Timeout: nessuna risposta in 15 secondi.\n`;
      } else {
        errorMsg += `Messaggio: ${error.message}\n`;
      }
      errorMsg += `\n--- TEST RAPIDO SUL TELEFONO ---\n`;
      errorMsg += `Apri Chrome e vai su:\n${serverUrl}/api/rooms\n`;
      errorMsg += `Se non si apre → firewall/rete. Sul PC: APRI-FIREWALL.bat (tasto destro = Esegui come amministratore). Stessa Wi‑Fi.\n`;
      errorMsg += `\nGuida completa: CONNESSIONE-TELEFONO.txt nella cartella del progetto.\n`;
      debugContent.textContent = errorMsg;
    }
    
    // In APK/WebView il modal non si chiude bene (OK non risponde) → non usarlo su Capacitor
    const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (!isCapacitor) {
      showConnectionErrorModal(
        'Errore: ' + (error.message || 'Impossibile connettersi') + '\n\n' +
        'Verifica: IP corretto (emulatore 10.0.2.2:3001, telefono 192.168.x.x:3001), Master avviato, stessa rete Wi-Fi, firewall porta 3001.'
      );
    }
  }
};

// Auto-discovery: prova a trovare il server master sulla LAN senza inserire l'IP a mano.
// Strategie:
//  1. mDNS hostname "rpg-tracker.local" (funziona su iPhone/iPad nativo, su Android moderno
//     funziona se il telefono supporta mDNS - molti lo fanno via NSD service)
//  2. Se conosciamo il subnet del telefono via WebRTC (cosa rara), provarlo
//  3. Lista di candidati comuni: IP gateway -> .1, .2, .254, ecc.
window.tryAutoDiscover = async function() {
  const ipInput = document.getElementById('server-ip-input');
  const statusDiv = document.getElementById('server-ip-status');
  const debugContent = document.getElementById('debug-content');

  if (statusDiv) statusDiv.innerHTML = '<span style="color:#ffd700;">🔍 Sto cercando il Master sulla rete...</span>';

  const candidates = [
    'rpg-tracker.local:3001',
    'rpg-tracker:3001'
  ];

  // Aggiungi candidati basati sull'IP corrente (se siamo gia' su una rete locale via PWA)
  try {
    const here = window.location.hostname;
    if (here && /^\d+\.\d+\.\d+\.\d+$/.test(here)) {
      const parts = here.split('.');
      // Stessa subnet: prova .1, .254
      for (const last of [1, 254]) {
        candidates.push(`${parts[0]}.${parts[1]}.${parts[2]}.${last}:3001`);
      }
    }
  } catch (_) {}

  for (const cand of candidates) {
    const url = `http://${cand}`;
    if (debugContent) debugContent.textContent = '🔍 Provo: ' + url;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        if (ipInput) ipInput.value = cand;
        if (statusDiv) statusDiv.innerHTML = `<span style="color:#51cf66;">✅ Trovato: ${cand}</span>`;
        if (debugContent) debugContent.textContent = '✅ Master trovato a ' + url + '\nClicca "Connetti" per procedere.';
        return cand;
      }
    } catch (_) { /* prossimo candidato */ }
  }

  if (statusDiv) statusDiv.innerHTML = '<span style="color:#ff6b6b;">❌ Nessun Master trovato. Inserisci l\'IP manualmente o scansiona il QR.</span>';
  if (debugContent) debugContent.textContent = '❌ Auto-discovery fallita.\nProva: rpg-tracker.local:3001\nOppure leggi l\'IP dalla schermata del Master.';
  return null;
};

// Apri scanner QR (placeholder, per ora apre solo la fotocamera del telefono se nativo)
window.openQrScanner = function() {
  alert('Scanner QR: prossima versione. Per ora inquadra il QR sul Master e leggi l\'IP, poi inseriscilo qui.');
};

// Funzione per adattare l'altezza del viewport su Android
function adjustViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

// Adatta l'altezza al caricamento e al resize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', adjustViewportHeight);
} else {
  adjustViewportHeight();
}

window.addEventListener('resize', adjustViewportHeight);
window.addEventListener('orientationchange', () => {
  setTimeout(adjustViewportHeight, 100);
});
// Determina l'URL del server
let socketUrl = '';
// App Android/iOS (Capacitor): l'app chiederà l'URL ogni volta; dopo "Connetti" usiamo sessionStorage per ricaricare con URL corretto
const isCapacitorApp = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
if (window.electronAPI && window.electronAPI.isElectron) {
  socketUrl = 'http://localhost:3001';
} else if (isCapacitorApp) {
  const urlParams = new URLSearchParams(window.location.search);
  const serverParam = urlParams.get('server');
  if (serverParam) {
    socketUrl = decodeURIComponent(serverParam);
    localStorage.setItem('serverUrl', socketUrl);
  } else {
    const fromStorage = localStorage.getItem('serverUrl');
    socketUrl = fromStorage || '';
  }
} else {
  socketUrl = window.location.origin;
}
// clientId persistente: identifica l'utente attraverso refresh, riavvii del browser, riconnessioni.
// Senza questo, se il giocatore ricarica la pagina perde l'eroe (il server vede un nuovo socket).
function getOrCreateClientId() {
  let id = localStorage.getItem('rpgClientId');
  if (!id) {
    if (window.crypto && window.crypto.randomUUID) {
      id = window.crypto.randomUUID();
    } else {
      id = 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
    }
    localStorage.setItem('rpgClientId', id);
  }
  return id;
}
const CLIENT_ID = getOrCreateClientId();
console.log('🆔 clientId:', CLIENT_ID.slice(0, 8) + '…');

// Su Capacitor senza server: non creare il socket (evita modal errore all'avvio). Si creerà dopo "Connetti" con ?server=
let socket;
if (isCapacitorApp && !socketUrl) {
  socket = { on: function() { return this; }, emit: function() { return this; }, id: null, connected: false };
} else {
  const socketConnectUrl = socketUrl || 'http://127.0.0.1:9999';
  socket = io(socketConnectUrl, {
    auth: { clientId: CLIENT_ID },
    query: { clientId: CLIENT_ID },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    reconnectionAttempts: Infinity,
    transports: ['websocket', 'polling']
  });
}
window.socket = socket;

// Stato locale
let gameState = null;
let myHeroId = null;
let availableSummons = [];
let availableEffects = [];

// Carica personaggio salvato (per riconnessione)
function loadSavedHero() {
  return localStorage.getItem('myHeroId');
}

// Salva personaggio scelto
function saveHero(heroId) {
  localStorage.setItem('myHeroId', heroId);
  myHeroId = heroId;
}

// Rimuovi personaggio salvato
function clearSavedHero() {
  localStorage.removeItem('myHeroId');
  myHeroId = null;
}

// Elementi DOM
const screens = {
  roomSelection: document.getElementById('room-selection'),
  selection: document.getElementById('character-selection'),
  player: document.getElementById('player-screen'),
  combat: document.getElementById('combat-screen')
};

// Mostra una schermata
function showScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[screenName]) {
    screens[screenName].classList.add('active');
    
    // Assicurati che la finestra abbia il focus (utile in Electron)
    if (window.focus) {
      window.focus();
    }
  }
}

// Helper per renderizzare ritratto (immagine o icona)
function renderPortrait(char, size = 'normal') {
  if (char.image) {
    // Assicurati che il percorso sia assoluto e punti al server
    const imagePath = char.image.startsWith('/') ? char.image : `/${char.image}`;
    // Se non è già un URL completo, aggiungi socketUrl
    const fullPath = imagePath.startsWith('http') ? imagePath : `${socketUrl}${imagePath}`;
    // Usa l'icona corretta come fallback: 👹 per nemici, 🤝 per alleati, 🔮 per evocazioni, 👤 per eroi
    const fallbackIcon = char.isEnemy ? '👹' : (char.isAlly ? '🤝' : (char.isSummon ? '🔮' : (char.icon || '👤')));
    return `<img src="${fullPath}" alt="${char.name}" class="portrait-img ${size}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';"><span style="display:none;">${fallbackIcon}</span>`;
  }
  // Se non c'è immagine, mostra l'icona corretta: 👹 per nemici, 🤝 per alleati, 🔮 per evocazioni, 👤 per eroi
  const defaultIcon = char.isEnemy ? '👹' : (char.isAlly ? '🤝' : (char.isSummon ? '🔮' : (char.icon || '👤')));
  return `<span class="placeholder-icon">${defaultIcon}</span>`;
}


// Rendering griglia selezione personaggi
function renderCharacterGrid() {
  if (!gameState) {
    console.warn('⚠️ renderCharacterGrid: gameState non disponibile');
    return;
  }
  
  if (!gameState.heroes || gameState.heroes.length === 0) {
    console.warn('⚠️ renderCharacterGrid: Nessun eroe disponibile');
    return;
  }
  
  const grid = document.getElementById('character-grid');
  if (!grid) {
    console.error('❌ renderCharacterGrid: character-grid non trovato nel DOM');
    return;
  }
  
  console.log('🎨 renderCharacterGrid: Rendering', gameState.heroes.length, 'eroi');
  grid.innerHTML = gameState.heroes.map(hero => {
    const isTaken = hero.ownerId !== null;
    const isMine = hero.ownerId === socket.id;
    
    return `
      <div class="character-card ${isTaken ? 'taken' : ''} ${isMine ? 'mine' : ''}" 
           data-id="${hero.id}"
           onclick="selectCharacter('${hero.id}')">
        ${isTaken && !isMine ? '<span class="taken-badge">Occupato</span>' : ''}
        <div class="character-portrait">
          ${renderPortrait(hero)}
        </div>
        <h3>${hero.name}</h3>
        ${hero.initiative !== null ? `<span class="init-preview">Init: ${Math.floor(hero.initiative)}</span>` : ''}
      </div>
    `;
  }).join('');
}

// Seleziona personaggio
function selectCharacter(heroId) {
  console.log('🎯 Tentativo selezione personaggio:', heroId);
  console.log('🔌 Socket connesso:', socket.connected);
  console.log('📊 GameState disponibile:', !!gameState);
  
  if (!socket.connected) {
    console.error('❌ Socket non connesso! Attendo connessione...');
    alert('Connessione al server non ancora stabilita. Riprova tra un momento.');
    return;
  }
  
  if (!gameState) {
    console.error('❌ GameState non disponibile!');
    alert('Stato del gioco non ancora caricato. Attendi...');
    return;
  }
  
  const hero = gameState.heroes.find(h => h.id === heroId);
  console.log('👤 Eroe trovato:', hero);
  
  if (!hero) {
    console.error('❌ Eroe non trovato:', heroId);
    alert('Personaggio non trovato!');
    return;
  }
  
  if (hero.ownerId && hero.ownerId !== socket.id) {
    console.warn('⚠️ Eroe attualmente preso da:', hero.ownerId, '— sovrascrivo (modalità "tra di noi")');
  }
  
  console.log('✅ Invio claimHero per:', heroId);
  socket.emit('claimHero', heroId);
  saveHero(heroId);
  console.log('💾 Personaggio salvato in localStorage');
}
window.selectCharacter = selectCharacter;

// Prova a riconnettersi al personaggio salvato
function tryReconnect() {
  const savedHeroId = loadSavedHero();
  if (savedHeroId && gameState) {
    const hero = gameState.heroes.find(h => h.id === savedHeroId);
    if (hero) {
      // Prova sempre a riprendere lo stesso eroe, anche se è ancora segnato come occupato
      // (potrebbe essere ancora il nostro se ci siamo appena riconnessi dopo una disconnessione)
      // Il server gestirà se è già occupato da qualcun altro
      console.log(`🔄 Tentativo di riconnessione a ${hero.name} (ID: ${savedHeroId})`);
      socket.emit('claimHero', savedHeroId);
      // NON impostare myHeroId qui - aspetta che il server confermi tramite gameState
    } else {
      // Il personaggio non esiste più
      console.warn(`⚠️ Personaggio salvato ${savedHeroId} non trovato nel gameState`);
      clearSavedHero();
    }
  }
}

// Rendering schermata giocatore
function renderPlayerScreen() {
  if (!gameState || !myHeroId) return;
  
  const myHero = gameState.heroes.find(h => h.id === myHeroId);
  if (!myHero) return;
  
  // Aggiorna info personaggio
  const portrait = document.getElementById('my-portrait');
  portrait.innerHTML = renderPortrait(myHero, 'large');
  
  const nameInput = document.getElementById('my-character-name');
  if (document.activeElement !== nameInput) {
    nameInput.value = myHero.name;
  }
  
  const initInput = document.getElementById('initiative-input');
  if (myHero.initiative !== null && document.activeElement !== initInput) {
    initInput.value = Math.floor(myHero.initiative);
  }
  
  // Lista effetti personali
  renderEffectsList('my-effects-list', myHero.effects, myHeroId);
  
  // Effetti ad area
  renderAreaEffects('area-effects-list');
  
  // Evocazioni
  renderSummons('summons-list');
}

// Determina se è bonus o malus
function isEffectBonus(effect) {
  if (effect.isBonus !== undefined) return effect.isBonus;
  if (effect.value !== undefined) return effect.value >= 0;
  return true;
}

// Rendering effetti
function renderEffectsList(containerId, effects, targetId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (effects.length === 0) {
    container.innerHTML = '<div class="no-effects">Nessun effetto attivo</div>';
    return;
  }
  
  container.innerHTML = effects.map(effect => {
    const isBonus = isEffectBonus(effect);
    return `
      <div class="effect-tag ${isBonus ? 'bonus' : 'malus'}">
        <span class="effect-sign">${isBonus ? '+' : '-'}</span>
        <span class="effect-info">
          <strong>${effect.name}</strong>
        </span>
        <span class="effect-rounds">${effect.remainingRounds} rnd</span>
        <button class="remove-effect-btn" onclick="removeEffect('${targetId}', '${effect.id}')">×</button>
      </div>
    `;
  }).join('');
}

// Rendering effetti ad area
function renderAreaEffects(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (gameState.areaEffects.length === 0) {
    container.innerHTML = '<div class="no-effects">Nessun effetto ad area</div>';
    return;
  }
  
  container.innerHTML = gameState.areaEffects.map(effect => `
    <div class="effect-tag area">
      <span class="effect-info">
        <strong>${effect.name}</strong>
        <span class="effect-creator">da ${effect.creatorName}</span>
      </span>
      <span class="effect-rounds">${effect.remainingRounds} rnd</span>
      ${effect.createdBy === socket.id ? 
        `<button class="remove-effect-btn" onclick="removeAreaEffect('${effect.id}')">×</button>` : 
        ''}
    </div>
  `).join('');
}

// Carica effetti disponibili
async function loadEffects() {
  try {
    const response = await fetch(`${socketUrl}/api/config/effects`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    availableEffects = await response.json();
    console.log(`✅ Caricati ${availableEffects.length} effetti disponibili:`, availableEffects);
    updateEffectDatalist();
  } catch (e) {
    console.error('❌ Errore caricamento effetti:', e);
    availableEffects = [];
    updateEffectDatalist();
  }
}

// Aggiorna datalist degli effetti
function updateEffectDatalist() {
  let datalist = document.getElementById('effects-datalist');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'effects-datalist';
    document.body.appendChild(datalist);
  }
  
  // Ordina gli effetti alfabeticamente
  const sortedEffects = [...availableEffects].sort((a, b) => {
    return a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
  });
  
  datalist.innerHTML = sortedEffects.map(effect => 
    `<option value="${effect.name}">`
  ).join('');
  
  document.querySelectorAll('input[list="effects-datalist"]').forEach(input => {
    if (!input.getAttribute('list')) {
      input.setAttribute('list', 'effects-datalist');
    }
  });
  ensureEffectPickers();
}

// Picker effetto: suggerimenti sotto il campo mentre si digita + pulsante ▼ (solo click seleziona, scroll non seleziona)
let _effectPickerLastOpen = 0;
const TAP_MOVE_THRESHOLD = 15;

function getSortedEffects() {
  return [...(availableEffects || [])].sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
}

function filterEffectsByQuery(effects, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return effects;
  return effects.filter(e => e.name.toLowerCase().includes(q));
}

function fillEffectPickerPanel(panel, input) {
  const effects = getSortedEffects();
  const filtered = filterEffectsByQuery(effects, input ? input.value : '');
  panel.innerHTML = filtered.length
    ? filtered.map(e => `<div class="effect-picker-option" data-name="${escapeAttr(e.name)}">${escapeHtml(e.name)}</div>`).join('')
    : '<div class="effect-picker-empty">Nessun effetto in elenco</div>';
}

function ensureEffectPickers() {
  const sortedEffects = getSortedEffects();
  document.querySelectorAll('input[list="effects-datalist"]').forEach(input => {
    let wrap = input.closest('.effect-input-with-picker');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'effect-input-with-picker';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'effect-picker-btn';
      btn.title = 'Scegli da elenco';
      btn.textContent = '▼';
      const panel = document.createElement('div');
      panel.className = 'effect-picker-panel';
      wrap.appendChild(btn);
      wrap.appendChild(panel);
      function openPicker(showAll) {
        _effectPickerLastOpen = Date.now();
        fillEffectPickerPanel(panel, showAll ? null : input);
        panel.classList.add('open');
        document.querySelectorAll('.effect-picker-panel.open').forEach(p => { if (p !== panel) p.classList.remove('open'); });
      }
      function onPickerBtn(e) {
        e.preventDefault();
        e.stopPropagation();
        if (panel.classList.contains('open')) {
          panel.classList.remove('open');
          return;
        }
        openPicker(true);
      }
      btn.addEventListener('click', onPickerBtn);
      btn.addEventListener('touchend', onPickerBtn, { passive: false });
      input.addEventListener('focus', () => {
        openPicker(false);
      });
      input.addEventListener('input', () => {
        fillEffectPickerPanel(panel, input);
        if (!panel.classList.contains('open')) panel.classList.add('open');
      });
      // Solo click seleziona (scroll nel panel non deve selezionare)
      panel.addEventListener('click', (e) => {
        const opt = e.target.closest('.effect-picker-option');
        if (!opt) return;
        input.value = opt.dataset.name || opt.textContent;
        panel.classList.remove('open');
      });
    }
    const panel = wrap.querySelector('.effect-picker-panel');
    if (panel) fillEffectPickerPanel(panel, wrap.querySelector('.effect-input'));
  });
  if (!window._effectPickerDocClose) {
    window._effectPickerDocClose = true;
    document.addEventListener('click', (e) => {
      if (Date.now() - _effectPickerLastOpen < 400) return;
      if (e.target.closest('.effect-picker-panel') || e.target.closest('.effect-input-with-picker')) return;
      document.querySelectorAll('.effect-picker-panel.open').forEach(p => p.classList.remove('open'));
    });
    document.addEventListener('touchend', (e) => {
      if (Date.now() - _effectPickerLastOpen < 400) return;
      if (e.target.closest('.effect-picker-panel') || e.target.closest('.effect-input-with-picker')) return;
      document.querySelectorAll('.effect-picker-panel.open').forEach(p => p.classList.remove('open'));
    }, { passive: true });
  }
}
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Carica evocazioni disponibili
async function loadSummons() {
  try {
    const response = await fetch(`${socketUrl}/api/config/summons`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    availableSummons = await response.json();
    console.log(`✅ Caricati ${availableSummons.length} evocazioni disponibili:`, availableSummons);
    populateSummonSelect();
  } catch (e) {
    console.error('❌ Errore caricamento evocazioni:', e);
    availableSummons = [];
    populateSummonSelect();
  }
}

// Popola il select delle evocazioni
function populateSummonSelect(selectId = null) {
  const selectIds = selectId ? [selectId] : ['summon-type', 'combat-summon-type'];
  selectIds.forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">Seleziona evocazione...</option>' +
      (availableSummons || []).map(summon =>
        `<option value="${summon.id}" data-name="${summon.name}" data-image="${summon.image || ''}">${summon.name}</option>`
      ).join('');
  });
  buildCustomSummonDropdowns(selectId);
}

// Dropdown custom per evocazioni (funziona in WebView/APK dove il select nativo può non aprirsi)
let _customSelectLastOpen = 0;
function buildCustomSummonDropdowns(selectId = null) {
  const ids = selectId ? [selectId] : ['summon-type', 'combat-summon-type'];
  ids.forEach(id => {
    const select = document.getElementById(id);
    const trigger = document.getElementById(id + '-trigger');
    const panel = document.getElementById(id + '-panel');
    if (!select || !trigger || !panel) return;
    panel.innerHTML = '<div class="custom-select-option" data-value="">Seleziona evocazione...</div>' +
      (availableSummons || []).map(s => `<div class="custom-select-option" data-value="${s.id}">${escapeHtml(s.name)}</div>`).join('');
    trigger.textContent = (select.options[select.selectedIndex] && select.value) ? select.options[select.selectedIndex].textContent : 'Seleziona evocazione...';
    if (panel._bound) return;
    panel._bound = true;
    function openSummonPanel() {
      _customSelectLastOpen = Date.now();
      panel.classList.toggle('open');
      document.querySelectorAll('.custom-select-panel.open').forEach(p => { if (p !== panel) p.classList.remove('open'); });
    }
    function onTrigger(e) {
      e.preventDefault();
      e.stopPropagation();
      openSummonPanel();
    }
    trigger.addEventListener('click', onTrigger);
    trigger.addEventListener('touchend', onTrigger, { passive: false });
    // Solo click seleziona (scroll nel panel non deve selezionare)
    panel.addEventListener('click', (e) => {
      const opt = e.target.closest('.custom-select-option');
      if (!opt) return;
      select.value = opt.dataset.value || '';
      trigger.textContent = opt.textContent;
      panel.classList.remove('open');
    });
  });
  if (!window._customSelectDocClose) {
    window._customSelectDocClose = true;
    document.addEventListener('click', () => {
      if (Date.now() - _customSelectLastOpen < 400) return;
      document.querySelectorAll('.custom-select-panel.open').forEach(p => p.classList.remove('open'));
    });
    document.addEventListener('touchend', () => {
      if (Date.now() - _customSelectLastOpen < 400) return;
      document.querySelectorAll('.custom-select-panel.open').forEach(p => p.classList.remove('open'));
    }, { passive: true });
  }
}

// Rendering evocazioni
function renderSummons(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (!gameState.summons || gameState.summons.length === 0) {
    container.innerHTML = '<div class="no-effects">Nessuna evocazione attiva</div>';
    return;
  }
  
  // Mostra solo le evocazioni del giocatore corrente
  const mySummons = gameState.summons.filter(s => s.ownerId === socket.id);
  
  if (mySummons.length === 0) {
    container.innerHTML = '<div class="no-effects">Nessuna evocazione attiva</div>';
    return;
  }
  
  container.innerHTML = mySummons.map(summon => `
    <div class="effect-tag summon">
      <span class="effect-info">
        <strong>${summon.name}</strong>
        <span class="effect-creator">Init: ${summon.initiative !== null ? Math.floor(summon.initiative) : '-'}</span>
      </span>
      <span class="effect-rounds">${summon.remainingRounds} rnd</span>
      <button class="remove-effect-btn" onclick="removeSummon('${summon.id}')">×</button>
    </div>
  `).join('');
}

// Rimuovi effetto
function removeEffect(targetId, effectId) {
  socket.emit('removeEffect', { targetId, effectId });
}
window.removeEffect = removeEffect;

// Rimuovi effetto ad area
function removeAreaEffect(effectId) {
  socket.emit('removeAreaEffect', effectId);
}
window.removeAreaEffect = removeAreaEffect;

// Rendering schermata combattimento
function renderCombatScreen() {
  if (!gameState || !gameState.combatStarted) return;
  
  // Round
  const roundNum = document.getElementById('round-number');
  if (roundNum) roundNum.textContent = gameState.currentRound;
  
  // Turno attuale
  const currentChar = gameState.turnOrder[gameState.currentTurn];
  const turnText = document.getElementById('current-turn-text');
  const delayAction = document.getElementById('delay-action');
  
  // Definisci isMe e isMySummon fuori dal blocco if per usarle dopo
  const isMe = currentChar && currentChar.id === myHeroId;
  const isMySummon = currentChar && currentChar.isSummon && currentChar.createdBy === socket.id;
  const isMyTurn = isMe || isMySummon;
  
  if (currentChar && turnText) {
    turnText.innerHTML = isMyTurn ? 
      `<span class="my-turn">⚔️ È IL TUO TURNO!</span>` : 
      `Turno di <strong>${currentChar.name}</strong>`;
    
    // Mostra pulsante ritarda solo se è il mio turno (eroe o evocazione)
    if (delayAction) {
      delayAction.style.display = isMyTurn ? 'block' : 'none';
    }
  }
  
  // Barra iniziativa
  const bar = document.getElementById('initiative-bar');
  bar.innerHTML = gameState.turnOrder.map((char, index) => {
    const isActive = index === gameState.currentTurn;
    const isMeInBar = char.id === myHeroId;
    const isMySummonInBar = char.isSummon && char.createdBy === socket.id; // Evocazione del giocatore
    const isEnemy = char.isEnemy;
    const isAlly = char.isAlly;
    const summonInfo = char.isSummon ? ` <span style="font-size: 0.7rem; color: var(--text-muted);">(${char.remainingRounds}rnd)</span>` : '';
    
    return `
      <div class="turn-card ${isActive ? 'active' : ''} ${isMeInBar || isMySummonInBar ? 'mine' : ''} ${isEnemy ? 'enemy' : ''} ${isAlly ? 'ally' : ''} ${char.isSummon ? 'summon' : ''}">
        <div class="portrait">${renderPortrait(char, 'small')}</div>
        <div class="name">${char.name}${summonInfo}</div>
        <div class="init-badge">${Math.floor(char.initiative)}</div>
        ${char.effects && char.effects.length > 0 ? 
          `<div class="effects-count">${char.effects.length} effetti</div>` : ''}
      </div>
    `;
  }).join('');
  
  // Renderizza le card selezionabili (eroe + evocazioni)
  renderEntityCards();
  
  // Mostra gli effetti dell'entità selezionata
  updateSelectedEntityEffects();
  
  // Effetti ad area in combattimento
  renderAreaEffects('combat-area-effects');
  
  // Evocazioni in combattimento - sempre visibili: il giocatore può evocare anche fuori dal proprio turno
  const combatSummonsSection = document.getElementById('combat-summons-section');
  if (combatSummonsSection) {
    combatSummonsSection.style.display = 'block';
  }
  renderSummons('combat-summons');
  populateSummonSelect('combat-summon-type');
  
  // Mostra personaggi ritardati (solo il proprio eroe se è ritardato)
  renderDelayedCharactersPlayer();
}

// Renderizza personaggi ritardati per il giocatore
function renderDelayedCharactersPlayer() {
  if (!gameState || !myHeroId) return;
  
  const panel = document.getElementById('delayed-panel-player');
  const container = document.getElementById('delayed-list-player');
  
  if (!panel || !container) return;
  
  // Trova se il mio eroe è ritardato
  const myDelayedHero = gameState.delayedCharacters?.find(char => char.id === myHeroId);
  
  if (!myDelayedHero) {
    panel.style.display = 'none';
    return;
  }
  
  panel.style.display = 'block';
  container.innerHTML = `
    <div class="delayed-item">
      <span class="char-icon">${renderPortrait(myDelayedHero)}</span>
      <span class="char-name">${myDelayedHero.name}</span>
      <button onclick="undelayMyCharacter()" class="btn tiny success" title="Rientra">▶ Rientra</button>
    </div>
  `;
}

// Rientra con il proprio personaggio
window.undelayMyCharacter = function() {
  if (!myHeroId) return;
  socket.emit('undelayCharacter', myHeroId);
};

// Variabile globale per l'entità selezionata (eroe o evocazione)
let selectedEntityId = null;

// Renderizza le card selezionabili (eroe + evocazioni)
function renderEntityCards() {
  const container = document.getElementById('entity-cards');
  if (!container || !gameState || !myHeroId) return;

  const myHero = gameState.heroes.find(h => h.id === myHeroId);
  if (!myHero) return;

  const allSummons = gameState.summons || [];
  const mySummons = allSummons.filter(s => s.createdBy === socket.id);

  // Se non c'è un'entità selezionata, seleziona l'eroe di default
  if (!selectedEntityId) {
    selectedEntityId = myHeroId;
  }

  // Verifica che l'entità selezionata sia ancora valida
  const isValidSelection = selectedEntityId === myHeroId || mySummons.some(s => s.id === selectedEntityId);
  if (!isValidSelection) {
    selectedEntityId = myHeroId;
  }

  const wrap = document.getElementById('entity-selector-wrap');
  if (wrap) {
    wrap.style.display = mySummons.length === 0 ? 'none' : '';
  }

  let html = '';
  if (mySummons.length === 0) {
    container.innerHTML = html;
    return;
  }

  // Chip "Tu" solo quando ci sono evocazioni (per tornare agli effetti del personaggio)
  const isHeroSelected = selectedEntityId === myHeroId;
  html += `
    <div class="entity-chip ${isHeroSelected ? 'selected' : ''}" onclick="selectEntity('${myHeroId}', 'hero')" title="I tuoi effetti">Tu</div>
  `;

  // Chip evocazioni compatte
  mySummons.forEach(summon => {
    const isSummonSelected = selectedEntityId === summon.id;
    html += `
      <div class="entity-chip ${isSummonSelected ? 'selected' : ''}" onclick="selectEntity('${summon.id}', 'summon')" title="${summon.name}">${renderPortrait(summon, 'small')} <span class="entity-chip-name">${summon.name}</span></div>
    `;
  });

  container.innerHTML = html;
}

// Seleziona un'entità (eroe o evocazione)
function selectEntity(entityId, type) {
  console.log(`🎯 Selezionata entità: ${entityId} (${type})`);
  selectedEntityId = entityId;
  renderEntityCards();
  updateSelectedEntityEffects();
}
window.selectEntity = selectEntity;

// Aggiorna gli effetti mostrati per l'entità selezionata
function updateSelectedEntityEffects() {
  if (!gameState || !selectedEntityId) {
    console.warn('⚠️ updateSelectedEntityEffects: gameState o selectedEntityId mancanti');
    return;
  }

  const titleEl = document.getElementById('selected-entity-title');
  let entity = null;
  let entityName = '';

  if (selectedEntityId === myHeroId) {
    entity = gameState.heroes.find(h => h.id === myHeroId);
    entityName = entity ? entity.name : 'Eroe';
    console.log(`📋 Aggiornando effetti per eroe: ${entityName}`, entity);
  } else {
    entity = (gameState.summons || []).find(s => s.id === selectedEntityId);
    entityName = entity ? entity.name : 'Evocazione';
    console.log(`📋 Aggiornando effetti per evocazione: ${entityName}`, entity);
  }

  if (titleEl) {
    titleEl.textContent = `🔮 Effetti di ${entityName}`;
  }

  if (entity) {
    renderEffectsList('combat-my-effects', entity.effects || [], entity.id);
  } else {
    const container = document.getElementById('combat-my-effects');
    if (container) {
      container.innerHTML = '<div class="no-effects">Nessun effetto attivo</div>';
    }
    console.warn(`⚠️ Entità ${selectedEntityId} non trovata`);
  }
}

// Aggiorna UI
function updateUI() {
  // Determina schermata basandosi sull'URL anche se gameState è null
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId');
  
  // Se non siamo in una stanza, mostra selezione stanze (anche se gameState è null)
  if (!roomId) {
    showScreen('roomSelection');
    // Carica le stanze quando si mostra la schermata di selezione
    loadRooms();
    return;
  }
  
  // Se gameState è null, non possiamo fare altro
  if (!gameState) return;
  
  // Assicurati che summons esista
  if (!gameState.summons) {
    gameState.summons = [];
  }
  
  // Verifica se il mio personaggio è ancora valido
  if (myHeroId) {
    const myHero = gameState.heroes.find(h => h.id === myHeroId);
    if (!myHero || myHero.ownerId !== socket.id) {
      myHeroId = null;
    }
  }
  
  // Siamo in una stanza, mostra schermata appropriata
  if (myHeroId) {
    const myHero = gameState.heroes.find(h => h.id === myHeroId);
    if (myHero && myHero.ownerId === socket.id) {
      // Abbiamo un personaggio confermato
      // Verifica se è il turno di una nostra evocazione
      const currentChar = gameState.turnOrder?.[gameState.currentTurn];
      const isMySummonTurn = currentChar && currentChar.isSummon && currentChar.createdBy === socket.id;
      
      if (gameState.combatStarted && (myHero.initiative !== null || isMySummonTurn)) {
        showScreen('combat');
        // Reset selezione entità quando entri in combattimento
        selectedEntityId = myHeroId;
        renderCombatScreen();
      } else {
        showScreen('player');
        renderPlayerScreen();
        // Aggiorna evocazioni se siamo nella schermata player
        if (gameState.summons) {
          renderSummons('summons-list');
        }
      }
    } else {
      // Il personaggio non è più nostro, mostra selezione
      myHeroId = null;
      if (roomId) {
        console.log('🎯 updateUI: Personaggio non più nostro, mostro selezione');
        showScreen('selection');
        if (gameState && gameState.heroes && gameState.heroes.length > 0) {
          renderCharacterGrid();
        }
      }
    }
  } else if (roomId) {
    // Siamo in una stanza ma non abbiamo ancora scelto un eroe
    // Mostra la schermata di selezione eroi
    console.log('🎯 updateUI: Mostro schermata selezione eroi (roomId presente, nessun myHeroId)');
    showScreen('selection');
    if (gameState && gameState.heroes && gameState.heroes.length > 0) {
      renderCharacterGrid();
    } else {
      console.warn('⚠️ updateUI: gameState.heroes non disponibile, non posso renderizzare la griglia');
    }
  }
  
  // Aggiorna datalist degli effetti
  updateEffectDatalist();
}

// === Event Listeners ===

// Imposta iniziativa
document.getElementById('set-initiative-btn').addEventListener('click', () => {
  const value = document.getElementById('initiative-input').value;
  if (value && myHeroId) {
    socket.emit('setHeroInitiative', { heroId: myHeroId, initiative: value });
  }
});

document.getElementById('initiative-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('set-initiative-btn').click();
  }
});

// Rinomina personaggio
document.getElementById('my-character-name').addEventListener('change', (e) => {
  if (myHeroId) {
    socket.emit('renameHero', { heroId: myHeroId, name: e.target.value });
  }
});

// Rilascia personaggio e torna alla selezione (così non si ri-reclama lo stesso PG)
function doReleaseAndReselect() {
  if (!myHeroId) return;
  socket.emit('releaseHero', myHeroId);
  clearSavedHero();
  myHeroId = null;
  closeReleaseModal();
  showScreen('selection');
  if (gameState && gameState.heroes && gameState.heroes.length > 0) {
    renderCharacterGrid();
  }
}

function openReleaseModal() {
  const modal = document.getElementById('release-character-modal');
  if (modal) modal.style.display = 'flex';
}

function closeReleaseModal() {
  const modal = document.getElementById('release-character-modal');
  if (modal) modal.style.display = 'none';
}

function releaseAndReselect() {
  if (!myHeroId) return;
  openReleaseModal();
}

const releaseCharacterBtn = document.getElementById('release-character-btn');
if (releaseCharacterBtn) {
  releaseCharacterBtn.addEventListener('click', (e) => { e.preventDefault(); releaseAndReselect(); });
  releaseCharacterBtn.addEventListener('touchend', (e) => { e.preventDefault(); releaseAndReselect(); }, { passive: false });
}
const releaseCombatBtn = document.getElementById('release-character-combat-btn');
if (releaseCombatBtn) {
  releaseCombatBtn.addEventListener('click', (e) => { e.preventDefault(); releaseAndReselect(); });
  releaseCombatBtn.addEventListener('touchend', (e) => { e.preventDefault(); releaseAndReselect(); }, { passive: false });
}
const releaseModalCancel = document.getElementById('release-character-cancel');
if (releaseModalCancel) {
  releaseModalCancel.addEventListener('click', closeReleaseModal);
  releaseModalCancel.addEventListener('touchend', (e) => { e.preventDefault(); closeReleaseModal(); }, { passive: false });
}
const releaseModalConfirm = document.getElementById('release-character-confirm');
if (releaseModalConfirm) {
  releaseModalConfirm.addEventListener('click', () => doReleaseAndReselect());
  releaseModalConfirm.addEventListener('touchend', (e) => { e.preventDefault(); doReleaseAndReselect(); }, { passive: false });
}

// Cancella personaggio salvato (dalla schermata selezione) così al prossimo avvio non rientri nel PG sbagliato
const clearSavedHeroBtn = document.getElementById('clear-saved-hero-btn');
if (clearSavedHeroBtn) {
  clearSavedHeroBtn.addEventListener('click', () => {
    clearSavedHero();
    myHeroId = null;
    if (gameState && gameState.heroes && gameState.heroes.length > 0) {
      renderCharacterGrid();
    }
    clearSavedHeroBtn.textContent = 'Personaggio salvato cancellato';
    setTimeout(() => { clearSavedHeroBtn.textContent = 'Cancella personaggio salvato e ricarica'; }, 2000);
  });
}

// Aggiungi effetto personale (schermata player)
document.getElementById('add-effect-btn').addEventListener('click', () => {
  if (!myHeroId) return;
  
  const name = document.getElementById('effect-name').value;
  const isBonus = document.getElementById('effect-bonus').value === 'bonus';
  const duration = document.getElementById('effect-duration').value;
  
  if (name && duration) {
    socket.emit('addEffect', {
      targetId: myHeroId,
      effect: { name, isBonus, duration }
    });
    
    // Reset form
    document.getElementById('effect-name').value = '';
    document.getElementById('effect-duration').value = '';
  }
});

// Aggiungi effetto personale (schermata combat)
document.getElementById('combat-add-effect-btn').addEventListener('click', () => {
  if (!myHeroId || !selectedEntityId) {
    console.warn('⚠️ Nessuna entità selezionata o eroe non trovato');
    return;
  }
  
  const name = document.getElementById('combat-effect-name').value.trim();
  const isBonus = document.getElementById('combat-effect-bonus').value === 'bonus';
  const duration = document.getElementById('combat-effect-duration').value;
  
  if (!name || !duration) {
    console.warn('⚠️ Nome o durata mancanti');
    return;
  }
  
  console.log(`✅ Aggiungo effetto "${name}" a entità ${selectedEntityId}`);
  
  socket.emit('addEffect', {
    targetId: selectedEntityId,
    effect: { name, isBonus, duration }
  });
  
  document.getElementById('combat-effect-name').value = '';
  document.getElementById('combat-effect-duration').value = '';
});

// Aggiungi effetto ad area (schermata player)
document.getElementById('add-area-effect-btn').addEventListener('click', () => {
  const name = document.getElementById('area-effect-name').value;
  const duration = document.getElementById('area-effect-duration').value;
  
  if (name && duration) {
    socket.emit('addAreaEffect', { name, duration });
    document.getElementById('area-effect-name').value = '';
    document.getElementById('area-effect-duration').value = '';
  }
});

// Aggiungi effetto ad area (schermata combat)
document.getElementById('combat-add-area-effect-btn').addEventListener('click', () => {
  const name = document.getElementById('combat-area-effect-name').value;
  const duration = document.getElementById('combat-area-effect-duration').value;
  
  if (name && duration) {
    socket.emit('addAreaEffect', { name, duration });
    document.getElementById('combat-area-effect-name').value = '';
    document.getElementById('combat-area-effect-duration').value = '';
  }
});

// Aggiungi evocazione in combattimento
const combatAddSummonBtn = document.getElementById('combat-add-summon-btn');
if (combatAddSummonBtn) {
  combatAddSummonBtn.addEventListener('click', () => {
    const summonType = document.getElementById('combat-summon-type').value;
    const initiative = document.getElementById('combat-summon-initiative').value;
    const duration = document.getElementById('combat-summon-duration').value;
    
    if (summonType && initiative && duration) {
      const selectedSummon = availableSummons.find(s => s.id === summonType);
      if (selectedSummon) {
        socket.emit('addSummon', { 
          summonId: summonType,
          name: selectedSummon.name,
          image: selectedSummon.image,
          initiative: parseInt(initiative),
          duration: parseInt(duration)
        });
        document.getElementById('combat-summon-type').value = '';
        document.getElementById('combat-summon-initiative').value = '';
        document.getElementById('combat-summon-duration').value = '';
      }
    }
  });
}

// Aggiungi evocazione
document.getElementById('add-summon-btn').addEventListener('click', () => {
  const summonType = document.getElementById('summon-type').value;
  const initiative = document.getElementById('summon-initiative').value;
  const duration = document.getElementById('summon-duration').value;
  
  if (summonType && initiative && duration) {
    const selectedSummon = availableSummons.find(s => s.id === summonType);
    if (selectedSummon) {
      socket.emit('addSummon', { 
        summonId: summonType,
        name: selectedSummon.name,
        image: selectedSummon.image,
        initiative: parseInt(initiative),
        duration: parseInt(duration)
      });
      document.getElementById('summon-type').value = '';
      document.getElementById('summon-initiative').value = '';
      document.getElementById('summon-duration').value = '';
    }
  }
});

// Rimuovi evocazione
window.removeSummon = function(summonId) {
  socket.emit('removeSummon', summonId);
};

// Ritarda turno
document.getElementById('delay-btn').addEventListener('click', () => {
  if (!myHeroId) return;
  
  // Verifica se è il turno dell'eroe o di una sua evocazione
  const currentChar = gameState?.turnOrder?.[gameState?.currentTurn];
  if (currentChar) {
    if (currentChar.id === myHeroId) {
      if (confirm('Vuoi ritardare il tuo turno?')) {
        socket.emit('delayCharacter', myHeroId);
      }
    } else if (currentChar.isSummon && currentChar.createdBy === socket.id) {
      // Ritarda l'evocazione
      if (confirm('Vuoi ritardare il turno di questa evocazione?')) {
        socket.emit('delayCharacter', currentChar.id);
      }
    }
  }
});

// Il giocatore non sceglie più la posizione al rientro - il master gestisce l'ordine via popup
// Manteniamo un handler no-op per compatibilità
socket.on('chooseUndelayPosition', () => {
  // Non più utilizzato: il master gestisce l'ordine via popup tie
});

// === Socket Events ===

socket.on('gameState', (state) => {
  console.log('📦 GameState ricevuto:', {
    heroes: state.heroes?.length || 0,
    enemies: state.enemies?.length || 0,
    allies: state.allies?.length || 0,
    combatStarted: state.combatStarted
  });
  
  const previousGameState = gameState;
  gameState = state;
  
  // Verifica se il mio personaggio è ancora valido
  if (myHeroId) {
    const myHero = gameState.heroes.find(h => h.id === myHeroId);
    if (!myHero) {
      // Il personaggio non esiste più
      console.warn('⚠️ Il mio personaggio non esiste più');
      clearSavedHero();
      myHeroId = null;
    } else if (myHero.ownerId === socket.id) {
      // Il personaggio è nostro - confermato!
      console.log('✅ Personaggio confermato:', myHero.name);
    } else {
      // Il personaggio è associato a un altro socket
      // Prova sempre a riprenderlo (il server verificherà se il socket precedente è ancora connesso)
      console.log('🔄 Tentativo di riprendere personaggio (socket cambiato):', myHeroId);
      socket.emit('claimHero', myHeroId);
      // NON impostare myHeroId qui - aspetta conferma server
      myHeroId = null;
    }
  }

  // Verifica se siamo in una stanza
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId');
  
  // Se non abbiamo ancora un personaggio, prova a riconnetterti a quello salvato
  if (!myHeroId) {
    const savedHeroId = loadSavedHero();
    if (savedHeroId) {
      // Verifica se il personaggio salvato è disponibile e appartiene a noi
      const savedHero = gameState.heroes.find(h => h.id === savedHeroId);
      if (savedHero) {
        if (savedHero.ownerId === socket.id) {
          // Il personaggio è già nostro!
          console.log('✅ Personaggio salvato già nostro:', savedHero.name);
          myHeroId = savedHeroId;
        } else {
          // C'è un personaggio salvato ma non è nostro: prova a riconnetterti
          console.log('🔄 Tentativo riconnessione automatica a personaggio salvato:', savedHeroId);
          tryReconnect();
        }
      } else {
        // Il personaggio salvato non esiste più
        console.warn('⚠️ Personaggio salvato non trovato nel gameState');
        clearSavedHero();
      }
    }
  }
  
  // Forza aggiornamento UI per migliorare sincronizzazione
  updateUI();
  
  // Se il combattimento è iniziato, mostra la schermata combattimento
  if (gameState.combatStarted) {
    if (!previousGameState?.combatStarted) {
      console.log('⚔️ Combattimento iniziato!');
    }
    // Se ho un eroe con iniziativa, mostro la schermata combattimento
    if (myHeroId) {
      const myHero = gameState.heroes.find(h => h.id === myHeroId);
      if (myHero && myHero.initiative !== null) {
        showScreen('combat');
      }
    }
  }
});

// Handler per errori di claim
socket.on('heroClaimError', (data) => {
  console.log('❌ Errore claim eroe:', data);
  
  // Se l'eroe è già occupato, pulisci il salvataggio e mostra la selezione
  if (data.heroId === myHeroId || data.heroId === loadSavedHero()) {
    const hero = gameState?.heroes.find(h => h.id === data.heroId);
    if (hero && hero.ownerId !== socket.id) {
      // Se era il nostro eroe salvato, informa l'utente che può chiedere al master di liberarlo
      console.log('⚠️ Personaggio salvato già occupato, mostro selezione');
      alert('Questo personaggio è già occupato da un altro giocatore.\n\nSe ti sei appena riconnesso, chiedi al Master di liberare il personaggio usando il pulsante 🔓 nella vista Master.');
      clearSavedHero();
      myHeroId = null;
      // Mostra schermata selezione
      showScreen('selection');
      if (gameState) {
        renderCharacterGrid();
      }
    }
  }
});

// Quando un altro client prende il nostro stesso personaggio, il server ci espelle
socket.on('characterTakenOver', (data) => {
  console.log('🔁 Personaggio preso da un\'altra sessione:', data);
  try {
    clearSavedHero();
    myHeroId = null;
    alert('Un\'altra sessione ha preso il personaggio "' + (data && data.heroName ? data.heroName : '') + '". Questa finestra verrà chiusa/disconnessa.');
  } catch (_) {}
});

// Riattacco automatico dopo refresh/riconnessione: il server ci dice "ho riassociato il tuo eroe"
socket.on('heroReattached', (data) => {
  if (!data || !data.heroId) return;
  console.log('🔄 Eroe riattaccato dal server:', data.heroName);
  myHeroId = data.heroId;
  saveHero(data.heroId);
  // Se siamo ancora sulla schermata di selezione, mostra subito quella del personaggio
  if (gameState) {
    const hero = gameState.heroes.find(h => h.id === data.heroId);
    if (hero) {
      showScreen(gameState.combatStarted ? 'combat' : 'player');
    }
  }
});

socket.on('combatStarted', () => {
  console.log('Combattimento iniziato!');
});

socket.on('newRound', (round) => {
  console.log('Nuovo round:', round);
});

// Carica e mostra stanze disponibili
async function loadRooms() {
  console.log('🏠 Caricamento stanze...');
  
  // Mostra debug info
  const debugArea = document.getElementById('debug-area');
  const debugContent = document.getElementById('debug-content');
  
  try {
    // Determina URL API in base all'ambiente
    let apiUrl = '/api/rooms';
    let serverUrlToUse = null;
    
    // Se siamo in browser/mobile (non Electron), usa l'URL corrente o quello salvato
    if (!window.electronAPI || !window.electronAPI.isElectron) {
      // Browser/Mobile: usa l'URL corrente o quello salvato in localStorage
      const saved = localStorage.getItem('serverUrl');
      if (saved) {
        serverUrlToUse = saved;
        apiUrl = `${saved}/api/rooms`;
        console.log('🌐 Browser/Mobile: usando server salvato:', apiUrl);
      } else {
        // Se non c'è un server salvato, non possiamo caricare le stanze
        // Mostra messaggio all'utente
        console.warn('⚠️ Nessun server configurato, non posso caricare le stanze');
        if (debugArea && debugContent) {
          debugArea.style.display = 'block';
          debugContent.textContent = '⚠️ Configura l\'IP del Master usando il campo sopra prima di caricare le stanze.';
        }
        const loading = document.getElementById('rooms-loading');
        const empty = document.getElementById('rooms-empty');
        if (loading) loading.style.display = 'none';
        if (empty) {
          empty.style.display = 'block';
          empty.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 20px;">📡</div>
            <h3>Configura il server</h3>
            <p>Inserisci l'IP del Master nel campo sopra e clicca "Connetti" per vedere le stanze disponibili.</p>
          `;
        }
        return; // Esci senza fare il fetch
      }
    } else if (window.electronAPI && window.electronAPI.isElectron) {
      // Electron: usa localhost
      serverUrlToUse = 'http://localhost:3001';
      apiUrl = 'http://localhost:3001/api/rooms';
      console.log('💻 Electron: usando localhost');
    }
    
    if (debugArea && debugContent) {
      debugArea.style.display = 'block';
      debugContent.textContent = `🔄 Caricamento stanze...\nURL: ${serverUrlToUse || apiUrl}`;
    }
    
    console.log('📡 Fetch a:', apiUrl);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 secondi
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    console.log('✅ Risposta ricevuta:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const rooms = await response.json();
    console.log('✅ Stanze caricate:', rooms.length);
    renderRooms(rooms);
  } catch (error) {
    console.error('❌ Errore caricamento stanze:', error);
    console.error('❌ Tipo errore:', error.name);
    console.error('❌ Messaggio:', error.message);
    
    // Mostra debug info
    const debugArea = document.getElementById('debug-area');
    const debugContent = document.getElementById('debug-content');
    if (debugArea && debugContent) {
      debugArea.style.display = 'block';
      let debugInfo = `❌ Errore caricamento stanze\n`;
      debugInfo += `URL: ${socketUrl}\n`;
      debugInfo += `Tipo: ${error.name}\n`;
      debugInfo += `Messaggio: ${error.message}\n`;
      if (error.stack) {
        debugInfo += `\nStack:\n${error.stack}`;
      }
      debugContent.textContent = debugInfo;
    }
    
    const loading = document.getElementById('rooms-loading');
    const empty = document.getElementById('rooms-empty');
    
    if (loading) {
      loading.style.display = 'none';
      loading.textContent = `Errore: ${error.message || 'Impossibile connettersi al server'}`;
    }
    
    if (empty) {
      empty.style.display = 'block';
      empty.innerHTML = `
        <div style="font-size: 3rem; margin-bottom: 20px;">❌</div>
        <h3>Errore caricamento stanze</h3>
        <p>${error.message || 'Impossibile connettersi al server'}</p>
        <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 10px;">
          Verifica che l'IP sia corretto e che il Master sia avviato
        </p>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 5px;">
          Vedi l'area Debug sopra per dettagli tecnici
        </p>
      `;
    }
  }
}

// Rendering lista stanze per giocatori
function renderRooms(rooms) {
  const grid = document.getElementById('rooms-grid');
  const loading = document.getElementById('rooms-loading');
  const empty = document.getElementById('rooms-empty');
  
  loading.style.display = 'none';
  
  if (rooms.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  
  empty.style.display = 'none';
  
  grid.innerHTML = rooms.map(room => {
    const status = room.status || 'waiting';
    const statusText = {
      'waiting': 'In attesa',
      'active': 'In corso',
      'completed': 'Completato'
    }[status] || 'In attesa';
    
    return `
      <div class="character-card" onclick="selectRoom('${room.id}')" style="cursor: pointer;">
        <div class="character-portrait">
          <span class="placeholder-icon">🏛️</span>
        </div>
        <h3>${room.name}</h3>
        <span class="init-preview">${statusText}</span>
      </div>
    `;
  }).join('');
}

// Seleziona una stanza
function selectRoom(roomId) {
  const params = new URLSearchParams(window.location.search);
  params.set('roomId', roomId);
  window.location.href = `/index.html?${params.toString()}`;
}
window.selectRoom = selectRoom;

socket.on('connect', () => {
  console.log('✅ Connesso al server, Socket ID:', socket.id);
  
  // Carica effetti e evocazioni disponibili
  loadEffects();
  loadSummons();
  
  // Se c'è un roomId nell'URL, entra nella stanza
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId');
  
  if (roomId) {
    console.log('📥 Entrando nella stanza:', roomId);
    socket.emit('joinRoom', roomId);
    console.log(`✅ Richiesta joinRoom inviata per: ${roomId}`);
    
    // Controlla se c'è un personaggio salvato
    const savedHeroId = loadSavedHero();
    if (!savedHeroId) {
      // Nessun personaggio salvato: mostra subito la schermata di selezione
      // (verrà aggiornata quando arriva il gameState)
      console.log('🎯 Nessun personaggio salvato, mostro schermata selezione');
      showScreen('selection');
    } else {
      console.log('💾 Personaggio salvato trovato:', savedHeroId, '- aspetto gameState per riconnessione');
    }
  } else {
    // Nessun roomId, mostra selezione stanze
    console.log('🏠 Nessun roomId, mostro selezione stanze');
    showScreen('roomSelection');
    // Carica le stanze solo se c'è un server configurato (per browser/mobile)
    if (window.electronAPI && window.electronAPI.isElectron) {
      // Electron: carica sempre
      loadRooms();
    } else {
      // Browser/Mobile: carica solo se c'è un server configurato
      const saved = localStorage.getItem('serverUrl');
      if (saved) {
        loadRooms();
      }
    }
  }
});

// Modal errore connessione (in APK/emulatore alert() non si chiude; usiamo modal nostro)
function showConnectionErrorModal(message) {
  const modal = document.getElementById('connection-error-modal');
  const textEl = document.getElementById('connection-error-text');
  if (modal && textEl) {
    textEl.textContent = message;
    modal.style.display = 'flex';
  } else {
    alert(message);
  }
}
function hideConnectionErrorModal() {
  const modal = document.getElementById('connection-error-modal');
  if (modal) modal.style.display = 'none';
  showScreen('roomSelection');
  const section = document.getElementById('server-ip-section');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.hideConnectionErrorModal = hideConnectionErrorModal;

socket.on('connect_error', (error) => {
  console.error('❌ Errore connessione socket:', error);
  console.error('❌ Socket URL tentato:', socketUrl);
  
  const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // Su APK/emulatore: non mostrare il modal al primo avvio, così l'utente vede subito il campo IP e può inserire 10.0.2.2:3001
  if (isCapacitor) {
    showScreen('roomSelection');
    return;
  }
  
  if (!window.electronAPI || !window.electronAPI.isElectron) {
    const saved = localStorage.getItem('serverUrl');
    if (!saved || saved === 'http://localhost:3001') {
      showConnectionErrorModal(
        'Non hai configurato l\'IP del Master.\n\n' +
        'Inserisci l\'IP nel campo sotto (es: 192.168.1.27:3001) e clicca "🔌 Connetti".\n\n' +
        'In emulatore usa: 10.0.2.2:3001'
      );
      return;
    }
  }
  
  showConnectionErrorModal(
    'Verifica: Master avviato, stessa rete Wi-Fi, IP corretto (es: 192.168.1.27:3001 o 10.0.2.2:3001 in emulatore), firewall non blocca porta 3001.'
  );
});

socket.on('error', (error) => {
  console.error('❌ Errore socket:', error);
});

socket.on('disconnect', () => {
  console.log('Disconnesso dal server');
});

// Pulsante OK del modal errore connessione
function setupConnectionErrorModal() {
  const okBtn = document.getElementById('connection-error-ok');
  const modal = document.getElementById('connection-error-modal');
  if (okBtn && modal) {
    function closeAndShow() {
      hideConnectionErrorModal();
    }
    okBtn.addEventListener('click', closeAndShow);
    okBtn.addEventListener('touchend', function(e) { e.preventDefault(); closeAndShow(); }, { passive: false });
    modal.addEventListener('click', function(e) { if (e.target === modal) closeAndShow(); });
  }
}

// Pulsante "Torna alle Stanze"
function setupBackButton() {
  const backBtn = document.getElementById('back-to-rooms-btn');
  if (backBtn) {
    backBtn.addEventListener('click', async () => {
      try {
        // Tutti (browser e Electron) vanno a index.html per vedere la lista delle stanze
        window.location.href = '/index.html';
      } catch (error) {
        console.error('Errore nel tornare alle stanze:', error);
        window.location.href = '/index.html';
      }
    });
  } else {
    console.warn('Pulsante back-to-rooms-btn non trovato');
  }
}

// Handler globale per la connessione - sempre disponibile
// connectToServerHandler è già definito all'inizio del file

// Setup campo IP nella schermata iniziale
function setupServerIPInput() {
  const ipInput = document.getElementById('server-ip-input');
  const connectBtn = document.getElementById('connect-ip-btn');
  const statusDiv = document.getElementById('server-ip-status');
  
  if (!ipInput) {
    console.error('❌ Elemento server-ip-input non trovato!');
    alert('Errore: campo IP non trovato. Ricarica la pagina.');
    return;
  }
  
  if (!connectBtn) {
    console.error('❌ Elemento connect-ip-btn non trovato!');
    alert('Errore: pulsante Connetti non trovato. Ricarica la pagina.');
    return;
  }
  
  console.log('✅ Elementi trovati:');
  console.log('  - ipInput:', ipInput);
  console.log('  - connectBtn:', connectBtn);
  console.log('🔧 Setup campo IP completato');
  
  // Inizializza area debug
  const debugArea = document.getElementById('debug-area');
  const debugContent = document.getElementById('debug-content');
  if (debugArea && debugContent) {
    debugArea.style.display = 'block';
    let initialDebug = `📱 App avviata\n`;
    initialDebug += `Ambiente: ${window.electronAPI && window.electronAPI.isElectron ? 'Electron' : 'Browser'}\n`;
    initialDebug += `Socket URL: ${socketUrl}\n`;
    debugContent.textContent = initialDebug;
  }
  
  // Precompila usando l'IP della barra URL (utile in browser/desktop: evita di
  // doverlo riscrivere ogni volta). Su Capacitor (APK) non c'è una URL utile.
  if (!isCapacitorApp) {
    try {
      const loc = window.location;
      // Usiamo solo se non è file:// e l'host non è vuoto
      if (loc && loc.hostname) {
        const port = loc.port || '3001';
        const fromUrl = `${loc.hostname}:${port}`;
        ipInput.value = fromUrl;
        ipInput.placeholder = fromUrl;
        console.log('📝 IP precompilato dalla URL:', fromUrl);
      }
    } catch (e) {
      console.warn('⚠️ Impossibile leggere IP dalla URL:', e);
    }
  }

  // Carica IP salvato (nell'app mobile non ripristiniamo: chiedi l'URL ogni volta)
  // Sovrascrive l'eventuale precompilazione da URL solo se diverso dal default localhost
  const saved = isCapacitorApp ? null : localStorage.getItem('serverUrl');
  console.log('💾 Server URL salvato:', saved);
  if (saved && saved !== 'http://localhost:3001') {
    try {
      const url = new URL(saved);
      const displayValue = `${url.hostname}${url.port ? ':' + url.port : ':3001'}`;
      ipInput.value = displayValue;
      console.log('📝 IP precompilato:', displayValue);
      if (statusDiv) {
        statusDiv.innerHTML = `<span style="color: #51cf66;">✅ Connesso a: ${saved}</span>`;
      }
      // Aggiorna debug
      if (debugContent) {
        let debugInfo = `📱 App avviata\n`;
        debugInfo += `Ambiente: ${window.electronAPI && window.electronAPI.isElectron ? 'Electron' : 'Browser'}\n`;
        debugInfo += `Socket URL: ${socketUrl}\n`;
        debugInfo += `✅ IP salvato: ${saved}\n`;
        debugInfo += `IP precompilato: ${displayValue}`;
        debugContent.textContent = debugInfo;
      }
    } catch (e) {
      console.error('❌ Errore parsing URL salvato:', e);
    }
  }
  
  // Listener sul pulsante (click + touchend per emulatore/WebView Android)
  function handleConnect(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (window.connectToServerHandler) window.connectToServerHandler(e);
  }
  if (connectBtn) {
    connectBtn.addEventListener('click', handleConnect);
    connectBtn.addEventListener('touchend', function(e) {
      e.preventDefault();
      handleConnect(e);
    }, { passive: false });
  }
  if (ipInput) {
    ipInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') handleConnect(e);
    });
  }
}

// Funzione per inizializzare la pagina
function initSegnoToggles() {
  document.querySelectorAll('.segno-toggle').forEach(wrap => {
    const select = document.getElementById(wrap.dataset.selectId);
    if (!select) return;
    const btns = wrap.querySelectorAll('.segno-btn');
    btns.forEach(btn => {
      btn.classList.toggle('active', select.value === btn.dataset.value);
      btn.addEventListener('click', () => {
        select.value = btn.dataset.value;
        btns.forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  });
}

function initializePage() {
  try {
    initSegnoToggles();
    setupBackButton();
    setupConnectionErrorModal();
    setupServerIPInput();
    
    // Se non c'è un roomId nell'URL, mostra la schermata di selezione stanze
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('roomId');
    
    if (!roomId) {
      console.log('🏠 Nessun roomId nell\'URL, mostro selezione stanze');
      showScreen('roomSelection');
      // Carica le stanze immediatamente (non aspetta la connessione socket)
      // Ma solo se c'è un server configurato (per browser/mobile)
      if (window.electronAPI && window.electronAPI.isElectron) {
        // Electron: carica sempre
        loadRooms();
      } else {
        // Browser: carica se c'è un server configurato. App mobile: non auto-caricare, chiedi URL ogni volta
        if (!isCapacitorApp) {
          const saved = localStorage.getItem('serverUrl');
          if (saved) {
            loadRooms();
          }
        }
      }
    }
    
    console.log('✅ Setup completato');
  } catch (error) {
    console.error('❌ Errore in setup:', error);
    alert('Errore setup: ' + error.message + '\n' + error.stack);
  }
}

// Setup quando il DOM è pronto
console.log('🚀 app.js caricato, readyState:', document.readyState);

try {
  if (document.readyState === 'loading') {
    console.log('⏳ DOM ancora in caricamento, aspetto DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', () => {
      console.log('✅ DOMContentLoaded ricevuto');
      initializePage();
    });
  } else {
    console.log('✅ DOM già caricato, eseguo setup immediatamente...');
    initializePage();
  }
} catch (error) {
  console.error('❌ Errore fatale in setup:', error);
  alert('Errore fatale: ' + error.message + '\n' + error.stack);
}
