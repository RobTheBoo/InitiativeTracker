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
    mountThemeToggle();
    mountTabletModeToggle();
  });

  // Espone API minimale
  window.RpgUI = {
    icons: ICONS,
    theme: { get: resolvedTheme, set: setTheme, toggle: toggleTheme },
    tabletMode: {
      get: readStoredTabletMode,
      set: setTabletMode,
      toggle: toggleTabletMode
    }
  };
})();
