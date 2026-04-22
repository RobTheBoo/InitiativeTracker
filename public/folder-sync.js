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
      const data = await apiPost('/api/folder/setup', { folderPath, autoExport: true, doExport: true });
      $('folder-path-input').value = data.folderPath;
      $('folder-auto-export').checked = true;
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

    $('folder-import-confirm-btn').addEventListener('click', confirmImport);
    $('folder-import-cancel-btn').addEventListener('click', () => {
      $('folder-import-modal').style.display = 'none';
    });
    $('folder-conflicts-all-overwrite').addEventListener('click', () => setAllConflicts('overwrite'));
    $('folder-conflicts-all-skip').addEventListener('click', () => setAllConflicts('skip'));

    $('folder-result-close-btn').addEventListener('click', () => {
      $('folder-result-modal').style.display = 'none';
    });

    // Refresh quando si apre la tab
    document.querySelectorAll('.config-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'folder') refreshStatus();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bind(); refreshStatus(); });
  } else {
    bind();
    refreshStatus();
  }
})();
