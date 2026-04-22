// Vista Master - master.js

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
console.log('🔌 Inizializzazione socket...');

// Determina l'URL del server
let socketUrl = '';
if (window.electronAPI && window.electronAPI.isElectron) {
  // In Electron, connettiti a localhost:3001 (server integrato)
  socketUrl = 'http://localhost:3001';
} else {
  // In browser, usa l'URL corrente
  socketUrl = window.location.origin;
}

// clientId persistente: utile per il master per identificare la sessione anche dopo refresh
function getOrCreateClientId() {
  let id = localStorage.getItem('rpgClientId');
  if (!id) {
    if (window.crypto && window.crypto.randomUUID) id = window.crypto.randomUUID();
    else id = 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
    localStorage.setItem('rpgClientId', id);
  }
  return id;
}
const CLIENT_ID = getOrCreateClientId();

console.log('🔗 Connessione socket a:', socketUrl);
const socket = io(socketUrl, {
  auth: { clientId: CLIENT_ID, role: 'master' },
  query: { clientId: CLIENT_ID },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 8000,
  reconnectionAttempts: Infinity,
  transports: ['websocket', 'polling']
});

// Log stato connessione
socket.on('connect', () => {
  console.log('✅ Socket connesso, ID:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('⚠️ Socket disconnesso:', reason);
});

socket.on('connect_error', (error) => {
  console.error('❌ Errore connessione socket:', error);
});

// Stato locale
let gameState = null;
let isMaster = false;
let enemyTypes = [];
let allyTypes = [];
let availableEffects = [];

// Carica tipi nemici dalle immagini
async function loadEnemyTypes() {
  try {
    console.log('🔄 Caricamento tipi nemici...');
    const response = await fetch(`${socketUrl}/api/enemy-types`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    enemyTypes = await response.json();
    console.log(`✅ Caricati ${enemyTypes.length} tipi di nemici:`, enemyTypes);
    populateEnemySelect();
  } catch (e) {
    console.error('❌ Errore caricamento tipi nemici:', e);
    // Fallback: aggiungi almeno un'opzione generica
    enemyTypes = [{ id: 'default', name: 'Generico', image: '' }];
    populateEnemySelect();
  }
}

// Popola il select dei tipi di nemici
function populateEnemySelect() {
  const select = document.getElementById('enemy-type');
  if (!select) return;
  
  // Aggiungi sempre un'opzione "Nessuna immagine" all'inizio
  let html = '<option value="">Nessuna immagine</option>';
  html += enemyTypes.map(type => 
    `<option value="${type.id}" data-image="${type.image || ''}">${type.name}</option>`
  ).join('');
  
  select.innerHTML = html;
  
  // Fallback se nessun tipo
  if (enemyTypes.length === 0) {
    select.innerHTML = '<option value="">Nessuna immagine</option>';
  }
}

// Carica effetti disponibili
async function loadEffects() {
  try {
    console.log('🔄 Caricamento effetti disponibili...');
    const response = await fetch(`${socketUrl}/api/config/effects`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    availableEffects = await response.json();
    console.log(`✅ Caricati ${availableEffects.length} effetti disponibili:`, availableEffects);
    // Aggiorna tutti i datalist degli effetti
    updateEffectDatalists();
  } catch (e) {
    console.error('❌ Errore caricamento effetti:', e);
    availableEffects = [];
  }
}

// Aggiorna tutti i datalist degli effetti
function updateEffectDatalists() {
  // Crea o aggiorna il datalist globale per gli effetti
  let datalist = document.getElementById('effects-datalist');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'effects-datalist';
    document.body.appendChild(datalist);
  }
  
  // Ordina gli effetti alfabeticamente per nome
  const sortedEffects = [...availableEffects].sort((a, b) => {
    return a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
  });
  
  datalist.innerHTML = sortedEffects.map(effect => 
    `<option value="${effect.name}">`
  ).join('');
  
  // Associa il datalist a tutti i campi input degli effetti
  document.querySelectorAll('input[id^="eff-name-"]').forEach(input => {
    if (!input.getAttribute('list')) {
      input.setAttribute('list', 'effects-datalist');
    }
  });
}

// Carica tipi alleati dal config
async function loadAllyTypes() {
  try {
    console.log('🔄 Caricamento tipi alleati...');
    const response = await fetch(`${socketUrl}/api/ally-types`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    allyTypes = await response.json();
    console.log(`✅ Caricati ${allyTypes.length} tipi di alleati:`, allyTypes);
    populateAllySelect();
  } catch (e) {
    console.error('❌ Errore caricamento tipi alleati:', e);
    // Fallback: aggiungi almeno un'opzione generica
    allyTypes = [{ id: 'default', name: 'Generico', image: '' }];
    populateAllySelect();
  }
}

// Popola il select dei tipi di alleati
function populateAllySelect() {
  const select = document.getElementById('ally-type');
  if (!select) return;
  
  // Aggiungi sempre un'opzione "Nessuna immagine" all'inizio
  let html = '<option value="">Nessuna immagine</option>';
  html += allyTypes.map(type => 
    `<option value="${type.id}" data-image="${type.image || ''}">${type.name}</option>`
  ).join('');
  
  select.innerHTML = html;
  
  // Fallback se nessun tipo
  if (allyTypes.length === 0) {
    select.innerHTML = '<option value="">Nessuna immagine</option>';
  }
}

// Elementi DOM
const screens = {
  panel: document.getElementById('master-panel'),
  error: document.getElementById('error-screen')
};

// Mostra una schermata
function showScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[screenName]) {
    screens[screenName].classList.add('active');
  }
}

// Helper per renderizzare ritratto (solo immagine, no icona)
function renderPortrait(char, size = 'normal') {
  if (char.image) {
    // Assicurati che il percorso sia assoluto se necessario
    const imagePath = char.image.startsWith('/') ? char.image : `/${char.image}`;
    const fullPath = imagePath.startsWith('http') ? imagePath : `${socketUrl}${imagePath}`;
    // Usa l'icona corretta come fallback: 👹 per nemici, 🤝 per alleati, 👤 per eroi
    const fallbackIcon = char.isEnemy ? '👹' : (char.isAlly ? '🤝' : (char.icon || '👤'));
    return `<img src="${fullPath}" alt="${char.name}" class="portrait-img ${size}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';"><span style="display:none;">${fallbackIcon}</span>`;
  }
  // Se non c'è immagine, mostra l'icona corretta: 👹 per nemici, 🤝 per alleati, 👤 per eroi
  const defaultIcon = char.isEnemy ? '👹' : (char.isAlly ? '🤝' : (char.icon || '👤'));
  return `<span class="char-icon-placeholder">${defaultIcon}</span>`;
}

// Determina se è bonus o malus
function isEffectBonus(effect) {
  if (effect.isBonus !== undefined) return effect.isBonus;
  if (effect.value !== undefined) return effect.value >= 0;
  return true;
}

// Controlla se è il turno di un personaggio
function isCurrentTurn(charId) {
  if (!gameState || !gameState.combatStarted || !gameState.turnOrder || gameState.turnOrder.length === 0) {
    return false;
  }
  const currentChar = gameState.turnOrder[gameState.currentTurn];
  return currentChar && currentChar.id === charId;
}


// Rendering lista eroi (include anche evocazioni)
function renderHeroesList() {
  if (!gameState) return;
  
  const container = document.getElementById('heroes-list');
  
  // Combina eroi e evocazioni
  const allHeroes = [
    ...gameState.heroes,
    ...(gameState.summons || [])
  ];
  
  if (allHeroes.length === 0) {
    container.innerHTML = '<div class="no-enemies">Nessun eroe disponibile</div>';
    return;
  }
  
  container.innerHTML = allHeroes.map(hero => {
    const isSummon = hero.isSummon;
    const isConnected = hero.ownerId !== null;
    const canDelay = isCurrentTurn(hero.id);
    const summonInfo = isSummon ? ` <span style="color: var(--text-muted); font-size: 0.85rem;">(${hero.remainingRounds} rnd)</span>` : '';
    
    return `
      <div class="character-item ${isConnected ? 'connected' : 'disconnected'} ${isSummon ? 'summon' : ''}">
        <div class="char-header">
          <span class="char-icon">${renderPortrait(hero, 'normal')}</span>
          ${isSummon ? 
            `<span class="char-name">${hero.name}${summonInfo}</span>` :
            `<input type="text" class="char-name-input" value="${hero.name}" 
                     onchange="renameHero('${hero.id}', this.value)">`
          }
          <span class="status-indicator ${isConnected ? 'online' : 'offline'}">
            ${isConnected ? '●' : '○'}
          </span>
          ${canDelay ? 
            `<button onclick="delayCharacter('${hero.id}')" class="btn tiny warning" title="Ritarda">⏸</button>` : ''}
          ${isConnected && !isSummon ? 
            `<button onclick="releaseHero('${hero.id}')" class="btn tiny secondary" title="Libera eroe">🔓</button>` : ''}
          ${isSummon ? 
            `<button onclick="removeSummon('${hero.id}')" class="btn tiny danger" title="Rimuovi evocazione">✕</button>` : ''}
        </div>
        <div class="char-controls">
          <input type="number" class="init-input" value="${hero.initiative !== null ? Math.floor(hero.initiative) : ''}" 
                 placeholder="Init" min="1" onchange="setHeroInit('${hero.id}', this.value)">
        </div>
        <div class="char-effects">
          ${hero.effects.map(eff => `
            <span class="mini-effect ${isEffectBonus(eff) ? 'bonus' : 'malus'}">
              ${isEffectBonus(eff) ? '+' : '-'} ${eff.name} - ${eff.remainingRounds}rnd
              <button onclick="removeCharEffect('${hero.id}', '${eff.id}')" class="mini-remove">×</button>
            </span>
          `).join('')}
        </div>
        <div class="add-effect-inline">
          <input type="text" id="eff-name-${hero.id}" placeholder="Nome effetto" class="mini-input wide" list="effects-datalist">
          <select id="eff-bonus-${hero.id}" class="mini-select tiny">
            <option value="true">+</option>
            <option value="false">-</option>
          </select>
          <input type="number" id="eff-dur-${hero.id}" placeholder="Rnd" class="mini-input tiny">
          <button onclick="addCharEffect('${hero.id}')" class="btn tiny primary">+</button>
        </div>
      </div>
    `;
  }).join('');
  
}

// Rendering lista nemici
function renderEnemiesList() {
  if (!gameState) return;
  
  const container = document.getElementById('enemies-list');
  
  if (gameState.enemies.length === 0) {
    container.innerHTML = '<div class="no-enemies">Nessun nemico aggiunto</div>';
    return;
  }
  
  container.innerHTML = gameState.enemies.map(enemy => {
    const canDelay = isCurrentTurn(enemy.id);
    
    return `
      <div class="character-item enemy">
        <div class="char-header">
          <span class="char-icon">${renderPortrait(enemy)}</span>
          <span class="char-name">${enemy.name}</span>
          ${canDelay ? 
            `<button onclick="delayCharacter('${enemy.id}')" class="btn tiny warning" title="Ritarda">⏸</button>` : ''}
          <button onclick="removeEnemy('${enemy.id}')" class="btn tiny danger">✕</button>
        </div>
        <div class="char-controls">
          <input type="number" class="init-input" value="${enemy.initiative !== null ? Math.floor(enemy.initiative) : ''}" 
                 placeholder="Init" min="1" onchange="setEnemyInit('${enemy.id}', this.value)">
        </div>
        <div class="char-effects">
          ${enemy.effects.map(eff => `
            <span class="mini-effect ${isEffectBonus(eff) ? 'bonus' : 'malus'}">
              ${isEffectBonus(eff) ? '+' : '-'} ${eff.name} - ${eff.remainingRounds}rnd
              <button onclick="removeCharEffect('${enemy.id}', '${eff.id}')" class="mini-remove">×</button>
            </span>
          `).join('')}
        </div>
        <div class="add-effect-inline">
          <input type="text" id="eff-name-${enemy.id}" placeholder="Nome effetto" class="mini-input wide" list="effects-datalist">
          <select id="eff-bonus-${enemy.id}" class="mini-select tiny">
            <option value="true">+</option>
            <option value="false">-</option>
          </select>
          <input type="number" id="eff-dur-${enemy.id}" placeholder="Rnd" class="mini-input tiny">
          <button onclick="addCharEffect('${enemy.id}')" class="btn tiny primary">+</button>
        </div>
      </div>
    `;
  }).join('');
}

// Rendering lista alleati
function renderAlliesList() {
  if (!gameState) {
    console.warn('⚠️ renderAlliesList: gameState è null');
    return;
  }
  
  const container = document.getElementById('allies-list');
  if (!container) {
    console.warn('⚠️ renderAlliesList: container non trovato');
    return;
  }
  
  // Assicurati che allies esista
  if (!gameState.allies) {
    gameState.allies = [];
  }
  
  console.log('🔄 renderAlliesList, allies:', gameState.allies.length, gameState.allies);
  
  if (gameState.allies.length === 0) {
    container.innerHTML = '<div class="no-enemies">Nessun alleato aggiunto</div>';
    return;
  }
  
  container.innerHTML = gameState.allies.map(ally => {
    const canDelay = isCurrentTurn(ally.id);
    
    // Debug: verifica che l'immagine sia presente
    if (ally.image) {
      console.log('🖼️ Alleato con immagine:', ally.name, ally.image);
    } else {
      console.log('⚠️ Alleato senza immagine:', ally.name);
    }
    
    return `
      <div class="character-item ally">
        <div class="char-header">
          <span class="char-icon">${renderPortrait(ally, 'normal')}</span>
          <span class="char-name">${ally.name}</span>
          ${canDelay ? 
            `<button onclick="delayCharacter('${ally.id}')" class="btn tiny warning" title="Ritarda">⏸</button>` : ''}
          <button onclick="removeAlly('${ally.id}')" class="btn tiny danger">✕</button>
        </div>
        <div class="char-controls">
          <input type="number" class="init-input" value="${ally.initiative !== null ? Math.floor(ally.initiative) : ''}" 
                 placeholder="Init" min="1" onchange="setAllyInit('${ally.id}', this.value)">
        </div>
        <div class="char-effects">
          ${ally.effects.map(eff => `
            <span class="mini-effect ${isEffectBonus(eff) ? 'bonus' : 'malus'}">
              ${isEffectBonus(eff) ? '+' : '-'} ${eff.name} - ${eff.remainingRounds}rnd
              <button onclick="removeCharEffect('${ally.id}', '${eff.id}')" class="mini-remove">×</button>
            </span>
          `).join('')}
        </div>
        <div class="add-effect-inline">
          <input type="text" id="eff-name-${ally.id}" placeholder="Nome effetto" class="mini-input wide" list="effects-datalist">
          <select id="eff-bonus-${ally.id}" class="mini-select tiny">
            <option value="true">+</option>
            <option value="false">-</option>
          </select>
          <input type="number" id="eff-dur-${ally.id}" placeholder="Rnd" class="mini-input tiny">
          <button onclick="addCharEffect('${ally.id}')" class="btn tiny primary">+</button>
        </div>
      </div>
    `;
  }).join('');
}

// Rendering effetti ad area
function renderAreaEffects() {
  if (!gameState) return;
  
  const container = document.getElementById('area-effects-list');
  
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
      <button class="remove-effect-btn" onclick="removeAreaEffect('${effect.id}')">×</button>
    </div>
  `).join('');
}

// Rendering personaggi ritardati
function renderDelayedCharacters() {
  if (!gameState) return;
  
  const panel = document.getElementById('delayed-panel');
  const container = document.getElementById('delayed-list');
  
  if (!gameState.delayedCharacters || gameState.delayedCharacters.length === 0) {
    panel.style.display = 'none';
    return;
  }
  
  panel.style.display = 'block';
  
  container.innerHTML = gameState.delayedCharacters.map(char => `
    <div class="delayed-item">
      <span class="char-icon">${renderPortrait(char)}</span>
      <span class="char-name">${char.name}</span>
      <button onclick="undelayCharacter('${char.id}')" class="btn tiny success" title="Rientra">▶</button>
    </div>
  `).join('');
}

// Rendering barra iniziativa
function renderInitiativeBar() {
  if (!gameState || !gameState.combatStarted) {
    // Nascondi la barra se il combattimento non è iniziato
    const combatBar = document.getElementById('combat-bar');
    if (combatBar) {
      combatBar.style.display = 'none';
    }
    return;
  }
  
  // Mostra la barra iniziativa sopra tutto
  const combatBar = document.getElementById('combat-bar');
  if (combatBar) {
    combatBar.style.display = 'block';
    combatBar.classList.add('active');
  }
  
  const bar = document.getElementById('initiative-bar');
  if (!bar) return;
  
  bar.innerHTML = gameState.turnOrder.map((char, index) => {
    const isActive = index === gameState.currentTurn;
    const charClass = char.isEnemy ? 'enemy' : (char.isAlly ? 'ally' : (char.isSummon ? 'summon' : 'hero'));
    const summonInfo = char.isSummon ? ` <span style="font-size: 0.7rem; color: var(--text-muted);">(${char.remainingRounds}rnd)</span>` : '';
    
    return `
      <div class="turn-card ${isActive ? 'active' : ''} ${charClass}">
        <div class="portrait">${renderPortrait(char, 'small')}</div>
        <div class="name">${char.name}${summonInfo}</div>
        <div class="init-badge">${Math.floor(char.initiative)}</div>
      </div>
    `;
  }).join('');
}

// Aggiorna UI
function updateUI() {
  if (!gameState) {
    console.warn('⚠️ updateUI chiamato ma gameState è null');
    return;
  }
  
  console.log('🔄 Aggiornamento UI, isMaster:', isMaster, 'heroes:', gameState.heroes?.length);
  
  // Status master
  const status = document.getElementById('master-status');
  if (isMaster) {
    status.textContent = '✓ Connesso come Master';
    status.classList.add('connected');
    showScreen('panel');
  } else {
    status.textContent = 'Connessione in corso...';
    status.classList.remove('connected');
  }
  
  // Round
  document.getElementById('round-number').textContent = gameState.currentRound;
  
  // Turno attuale
  if (gameState.combatStarted && gameState.turnOrder.length > 0) {
    const currentChar = gameState.turnOrder[gameState.currentTurn];
    document.getElementById('current-turn-text').textContent = 
      `⚔️ ${currentChar.name}`;
  } else {
    document.getElementById('current-turn-text').textContent = 'In attesa...';
  }
  
  // Mostra/nascondi controlli combattimento
  const startBtn = document.getElementById('start-combat-btn');
  const stopBtn = document.getElementById('stop-combat-btn');
  const turnControls = document.getElementById('turn-controls');
  const combatBar = document.getElementById('combat-bar');
  
  if (gameState.combatStarted) {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    turnControls.style.display = 'flex';
    if (combatBar) {
    combatBar.style.display = 'block';
      combatBar.classList.add('active');
    }
  } else {
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    turnControls.style.display = 'none';
    combatBar.style.display = 'none';
  }
  
  // Render liste
  renderHeroesList();
  renderEnemiesList();
  renderAlliesList();
  renderAreaEffects();
  renderDelayedCharacters();
  renderInitiativeBar();
  // Aggiorna datalist degli effetti dopo il rendering
  updateEffectDatalists();
}

// === Funzioni globali per onclick ===

window.renameHero = function(heroId, name) {
  socket.emit('renameHero', { heroId, name });
};

window.setHeroInit = function(heroId, initiative) {
  // Se è un'evocazione, usa setSummonInitiative, altrimenti setHeroInitiative
  const hero = gameState.heroes.find(h => h.id === heroId) || (gameState.summons || []).find(s => s.id === heroId);
  if (hero && hero.isSummon) {
    socket.emit('setSummonInitiative', { summonId: heroId, initiative });
  } else {
  socket.emit('setHeroInitiative', { heroId, initiative });
  }
};

window.removeSummon = function(summonId) {
  if (confirm('Vuoi eliminare questa evocazione?')) {
    socket.emit('removeSummon', summonId);
  }
};

window.setEnemyInit = function(enemyId, initiative) {
  socket.emit('setEnemyInitiative', { enemyId, initiative });
};

window.removeEnemy = function(enemyId) {
  socket.emit('removeEnemy', enemyId);
};

window.removeAlly = function(allyId) {
  socket.emit('removeAlly', allyId);
};

window.setAllyInit = function(allyId, initiative) {
  socket.emit('setAllyInitiative', { allyId, initiative });
};

window.delayCharacter = function(charId) {
  socket.emit('delayCharacter', charId);
};

window.undelayCharacter = function(charId) {
  socket.emit('undelayCharacter', charId);
};

window.releaseHero = function(heroId) {
  if (confirm('Vuoi liberare questo eroe? Il giocatore perderà il controllo del personaggio.')) {
    socket.emit('releaseHero', heroId);
  }
};

window.addCharEffect = function(targetId) {
  const name = document.getElementById(`eff-name-${targetId}`).value;
  const isBonus = document.getElementById(`eff-bonus-${targetId}`).value === 'true';
  const duration = document.getElementById(`eff-dur-${targetId}`).value;
  
  if (name && duration) {
    socket.emit('addEffect', {
      targetId,
      effect: { name, isBonus, duration }
    });
    
    document.getElementById(`eff-name-${targetId}`).value = '';
    document.getElementById(`eff-dur-${targetId}`).value = '';
  }
};

window.removeCharEffect = function(targetId, effectId) {
  socket.emit('removeEffect', { targetId, effectId });
};

window.removeAreaEffect = function(effectId) {
  socket.emit('removeAreaEffect', effectId);
};

// === Event Listeners ===

// Aggiungi nemico
document.getElementById('add-enemy-btn').addEventListener('click', () => {
  const name = document.getElementById('enemy-name').value;
  const typeSelect = document.getElementById('enemy-type');
  const enemyType = typeSelect.value;
  const initiative = document.getElementById('enemy-initiative').value;
  
  if (name) {
    socket.emit('addEnemy', { name, icon: '👹', initiative, imageId: enemyType });
    document.getElementById('enemy-name').value = '';
    document.getElementById('enemy-initiative').value = '';
  }
});

// Aggiungi alleato
document.getElementById('add-ally-btn').addEventListener('click', () => {
  const name = document.getElementById('ally-name').value;
  const typeSelect = document.getElementById('ally-type');
  const allyType = typeSelect.value;
  const initiative = document.getElementById('ally-initiative').value;
  
  if (name) {
    socket.emit('addAlly', { name, initiative, imageId: allyType });
    document.getElementById('ally-name').value = '';
    document.getElementById('ally-initiative').value = '';
  }
});

// Aggiungi effetto ad area
document.getElementById('add-area-effect-btn').addEventListener('click', () => {
  const name = document.getElementById('area-effect-name').value;
  const duration = document.getElementById('area-effect-duration').value;
  
  if (name && duration) {
    socket.emit('addAreaEffect', { name, duration });
    document.getElementById('area-effect-name').value = '';
    document.getElementById('area-effect-duration').value = '';
  }
});

// Inizia combattimento
document.getElementById('start-combat-btn').addEventListener('click', () => {
  socket.emit('startCombat');
});

// Ferma combattimento
document.getElementById('stop-combat-btn').addEventListener('click', () => {
  socket.emit('stopCombat');
});

// Turno successivo
document.getElementById('next-turn-btn').addEventListener('click', () => {
  socket.emit('nextTurn');
});

// Turno precedente
document.getElementById('prev-turn-btn').addEventListener('click', () => {
  socket.emit('prevTurn');
});

// Reset tutto
document.getElementById('reset-all-btn').addEventListener('click', () => {
  if (confirm('Sei sicuro di voler resettare tutto?')) {
    socket.emit('resetAll');
  }
});

// === Socket Events ===

socket.on('gameState', (state) => {
  console.log('📦 GameState ricevuto:', state);
  gameState = state;
  
  // Assicurati che allies esista
  if (!gameState.allies) {
    gameState.allies = [];
  }
  
  // Verifica se siamo il master
  const wasMaster = isMaster;
  isMaster = (state.masterId === socket.id);
  
  // Se siamo diventati master, aggiorna lo stato
  if (isMaster && !wasMaster) {
    console.log('✅ Diventato master!');
  }
  
  console.log('🔄 Aggiornamento UI, heroes:', state.heroes?.length, 'enemies:', state.enemies?.length, 'allies:', state.allies?.length);
  updateUI();
});

// Pulsante "Torna alle Stanze"
function setupBackButton() {
const backBtn = document.getElementById('back-to-rooms-btn');
if (backBtn) {
    backBtn.addEventListener('click', async () => {
      try {
    if (window.electronAPI && window.electronAPI.isElectron) {
      // In Electron, usa l'API
          await window.electronAPI.backToRooms();
    } else {
      // In browser, naviga alla pagina room selector
          window.location.href = '/room-selector.html';
        }
      } catch (error) {
        console.error('Errore nel tornare alle stanze:', error);
        // Fallback: prova comunque a navigare
      window.location.href = '/room-selector.html';
    }
  });
  } else {
    console.warn('Pulsante back-to-rooms-btn non trovato');
  }
}

// Setup quando il DOM è pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupBackButton);
} else {
  setupBackButton();
}

socket.on('error', (message) => {
  console.error('Errore:', message);
  showScreen('error');
});

socket.on('connect', () => {
  console.log('✅ Connesso al server, richiedo ruolo Master...');
  
  // Verifica che siamo in Electron (solo Electron può diventare master)
  if (!window.electronAPI || !window.electronAPI.isElectron) {
    console.error('❌ Tentativo di diventare master da browser! Solo Electron può diventare master.');
    alert('⚠️ Accesso negato!\n\nSolo l\'applicazione Master (Electron) può accedere alla vista Master.\n\nI giocatori devono usare la vista Giocatore (index.html).');
    // Reindirizza alla vista giocatore
    window.location.href = '/index.html';
    return;
  }
  
  // Se c'è un roomId nell'URL, entra nella stanza PRIMA di diventare master
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId');
  
  if (roomId) {
    console.log(`📥 Entrando nella stanza: ${roomId}`);
    socket.emit('joinRoom', roomId);
    
    // Usa un listener temporaneo per aspettare il gameState dopo joinRoom
    let gameStateReceived = false;
    const onGameState = (state) => {
      if (!gameStateReceived) {
        gameStateReceived = true;
        socket.off('gameState', onGameState);
        console.log('📦 GameState ricevuto, divento master...');
        // Ora che siamo nella stanza, diventa master
        socket.emit('becomeMaster');
      }
    };
    socket.on('gameState', onGameState);
    
    // Timeout di sicurezza: se dopo 3 secondi non riceviamo gameState, prova comunque
    setTimeout(() => {
      if (!gameStateReceived) {
        console.warn('⚠️ Timeout: gameState non ricevuto, provo comunque a diventare master');
        socket.off('gameState', onGameState);
        socket.emit('becomeMaster');
      }
    }, 3000);
  } else {
    // Nessuna stanza, prova comunque a diventare master (per compatibilità)
    console.log('⚠️ Nessun roomId nell\'URL, provo comunque a diventare master');
    socket.emit('becomeMaster');
  }
  
  // Carica tipi nemici e alleati dopo un breve delay per assicurarsi che il server sia pronto
  setTimeout(() => {
  loadEnemyTypes();
    loadAllyTypes();
    loadEffects();
  }, 500);
});

// Gestisci errori dal server
socket.on('error', (message) => {
  console.error('❌ Errore dal server:', message);
  if (message.includes('Master') || message.includes('Electron')) {
    alert(`⚠️ ${message}\n\nSe stai cercando di accedere come Master da browser, devi usare l'applicazione Electron.`);
    window.location.href = '/index.html';
  }
});

