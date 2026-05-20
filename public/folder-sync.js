// Frontend per la tab "Importa" (folder sync).
// Endpoint backend: /api/folder/{status,config,test,analyze-import,import,export}.
// In Electron usa window.electronAPI.pickFolder() per il dialog nativo.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const isElectron = !!(window.electronAPI && typeof window.electronAPI.pickFolder === 'function');

  // ----- API helpers -----
  async function apiGet(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  }
  async function apiPost(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!r.ok) {
      let err;
      try { err = (await r.json()).error || r.statusText; } catch (_) { err = r.statusText; }
      throw new Error(err);
    }
    return r.json();
  }

  function formatTs(ts) {
    if (!ts) return 'mai';
    try {
      const d = new Date(ts);
      return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) { return String(ts); }
  }

  function setStatusLine(html, color) {
    const el = $('folder-status-line');
    if (!el) return;
    el.innerHTML = html;
    el.style.color = color || 'var(--text-dim)';
  }

  function showResultModal(title, body) {
    $('folder-result-title').textContent = title;
    $('folder-result-body').textContent = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    $('folder-result-modal').style.display = 'flex';
  }

  // ----- Refresh status -----
  async function refreshStatus() {
    try {
      const s = await apiGet('/api/folder/status');
      $('folder-path-input').value = s.folderPath || '';
      $('folder-auto-export').checked = !!s.autoExport;

      if (!s.folderPath) {
        setStatusLine('Nessuna cartella configurata. Premi <strong>Popola cartella di lavoro</strong> per iniziare.', 'var(--text-dim)');
        return;
      }
      const usable = s.folderUsable;
      if (!usable || !usable.ok) {
        setStatusLine(`⚠️ Cartella non utilizzabile: ${(usable && usable.error) || 'errore'}`, '#ff6b6b');
        return;
      }
      const lastImp = s.lastImportAt ? formatTs(s.lastImportAt) : 'mai';
      const lastExp = s.lastExportAt ? formatTs(s.lastExportAt) : 'mai';
      const manifestInfo = s.manifest
        ? ` · contiene ${s.manifest.counts?.rooms ?? '?'} stanze, ${s.manifest.counts?.images ?? '?'} immagini (export del ${formatTs(s.manifest.exportedAt)})`
        : ' · cartella vuota o senza manifest';
      setStatusLine(`✅ Cartella OK · ultimo import: <strong>${lastImp}</strong> · ultimo export: <strong>${lastExp}</strong>${manifestInfo}`, 'var(--text-light)');
    } catch (e) {
      setStatusLine('❌ Errore status: ' + e.message, '#ff6b6b');
    }
  }

  // ----- Browse (Electron) -----
  async function browse() {
    if (!isElectron) return;
    try {
      const current = $('folder-path-input').value.trim();
      const r = await window.electronAPI.pickFolder({ defaultPath: current || undefined });
      if (r && !r.canceled && r.folderPath) {
        $('folder-path-input').value = r.folderPath;
      }
    } catch (e) {
      alert('Errore apertura selettore: ' + e.message);
    }
  }

  // ----- Test -----
  async function testFolder() {
    const folderPath = $('folder-path-input').value.trim();
    if (!folderPath) { alert('Inserisci un path prima di verificare'); return; }
    try {
      const r = await apiPost('/api/folder/test', { folderPath });
      if (r.ok) setStatusLine('✅ Cartella scrivibile, pronta per export/import', 'var(--text-light)');
      else setStatusLine('⚠️ Cartella non utilizzabile: ' + r.error, '#ff6b6b');
    } catch (e) {
      setStatusLine('❌ ' + e.message, '#ff6b6b');
    }
  }

  // ----- Save config -----
  async function saveConfig() {
    const folderPath = $('folder-path-input').value.trim();
    const autoExport = $('folder-auto-export').checked;
    try {
      await apiPost('/api/folder/config', { folderPath, autoExport });
      await refreshStatus();
    } catch (e) {
      alert('Errore salvataggio: ' + e.message);
    }
  }

  // ----- Import flow -----
  async function startImport() {
    const folderPath = $('folder-path-input').value.trim();
    if (!folderPath) { alert('Configura prima la cartella'); return; }
    try {
      const analysis = await apiPost('/api/folder/analyze-import', { folderPath });
      openImportModal(analysis);
    } catch (e) {
      alert('Errore analisi: ' + e.message);
    }
  }

  function openImportModal(analysis) {
    const summary = $('folder-import-summary');
    const conflictsWrap = $('folder-import-conflicts-wrap');
    const list = $('folder-import-conflicts-list');

    const totalRooms = analysis.rooms.length;
    const newRooms = analysis.rooms.filter(r => !r.exists).length;
    const conflicts = analysis.rooms.filter(r => r.exists);

    const cfgC = analysis.configCounts;
    const cfgLine = analysis.hasConfig
      ? `✅ presente${cfgC ? ` — eroi:${cfgC.heroes}, nemici:${cfgC.enemies}, NPC:${cfgC.allies}, evocazioni:${cfgC.summons}, effetti:${cfgC.effects}` : ''}`
      : '<em style="color: var(--text-dim);">assente</em>';

    const imgPerSub = analysis.imagesPerSub || {};
    const imgLine = `${analysis.imageCount} (heroes:${imgPerSub.heroes||0}, enemies:${imgPerSub.enemies||0}, allies:${imgPerSub.allies||0}, summons:${imgPerSub.summons||0})`;

    const warnings = (analysis.warnings || []);
    const blockers = (analysis.blockers || []);

    let validation = '';
    if (blockers.length) {
      validation += `<div style="background: rgba(220,80,80,0.12); border: 1px solid rgba(220,80,80,0.45); color: #ff9a9a; padding: 10px; border-radius: 6px; margin-top: 12px;">
        <strong>⛔ Import bloccato:</strong>
        <ul style="margin: 6px 0 0 18px;">${blockers.map(b => '<li>' + escapeHtml(b) + '</li>').join('')}</ul>
      </div>`;
    }
    if (warnings.length) {
      validation += `<div style="background: rgba(212,175,55,0.10); border: 1px solid rgba(212,175,55,0.40); color: var(--accent-gold); padding: 10px; border-radius: 6px; margin-top: 12px;">
        <strong>⚠️ Avvisi:</strong>
        <ul style="margin: 6px 0 0 18px; color: var(--text-light);">${warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('')}</ul>
      </div>`;
    }

    summary.innerHTML = `
      <div>📂 <strong>${escapeHtml(analysis.folderPath)}</strong></div>
      <div>📋 Manifest: ${analysis.manifest ? 'presente (v' + escapeHtml(String(analysis.manifest.version)) + ')' : '<em style="color: var(--text-dim);">assente</em>'}</div>
      <div>⚙️ Libreria personaggi: ${cfgLine}</div>
      <div>🖼️ Immagini: ${imgLine}</div>
      <div>🏰 Stanze: ${totalRooms} totali, ${newRooms} nuove, ${conflicts.length} esistenti</div>
      ${validation}
    `;

    if (conflicts.length === 0) {
      conflictsWrap.style.display = 'none';
    } else {
      conflictsWrap.style.display = 'block';
      list.innerHTML = conflicts.map(r => `
        <div style="display: flex; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid var(--border-gold);">
          <div style="flex: 1; color: var(--text-light);">
            <div style="font-weight: 600;">${escapeHtml(r.name)}</div>
            <div style="font-size: 0.8rem; color: var(--text-dim);">${escapeHtml(r.id)}${r.hasGameState ? '' : ' · <em>senza gameState</em>'}</div>
          </div>
          <select class="folder-conflict-decision" data-room-id="${escapeHtml(r.id)}"
                  style="background: var(--bg-dark); color: var(--text-light); border: 1px solid var(--border-gold); padding: 6px; border-radius: 4px;">
            <option value="skip" selected>Salta</option>
            <option value="overwrite">Sovrascrivi</option>
          </select>
        </div>
      `).join('');
    }

    // Disabilita Importa se ci sono blockers.
    const confirmBtn = $('folder-import-confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled = !analysis.canImport;
      confirmBtn.title = analysis.canImport ? '' : 'Risolvi i blockers per procedere';
    }

    $('folder-import-modal').dataset.analysis = JSON.stringify(analysis);
    $('folder-import-modal').style.display = 'flex';
  }

  async function confirmImport() {
    const modal = $('folder-import-modal');
    const analysis = JSON.parse(modal.dataset.analysis || '{}');
    const folderPath = analysis.folderPath;
    const resolutions = {};
    document.querySelectorAll('.folder-conflict-decision').forEach(sel => {
      resolutions[sel.dataset.roomId] = sel.value;
    });
    modal.style.display = 'none';

    try {
      const result = await apiPost('/api/folder/import', { folderPath, resolutions });
      const lines = [
        result.configImported ? '✅ Libreria importata' : '⏭️  Libreria non presente',
        `🖼️  Immagini copiate: ${result.images.copied} (errori: ${result.images.errors.length})`,
        `🏰 Stanze: ${result.rooms.created} create, ${result.rooms.overwritten} sovrascritte, ${result.rooms.skipped} saltate, ${result.rooms.errors.length} errori`
      ];
      if (result.images.errors.length || result.rooms.errors.length) {
        lines.push('', '--- ERRORI ---');
        [...result.images.errors, ...result.rooms.errors].forEach(e => {
          lines.push(`  ${e.file || e.roomId}: ${e.error}`);
        });
      }
      showResultModal('📥 Import completato', lines.join('\n'));
      await refreshStatus();
    } catch (e) {
      showResultModal('❌ Import fallito', e.message);
    }
  }

  // ----- Export -----
  async function doExport() {
    const folderPath = $('folder-path-input').value.trim();
    if (!folderPath) { alert('Configura prima la cartella (Popola cartella di lavoro)'); return; }
    try {
      const r = await apiPost('/api/folder/export', { folderPath });
      const totalErr = r.images.errors.length + r.rooms.errors.length;
      const lines = [
        totalErr === 0 ? '✅ Esportazione completata (set dati completo)' : `⚠️ Esportazione con ${totalErr} errori`,
        `📂 ${r.folderPath}`,
        '',
        `⚙️  Libreria personaggi (config.json): ${r.configWritten ? '✅ scritta' : '⏭️  skip'}`,
        `🖼️  Immagini: ${r.images.copied} copiate, ${r.images.skipped} gia\u0027 aggiornate (errori: ${r.images.errors.length})`,
        `🏰 Stanze (incl. gameState): ${r.rooms.written} scritte (errori: ${r.rooms.errors.length})`,
        `📋 manifest.json + README.md: aggiornati`,
        '',
        '👉 Su un altro PC: installa l\u0027app, vai in Configurazione → Importa,',
        '   apri questa cartella e premi "Importa dalla cartella". Avrai tutto.'
      ];
      if (r.images.errors.length || r.rooms.errors.length) {
        lines.push('', '--- ERRORI ---');
        [...r.images.errors, ...r.rooms.errors].forEach(e => {
          lines.push(`  ${e.file || e.roomId}: ${e.error}`);
        });
      }
      if (r.warnings && r.warnings.length) {
        lines.push('', '--- WARNINGS ---', ...r.warnings.map(w => '  ' + w));
      }
      showResultModal('📤 Export completato', lines.join('\n'));
      await refreshStatus();
    } catch (e) {
      showResultModal('❌ Export fallito', e.message);
    }
  }

  // ----- Conflict bulk actions -----
  function setAllConflicts(value) {
    document.querySelectorAll('.folder-conflict-decision').forEach(sel => { sel.value = value; });
  }

  // ----- Helpers -----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ----- Popola cartella di lavoro (one-shot) -----
  // Apre il selettore con default sulla cartella dati del programma (userData),
  // poi chiama POST /api/folder/setup che crea struttura + salva path + esporta.
  async function quickSetup() {
    let folderPath = $('folder-path-input').value.trim();

    // Pre-fill suggerito = cartella dati programma (in Electron).
    let suggestedDefault;
    if (isElectron && window.electronAPI && window.electronAPI.getDataPath) {
      try {
        const dp = await window.electronAPI.getDataPath();
        suggestedDefault = dp && dp.basePath;
      } catch (_) {}
    }

    if (isElectron) {
      try {
        const r = await window.electronAPI.pickFolder({
          title: 'Popola cartella di lavoro (puoi puntare anche dentro OneDrive/Drive)',
          defaultPath: folderPath || suggestedDefault || undefined
        });
        if (r && !r.canceled && r.folderPath) folderPath = r.folderPath;
        else return; // annullato
      } catch (e) {
        alert('Errore selettore: ' + e.message);
        return;
      }
    } else if (!folderPath) {
      const typed = prompt('Inserisci il percorso completo della cartella di lavoro:');
      if (!typed) return;
      folderPath = typed.trim();
    }

    setStatusLine('⏳ Inizializzazione struttura cartella…', 'var(--accent-gold)');
    try {
      const data = await apiPost('/api/folder/setup', { folderPath, autoExport: true });
      $('folder-path-input').value = data.folderPath;
      $('folder-auto-export').checked = true;

      // Se la cartella scelta contiene gia' un export (es. cartella OneDrive
      // popolata da un altro PC), il backend NON ha esportato. Proponiamo
      // l'import dei dati remoti.
      if (data.existingDataDetected) {
        await refreshStatus();
        await offerImportExistingData(data);
        return;
      }

      const created = (data.structureCreated && data.structureCreated.created) || [];
      const exp = data.exportResult || {};
      const lines = [
        '✅ Cartella pronta: ' + data.folderPath,
        '',
        created.length
          ? `📁 ${created.length} sottocartelle create`
          : '📁 Struttura gia\u0027 esistente, nessuna modifica',
        exp.rooms
          ? `📤 Esportate ${exp.rooms.written} stanze, ${exp.images.copied} immagini (skip ${exp.images.skipped})`
          : '',
        '',
        '👉 Ora puoi droppare a mano altre immagini nelle sottocartelle:',
        '   ' + data.folderPath + '\\images\\heroes',
        '   ' + data.folderPath + '\\images\\enemies',
        '   ' + data.folderPath + '\\images\\allies',
        '   ' + data.folderPath + '\\images\\summons'
      ].filter(Boolean);
      showResultModal('📁 Popola cartella di lavoro', lines.join('\n'));
      await refreshStatus();
    } catch (e) {
      setStatusLine('❌ Setup fallito: ' + e.message, '#ff6b6b');
    }
  }

  // Cartella scelta gia' contiene un export (manifest presente).
  // Chiede all'utente cosa fare: importare qui, sovrascrivere col PC locale, o niente.
  async function offerImportExistingData(setupData) {
    const folderPath = setupData.folderPath;
    let analysis;
    try {
      analysis = await apiPost('/api/folder/analyze-import', { folderPath });
    } catch (e) {
      showResultModal('❌ Errore analisi cartella', e.message);
      return;
    }

    const m = setupData.manifest || {};
    const cfgC = analysis.configCounts || {};
    const totalLib = (cfgC.heroes || 0) + (cfgC.enemies || 0) + (cfgC.allies || 0)
                   + (cfgC.summons || 0) + (cfgC.effects || 0);
    const expDate = m.exportedAt ? formatTs(m.exportedAt) : 'data ignota';

    const summary =
      `📂 ${folderPath}\n\n` +
      `Questa cartella contiene gia' un export di RPG Initiative Tracker:\n` +
      `   • Esportato il: ${expDate}\n` +
      `   • Libreria: ${totalLib} elementi (eroi:${cfgC.heroes||0}, nemici:${cfgC.enemies||0}, NPC:${cfgC.allies||0}, evocazioni:${cfgC.summons||0}, effetti:${cfgC.effects||0})\n` +
      `   • Stanze: ${analysis.rooms.length}\n` +
      `   • Immagini: ${analysis.imageCount}\n\n` +
      `Cosa vuoi fare?`;

    // Modale con 3 azioni
    showChoiceModal('📥 Cartella gia\u0027 popolata', summary, [
      { label: '📥 Importa tutto su questo PC (consigliato)', kind: 'primary', value: 'import-all' },
      { label: '📤 Sovrascrivi cartella con dati di questo PC', kind: 'secondary', value: 'force-export' },
      { label: '✋ Niente per ora (solo imposta path)', kind: 'secondary', value: 'noop' }
    ], async (choice) => {
      if (choice === 'import-all') {
        // Import con overwrite di TUTTE le rooms in conflitto.
        try {
          const resolutions = {};
          analysis.rooms.filter(r => r.exists).forEach(r => { resolutions[r.id] = 'overwrite'; });
          const result = await apiPost('/api/folder/import', { folderPath, resolutions });
          const lines = [
            '✅ Import completato dalla cartella esistente',
            '',
            `⚙️  Libreria: ${result.configImported ? 'importata' : 'non presente'}`,
            `🖼️  Immagini: ${result.images.copied} copiate (errori: ${result.images.errors.length})`,
            `🏰 Stanze: ${result.rooms.created} create, ${result.rooms.overwritten} sovrascritte (errori: ${result.rooms.errors.length})`,
            '',
            '🎉 Adesso questo PC ha tutti i nemici, NPC, effetti, eroi, evocazioni',
            '   e stanze del PC originale.'
          ];
          showResultModal('📥 Dati importati', lines.join('\n'));
          await refreshStatus();
          // Reload pagina per rigenerare le grid (config.js carica al boot)
          setTimeout(() => location.reload(), 1500);
        } catch (e) {
          showResultModal('❌ Import fallito', e.message);
        }
      } else if (choice === 'force-export') {
        // L'utente sa quel che fa: sovrascrive cartella remota.
        if (!confirm('Sovrascrivere i dati della cartella con lo stato di questo PC?\nI dati nella cartella verranno persi.')) return;
        try {
          const data = await apiPost('/api/folder/setup', { folderPath, autoExport: true, forceExport: true });
          const exp = data.exportResult || {};
          showResultModal('📤 Cartella sovrascritta', [
            '✅ Cartella aggiornata con i dati di questo PC',
            `📤 ${exp.rooms?.written || 0} stanze, ${exp.images?.copied || 0} immagini`
          ].join('\n'));
          await refreshStatus();
        } catch (e) {
          showResultModal('❌ Export fallito', e.message);
        }
      } else {
        // noop: path gia' salvato dal setup, nessuna operazione dati.
        showResultModal('✋ Cartella collegata', [
          'Path salvato: ' + folderPath,
          '',
          'Quando vuoi puoi premere "📥 Importa dalla cartella" o',
          '"📤 Esporta nella cartella" qui sotto.'
        ].join('\n'));
      }
    });
  }

  // Modale generica con N opzioni a bottone (usa la stessa griglia visiva del result modal).
  function showChoiceModal(title, body, choices, onChoice) {
    $('folder-result-title').textContent = title;
    const bodyEl = $('folder-result-body');
    bodyEl.textContent = body;

    // Iniettiamo i bottoni custom dentro il modal-buttons.
    const modal = $('folder-result-modal');
    const btnRow = modal.querySelector('.modal-buttons');
    const closeBtn = $('folder-result-close-btn');
    if (closeBtn) closeBtn.style.display = 'none';

    // Rimuovi eventuali bottoni custom precedenti
    btnRow.querySelectorAll('.choice-btn').forEach(b => b.remove());

    choices.forEach(ch => {
      const b = document.createElement('button');
      b.className = 'btn choice-btn ' + (ch.kind === 'primary' ? 'primary' : 'secondary');
      b.textContent = ch.label;
      b.style.flex = '1';
      b.style.minWidth = '180px';
      b.addEventListener('click', async () => {
        // Cleanup
        btnRow.querySelectorAll('.choice-btn').forEach(x => x.remove());
        if (closeBtn) closeBtn.style.display = '';
        modal.style.display = 'none';
        try { await onChoice(ch.value); } catch (e) { console.error(e); }
      });
      btnRow.insertBefore(b, closeBtn || null);
    });

    btnRow.style.flexWrap = 'wrap';
    modal.style.display = 'flex';
  }

  // ============================================================
  // ===== UI 3-sorgenti (2026-05) ==============================
  // ============================================================

  // Detect Capacitor (APK Android) — il file picker nativo va per content:// URI,
  // non per path POSIX. La UI cambia: niente input testuale path, ma "Aggiungi file"
  // multi-select con upload multipart al server.
  const isCapacitor = (function () {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.getPlatform === 'function'
        && window.Capacitor.getPlatform() !== 'web');
    } catch (_) { return false; }
  })();

  function getFilePickerPlugin() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FilePicker) {
        return window.Capacitor.Plugins.FilePicker;
      }
    } catch (_) {}
    return null;
  }

  // Trasforma il path nativo (content://...) in una URL leggibile dalla WebView
  // e poi in Blob via fetch. Approach raccomandato dal team Capawesome quando
  // i file sono > 1-2 MB (readData:true puo' crashare l'app).
  async function fileToBlob(file) {
    if (file.blob) return file.blob; // Web: gia' Blob diretto.
    if (!file.path) throw new Error('File senza path nativo');
    const url = window.Capacitor.convertFileSrc(file.path);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Lettura file fallita: HTTP ' + res.status);
    return await res.blob();
  }

  // Helper: aggiunge una riga di "stato file caricati" sotto il bottone giusto.
  function setMobileLog(elId, msg, isError) {
    const el = $(elId);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#ff6b6b' : 'var(--text-light)';
  }

  async function pickAndUploadImages() {
    const FilePicker = getFilePickerPlugin();
    if (!FilePicker) { alert('File picker non disponibile in questa versione APK.'); return; }
    const sub = $('src-images-mobile-sub').value;
    setMobileLog('src-images-status', '⏳ Apertura file picker...', false);
    let result;
    try {
      result = await FilePicker.pickFiles({ types: ['image/*'], limit: 0, readData: false });
    } catch (e) {
      setMobileLog('src-images-status', '❌ Selezione annullata o errore: ' + e.message, true);
      return;
    }
    const files = (result && result.files) || [];
    if (!files.length) { setMobileLog('src-images-status', 'Nessun file selezionato.', false); return; }

    setMobileLog('src-images-status', `⏳ Carico ${files.length} immagini in "${sub}"...`, false);
    const fd = new FormData();
    fd.append('subfolder', sub);
    let read = 0;
    for (const f of files) {
      try {
        const blob = await fileToBlob(f);
        fd.append('files', blob, f.name || `img-${Date.now()}.bin`);
        read++;
      } catch (e) {
        console.warn('Skip', f.name, e.message);
      }
    }
    if (read === 0) { setMobileLog('src-images-status', '❌ Nessun file leggibile', true); return; }

    try {
      const r = await fetch('/api/folder/upload-images', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const out = await r.json();
      setMobileLog('src-images-status', `✅ ${out.copied} immagini copiate in "${sub}" (errori: ${out.errors.length})`, false);
    } catch (e) {
      setMobileLog('src-images-status', '❌ Upload fallito: ' + e.message, true);
    }
  }

  async function pickAndUploadRooms() {
    const FilePicker = getFilePickerPlugin();
    if (!FilePicker) { alert('File picker non disponibile in questa versione APK.'); return; }
    setMobileLog('src-rooms-status', '⏳ Apertura file picker...', false);
    let result;
    try {
      result = await FilePicker.pickFiles({ types: ['application/json'], limit: 0, readData: false });
    } catch (e) {
      setMobileLog('src-rooms-status', '❌ ' + e.message, true);
      return;
    }
    const files = (result && result.files) || [];
    if (!files.length) { setMobileLog('src-rooms-status', 'Nessun file selezionato.', false); return; }

    setMobileLog('src-rooms-status', `⏳ Carico ${files.length} stanze...`, false);
    const fd = new FormData();
    let read = 0;
    for (const f of files) {
      try {
        const blob = await fileToBlob(f);
        fd.append('files', blob, f.name || `room-${Date.now()}.json`);
        read++;
      } catch (e) {
        console.warn('Skip', f.name, e.message);
      }
    }
    if (read === 0) { setMobileLog('src-rooms-status', '❌ Nessun file leggibile', true); return; }

    try {
      const r = await fetch('/api/folder/upload-rooms', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const out = await r.json();
      setMobileLog('src-rooms-status', `✅ ${out.created} create · ${out.overwritten} sovrascritte · ${out.skipped} saltate (errori: ${out.errors.length})`, false);
    } catch (e) {
      setMobileLog('src-rooms-status', '❌ Upload fallito: ' + e.message, true);
    }
  }

  async function pickAndUploadLibrary() {
    const FilePicker = getFilePickerPlugin();
    if (!FilePicker) { alert('File picker non disponibile in questa versione APK.'); return; }
    setMobileLog('src-library-status', '⏳ Apertura file picker...', false);
    let result;
    try {
      result = await FilePicker.pickFiles({ types: ['application/json'], limit: 1, readData: false });
    } catch (e) {
      setMobileLog('src-library-status', '❌ ' + e.message, true);
      return;
    }
    const files = (result && result.files) || [];
    if (!files.length) { setMobileLog('src-library-status', 'Nessun file selezionato.', false); return; }

    const f = files[0];
    setMobileLog('src-library-status', '⏳ Carico libreria...', false);
    try {
      const blob = await fileToBlob(f);
      const fd = new FormData();
      fd.append('file', blob, f.name || 'config.json');
      const r = await fetch('/api/folder/upload-library', { method: 'POST', body: fd });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || 'HTTP ' + r.status);
      const c = out.counts || {};
      setMobileLog('src-library-status', `✅ Libreria importata: ${c.heroes||0} eroi, ${c.enemies||0} nemici, ${c.allies||0} alleati, ${c.summons||0} evoc., ${c.effects||0} effetti`, false);
    } catch (e) {
      setMobileLog('src-library-status', '❌ Upload fallito: ' + e.message, true);
    }
  }


  // Mostra il "probe" come riga di stato sotto ogni input.
  function setSrcStatus(elId, probe, kind) {
    const el = $(elId);
    if (!el) return;
    if (!probe || probe.path === null) {
      el.textContent = ''; // niente puntamento
      el.style.color = 'var(--text-dim)';
      return;
    }
    if (probe.ok === true) {
      el.textContent = '✅ ' + (kind === 'file' ? 'File trovato' : 'Cartella trovata');
      el.style.color = 'var(--text-light)';
    } else {
      const msg = probe.missing ? 'Path non esiste' : (probe.message || 'non utilizzabile');
      el.textContent = '⚠️ ' + msg;
      el.style.color = '#ff9b6b';
    }
  }

  async function refreshSources() {
    if (!$('src-images-path')) return; // UI assente in pagine vecchie
    try {
      const s = await apiGet('/api/folder/sources');
      $('src-images-path').value = s.sources.imagesPath || '';
      $('src-rooms-path').value = s.sources.roomsPath || '';
      $('src-library-path').value = s.sources.libraryPath || '';
      setSrcStatus('src-images-status', s.probes.images, 'dir');
      setSrcStatus('src-rooms-status', s.probes.rooms, 'dir');
      setSrcStatus('src-library-status', s.probes.library, 'file');

      // Hint con il path della cartella di lavoro dell'app.
      try {
        const info = await apiGet('/api/server-info');
        if (info && info.dataDir && $('src-data-dir-hint')) {
          $('src-data-dir-hint').textContent = info.dataDir;
        }
      } catch (_) {}
    } catch (e) {
      console.warn('refreshSources fallito:', e.message);
    }
  }

  async function pickSourceFolder(inputId, statusId) {
    if (!isElectron) {
      alert('Su questa piattaforma non e\' disponibile lo Sfoglia: incolla il path a mano nel campo, poi premi Salva.');
      return;
    }
    try {
      const r = await window.electronAPI.pickFolder({
        title: 'Scegli la cartella sorgente',
        defaultPath: $(inputId).value || undefined,
        buttonLabel: 'Usa questa cartella'
      });
      if (r && !r.canceled && r.folderPath) {
        $(inputId).value = r.folderPath;
        // Salviamo subito cosi' il prossimo refresh probe lo trova.
        await saveSources();
      }
    } catch (e) {
      alert('Errore selezione cartella: ' + e.message);
    }
  }

  async function pickSourceFile(inputId, statusId) {
    if (!isElectron) {
      alert('Su questa piattaforma non e\' disponibile lo Sfoglia: incolla il path a mano nel campo, poi premi Salva.');
      return;
    }
    if (typeof window.electronAPI.pickFile !== 'function') {
      alert('Questa versione dell\'app non supporta la selezione file. Aggiorna il preload.js.');
      return;
    }
    try {
      const r = await window.electronAPI.pickFile({
        title: 'Scegli il file libreria (config.json)',
        defaultPath: $(inputId).value || undefined,
        filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'Tutti i file', extensions: ['*'] }],
        buttonLabel: 'Usa questo file'
      });
      if (r && !r.canceled && r.filePath) {
        $(inputId).value = r.filePath;
        await saveSources();
      }
    } catch (e) {
      alert('Errore selezione file: ' + e.message);
    }
  }

  async function saveSources() {
    try {
      await apiPost('/api/folder/sources', {
        imagesPath: $('src-images-path').value.trim(),
        roomsPath: $('src-rooms-path').value.trim(),
        libraryPath: $('src-library-path').value.trim()
      });
      await refreshSources();
    } catch (e) {
      alert('Errore salvataggio puntamenti: ' + e.message);
    }
  }

  async function clearSource(field) {
    const inputMap = { imagesPath: 'src-images-path', roomsPath: 'src-rooms-path', libraryPath: 'src-library-path' };
    $(inputMap[field]).value = '';
    await apiPost('/api/folder/sources', { [field]: '' });
    await refreshSources();
  }

  async function importFromSources() {
    const sources = {
      imagesPath: $('src-images-path').value.trim(),
      roomsPath: $('src-rooms-path').value.trim(),
      libraryPath: $('src-library-path').value.trim()
    };
    if (!sources.imagesPath && !sources.roomsPath && !sources.libraryPath) {
      alert('Indica almeno una sorgente (immagini, stanze o libreria) prima di importare.');
      return;
    }
    let analysis;
    try {
      analysis = await apiPost('/api/folder/analyze-sources', sources);
    } catch (e) {
      showResultModal('❌ Analisi fallita', e.message);
      return;
    }

    if (!analysis.canImport) {
      showResultModal('❌ Non e\' possibile importare', (analysis.blockers || []).join('\n') || 'Errore sconosciuto');
      return;
    }

    // Riusa il modal "folder-import-modal" della UI vecchia: stessa logica conflitti stanze.
    const sumLines = [];
    if (analysis.hasImages) {
      const subs = Object.entries(analysis.imagesPerSub).filter(([, n]) => n > 0).map(([s, n]) => `${s}: ${n}`).join(', ');
      sumLines.push(`🖼️ <strong>${analysis.imageCount}</strong> immagini ${subs ? '(' + subs + ')' : ''}`);
    }
    if (analysis.hasLibrary && analysis.configCounts) {
      const cc = analysis.configCounts;
      sumLines.push(`⚙️ Libreria: ${cc.heroes} eroi, ${cc.enemies} nemici, ${cc.allies} alleati, ${cc.summons} evocazioni, ${cc.effects} effetti`);
    }
    if (analysis.hasRooms) {
      const newRooms = analysis.rooms.filter(r => !r.exists).length;
      const conflictRooms = analysis.rooms.filter(r => r.exists).length;
      sumLines.push(`🏰 Stanze: ${newRooms} nuove, ${conflictRooms} con stesso ID gia' presenti`);
    }
    if (!sumLines.length) sumLines.push('Niente da importare in queste sorgenti.');
    if (analysis.warnings && analysis.warnings.length) {
      sumLines.push('');
      sumLines.push('⚠️ ' + analysis.warnings.join('\n⚠️ '));
    }

    $('folder-import-summary').innerHTML = sumLines.join('<br>');

    // Conflict list (riusa esattamente lo stesso markup della UI vecchia).
    const conflictRooms = analysis.rooms.filter(r => r.exists);
    const wrap = $('folder-import-conflicts-wrap');
    const list = $('folder-import-conflicts-list');
    if (conflictRooms.length === 0) {
      wrap.style.display = 'none';
      list.innerHTML = '';
    } else {
      wrap.style.display = '';
      list.innerHTML = conflictRooms.map(r => `
        <div class="folder-conflict-row" data-id="${r.id}" style="display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--border-gold);">
          <span style="flex: 1; color: var(--text-light);">${r.name}</span>
          <select class="folder-conflict-select" data-id="${r.id}" style="background: var(--bg-light); color: var(--text-light); border: 1px solid var(--border-gold); border-radius: 4px; padding: 3px 6px;">
            <option value="overwrite">Sovrascrivi</option>
            <option value="skip" selected>Salta</option>
          </select>
        </div>
      `).join('');
    }

    // Salva sorgenti in chiusura (per il bottone Conferma).
    $('folder-import-modal').dataset.mode = 'sources';
    $('folder-import-modal').dataset.sources = JSON.stringify(sources);
    $('folder-import-modal').style.display = 'flex';
  }

  async function confirmImportSources() {
    const modal = $('folder-import-modal');
    const sources = JSON.parse(modal.dataset.sources || '{}');
    const resolutions = {};
    document.querySelectorAll('.folder-conflict-select').forEach(sel => {
      resolutions[sel.dataset.id] = sel.value;
    });
    modal.style.display = 'none';

    try {
      const result = await apiPost('/api/folder/import-sources', { ...sources, resolutions });
      const lines = [
        '✅ Import completato',
        '',
        `⚙️  Libreria: ${result.configImported ? 'importata' : 'non presente'}`,
        `🖼️  Immagini: ${result.images.copied} copiate (errori: ${result.images.errors.length})`,
        `🏰 Stanze: ${result.rooms.created} create, ${result.rooms.overwritten} sovrascritte, ${result.rooms.skipped} saltate (errori: ${result.rooms.errors.length})`,
        '',
        '📁 Tutto e\' stato copiato nella cartella di lavoro dell\'app.',
        '   I file sorgente non sono stati modificati.'
      ];
      showResultModal('📥 Dati importati', lines.join('\n'));
      await refreshSources();
      // Reload pagina per rigenerare le grid (config.js carica al boot)
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      showResultModal('❌ Import fallito', e.message);
    }
  }

  // ----- Bind -----
  function bind() {
    if (isElectron && $('folder-browse-btn')) {
      $('folder-browse-btn').style.display = '';
      $('folder-browse-btn').addEventListener('click', browse);
    }
    if ($('folder-setup-quick-btn')) {
      $('folder-setup-quick-btn').addEventListener('click', quickSetup);
    }
    $('folder-test-btn').addEventListener('click', testFolder);
    $('folder-save-btn').addEventListener('click', saveConfig);
    $('folder-auto-export').addEventListener('change', saveConfig);

    $('folder-import-btn').addEventListener('click', startImport);
    $('folder-export-btn').addEventListener('click', doExport);

    // Conferma import: gestiamo entrambi i flow ("classico" cartella unica e "sources").
    $('folder-import-confirm-btn').addEventListener('click', () => {
      const modal = $('folder-import-modal');
      if (modal.dataset.mode === 'sources') confirmImportSources();
      else confirmImport();
    });
    $('folder-import-cancel-btn').addEventListener('click', () => {
      $('folder-import-modal').style.display = 'none';
      $('folder-import-modal').dataset.mode = '';
    });
    $('folder-conflicts-all-overwrite').addEventListener('click', () => setAllConflicts('overwrite'));
    $('folder-conflicts-all-skip').addEventListener('click', () => setAllConflicts('skip'));

    $('folder-result-close-btn').addEventListener('click', () => {
      $('folder-result-modal').style.display = 'none';
    });

    // Bindings nuova UI 3-sorgenti
    if ($('src-images-pick')) {
      if (isCapacitor) {
        // Su APK: nascondi input testuale + Sfoglia (path POSIX non hanno senso),
        // mostra invece i bottoni "Aggiungi file" che usano FilePicker nativo.
        $('src-images-path').style.display = 'none';
        $('src-images-pick').style.display = 'none';
        $('src-images-clear').style.display = 'none';
        $('src-rooms-path').style.display = 'none';
        $('src-rooms-pick').style.display = 'none';
        $('src-rooms-clear').style.display = 'none';
        $('src-library-path').style.display = 'none';
        $('src-library-pick').style.display = 'none';
        $('src-library-clear').style.display = 'none';
        $('src-images-mobile').style.display = 'flex';
        $('src-rooms-mobile').style.display = 'flex';
        $('src-library-mobile').style.display = 'flex';
        $('src-actions-desktop').style.display = 'none';
        $('src-desc-desktop').style.display = 'none';
        $('src-desc-mobile').style.display = '';

        $('src-images-mobile-add').addEventListener('click', pickAndUploadImages);
        $('src-rooms-mobile-add').addEventListener('click', pickAndUploadRooms);
        $('src-library-mobile-add').addEventListener('click', pickAndUploadLibrary);
      } else {
        $('src-images-pick').addEventListener('click', () => pickSourceFolder('src-images-path', 'src-images-status'));
        $('src-rooms-pick').addEventListener('click', () => pickSourceFolder('src-rooms-path', 'src-rooms-status'));
        $('src-library-pick').addEventListener('click', () => pickSourceFile('src-library-path', 'src-library-status'));
        $('src-images-clear').addEventListener('click', () => clearSource('imagesPath'));
        $('src-rooms-clear').addEventListener('click', () => clearSource('roomsPath'));
        $('src-library-clear').addEventListener('click', () => clearSource('libraryPath'));
        $('src-save-btn').addEventListener('click', saveSources);
        $('src-import-btn').addEventListener('click', importFromSources);
      }
    }

    // Refresh quando si apre la tab
    document.querySelectorAll('.config-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'folder') {
          refreshStatus();
          refreshSources();
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bind(); refreshStatus(); refreshSources(); });
  } else {
    bind();
    refreshStatus();
    refreshSources();
  }
})();
