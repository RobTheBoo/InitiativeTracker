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

  // -----------------------------------------------------------------------
  // PWA install prompt
  // - Su Chrome/Android: capta beforeinstallprompt e mostra banner
  // - Su iOS Safari (no beforeinstallprompt): mostra istruzioni "Aggiungi a Home"
  // -----------------------------------------------------------------------
  let deferredInstallPrompt = null;
  function setupPwaInstall() {
    // Non in Electron, non in Capacitor (la' non serve)
    if (window.electronAPI && window.electronAPI.isElectron) return;
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return;
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
    if (window.navigator.standalone === true) return;

    const dismissedAt = parseInt(localStorage.getItem('pwaPromptDismissed') || '0', 10);
    if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return; // non ri-proporre per 7 giorni

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      showInstallBanner('android');
    });

    // iOS rilevamento
    const ua = window.navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
    if (isIOS && isSafari) {
      // Aspetta un attimo per non infastidire al primo paint
      setTimeout(() => showInstallBanner('ios'), 4000);
    }
  }

  function showInstallBanner(platform) {
    if (document.getElementById('rpg-install-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'rpg-install-banner';
    banner.style.cssText = `
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      background: rgba(15, 15, 25, 0.96); color: var(--text-light, #e8e6e3);
      border: 1px solid var(--border-gold, #a08050); border-radius: 10px;
      padding: 14px 18px; max-width: calc(100vw - 24px); width: 360px;
      z-index: 10001; box-shadow: 0 8px 24px rgba(0,0,0,0.5); font-family: 'Crimson Text', serif;
      backdrop-filter: blur(8px);
    `;
    if (platform === 'android') {
      banner.innerHTML = `
        <div style="font-weight:bold;margin-bottom:6px;color:var(--accent-gold,#f0c674);">📲 Installa l'app</div>
        <div style="font-size:0.9rem;margin-bottom:10px;">Aggiungi RPG Tracker alla home per giocare in fullscreen.</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="rpg-install-no" style="background:none;border:1px solid #555;color:inherit;padding:6px 14px;border-radius:6px;cursor:pointer;">Più tardi</button>
          <button id="rpg-install-yes" style="background:var(--accent-gold,#f0c674);border:0;color:#1a1a2e;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:bold;">Installa</button>
        </div>`;
    } else {
      banner.innerHTML = `
        <div style="font-weight:bold;margin-bottom:6px;color:var(--accent-gold,#f0c674);">📲 Installa su iPhone</div>
        <div style="font-size:0.88rem;margin-bottom:10px;line-height:1.4;">
          Tocca <strong>Condividi</strong> in basso, poi <strong>"Aggiungi alla schermata Home"</strong>.
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button id="rpg-install-no" style="background:none;border:1px solid #555;color:inherit;padding:6px 14px;border-radius:6px;cursor:pointer;">Ho capito</button>
        </div>`;
    }
    document.body.appendChild(banner);
    const no = document.getElementById('rpg-install-no');
    const yes = document.getElementById('rpg-install-yes');
    if (no) no.addEventListener('click', () => {
      localStorage.setItem('pwaPromptDismissed', String(Date.now()));
      banner.remove();
    });
    if (yes) yes.addEventListener('click', async () => {
      banner.remove();
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try { await deferredInstallPrompt.userChoice; } catch (_) {}
        deferredInstallPrompt = null;
      }
    });
  }

  // Esponi globalmente
  window.RPG_UI = {
    setConnStatus,
    bindToSocket,
    snackbar,
    animateTurnChange,
    setupPwaInstall
  };

  // Auto-setup PWA install prompt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupPwaInstall);
  } else {
    setupPwaInstall();
  }

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
