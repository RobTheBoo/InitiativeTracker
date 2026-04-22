// Configurazione - Gestione Eroi, Nemici e NPC
let heroes = [];
let enemies = [];
let allies = [];
let effects = [];
let summons = [];

// Modal per inserire nome
let modalCallback = null;

function showModal(title, callback) {
  modalCallback = callback;
  const modal = document.getElementById('name-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalInput = document.getElementById('modal-input');
  
  modalTitle.textContent = title;
  modalInput.value = '';
  modal.style.display = 'flex';
  
  // Assicurati che la finestra abbia il focus (utile in Electron)
  if (window.focus) {
    window.focus();
  }
  
  // Ritarda il focus sull'input per assicurarsi che il modal sia completamente visibile
  // Usa requestAnimationFrame per aspettare il prossimo frame di rendering
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      modalInput.focus();
      modalInput.select(); // Seleziona il testo esistente per facilitare la modifica
    });
  });
  
  // Enter key per confermare
  modalInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      confirmModal();
    }
  };
}

function confirmModal() {
  const modal = document.getElementById('name-modal');
  const modalInput = document.getElementById('modal-input');
  const name = modalInput.value.trim();
  
  modal.style.display = 'none';
  
  if (name && modalCallback) {
    modalCallback(name);
  }
  
  modalCallback = null;
}

function cancelModal() {
  const modal = document.getElementById('name-modal');
  modal.style.display = 'none';
  modalCallback = null;
}

// Esponi funzioni modal globalmente
window.confirmModal = confirmModal;
window.cancelModal = cancelModal;

// Determina l'URL del server
let socketUrl = '';
function initSocketUrl() {
  if (window.electronAPI && window.electronAPI.isElectron) {
    // In Electron, usa localhost (server integrato)
    socketUrl = 'http://localhost:3001';
    console.log('🔗 Config: usando localhost:3001 (Electron)');
  } else {
    // In browser, usa localStorage se disponibile, altrimenti window.location.origin
    const saved = localStorage.getItem('serverUrl');
    socketUrl = saved || window.location.origin;
    console.log('🔗 Config: usando server browser/mobile:', socketUrl);
  }
  console.log('✅ socketUrl configurato:', socketUrl);
}

// Inizializza subito
initSocketUrl();

// Riprova dopo che il DOM è caricato (per sicurezza nella build)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM caricato, verifica socketUrl');
    if (!socketUrl || socketUrl === '') {
      initSocketUrl();
    }
  });
}

