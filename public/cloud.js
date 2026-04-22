// UI per la tab "Cloud" della pagina configurazione.
// Usa gli endpoint REST /api/cloud/* esposti da src/cloud/cloud-routes.js

(function() {
  let pollSession = null;
  let pollTimer = null;

  function $(id) { return document.getElementById(id); }

  function show(el, display = 'block') { if (el) el.style.display = display; }
  function hide(el) { if (el) el.style.display = 'none'; }

  function fmtBytes(n) {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  async function refreshStatus() {
    const card = $('cloud-status-card');
    if (!card) return;
    card.innerHTML = '<div>Caricamento stato…</div>';

    try {
      const res = await fetch('/api/cloud/status');
      const status = await res.json();

      let html = '';
      if (!status.configured) {
        html = `
          <div style="color: var(--accent-red);">
            ❌ Azure clientId non configurato. Apri "Setup iniziale" qui sotto e segui i passi.
          </div>`;
        hide($('cloud-connect-btn'));
        hide($('cloud-sync-btn'));
        hide($('cloud-push-btn'));
        hide($('cloud-disconnect-btn'));
        const details = $('cloud-setup-details');
        if (details) details.open = true;
      } else if (!status.connected) {
        html = `
          <div style="color: var(--accent-gold);">
            ⚙️ Azure clientId configurato.
            <span style="color: var(--text-light); margin-left: 8px;">Connettiti con il tuo account Microsoft per iniziare.</span>
          </div>`;
        show($('cloud-connect-btn'), 'inline-block');
        hide($('cloud-sync-btn'));
        hide($('cloud-push-btn'));
        hide($('cloud-disconnect-btn'));
      } else {
        const acct = status.account || {};
        const q = status.quota || {};
        html = `
          <div style="color: #51cf66; font-weight: bold; margin-bottom: 6px;">✅ Connesso</div>
          <div style="color: var(--text-light); margin-bottom: 4px;">
            <strong>${acct.displayName || 'OneDrive'}</strong>
            ${acct.mail ? '<span style="color: var(--text-dim);">(' + acct.mail + ')</span>' : ''}
          </div>
          ${q.total ? `<div style="color: var(--text-light); margin-top: 8px;">
            Spazio: <strong>${fmtBytes(q.used)}</strong> / ${fmtBytes(q.total)} usati
            <div style="background: var(--bg-light); height: 8px; border-radius: 4px; margin-top: 4px; overflow: hidden;">
              <div style="background: var(--accent-gold); height: 100%; width: ${Math.min(100, (q.used/q.total)*100).toFixed(1)}%;"></div>
            </div>
          </div>` : ''}
          ${status.lastSyncAt ? `<div style="color: var(--text-dim); margin-top: 8px; font-size: 0.85rem;">
            Ultimo sync: ${new Date(status.lastSyncAt).toLocaleString('it-IT')}
          </div>` : ''}
          ${status.connectionError ? `<div style="color: var(--accent-red); margin-top: 8px;">⚠️ ${status.connectionError}</div>` : ''}
        `;
        hide($('cloud-connect-btn'));
        show($('cloud-sync-btn'), 'inline-block');
        show($('cloud-push-btn'), 'inline-block');
        show($('cloud-disconnect-btn'), 'inline-block');
      }
      card.innerHTML = html;
    } catch (e) {
      card.innerHTML = `<div style="color: var(--accent-red);">Errore caricamento stato: ${e.message}</div>`;
    }
  }

  async function saveClientId() {
    const inp = $('cloud-client-id-input');
    const id = (inp.value || '').trim();
    if (id.length < 8) { alert('clientId non valido'); return; }
    try {
      const res = await fetch('/api/cloud/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: id })
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'errore');
      inp.value = '';
      const details = $('cloud-setup-details');
      if (details) details.open = false;
      await refreshStatus();
      alert('✅ Salvato. Ora puoi cliccare "Connetti OneDrive".');
    } catch (e) {
      alert('Errore: ' + e.message);
    }
  }

  async function startConnect() {
    try {
      const res = await fetch('/api/cloud/auth/start', { method: 'POST' });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'errore');
      pollSession = out.sessionId;
      $('cloud-auth-uri').href = out.verificationUri;
      $('cloud-auth-uri').textContent = out.verificationUri.replace(/^https?:\/\//, '');
      $('cloud-auth-code').textContent = out.userCode;
      $('cloud-auth-status').textContent = 'In attesa dell\'autorizzazione… (codice valido per ' + Math.round(out.expiresIn / 60) + ' minuti)';
      $('cloud-auth-modal').style.display = 'flex';
      pollTimer = setInterval(pollAuthStatus, 3000);
    } catch (e) {
      alert('Errore avvio connessione: ' + e.message);
    }
  }

  async function pollAuthStatus() {
    if (!pollSession) return;
    try {
      const res = await fetch('/api/cloud/auth/status/' + pollSession);
      const flow = await res.json();
      if (!res.ok) {
        clearInterval(pollTimer);
        pollTimer = null;
        $('cloud-auth-status').textContent = '❌ Sessione scaduta';
        return;
      }
      if (flow.status === 'success') {
        clearInterval(pollTimer);
        pollTimer = null;
        $('cloud-auth-status').textContent = '✅ Connesso! Chiudi questa finestra.';
        setTimeout(() => {
          $('cloud-auth-modal').style.display = 'none';
          refreshStatus();
        }, 1500);
      } else if (flow.status === 'error') {
        clearInterval(pollTimer);
        pollTimer = null;
        $('cloud-auth-status').textContent = '❌ ' + (flow.error || 'errore');
      }
    } catch (_) { /* network blip, riproveremo */ }
  }

  function cancelAuth() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    pollSession = null;
    $('cloud-auth-modal').style.display = 'none';
  }

  async function doSync() {
    const btn = $('cloud-sync-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Sync in corso…';
    try {
      const res = await fetch('/api/cloud/sync', { method: 'POST' });
      const out = await res.json();
      $('cloud-result-title').textContent = res.ok ? '⬇️ Sync completato' : '❌ Sync fallito';
      $('cloud-result-body').textContent = JSON.stringify(out, null, 2);
      $('cloud-result-modal').style.display = 'flex';
      await refreshStatus();
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇️ Scarica da OneDrive';
    }
  }

  async function doPush() {
    if (!confirm('Carica TUTTE le immagini locali su OneDrive? Quelle gia' + String.fromCharCode(39) + ' presenti verranno sovrascritte.')) return;
    const btn = $('cloud-push-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Upload in corso…';
    try {
      const res = await fetch('/api/cloud/push', { method: 'POST' });
      const out = await res.json();
      $('cloud-result-title').textContent = res.ok ? '⬆️ Upload completato' : '❌ Upload fallito';
      $('cloud-result-body').textContent = JSON.stringify(out, null, 2);
      $('cloud-result-modal').style.display = 'flex';
      await refreshStatus();
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '⬆️ Carica tutto su OneDrive';
    }
  }

  async function doDisconnect() {
    if (!confirm('Disconnetti OneDrive? Le immagini locali resteranno, ma i nuovi upload non andranno piu in cloud.')) return;
    try {
      const res = await fetch('/api/cloud/auth/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || 'errore');
      await refreshStatus();
    } catch (e) {
      alert('Errore: ' + e.message);
    }
  }

  function setupListeners() {
    const map = {
      'cloud-save-clientid-btn': saveClientId,
      'cloud-connect-btn': startConnect,
      'cloud-sync-btn': doSync,
      'cloud-push-btn': doPush,
      'cloud-disconnect-btn': doDisconnect,
      'cloud-auth-cancel-btn': cancelAuth,
      'cloud-result-close-btn': () => { $('cloud-result-modal').style.display = 'none'; }
    };
    for (const [id, fn] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    }
  }

  // Inizializza quando si apre la tab Cloud
  function init() {
    setupListeners();
    // Refresha solo se la tab e' attiva al load (oppure quando l'utente la apre)
    const cloudTab = document.getElementById('cloud-tab');
    if (cloudTab && cloudTab.classList.contains('active')) {
      refreshStatus();
    }
    // Hook sui tab button per refreshare quando l'utente apre Cloud
    document.querySelectorAll('.config-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'cloud') setTimeout(refreshStatus, 100);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
