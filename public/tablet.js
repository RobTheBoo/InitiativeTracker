// Vista Tablet - tablet.js
// Determina l'URL del server
let socketUrl = '';
if (window.electronAPI && window.electronAPI.isElectron) {
  // In Electron, connettiti a localhost:3001 (server integrato)
  socketUrl = 'http://localhost:3001';
} else {
  // In browser, usa l'URL corrente
  socketUrl = window.location.origin;
}
function getOrCreateClientId() {
  let id = localStorage.getItem('rpgClientId');
  if (!id) {
    if (window.crypto && window.crypto.randomUUID) id = window.crypto.randomUUID();
    else id = 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
    localStorage.setItem('rpgClientId', id);
  }
  return id;
}
const CLIENT_ID = getOrCreateClientId();

const socket = io(socketUrl, {
  auth: { clientId: CLIENT_ID, role: 'tablet' },
  query: { clientId: CLIENT_ID },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 8000,
  reconnectionAttempts: Infinity,
  transports: ['websocket', 'polling']
});
window.socket = socket;

// Stato locale
let gameState = null;

// Elementi DOM
const waitingScreen = document.getElementById('waiting-screen');
const initiativeBar = document.getElementById('initiative-bar');
const areaEffectsDisplay = document.getElementById('area-effects-display');
const playersList = document.getElementById('players-list');

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

// Conta bonus e malus di un personaggio
function countEffects(effects) {
  if (!effects || effects.length === 0) return { bonus: 0, malus: 0 };
  
  let bonus = 0;
  let malus = 0;
  
  effects.forEach(eff => {
    // Se ha un valore, usa quello per determinare +/-
    // Altrimenti considera tutti come bonus (neutri)
    if (eff.value !== undefined) {
      if (eff.value >= 0) bonus++;
      else malus++;
    } else if (eff.isBonus === false) {
      malus++;
    } else {
      bonus++;
    }
  });
  
  return { bonus, malus };
}

// Genera badge +/- per gli effetti
function renderEffectBadges(effects) {
  const { bonus, malus } = countEffects(effects);
  
  if (bonus === 0 && malus === 0) return '';
  
  let html = '<div class="effect-badges">';
  
  if (bonus > 0) {
    html += `<span class="effect-badge bonus">+${bonus}</span>`;
  }
  if (malus > 0) {
    html += `<span class="effect-badge malus">-${malus}</span>`;
  }
  
  html += '</div>';
  return html;
}

// Mostra/nascondi schermate
function showCombat(show) {
  waitingScreen.style.display = show ? 'none' : 'flex';
  document.querySelector('.tablet-initiative').style.display = show ? 'block' : 'none';
  document.querySelector('.tablet-effects').style.display = show ? 'block' : 'none';
}

// Rendering giocatori connessi (attesa)
function renderWaitingPlayers() {
  if (!gameState) return;
  
  const connectedHeroes = gameState.heroes.filter(h => h.ownerId !== null);
  
  playersList.innerHTML = connectedHeroes.map(hero => `
    <div class="player-card ${hero.initiative !== null ? 'ready' : ''}">
      <div class="player-icon">${renderPortrait(hero, 'medium')}</div>
      <div class="player-name">${hero.name}</div>
      ${hero.initiative !== null ? 
        `<div class="player-init">Init: ${Math.floor(hero.initiative)}</div>` : 
        '<div class="player-waiting">In attesa...</div>'}
    </div>
  `).join('');
  
  if (connectedHeroes.length === 0) {
    playersList.innerHTML = '<div class="no-players">Nessun giocatore connesso</div>';
  }
}

