/**
 * theme-toggle.js — RPG Initiative Tracker
 *
 * Gestisce:
 *   1) Tema dark/light persistito in localStorage('rpg-theme')
 *      - se mai impostato: legge prefers-color-scheme
 *   2) Mode orientation tablet: persistito in localStorage('rpg-tablet-mode')
 *      - 'landscape-lock' (default) | 'responsive'
 *   3) Aggiorna <meta name="theme-color"> dinamicamente quando cambia tema
 *   4) Espone window.RpgUI con icone SVG Lucide-style usate dall'app
 *
 * Autosetup: legge gli attributi `data-theme-toggle-into="<selector>"` e
 * `data-tablet-mode-toggle-into="<selector>"` su <body> o su un elemento
 * specifico, e inietta i bottoni nelle posizioni indicate.
 *
 * NOTA: niente dipendenze esterne. ESM-free, vanilla. Caricabile come
 * <script defer src="theme-toggle.js"></script>.
 */
(function () {
  'use strict';

  // ============================================================
  // ICONE SVG (Lucide-style, ~24x24, currentColor)
  // ============================================================
  const ICONS = {
    sun: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
    moon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    monitor: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    rotate: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3.51-7.13"/><path d="M21 5v5h-5"/></svg>',
    smartphone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
    smartphoneLandscape: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M18 12h.01"/></svg>',
    rotateAuto: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/><path d="M3 12a9 9 0 0 1 14-7.5"/><path d="M21 12a9 9 0 0 1-14 7.5"/></svg>',
    settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
  };

  // ============================================================
  // THEME (dark/light)
  // ============================================================
  const THEME_KEY = 'rpg-theme';
  const VALID_THEMES = ['dark', 'light'];

  function readStoredTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return VALID_THEMES.includes(v) ? v : null;
    } catch { return null; }
  }

  function systemPrefersLight() {
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches;
    } catch { return false; }
  }

  function resolvedTheme() {
    return readStoredTheme() || (systemPrefersLight() ? 'light' : 'dark');
  }

  function applyTheme(theme) {
    if (!VALID_THEMES.includes(theme)) theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);

    // Aggiorna meta theme-color (statusbar PWA Android, address bar mobile)
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'light' ? '#f4f1ea' : '#1a1a2e');
    }

    // Notifica eventi per chi vuole reagire (es. ridisegnare canvas/QR)
    try {
      window.dispatchEvent(new CustomEvent('rpg-theme-change', { detail: { theme } }));
    } catch { /* no-op */ }
  }

  function setTheme(theme) {
    if (!VALID_THEMES.includes(theme)) return;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* no-op */ }
    applyTheme(theme);
  }

  function toggleTheme() {
    setTheme(resolvedTheme() === 'light' ? 'dark' : 'light');
  }

  // ============================================================
  // TABLET ORIENTATION MODE
  // ============================================================
  const TABLET_MODE_KEY = 'rpg-tablet-mode';
  const VALID_TABLET_MODES = ['landscape-lock', 'responsive'];

  function readStoredTabletMode() {
    try {
      const v = localStorage.getItem(TABLET_MODE_KEY);
      return VALID_TABLET_MODES.includes(v) ? v : 'landscape-lock';
    } catch { return 'landscape-lock'; }
  }

  function applyTabletMode(mode) {
    if (!VALID_TABLET_MODES.includes(mode)) mode = 'landscape-lock';
    if (document.body && document.body.classList.contains('tablet-view')) {
      document.body.setAttribute('data-orient-mode', mode);
    }
  }

  function setTabletMode(mode) {
    if (!VALID_TABLET_MODES.includes(mode)) return;
    try { localStorage.setItem(TABLET_MODE_KEY, mode); } catch { /* no-op */ }
    applyTabletMode(mode);
  }

  function toggleTabletMode() {
    setTabletMode(readStoredTabletMode() === 'responsive' ? 'landscape-lock' : 'responsive');
  }

  // ============================================================
  // ORIENT LOCK (auto / portrait / landscape) — per cellulare/APK
  // ============================================================
  // 3 livelli di lock con fallback graduale:
  //  1. Capacitor native plugin (APK Android)
  //  2. Web Screen Orientation API (PWA standalone)
  //  3. Overlay "ruota il telefono" se i due sopra non hanno effetto e l'orientamento
  //     fisico del device non corrisponde a quello richiesto
  const ORIENT_KEY = 'rpg-orient-lock';
  const VALID_ORIENTS = ['auto', 'portrait', 'landscape'];

  function readStoredOrient() {
    try {
      const v = localStorage.getItem(ORIENT_KEY);
      return VALID_ORIENTS.includes(v) ? v : 'auto';
    } catch { return 'auto'; }
  }

  function isCapacitorNative() {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch { return false; }
  }

  function getNativeOrientPlugin() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScreenOrientation) {
        return window.Capacitor.Plugins.ScreenOrientation;
      }
    } catch { /* no-op */ }
    return null;
  }

  function currentDeviceOrientation() {
    try {
      // Primary source: window.screen.orientation.type
      if (window.screen && window.screen.orientation && window.screen.orientation.type) {
        return window.screen.orientation.type.startsWith('portrait') ? 'portrait' : 'landscape';
      }
    } catch { /* no-op */ }
    // Fallback: aspect ratio
    return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
  }

  async function applyOrientLock(mode) {
    if (!VALID_ORIENTS.includes(mode)) mode = 'auto';
    document.documentElement.setAttribute('data-orient-lock', mode);

    // Livello 1: native plugin (APK)
    const native = getNativeOrientPlugin();
    if (native) {
      try {
        if (mode === 'auto') {
          if (typeof native.unlock === 'function') await native.unlock();
        } else {
          await native.lock({ orientation: mode });
        }
      } catch (e) { /* ignora, passa al fallback */ }
    }

    // Livello 2: Web API (PWA standalone)
    if (!native) {
      try {
        if (window.screen && window.screen.orientation) {
          if (mode === 'auto') {
            if (typeof window.screen.orientation.unlock === 'function') {
              window.screen.orientation.unlock();
            }
          } else if (typeof window.screen.orientation.lock === 'function') {
            // Promise; in browser desktop verrà rifiutato silenziosamente
            const p = window.screen.orientation.lock(mode);
            if (p && typeof p.catch === 'function') p.catch(() => { /* no-op */ });
          }
        }
      } catch { /* no-op */ }
    }

    // Livello 3: overlay (sempre valutato)
    refreshOrientOverlay(mode);
  }

  function setOrientLock(mode) {
    if (!VALID_ORIENTS.includes(mode)) return;
    try { localStorage.setItem(ORIENT_KEY, mode); } catch { /* no-op */ }
    applyOrientLock(mode);
  }

  function cycleOrientLock() {
    const cur = readStoredOrient();
    const next = cur === 'auto' ? 'portrait' : (cur === 'portrait' ? 'landscape' : 'auto');
    setOrientLock(next);
  }

  // ---- Overlay "ruota il telefono" ----
  function ensureOrientOverlay() {
    let el = document.getElementById('rpg-orient-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'rpg-orient-overlay';
    el.className = 'rpg-orient-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.style.display = 'none';
    el.innerHTML = '<div class="rpg-orient-overlay-inner">'
      + '<div class="rpg-orient-overlay-icon" aria-hidden="true"></div>'
      + '<div class="rpg-orient-overlay-msg"></div>'
      + '<button type="button" class="rpg-orient-overlay-dismiss" aria-label="Sblocca orientamento">Sblocca (auto)</button>'
      + '</div>';
    el.querySelector('.rpg-orient-overlay-dismiss').addEventListener('click', () => {
      setOrientLock('auto');
      const fab = document.getElementById('rpg-orient-toggle');
      if (fab) refreshOrientButton(fab);
    });
    if (document.body) document.body.appendChild(el);
    return el;
  }

  function refreshOrientOverlay(mode) {
    const target = mode || readStoredOrient();
    const el = document.getElementById('rpg-orient-overlay') || ensureOrientOverlay();
    if (!el) return;
    if (target === 'auto') { el.style.display = 'none'; return; }
    const cur = currentDeviceOrientation();
    if (cur === target) { el.style.display = 'none'; return; }
    // Mostra overlay solo se il lock fisico non è andato a buon fine
    const icon = el.querySelector('.rpg-orient-overlay-icon');
    const msg = el.querySelector('.rpg-orient-overlay-msg');
    if (icon) icon.innerHTML = target === 'portrait' ? ICONS.smartphone : ICONS.smartphoneLandscape;
    if (msg) {
      msg.textContent = target === 'portrait'
        ? 'Ruota il telefono in verticale'
        : 'Ruota il telefono in orizzontale';
    }
    el.style.display = 'flex';
  }

  // ============================================================
  // BOTTONI TOGGLE (auto-mount)
  // ============================================================
  function makeIconButton({ id, icon, label, title, onClick, extraClass = '' }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = `rpg-icon-btn ${extraClass}`.trim();
    btn.setAttribute('aria-label', label);
    btn.title = title || label;
    btn.innerHTML = icon;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function refreshThemeButton(btn) {
    const cur = resolvedTheme();
    btn.innerHTML = cur === 'light' ? ICONS.moon : ICONS.sun;
    btn.title = cur === 'light' ? 'Passa al tema scuro' : 'Passa al tema chiaro';
    btn.setAttribute('aria-pressed', cur === 'light' ? 'true' : 'false');
  }

  function refreshTabletModeButton(btn) {
    const cur = readStoredTabletMode();
    btn.innerHTML = cur === 'responsive' ? ICONS.smartphone : ICONS.monitor;
    btn.title = cur === 'responsive'
      ? 'Modalità responsive (passa a landscape-only)'
      : 'Landscape-only (passa a responsive)';
    btn.setAttribute('aria-pressed', cur === 'responsive' ? 'true' : 'false');
  }

  function refreshOrientButton(btn) {
    const cur = readStoredOrient();
    let icon, title;
    if (cur === 'portrait') { icon = ICONS.smartphone; title = 'Verticale forzato (tap per orizzontale)'; }
    else if (cur === 'landscape') { icon = ICONS.smartphoneLandscape; title = 'Orizzontale forzato (tap per auto)'; }
    else { icon = ICONS.rotateAuto; title = 'Auto-rotazione (tap per verticale)'; }
    btn.innerHTML = icon;
    btn.title = title;
    btn.setAttribute('data-orient-state', cur);
    btn.setAttribute('aria-label', title);
  }

  function shouldShowOrientToggle() {
    if (document.body && document.body.classList.contains('tablet-view')) return false;
    if (isCapacitorNative()) return true;
    try { return window.matchMedia('(max-width: 768px)').matches; }
    catch { return window.innerWidth <= 768; }
  }

  function mountThemeToggle() {
    if (document.getElementById('rpg-theme-toggle')) return;
    const target = document.querySelector('[data-theme-toggle-into]');
    if (!target) return;

    const btn = makeIconButton({
      id: 'rpg-theme-toggle',
      icon: '',
      label: 'Cambia tema',
      onClick: () => { toggleTheme(); refreshThemeButton(btn); }
    });
    refreshThemeButton(btn);
    target.appendChild(btn);
  }

  function mountTabletModeToggle() {
    if (!document.body.classList.contains('tablet-view')) return;
    if (document.getElementById('rpg-tablet-mode-toggle')) return;

    const target = document.querySelector('[data-tablet-mode-toggle-into]') || document.body;

    const btn = makeIconButton({
      id: 'rpg-tablet-mode-toggle',
      icon: '',
      label: 'Modalità schermo',
      onClick: () => { toggleTabletMode(); refreshTabletModeButton(btn); },
      extraClass: 'rpg-tablet-mode-toggle-fab'
    });
    refreshTabletModeButton(btn);
    target.appendChild(btn);
  }

  function mountOrientToggle() {
    if (!shouldShowOrientToggle()) return;
    if (document.getElementById('rpg-orient-toggle')) return;
    const target = document.querySelector('[data-orient-toggle-into]') || document.body;
    const btn = makeIconButton({
      id: 'rpg-orient-toggle',
      icon: '',
      label: 'Orientamento schermo',
      onClick: () => { cycleOrientLock(); refreshOrientButton(btn); },
      extraClass: 'rpg-orient-toggle-fab'
    });
    refreshOrientButton(btn);
    target.appendChild(btn);
  }

  function unmountOrientToggle() {
    const btn = document.getElementById('rpg-orient-toggle');
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  }

  // ============================================================
  // INIT (fase early per evitare flash dark/light)
  // ============================================================
  applyTheme(resolvedTheme());

  // Reagisci a cambi di prefers-color-scheme se l'utente non ha override
  try {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => { if (!readStoredTheme()) applyTheme(resolvedTheme()); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  } catch { /* no-op */ }

  // Monta i bottoni quando il DOM è pronto
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }
  onReady(() => {
    applyTabletMode(readStoredTabletMode());
    applyOrientLock(readStoredOrient());
    mountThemeToggle();
    mountTabletModeToggle();
    mountOrientToggle();

    // Reagisci a cambi di viewport (resize/rotate): mostra/nascondi FAB orient
    // e aggiorna overlay se l'orientamento fisico è cambiato
    let resizeTimer = null;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (shouldShowOrientToggle()) {
          mountOrientToggle();
        } else {
          unmountOrientToggle();
        }
        refreshOrientOverlay();
      }, 150);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    try {
      if (window.screen && window.screen.orientation && window.screen.orientation.addEventListener) {
        window.screen.orientation.addEventListener('change', onResize);
      }
    } catch { /* no-op */ }
  });

  // Espone API minimale
  window.RpgUI = {
    icons: ICONS,
    theme: { get: resolvedTheme, set: setTheme, toggle: toggleTheme },
    tabletMode: {
      get: readStoredTabletMode,
      set: setTabletMode,
      toggle: toggleTabletMode
    },
    orientLock: {
      get: readStoredOrient,
      set: setOrientLock,
      cycle: cycleOrientLock
    }
  };
})();
