// Wizard "primo avvio" per scegliere la cartella di lavoro (Import/Export folder).
// Mostra una modale UNA VOLTA quando /api/folder/status dice folderPath === null
// e l'utente non ha gia' scelto "Salta per ora" (localStorage).
//
// Flusso:
// 1. Apre la modale con un input + bottone Sfoglia (solo Electron).
// 2. Su "Crea e usa": chiama POST /api/folder/setup che crea struttura + salva path.
// 3. Su "Salta per ora": setta flag locale, modale non si riapre piu' fino a refresh manuale.
//
// Idempotente: se la cartella esiste gia' con files, scaffold non sovrascrive.

(function () {
  'use strict';

  const SKIP_KEY = 'rpgFolderSetupSkipped';
  const $ = (id) => document.getElementById(id);
  const isElectron = !!(window.electronAPI && typeof window.electronAPI.pickFolder === 'function');

  function show()  { const m = $('folder-setup-modal'); if (m) m.style.display = 'flex'; }
  function hide()  { const m = $('folder-setup-modal'); if (m) m.style.display = 'none'; }

  function setStatus(kind, text) {
    const el = $('setup-status');
    if (!el) return;
    if (!kind) { el.style.display = 'none'; el.className = 'setup-status'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.className = 'setup-status ' + kind;
    el.textContent = text;
  }

  async function browse() {
    if (!isElectron) return;
    try {
      const current = $('setup-path-input').value.trim();
      const r = await window.electronAPI.pickFolder({
        title: 'Popola cartella di lavoro (default: cartella dati programma)',
        defaultPath: current || undefined
      });
      if (r && !r.canceled && r.folderPath) {
        $('setup-path-input').value = r.folderPath;
        setStatus(null);
      }
    } catch (e) {
      setStatus('err', 'Errore selettore cartella: ' + e.message);
    }
  }

  // Pre-fill input con la cartella dati programma (in Electron) cosi' l'utente
  // sa subito qual e' il default e puo' confermare con un click.
  async function prefillSuggestedPath() {
    const input = $('setup-path-input');
    if (!input || input.value.trim() || !isElectron) return;
    try {
      if (window.electronAPI && window.electronAPI.getDataPath) {
        const dp = await window.electronAPI.getDataPath();
        if (dp && dp.basePath) input.value = dp.basePath;
      }
    } catch (_) {}
  }

  async function confirm() {
    const folderPath = $('setup-path-input').value.trim();
    if (!folderPath) {
      setStatus('err', 'Inserisci o sfoglia un percorso prima di confermare.');
      return;
    }
    setStatus('busy', '⏳ Creazione struttura cartella in corso…');
    $('setup-confirm-btn').disabled = true;
    try {
      const r = await fetch('/api/folder/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath, autoExport: true })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));

      // Cartella gia' popolata da un altro PC: chiediamo se importare i dati.
      if (data.existingDataDetected) {
        const m = data.manifest || {};
        const exportedDate = m.exportedAt ? new Date(m.exportedAt).toLocaleString('it-IT') : 'data ignota';
        const counts = m.counts || {};
        const ok = window.confirm(
          'La cartella scelta contiene gia\u0027 un export di RPG Initiative Tracker:\n\n' +
          '   Esportato il: ' + exportedDate + '\n' +
          '   Stanze: ' + (counts.rooms || 0) + '\n' +
          '   Immagini: ' + (counts.images || 0) + '\n\n' +
          'Vuoi importare questi dati su questo PC?\n\n' +
          'OK   = importa tutto (nemici, NPC, effetti, eroi, evocazioni, stanze, immagini)\n' +
          'Annulla = non importare niente, lascia la cartella collegata e basta'
        );
        if (ok) {
          setStatus('busy', '⏳ Importazione dati in corso…');
          try {
            // Costruisci resolutions: tutte le stanze in conflitto -> overwrite.
            const analysis = await fetch('/api/folder/analyze-import', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folderPath })
            }).then(r => r.json());
            const resolutions = {};
            (analysis.rooms || []).filter(rr => rr.exists).forEach(rr => { resolutions[rr.id] = 'overwrite'; });
            const importRes = await fetch('/api/folder/import', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folderPath, resolutions })
            }).then(r => r.json());
            setStatus('ok',
              '✅ Dati importati: ' +
              (importRes.rooms.created + importRes.rooms.overwritten) + ' stanze, ' +
              importRes.images.copied + ' immagini'
            );
            try { localStorage.removeItem(SKIP_KEY); } catch (_) {}
            // Reload per rigenerare la lista stanze in room-selector
            setTimeout(() => location.reload(), 1500);
            return;
          } catch (e) {
            setStatus('err', '❌ Import fallito: ' + e.message);
            return;
          }
        } else {
          setStatus('ok', '✅ Cartella collegata: ' + folderPath + '\n(nessun import effettuato)');
          try { localStorage.removeItem(SKIP_KEY); } catch (_) {}
          setTimeout(hide, 1800);
          return;
        }
      }

      const created = (data.structureCreated && data.structureCreated.created) || [];
      const exp = data.exportResult;
      const lines = [
        '✅ Cartella pronta: ' + data.folderPath,
        created.length
          ? '📁 ' + created.length + ' sottocartelle create'
          : '📁 Struttura gia\u0027 esistente, nessuna modifica',
        exp ? '📤 Stato attuale esportato (' + (exp.rooms?.written || 0) + ' stanze, ' + (exp.images?.copied || 0) + ' immagini)' : ''
      ].filter(Boolean);
      setStatus('ok', lines.join('\n'));

      try { localStorage.removeItem(SKIP_KEY); } catch (_) {}
      setTimeout(hide, 1400);
    } catch (e) {
      setStatus('err', '❌ ' + e.message);
    } finally {
      $('setup-confirm-btn').disabled = false;
    }
  }

  function skip() {
    try { localStorage.setItem(SKIP_KEY, '1'); } catch (_) {}
    hide();
  }

  async function maybeShow() {
    try {
      if (localStorage.getItem(SKIP_KEY) === '1') return;
    } catch (_) {}
    try {
      const r = await fetch('/api/folder/status');
      if (!r.ok) return;
      const s = await r.json();
      if (s && !s.folderPath) {
        if (isElectron) {
          $('setup-browse-btn').style.display = '';
        }
        await prefillSuggestedPath();
        show();
      }
    } catch (e) {
      // Se l'endpoint non risponde, non bloccare l'app: skip silenzioso.
      console.warn('folder-setup-wizard: /api/folder/status non disponibile:', e.message);
    }
  }

  function bind() {
    const browseBtn = $('setup-browse-btn');
    const confirmBtn = $('setup-confirm-btn');
    const skipBtn = $('setup-skip-btn');
    const input = $('setup-path-input');
    if (browseBtn) browseBtn.addEventListener('click', browse);
    if (confirmBtn) confirmBtn.addEventListener('click', confirm);
    if (skipBtn) skipBtn.addEventListener('click', skip);
    if (input) input.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirm(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bind(); maybeShow(); });
  } else {
    bind(); maybeShow();
  }
})();