// Rendering barra iniziativa
function renderInitiativeBar() {
  if (!gameState || !gameState.combatStarted) return;
  
  initiativeBar.innerHTML = gameState.turnOrder.map((char, index) => {
    const isActive = index === gameState.currentTurn;
    const charClass = char.isEnemy ? 'enemy' : (char.isAlly ? 'ally' : (char.isSummon ? 'summon' : 'hero'));
    const isPast = index < gameState.currentTurn;
    
    return `
      <div class="tablet-turn-card ${isActive ? 'active' : ''} \ ${isPast ? 'past' : ''}">
        <div class="tablet-token">
          <div class="tablet-portrait ${isActive ? 'pulse' : ''}">${renderPortrait(char, 'large')}</div>
        </div>
        <div class="tablet-name">${char.name}${char.isSummon ? ` <span style="font-size: 0.7rem; color: var(--text-muted);">(${char.remainingRounds}rnd)</span>` : ''}</div>
        <div class="tablet-init">${Math.floor(char.initiative)}</div>
      </div>
    `;
  }).join('');
  
  // Scrolla al personaggio attivo
  setTimeout(() => {
    const activeCard = initiativeBar.querySelector('.tablet-turn-card.active');
    if (activeCard) {
      activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, 100);
}

// Rendering turno attuale (personaggio grande al centro)
function renderCurrentTurn() {
  if (!gameState || !gameState.combatStarted || gameState.turnOrder.length === 0) return;
  
  const currentChar = gameState.turnOrder[gameState.currentTurn];
  
  // Separare bonus e malus
  const bonusEffects = [];
  const malusEffects = [];
  
  if (currentChar.effects && currentChar.effects.length > 0) {
    currentChar.effects.forEach(eff => {
      if (eff.value !== undefined) {
        if (eff.value >= 0) bonusEffects.push(eff);
        else malusEffects.push(eff);
      } else if (eff.isBonus === false) {
        malusEffects.push(eff);
      } else {
        bonusEffects.push(eff);
      }
    });
  }
  
  // Renderizza effetti in due riquadri separati (bonus e malus)
  let effectsHtml = '';
  if (bonusEffects.length > 0 || malusEffects.length > 0) {
    effectsHtml = '<div class="current-turn-effects-container">';
    
    // Riquadro Bonus
    if (bonusEffects.length > 0) {
      effectsHtml += '<div class="effects-box bonus-box">';
      effectsHtml += '<div class="effects-box-title">Bonus</div>';
      effectsHtml += '<div class="effects-box-content">';
      const totalColumns = Math.ceil(bonusEffects.length / 5);
      for (let col = 0; col < totalColumns; col++) {
        effectsHtml += '<div class="effects-column bonus-column">';
        for (let row = 0; row < 5; row++) {
          const index = col * 5 + row;
          if (index < bonusEffects.length) {
            const eff = bonusEffects[index];
            effectsHtml += `<div class="effect-name-item bonus">${eff.name || 'Bonus'}</div>`;
          }
        }
        effectsHtml += '</div>';
      }
      effectsHtml += '</div></div>';
    }
    
    // Riquadro Malus
    if (malusEffects.length > 0) {
      effectsHtml += '<div class="effects-box malus-box">';
      effectsHtml += '<div class="effects-box-title">Malus</div>';
      effectsHtml += '<div class="effects-box-content">';
      const totalColumns = Math.ceil(malusEffects.length / 5);
      for (let col = 0; col < totalColumns; col++) {
        effectsHtml += '<div class="effects-column malus-column">';
        for (let row = 0; row < 5; row++) {
          const index = col * 5 + row;
          if (index < malusEffects.length) {
            const eff = malusEffects[index];
            effectsHtml += `<div class="effect-name-item malus">${eff.name || 'Malus'}</div>`;
          }
        }
        effectsHtml += '</div>';
      }
      effectsHtml += '</div></div>';
    }
    
    effectsHtml += '</div>';
  }
  
  // Container con foto e nome allineati verticalmente, effetti separati
  const container = document.getElementById('current-turn-container');
  container.innerHTML = `
    <div class="current-turn-layout">
      <div class="turn-portrait-name-container">
        <div class="turn-portrait ${currentChar.isEnemy ? 'pulse' : ''}">${renderPortrait(currentChar, 'mega')}</div>
        <div class="turn-name-inline">
          <span class="${(currentChar.isEnemy ? 'enemy-name' : (currentChar.isAlly ? 'ally-name' : 'hero-name'))}">${currentChar.name}</span>
        </div>
      </div>
      ${effectsHtml}
    </div>
  `;
}

// Rendering effetti ad area (sotto la barra)
function renderAreaEffects() {
  if (!gameState) return;
  
  if (gameState.areaEffects.length === 0) {
    areaEffectsDisplay.innerHTML = '<div class="no-tablet-effects">Nessun effetto ad area attivo</div>';
    return;
  }
  
  areaEffectsDisplay.innerHTML = gameState.areaEffects.map(effect => `
    <div class="tablet-effect-card area">
      <div class="tablet-effect-icon">🌍</div>
      <div class="tablet-effect-info">
        <div class="tablet-effect-name">${effect.name}</div>
        <div class="tablet-effect-meta">
          <span class="tablet-effect-creator">da ${effect.creatorName}</span>
          <span class="tablet-effect-rounds">${effect.remainingRounds} rnd</span>
        </div>
      </div>
    </div>
  `).join('');
}

// Aggiorna UI completa
function updateUI() {
  if (!gameState) return;
  
  // Round
  document.getElementById('round-number').textContent = gameState.currentRound;
  
  if (gameState.combatStarted) {
    showCombat(true);
    renderCurrentTurn();
    renderInitiativeBar();
    renderAreaEffects();
    // Anima la transizione di turno se cambiata
    if (window.RPG_UI && typeof window.RPG_UI.animateTurnChange === 'function') {
      const el = document.getElementById('current-turn-container');
      window.RPG_UI.animateTurnChange(el, gameState.currentTurn);
    }
  } else {
    showCombat(false);
    renderWaitingPlayers();
  }
}

// === Socket Events ===

socket.on('gameState', (state) => {
  gameState = state;
  updateUI();
});

socket.on('combatStarted', () => {
  console.log('⚔️ Combattimento iniziato!');
  // Forza l'aggiornamento dell'UI quando il combattimento inizia
  if (gameState) {
    updateUI();
  }
});

socket.on('newRound', (round) => {
  console.log('Nuovo round:', round);
  // Animazione nuovo round
  const roundNum = document.getElementById('round-number');
  roundNum.classList.add('round-flash');
  setTimeout(() => roundNum.classList.remove('round-flash'), 500);
});

socket.on('connect', async () => {
  console.log('Tablet connesso al server');
  
  // Il tablet si connette automaticamente alla stanza attiva, senza richiedere selezione
  let roomId = null;
  
  // Prima prova a vedere se c'è un roomId nell'URL (per compatibilità)
  const urlParams = new URLSearchParams(window.location.search);
  roomId = urlParams.get('roomId');
  
  // Se non c'è roomId nell'URL, ottieni la stanza attiva dal server
  if (!roomId) {
    try {
      const response = await fetch(`${socketUrl}/api/active-room`);
      if (response.ok) {
        const data = await response.json();
        roomId = data.roomId;
        console.log(`📱 Tablet: stanza attiva trovata: ${roomId}`);
      } else {
        console.warn('⚠️ Nessuna stanza attiva disponibile, aspetto...');
        // Riprova dopo 2 secondi
        setTimeout(async () => {
          try {
            const retryResponse = await fetch(`${socketUrl}/api/active-room`);
            if (retryResponse.ok) {
              const retryData = await retryResponse.json();
              socket.emit('joinRoom', retryData.roomId);
              console.log(`📱 Tablet: entrato nella stanza dopo retry: ${retryData.roomId}`);
            }
          } catch (e) {
            console.error('Errore retry stanza:', e);
          }
        }, 2000);
        return;
      }
    } catch (error) {
      console.error('Errore ottenimento stanza attiva:', error);
      return;
    }
  }
  
  if (roomId) {
    socket.emit('joinRoom', roomId);
    console.log(`📱 Tablet entrato nella stanza: ${roomId}`);
  }
});

socket.on('disconnect', () => {
  console.log('Tablet disconnesso dal server');
});

// Il tablet non gestisce le stanze, si connette automaticamente alla stanza attiva

// Genera QR Code
function generateQRCode(url) {
  const qrContainer = document.getElementById('qr-code');
  if (!qrContainer) return;
  
  // Usa un servizio online per generare il QR code
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}`;
  qrContainer.innerHTML = `<img src="${qrUrl}" alt="QR Code" style="width: 100%; height: auto; border-radius: 8px;">`;
  document.getElementById('qr-code-container').style.display = 'block';
}

// Carica IP server e genera QR code
async function loadServerIP() {
  try {
    let url = '';
    const serverIpElement = document.getElementById('server-ip');
    if (!serverIpElement) return;
    
    if (window.electronAPI && window.electronAPI.isElectron) {
      try {
        const { ip, port } = await window.electronAPI.getServerIP();
        url = `http://${ip}:${port}`;
        serverIpElement.textContent = url;
      } catch (error) {
        // Se getServerIP non è disponibile, usa localhost
        url = 'http://localhost:3001';
        serverIpElement.textContent = url;
      }
    } else {
      url = window.location.origin;
      serverIpElement.textContent = url;
    }
    
    // Genera QR code
    generateQRCode(url);
  } catch (error) {
    console.error('Errore caricamento IP:', error);
  }
}

// Funzione per adattare l'altezza del viewport su Android
function adjustViewportHeight() {
  // Calcola l'altezza disponibile reale (escludendo le barre di sistema)
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
  
  // Per tablet-container, usa l'altezza reale
  const tabletContainer = document.querySelector('.tablet-container');
  if (tabletContainer) {
    tabletContainer.style.height = `${window.innerHeight}px`;
  }
}

// Adatta l'altezza al caricamento e al resize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    adjustViewportHeight();
    loadServerIP();
  });
} else {
  adjustViewportHeight();
  loadServerIP();
}

// Riadatta l'altezza quando la finestra viene ridimensionata o ruotata
window.addEventListener('resize', adjustViewportHeight);
window.addEventListener('orientationchange', () => {
  setTimeout(adjustViewportHeight, 100); // Piccolo delay per Android
});

// Se siamo in Electron, ascolta evento server avviato
if (window.electronAPI && window.electronAPI.isElectron) {
  window.electronAPI.onServerStarted((data) => {
    const url = `http://${data.ip}:${data.port}`;
    const serverIpElement = document.getElementById('server-ip');
    if (serverIpElement) {
      serverIpElement.textContent = url;
    }
    generateQRCode(url);
  });
}
