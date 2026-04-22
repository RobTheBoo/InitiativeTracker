// UI helpers condivisi: toast connessione, snackbar, animazione transizione turno tablet.
// Caricato da index.html, master.html, tablet.html. Self-contained, no deps.

(function() {
  // -----------------------------------------------------------------------
  // Connection status toast
  // -----------------------------------------------------------------------
  function ensureConnToast() {
    let el = document.getElementById('rpg-conn-toast');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'rpg-conn-toast';
    el.className = 'conn-toast';
    el.innerHTML = '<span class="conn-dot"></span><span class="conn-label">…</span>';
    document.body.appendChild(el);
    return el;
  }

  let lastStatus = null;
  let hideTimer = null;
  function setConnStatus(status, label) {
    const el = ensureConnToast();
    if (lastStatus === status && el.querySelector('.conn-label').textContent === label) return;
    lastStatus = status;
    el.classList.remove('connected', 'disconnected', 'reconnecting');
    el.classList.add(status);
    el.querySelector('.conn-label').textContent = label;
    el.classList.add('visible');
    if (hideTimer) clearTimeout(hideTimer);
    if (status === 'connected') {
      hideTimer = setTimeout(() => el.classList.remove('visible'), 2500);
    }
  }

  // Aggancia automaticamente al socket globale se presente (window.socket viene definito dalle viste)
  function bindToSocket(socket) {
    if (!socket || typeof socket.on !== 'function') return;
    socket.on('connect', () => setConnStatus('connected', 'Connesso'));
    socket.on('disconnect', () => setConnStatus('disconnected', 'Disconnesso'));
    socket.io?.on?.('reconnect_attempt', (n) => setConnStatus('reconnecting', `Riconnessione… (${n})`));
    socket.io?.on?.('reconnect_failed', () => setConnStatus('disconnected', 'Riconnessione fallita'));
    if (socket.connected) setConnStatus('connected', 'Connesso');
  }

  // -----------------------------------------------------------------------
  // Snackbar generico
  // -----------------------------------------------------------------------
  function snackbar(msg, kind = 'info', duration = 3000) {
    let el = document.getElementById('rpg-snackbar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rpg-snackbar';
      el.className = 'snackbar';
      document.body.appendChild(el);
    }
    el.classList.remove('success', 'error', 'warning');
    if (kind && kind !== 'info') el.classList.add(kind);
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('visible'), duration);
  }

  // -----------------------------------------------------------------------
  // Tablet: animazione transizione turno
  // -----------------------------------------------------------------------
  let lastTurnIndex = -1;
  function animateTurnChange(currentTurnEl, newIndex) {
    if (!currentTurnEl) return;
    if (lastTurnIndex === newIndex) return;
    if (lastTurnIndex !== -1) {
      currentTurnEl.classList.add('turn-changing');
      setTimeout(() => {
        currentTurnEl.classList.remove('turn-changing', 'turn-arriving');
        // forza reflow per ri-applicare l'animazione
        // eslint-disable-next-line no-unused-expressions
        void currentTurnEl.offsetWidth;
        currentTurnEl.classList.add('turn-arriving');
        setTimeout(() => currentTurnEl.classList.remove('turn-arriving'), 700);
      }, 180);
    }
    lastTurnIndex = newIndex;
  }

  // Esponi globalmente
  window.RPG_UI = {
    setConnStatus,
    bindToSocket,
    snackbar,
    animateTurnChange
  };

  // Auto-bind quando window.socket diventa disponibile
  function tryAutoBind(retries = 30) {
    if (window.socket && typeof window.socket.on === 'function') {
      bindToSocket(window.socket);
      return;
    }
    if (retries > 0) setTimeout(() => tryAutoBind(retries - 1), 200);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tryAutoBind());
  } else {
    tryAutoBind();
  }
})();