// Carica eroi e nemici
async function loadHeroes() {
  try {
    // Verifica che socketUrl sia impostato
    if (!socketUrl) {
      initSocketUrl();
    }
    
    console.log('📥 Caricamento eroi da:', `${socketUrl}/api/config/heroes`);
    const response = await fetch(`${socketUrl}/api/config/heroes`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    heroes = await response.json();
    console.log('✅ Eroi caricati:', heroes.length);
    renderHeroes();
  } catch (e) {
    console.error('❌ Errore caricamento eroi:', e);
    console.error('   - socketUrl:', socketUrl);
    console.error('   - Errore completo:', e.message);
    heroes = [];
    renderHeroes();
    
    // Mostra un messaggio all'utente
    const errorMsg = `Errore nel caricamento degli eroi.\n\nVerifica che:\n1. Il server sia avviato\n2. L'app Electron sia in esecuzione\n3. La console per altri errori\n\nErrore: ${e.message}`;
    alert(errorMsg);
  }
}

async function loadEnemies() {
  try {
    // Assicurati che socketUrl sia impostato
    if (!socketUrl) {
      initSocketUrl();
    }
    console.log('📥 Caricamento nemici da:', `${socketUrl}/api/config/enemies`);
    const response = await fetch(`${socketUrl}/api/config/enemies`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    enemies = await response.json();
    console.log('✅ Nemici caricati:', enemies.length);
    renderEnemies();
  } catch (e) {
    console.error('❌ Errore caricamento nemici:', e);
    alert('Errore nel caricamento dei nemici: ' + e.message);
    enemies = [];
    renderEnemies();
  }
}

async function loadAllies() {
  try {
    // Assicurati che socketUrl sia impostato
    if (!socketUrl) {
      initSocketUrl();
    }
    console.log('📥 Caricamento NPC da:', `${socketUrl}/api/config/allies`);
    const response = await fetch(`${socketUrl}/api/config/allies`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    allies = await response.json();
    console.log('✅ NPC caricati:', allies.length);
    renderAllies();
  } catch (e) {
    console.error('❌ Errore caricamento NPC:', e);
    alert('Errore nel caricamento degli NPC: ' + e.message);
    allies = [];
    renderAllies();
  }
}

// Rendering
function renderHeroes() {
  const grid = document.getElementById('heroes-grid');
  grid.innerHTML = heroes.map(hero => {
    const imageUrl = hero.image ? (hero.image.startsWith('http') ? hero.image : `${socketUrl}${hero.image}`) : null;
    return `
    <div class="character-config-card">
      <button class="delete-char-btn" onclick="deleteHero('${hero.id}')">×</button>
      ${imageUrl ? 
        `<img src="${imageUrl}" alt="${hero.name}" class="char-preview" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">` +
        `<div class="char-icon-preview" style="display:none;">👤</div>` :
        `<div class="char-icon-preview">👤</div>`
      }
      <div class="char-config-form">
        <label>Nome:</label>
        <input type="text" value="${hero.name}" onchange="updateHero('${hero.id}', 'name', this.value)">
        <label>Immagine:</label>
        <div class="file-upload-area" onclick="document.getElementById('hero-img-${hero.id}').click()">
          <input type="file" id="hero-img-${hero.id}" accept="image/*" onchange="uploadHeroImage('${hero.id}', this.files[0])">
          ${hero.image ? 'Cambia immagine' : 'Carica immagine'}
        </div>
      </div>
    </div>
    `;
  }).join('');
}

function renderEnemies() {
  const grid = document.getElementById('enemies-grid');
  if (!grid) {
    console.error('❌ renderEnemies: enemies-grid non trovato nel DOM');
    return;
  }
  
  console.log('🎨 renderEnemies chiamato, nemici da renderizzare:', enemies.length);
  console.log('📋 IDs nemici:', enemies.map(e => e.id));
  console.log('📋 Nomi nemici:', enemies.map(e => e.name));
  
  grid.innerHTML = enemies.map(enemy => {
    const imageUrl = enemy.image ? (enemy.image.startsWith('http') ? enemy.image : `${socketUrl}${enemy.image}`) : null;
    return `
    <div class="character-config-card">
      <button class="delete-char-btn" onclick="deleteEnemy('${enemy.id}')">×</button>
      ${imageUrl ? 
        `<img src="${imageUrl}" alt="${enemy.name}" class="char-preview" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">` +
        `<div class="char-icon-preview" style="display:none;">👹</div>` :
        `<div class="char-icon-preview">👹</div>`
      }
      <div class="char-config-form">
        <label>Nome:</label>
        <input type="text" value="${enemy.name}" onchange="updateEnemy('${enemy.id}', 'name', this.value)">
        <label>Immagine:</label>
        <div class="file-upload-area" onclick="document.getElementById('enemy-img-${enemy.id}').click()">
          <input type="file" id="enemy-img-${enemy.id}" accept="image/*" onchange="uploadEnemyImage('${enemy.id}', this.files[0])">
          ${enemy.image ? 'Cambia immagine' : 'Carica immagine'}
        </div>
      </div>
    </div>
    `;
  }).join('');
  
  console.log('✅ renderEnemies completato, card renderizzate:', enemies.length);
}

function renderAllies() {
  const grid = document.getElementById('allies-grid');
  if (!grid) {
    console.error('❌ renderAllies: allies-grid non trovato nel DOM');
    return;
  }
  
  console.log('🎨 renderAllies chiamato, allies da renderizzare:', allies.length);
  console.log('📋 IDs allies:', allies.map(a => a.id));
  
  grid.innerHTML = allies.map(ally => {
    const imageUrl = ally.image ? (ally.image.startsWith('http') ? ally.image : `${socketUrl}${ally.image}`) : null;
    return `
    <div class="character-config-card">
      <button class="delete-char-btn" onclick="deleteAlly('${ally.id}')">×</button>
      ${imageUrl ? 
        `<img src="${imageUrl}" alt="${ally.name}" class="char-preview" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">` +
        `<div class="char-icon-preview" style="display:none;">🤝</div>` :
        `<div class="char-icon-preview">🤝</div>`
      }
      <div class="char-config-form">
        <label>Nome:</label>
        <input type="text" value="${ally.name}" onchange="updateAlly('${ally.id}', 'name', this.value)">
        <label>Immagine:</label>
        <div class="file-upload-area" onclick="document.getElementById('ally-img-${ally.id}').click()">
          <input type="file" id="ally-img-${ally.id}" accept="image/*" onchange="uploadAllyImage('${ally.id}', this.files[0])">
          ${ally.image ? 'Cambia immagine' : 'Carica immagine'}
        </div>
      </div>
    </div>
    `;
  }).join('');
  
  console.log('✅ renderAllies completato, card renderizzate:', allies.length);
}

// Carica effetti
async function loadEffects() {
  try {
    if (!socketUrl) {
      initSocketUrl();
    }
    console.log('📥 Caricamento effetti da:', `${socketUrl}/api/config/effects`);
    const response = await fetch(`${socketUrl}/api/config/effects`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    effects = await response.json();
    console.log('✅ Effetti caricati:', effects.length);
    renderEffects();
  } catch (e) {
    console.error('❌ Errore caricamento effetti:', e);
    alert('Errore nel caricamento degli effetti: ' + e.message);
    effects = [];
    renderEffects();
  }
}

// Rendering effetti
function renderEffects() {
  const list = document.getElementById('effects-list');
  if (!list) {
    console.error('❌ renderEffects: effects-list non trovato nel DOM');
    return;
  }
  
  console.log('🎨 renderEffects chiamato, effetti da renderizzare:', effects.length);
  
  list.innerHTML = effects.map(effect => {
    return `
    <div class="character-config-card">
      <button class="delete-char-btn" onclick="deleteEffect('${effect.id}')">×</button>
      <div class="char-config-form">
        <label>Nome:</label>
        <input type="text" value="${effect.name}" onchange="updateEffect('${effect.id}', 'name', this.value)">
      </div>
    </div>
    `;
  }).join('');
  
  console.log('✅ renderEffects completato, card renderizzate:', effects.length);
}

// Carica evocazioni
async function loadSummons() {
  try {
    if (!socketUrl) {
      initSocketUrl();
    }
    console.log('📥 Caricamento evocazioni da:', `${socketUrl}/api/config/summons`);
    const response = await fetch(`${socketUrl}/api/config/summons`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    summons = await response.json();
    console.log('✅ Evocazioni caricate:', summons.length);
    renderSummons();
  } catch (e) {
    console.error('❌ Errore caricamento evocazioni:', e);
    alert('Errore nel caricamento delle evocazioni: ' + e.message);
    summons = [];
    renderSummons();
  }
}

// Rendering evocazioni
function renderSummons() {
  const grid = document.getElementById('summons-grid');
  if (!grid) {
    console.error('❌ renderSummons: summons-grid non trovato nel DOM');
    return;
  }
  
  console.log('🎨 renderSummons chiamato, evocazioni da renderizzare:', summons.length);
  
  grid.innerHTML = summons.map(summon => {
    const imageUrl = summon.image ? (summon.image.startsWith('http') ? summon.image : `${socketUrl}${summon.image}`) : null;
    return `
    <div class="character-config-card">
      <button class="delete-char-btn" onclick="deleteSummon('${summon.id}')">×</button>
      ${imageUrl ? 
        `<img src="${imageUrl}" alt="${summon.name}" class="char-preview" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">` +
        `<div class="char-icon-preview" style="display:none;">🔮</div>` :
        `<div class="char-icon-preview">🔮</div>`
      }
      <div class="char-config-form">
        <label>Nome:</label>
        <input type="text" value="${summon.name}" onchange="updateSummon('${summon.id}', 'name', this.value)">
        <label>Immagine:</label>
        <div class="file-upload-area" onclick="document.getElementById('summon-img-${summon.id}').click()">
          <input type="file" id="summon-img-${summon.id}" accept="image/*" onchange="uploadSummonImage('${summon.id}', this.files[0])">
          ${summon.image ? 'Cambia immagine' : 'Carica immagine'}
        </div>
      </div>
    </div>
    `;
  }).join('');
  
  console.log('✅ renderSummons completato, card renderizzate:', summons.length);
}

// Upload immagini
async function uploadHeroImage(heroId, file) {
  if (!file) return;
  
  // Assicurati che socketUrl sia impostato
  if (!socketUrl) {
    initSocketUrl();
  }
  
  const formData = new FormData();
  formData.append('image', file);
  formData.append('heroId', heroId);
  
  try {
    const url = `${socketUrl}/api/config/heroes/upload`;
    console.log('📤 Upload immagine eroe:', heroId, 'URL:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });
    
    console.log('📥 Risposta upload eroe:', response.status, response.statusText);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Immagine eroe caricata:', result);
      await loadHeroes();
      alert('Immagine caricata con successo!');
    } else {
      const error = await response.text();
      console.error('❌ Errore upload:', error);
      throw new Error('Errore upload: ' + error);
    }
  } catch (e) {
    console.error('❌ Errore upload immagine eroe:', e);
    alert('Errore nel caricamento dell\'immagine: ' + e.message);
  }
}

async function uploadEnemyImage(enemyId, file) {
  if (!file) return;
  
  // Assicurati che socketUrl sia impostato
  if (!socketUrl) {
    initSocketUrl();
  }
  
  const formData = new FormData();
  formData.append('image', file);
  formData.append('enemyId', enemyId);
  
  try {
    const url = `${socketUrl}/api/config/enemies/upload`;
    console.log('📤 Upload immagine nemico:', enemyId, 'URL:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });
    
    console.log('📥 Risposta upload nemico:', response.status, response.statusText);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Immagine nemico caricata:', result);
      await loadEnemies();
      alert('Immagine caricata con successo!');
    } else {
      const error = await response.text();
      console.error('❌ Errore upload:', error);
      throw new Error('Errore upload: ' + error);
    }
  } catch (e) {
    console.error('❌ Errore upload immagine nemico:', e);
    alert('Errore nel caricamento dell\'immagine: ' + e.message);
  }
}

async function uploadAllyImage(allyId, file) {
  if (!file) return;
  
  // Assicurati che socketUrl sia impostato
  if (!socketUrl) {
    initSocketUrl();
  }
  
  const formData = new FormData();
  formData.append('image', file);
  formData.append('allyId', allyId);
  
  try {
    const url = `${socketUrl}/api/config/allies/upload`;
    console.log('📤 Upload immagine NPC:', allyId, 'URL:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });
    
    console.log('📥 Risposta upload NPC:', response.status, response.statusText);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Immagine NPC caricata:', result);
      await loadAllies();
      alert('Immagine caricata con successo!');
    } else {
      const error = await response.text();
      console.error('❌ Errore upload:', error);
      throw new Error('Errore upload: ' + error);
    }
  } catch (e) {
    console.error('❌ Errore upload immagine NPC:', e);
    alert('Errore nel caricamento dell\'immagine: ' + e.message);
  }
}

// Aggiorna eroe
async function updateHero(heroId, field, value) {
  try {
    const response = await fetch(`${socketUrl}/api/config/heroes/${heroId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
    
    if (response.ok) {
      await loadHeroes();
    }
  } catch (e) {
    console.error('Errore aggiornamento eroe:', e);
  }
}

// Aggiorna nemico
async function updateEnemy(enemyId, field, value) {
  try {
    const response = await fetch(`${socketUrl}/api/config/enemies/${enemyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
    
    if (response.ok) {
      await loadEnemies();
    }
  } catch (e) {
    console.error('Errore aggiornamento nemico:', e);
  }
}

// Aggiorna NPC
async function updateAlly(allyId, field, value) {
  try {
    const response = await fetch(`${socketUrl}/api/config/allies/${allyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
    
    if (response.ok) {
      await loadAllies();
    }
  } catch (e) {
    console.error('Errore aggiornamento NPC:', e);
  }
}

// Aggiungi nuovo eroe
async function addNewHero() {
  showModal('Nome del nuovo eroe:', async (name) => {
    if (!name) return;
    
    try {
      const response = await fetch(`${socketUrl}/api/config/heroes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      
      if (response.ok) {
        await loadHeroes();
      } else {
        const error = await response.text();
        console.error('Errore risposta:', error);
        alert('Errore durante l\'aggiunta dell\'eroe');
      }
    } catch (e) {
      console.error('Errore aggiunta eroe:', e);
      alert('Errore durante l\'aggiunta dell\'eroe: ' + e.message);
    }
  });
}

// Aggiungi nuovo nemico
async function addNewEnemy() {
  showModal('Nome del nuovo nemico:', async (name) => {
    if (!name) return;
    
    try {
      // Assicurati che socketUrl sia impostato
      if (!socketUrl) {
        initSocketUrl();
      }
      
      const url = `${socketUrl}/api/config/enemies`;
      console.log('📤 Aggiunta nemico:', name, 'URL:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      
      console.log('📥 Risposta aggiunta nemico:', response.status, response.statusText);
      
      if (response.ok) {
        console.log('🔄 Parsing JSON risposta...');
        const data = await response.json();
        console.log('✅ Nemico aggiunto:', data);
        console.log('📋 Dettagli nemico aggiunto - ID:', data.id, 'Nome:', data.name);
        console.log('🔄 Ricarico lista nemici...');
        await loadEnemies();
        console.log('✅ Lista nemici ricaricata');
      } else {
        const error = await response.text();
        console.error('❌ Errore risposta:', error);
        alert('Errore durante l\'aggiunta del nemico: ' + error);
      }
    } catch (e) {
      console.error('❌ Errore aggiunta nemico:', e);
      alert('Errore durante l\'aggiunta del nemico: ' + e.message);
    }
  });
}

// Aggiungi nuovo NPC
async function addNewAlly() {
  showModal('Nome del nuovo NPC:', async (name) => {
    if (!name) return;
    
    try {
      // Assicurati che socketUrl sia impostato
      if (!socketUrl) {
        initSocketUrl();
      }
      
      const url = `${socketUrl}/api/config/allies`;
      console.log('📤 Aggiunta NPC:', name, 'URL:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      
      console.log('📥 Risposta aggiunta NPC:', response.status, response.statusText);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ NPC aggiunto:', data);
        console.log('🔄 Ricarico lista NPC...');
        await loadAllies();
        console.log('✅ Lista NPC ricaricata');
      } else {
        const error = await response.text();
        console.error('❌ Errore risposta:', error);
        alert('Errore durante l\'aggiunta del NPC: ' + error);
      }
    } catch (e) {
      console.error('❌ Errore aggiunta NPC:', e);
      alert('Errore durante l\'aggiunta del NPC: ' + e.message);
    }
  });
}

// Aggiungi nuovo effetto
async function addNewEffect() {
  showModal('Nome del nuovo effetto:', async (name) => {
    if (!name) return;
    
    try {
      if (!socketUrl) {
        initSocketUrl();
      }
      
      const url = `${socketUrl}/api/config/effects`;
      console.log('📤 Aggiunta effetto:', name, 'URL:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Effetto aggiunto:', result);
        await loadEffects();
      } else {
        const error = await response.text();
        console.error('❌ Errore risposta:', error);
        alert('Errore durante l\'aggiunta dell\'effetto: ' + error);
      }
    } catch (e) {
      console.error('❌ Errore aggiunta effetto:', e);
      alert('Errore durante l\'aggiunta dell\'effetto: ' + e.message);
    }
  });
}

// Aggiorna effetto
async function updateEffect(effectId, field, value) {
  try {
    // Gli effetti sono semplici, ricreiamo l'effetto con il nuovo nome
    const config = await fetch(`${socketUrl}/api/config/effects`);
    const effects = await config.json();
    const effect = effects.find(e => e.id === effectId);
    if (effect) {
      // Elimina il vecchio e crea il nuovo
      await fetch(`${socketUrl}/api/config/effects/${effectId}`, {
        method: 'DELETE'
      });
      await fetch(`${socketUrl}/api/config/effects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value })
      });
      await loadEffects();
    }
  } catch (e) {
    console.error('Errore aggiornamento effetto:', e);
  }
}

// Elimina effetto
async function deleteEffect(effectId) {
  if (!confirm('Sei sicuro di voler eliminare questo effetto?')) return;
  
  try {
    const response = await fetch(`${socketUrl}/api/config/effects/${effectId}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      await loadEffects();
    }
  } catch (e) {
    console.error('Errore eliminazione effetto:', e);
  }
}

// Aggiungi nuova evocazione
async function addNewSummon() {
  showModal('Nome della nuova evocazione:', async (name) => {
    if (!name) return;
    
    try {
      if (!socketUrl) {
        initSocketUrl();
      }
      
      const url = `${socketUrl}/api/config/summons`;
      console.log('📤 Aggiunta evocazione:', name, 'URL:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Evocazione aggiunta:', result);
        await loadSummons();
      } else {
        const error = await response.text();
        console.error('❌ Errore risposta:', error);
        alert('Errore durante l\'aggiunta dell\'evocazione: ' + error);
      }
    } catch (e) {
      console.error('❌ Errore aggiunta evocazione:', e);
      alert('Errore durante l\'aggiunta dell\'evocazione: ' + e.message);
    }
  });
}

// Aggiorna evocazione
async function updateSummon(summonId, field, value) {
  try {
    const response = await fetch(`${socketUrl}/api/config/summons/${summonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
    
    if (response.ok) {
      await loadSummons();
    }
  } catch (e) {
    console.error('Errore aggiornamento evocazione:', e);
  }
}

// Elimina evocazione
async function deleteSummon(summonId) {
  if (!confirm('Sei sicuro di voler eliminare questa evocazione?')) return;
  
  try {
    const response = await fetch(`${socketUrl}/api/config/summons/${summonId}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      await loadSummons();
    }
  } catch (e) {
    console.error('Errore eliminazione evocazione:', e);
  }
}

// Upload immagine evocazione
async function uploadSummonImage(summonId, file) {
  if (!file) return;
  
  if (!socketUrl) {
    initSocketUrl();
  }
  
  const formData = new FormData();
  formData.append('image', file);
  formData.append('summonId', summonId);
  
  try {
    const url = `${socketUrl}/api/config/summons/upload`;
    console.log('📤 Upload immagine evocazione:', summonId, 'URL:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Immagine evocazione caricata:', result);
      await loadSummons();
      alert('Immagine caricata con successo!');
    } else {
      const error = await response.text();
      console.error('❌ Errore upload:', error);
      throw new Error('Errore upload: ' + error);
    }
  } catch (e) {
    console.error('❌ Errore upload immagine evocazione:', e);
    alert('Errore nel caricamento dell\'immagine: ' + e.message);
  }
}

// Elimina eroe
async function deleteHero(heroId) {
  if (!confirm('Sei sicuro di voler eliminare questo eroe?')) return;
  
  try {
    const response = await fetch(`${socketUrl}/api/config/heroes/${heroId}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      await loadHeroes();
    }
  } catch (e) {
    console.error('Errore eliminazione eroe:', e);
  }
}

// Elimina nemico
async function deleteEnemy(enemyId) {
  if (!confirm('Sei sicuro di voler eliminare questo nemico?')) return;
  
  try {
    const response = await fetch(`${socketUrl}/api/config/enemies/${enemyId}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      await loadEnemies();
    }
  } catch (e) {
    console.error('Errore eliminazione nemico:', e);
  }
}

// Elimina NPC
async function deleteAlly(allyId) {
  if (!confirm('Sei sicuro di voler eliminare questo NPC?')) return;
  
  try {
    const response = await fetch(`${socketUrl}/api/config/allies/${allyId}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      await loadAllies();
    }
  } catch (e) {
    console.error('Errore eliminazione NPC:', e);
  }
}

// Esponi funzioni globalmente per onclick
window.addNewHero = addNewHero;
window.addNewEnemy = addNewEnemy;
window.addNewAlly = addNewAlly;
window.addNewEffect = addNewEffect;
window.addNewSummon = addNewSummon;
window.deleteHero = deleteHero;
window.deleteEnemy = deleteEnemy;
window.deleteAlly = deleteAlly;
window.deleteEffect = deleteEffect;
window.deleteSummon = deleteSummon;
window.updateHero = updateHero;
window.updateEnemy = updateEnemy;
window.updateAlly = updateAlly;
window.updateEffect = updateEffect;
window.updateSummon = updateSummon;
window.uploadHeroImage = uploadHeroImage;
window.uploadEnemyImage = uploadEnemyImage;
window.uploadAllyImage = uploadAllyImage;
window.uploadSummonImage = uploadSummonImage;

// Tab switching
document.querySelectorAll('.config-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    
    // Update tabs
    document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Update content
    document.querySelectorAll('.config-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
  });
});

// Back button
function setupBackButton() {
  const backBtn = document.getElementById('back-to-rooms-btn');
  if (backBtn) {
    backBtn.addEventListener('click', async () => {
      try {
        if (window.electronAPI && window.electronAPI.isElectron) {
          await window.electronAPI.backToRooms();
        } else {
          window.location.href = '/room-selector.html';
        }
      } catch (error) {
        console.error('Errore:', error);
        window.location.href = '/room-selector.html';
      }
    });
  }
}

// Funzione per attendere che il server sia pronto
async function waitForServer(maxAttempts = 10, delay = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // Timeout di 2 secondi
      
      const response = await fetch(`${socketUrl}/api/config/heroes`, { 
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        console.log('✅ Server pronto!');
        return true;
      }
    } catch (e) {
      // Server non ancora pronto, aspetta
      if (i < maxAttempts - 1) {
        console.log(`⏳ Server non ancora pronto, tentativo ${i + 1}/${maxAttempts}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  console.warn('⚠️ Server non risponde dopo', maxAttempts, 'tentativi');
  return false;
}

// Inizializzazione
async function initialize() {
  setupBackButton();
  
  // Assicurati che socketUrl sia impostato
  if (!socketUrl) {
    initSocketUrl();
  }
  
  // Mostra/nascondi tab in base al ruolo
  if (window.electronAPI && window.electronAPI.isElectron) {
    // Master: mostra tutti i tab (incluso evocazioni)
    // Non nascondere nulla - tutti i tab sono visibili
  } else {
    // Giocatori: nascondi tab eroi/nemici, mostra solo evocazioni ed effetti
    const heroesTab = document.querySelector('.config-tab[data-tab="heroes"]');
    const enemiesTab = document.querySelector('.config-tab[data-tab="enemies"]');
    const alliesTab = document.querySelector('.config-tab[data-tab="allies"]');
    if (heroesTab) heroesTab.style.display = 'none';
    if (enemiesTab) enemiesTab.style.display = 'none';
    if (alliesTab) alliesTab.style.display = 'none';
    
    // Attiva tab evocazioni di default per giocatori
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab');
    if (tab === 'summons' || !tab) {
      setTimeout(() => {
        const summonsTab = document.querySelector('.config-tab[data-tab="summons"]');
        if (summonsTab) {
          document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.config-content').forEach(c => c.classList.remove('active'));
          summonsTab.classList.add('active');
          const summonsContent = document.getElementById('summons-tab');
          if (summonsContent) summonsContent.classList.add('active');
        }
      }, 100);
    }
  }
  
  // Attendi che il server sia pronto (solo in Electron)
  if (window.electronAPI && window.electronAPI.isElectron) {
    const serverReady = await waitForServer();
    if (!serverReady) {
      console.error('❌ Server non disponibile! Verifica la console di Electron per errori.');
      alert('⚠️ Il server non è disponibile!\n\nVerifica la console di Electron per errori.\n\nPossibili cause:\n- Porta 3000 occupata\n- Errore durante l\'avvio\n- File mancanti');
    }
  }
  
  // Mostra/nascondi tab in base al ruolo
  if (window.electronAPI && window.electronAPI.isElectron) {
    // Master: mostra tutti i tab, carica tutto
    loadHeroes();
    loadEnemies();
    loadAllies();
    loadEffects();
    loadSummons();
  } else {
    // Giocatori: mostra solo Evocazioni ed Effetti
    const heroesTab = document.querySelector('.config-tab[data-tab="heroes"]');
    const enemiesTab = document.querySelector('.config-tab[data-tab="enemies"]');
    const alliesTab = document.querySelector('.config-tab[data-tab="allies"]');
    if (heroesTab) heroesTab.style.display = 'none';
    if (enemiesTab) enemiesTab.style.display = 'none';
    if (alliesTab) alliesTab.style.display = 'none';
    
    // Carica solo evocazioni ed effetti per i giocatori
    loadEffects();
    loadSummons();
    
    // Attiva tab evocazioni di default per giocatori
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab');
    if (tab === 'summons' || !tab) {
      setTimeout(() => {
        const summonsTab = document.querySelector('.config-tab[data-tab="summons"]');
        if (summonsTab) {
          document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.config-content').forEach(c => c.classList.remove('active'));
          summonsTab.classList.add('active');
          const summonsContent = document.getElementById('summons-tab');
          if (summonsContent) summonsContent.classList.add('active');
        }
      }, 100);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