socket.on('connect_error', (error) => {
  console.error('❌ Errore connessione socket:', error);
  const status = document.getElementById('master-status');
  if (status) {
    status.textContent = '❌ Errore di connessione al server';
    status.classList.remove('connected');
  }
});

socket.on('disconnect', (reason) => {
  console.log('⚠️ Disconnesso dal server:', reason);
  const status = document.getElementById('master-status');
  if (status) {
    status.textContent = '⚠️ Disconnesso dal server';
    status.classList.remove('connected');
  }
});


socket.on('newRound', (round) => {
  console.log('Nuovo round:', round);
});

// === Gestione iniziative uguali ===
let currentTies = [];
let currentTieIndex = 0;
let orderedSelections = [];

socket.on('resolveInitiativeTies', (ties) => {
  currentTies = ties;
  currentTieIndex = 0;
  orderedSelections = [];
  showNextTie();
});

function showNextTie() {
  const modal = document.getElementById('initiative-tie-modal');
  if (!modal) return;
  if (currentTieIndex >= currentTies.length) {
    modal.style.display = 'none';
    return;
  }
  const tie = currentTies[currentTieIndex];
  const message = document.getElementById('tie-message');
  const container = document.getElementById('tie-characters');
  if (!message || !container) return;
  message.textContent = `Iniziativa ${tie.initiative}: Chi agisce per primo?`;
  container.innerHTML = tie.characters.map(char => {
    const safeId = String(char.id).replace(/"/g, '&quot;');
    return `<div class="tie-card" data-char-id="${safeId}" data-initiative="${tie.initiative}" role="button" tabindex="0">
      <div class="tie-portrait">${renderPortrait(char, 'large')}</div>
      <div class="tie-name">${char.name}</div>
      <div class="tie-init">Init: ${tie.initiative}</div>
    </div>`;
  }).join('');
  modal.style.display = 'flex';
  // Delegazione click (funziona anche con id contenenti apici o caratteri speciali)
  container.querySelectorAll('.tie-card').forEach(card => {
    card.onclick = null;
    card.onclick = function () {
      const charId = this.getAttribute('data-char-id');
      const initiative = Number(this.getAttribute('data-initiative'));
      if (charId != null) selectTieOrder(charId, initiative);
    };
  });
}

function selectTieOrder(charId, initiative) {
  const tie = currentTies[currentTieIndex];
  if (!tie) return;
  orderedSelections.push(charId);
  tie.characters = tie.characters.filter(c => String(c.id) !== String(charId));
  if (tie.characters.length <= 1) {
    if (tie.characters.length === 1) {
      orderedSelections.push(tie.characters[0].id);
    }
    socket.emit('setInitiativeOrder', {
      initiative: initiative,
      orderedIds: orderedSelections.slice()
    });
    orderedSelections = [];
    currentTieIndex++;
    showNextTie();
  } else {
    showNextTie();
  }
}
window.selectTieOrder = selectTieOrder;

