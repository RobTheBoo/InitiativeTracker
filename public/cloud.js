// UI per la tab "Cloud" della pagina configurazione: gestisce OneDrive E Google Drive.
// Usa endpoint REST /api/cloud/* (provider-agnostic).

(function() {
  let pollSession = null;
  let pollTimer = null;
  let activeProvider = null;

  const PROVIDER_LABELS = {
    onedrive: 'OneDrive',
    gdrive: 'Google Drive'
  };

  function $(s, root = document) { return root.querySelector(s); }
  function $$(s, root = document) { return Array.from(root.querySelectorAll(s)); }
  function show(el, d = 'inline-block') { if (el) el.style.display = d; }
  function hide(el) { if (el) el.style.display = 'none'; }

  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
  }

  function getProviderCard(provider) {
    return document.querySelector(`.cloud-provider-card[data-provider="${provider}"]`);
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/cloud/status');
      const data = await res.json();
      for (const provider of Object.keys(data.providers || {})) {
        renderProviderCard(provider, data.providers[provider]);
      }
    } catch (e) {
      console.error('cloud status err', e);
    }
  }

  function renderProviderCard(provider, status) {
    const card = getProviderCard(provider);
    if (!card) return;
    const statusEl = $('.cloud-status-card', card);
    const setupDetails = $('.cloud-setup-details', card);
    const connectBtn = $('.cloud-connect-btn', card);
    const syncBtn = $('.cloud-sync-btn', card);
    const pushBtn = $('.cloud-push-btn', card);
    const disconnectBtn = $('.cloud-disconnect-btn', card);

    let html = '';
    if (!status.configured) {
      html = `<div style="color: var(--accent-red);">❌ Client ID non configurato. Apri "Setup" qui sotto per ottenerlo (gratis).</div>`;
      hide(connectBtn); hide(syncBtn); hide(pushBtn); hide(disconnectBtn);
      if (setupDetails) setupDetails.open = true;
    } else if (!status.connected) {
      html = `<div style="color: var(--accent-gold);">⚙️ Configurato. Clicca "Connetti" per autorizzare l'accesso.</div>`;
      show(connectBtn); hide(syncBtn); hide(pushBtn); hide(disconnectBtn);
    } else {
      const acct = status.account || {};
      const q = status.quota || {};
      html = `
        <div style="color: #51cf66; font-weight: bold; margin-bottom: 6px;">✅ Connesso</div>
        <div style="color: var(--text-light);">
          <strong>${escapeHtml(acct.displayName || PROVIDER_LABELS[provider])}</strong>
          ${acct.mail ? `<span style="color: var(--text-dim); margin-left: 6px;">(${escapeHtml(acct.mail)})</span>` : ''}
        </div>
        ${q.total ? `<div style="color: var(--text-light); margin-top: 8px; font-size: 0.9rem;">
          Spazio: <strong>${fmtBytes(q.used)}</strong> / ${fmtBytes(q.total)}
          <div style="background: var(--bg-light); height: 6px; border-radius: 3px; margin-top: 4px; overflow: hidden;">
            <div style="background: var(--accent-gold); height: 100%; width: ${Math.min(100, (q.used/q.total)*100).toFixed(1)}%;"></div>
          </div>
        </div>` : ''}
        ${status.lastSyncAt ? `<div style="color: var(--text-dim); margin-top: 8px; font-size: 0.8rem;">Ultimo sync: ${new Date(status.lastSyncAt).toLocaleString('it-IT')}</div>` : ''}
        ${status.connectionError ? `<div style="color: var(--accent-red); margin-top: 8px;">⚠️ ${escapeHtml(status.connectionError)}</div>` : ''}
      `;
      hide(connectBtn); show(syncBtn); show(pushBtn); show(disconnectBtn);
    }
    statusEl.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  async function saveClientId(provider, value) {
    if (!value || value.length < 8) { alert('Client ID non valido'); return; }
    try {
      const res = await fetch('/api/cloud/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, clientId: value })
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'errore');
      const card = getProviderCard(provider);
      const inp = $('.cloud-client-id-input', card);
      if (inp) inp.value = '';
      const det = $('.cloud-setup-details', card);
      if (det) det.open = false;
      await refreshStatus();
      RPG_UI?.snackbar?.(`Client ID ${PROVIDER_LABELS[provider]} salvato`, 'success');
    } catch (e) {
      alert('Errore: ' + e.message);
    }
  }

  async function startConnect(provider) {
    activeProvider = provider;
    try {
      const res = await fetch('/api/cloud/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'errore');
      pollSession = out.sessionId;
      $('#cloud-auth-title').textContent = `🔐 Connetti ${PROVIDER_LABELS[provider]}`;
      $('#cloud-auth-uri').href = out.verificationUri;
      $('#cloud-auth-uri').textContent = out.verificationUri;

      // Per Google: niente codice da inserire (loopback automatico)
      // Per OneDrive: mostriamo il device code
      const codeWrap = $('#cloud-auth-code-wrap');
      if (out.userCode && out.userCode !== '(apri il link)') {
        codeWrap.style.display = 'block';
        $('#cloud-auth-code').textContent = out.userCode;
        $('#cloud-auth-intro').textContent = 'Apri questo URL nel browser e inserisci il codice qui sotto:';
      } else {
        codeWrap.style.display = 'none';
        $('#cloud-auth-intro').textContent = 'Si aprirà la pagina di autorizzazione. Accetta i permessi per continuare. Il browser verrà rediretto automaticamente.';
      }

      $('#cloud-auth-status').textContent = `In attesa dell'autorizzazione… (valido per ${Math.round(out.expiresIn / 60)} min)`;
      $('#cloud-auth-modal').style.display = 'flex';

      // Tenta di aprire automaticamente il consent URL (per Google e' essenziale)
      try { window.open(out.verificationUri, '_blank', 'noopener'); } catch (_) {}

      pollTimer = setInterval(pollAuth, 2500);
    } catch (e) {
      alert('Errore avvio connessione: ' + e.message);
    }
  }

  async function pollAuth() {
    if (!pollSession) return;
    try {
      const res = await fetch('/api/cloud/auth/status/' + pollSession);
      const flow = await res.json();
      if (!res.ok) {
        clearInterval(pollTimer); pollTimer = null;
        $('#cloud-auth-status').textContent = '❌ Sessione scaduta';
        return;
      }
      if (flow.status === 'success') {
        clearInterval(pollTimer); pollTimer = null;
        $('#cloud-auth-status').textContent = '✅ Connesso! Chiudi questa finestra.';
        setTimeout(() => {
          $('#cloud-auth-modal').style.display = 'none';
          refreshStatus();
          RPG_UI?.snackbar?.(`${PROVIDER_LABELS[activeProvider]} connesso`, 'success');
        }, 1200);
      } else if (flow.status === 'error') {
        clearInterval(pollTimer); pollTimer = null;
        $('#cloud-auth-status').textContent = '❌ ' + (flow.error || 'errore');
      }
    } catch (_) { /* network blip */ }
  }

  function cancelAuth() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    pollSession = null;
    activeProvider = null;
    $('#cloud-auth-modal').style.display = 'none';
  }

  async function doSync(provider) {
    const card = getProviderCard(provider);
    const btn = $('.cloud-sync-btn', card);
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = '⏳ Sync…';
    try {
      const res = await fetch('/api/cloud/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      });
      const out = await res.json();
      $('#cloud-result-title').textContent = res.ok ? `⬇️ Sync ${PROVIDER_LABELS[provider]}` : '❌ Sync fallito';
      $('#cloud-result-body').textContent = JSON.stringify(out, null, 2);
      $('#cloud-result-modal').style.display = 'flex';
      await refreshStatus();
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  async function doPush(provider) {
    if (!confirm(`Carica TUTTE le immagini locali su ${PROVIDER_LABELS[provider]}? Quelle gia' presenti verranno sovrascritte.`)) return;
    const card = getProviderCard(provider);
    const btn = $('.cloud-push-btn', card);
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = '⏳ Upload…';
    try {
      const res = await fetch('/api/cloud/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      });
      const out = await res.json();
      $('#cloud-result-title').textContent = res.ok ? `⬆️ Upload ${PROVIDER_LABELS[provider]}` : '❌ Upload fallito';
      $('#cloud-result-body').textContent = JSON.stringify(out, null, 2);
      $('#cloud-result-modal').style.display = 'flex';
      await refreshStatus();
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  async function doDisconnect(provider) {
    if (!confirm(`Disconnetti ${PROVIDER_LABELS[provider]}? Le immagini locali resteranno.`)) return;
    try {
      const res = await fetch('/api/cloud/auth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'errore');
      await refreshStatus();
    } catch (e) {
      alert('Errore: ' + e.message);
    }
  }

  function setupListeners() {
    // Per ogni card provider, aggancia i bottoni
    $$('.cloud-provider-card').forEach(card => {
      const provider = card.dataset.provider;
      $('.cloud-save-clientid-btn', card)?.addEventListener('click', () => {
        const inp = $('.cloud-client-id-input', card);
        saveClientId(provider, (inp.value || '').trim());
      });
      $('.cloud-connect-btn', card)?.addEventListener('click', () => startConnect(provider));
      $('.cloud-sync-btn', card)?.addEventListener('click', () => doSync(provider));
      $('.cloud-push-btn', card)?.addEventListener('click', () => doPush(provider));
      $('.cloud-disconnect-btn', card)?.addEventListener('click', () => doDisconnect(provider));
    });

    $('#cloud-auth-cancel-btn')?.addEventListener('click', cancelAuth);
    $('#cloud-result-close-btn')?.addEventListener('click', () => {
      $('#cloud-result-modal').style.display = 'none';
    });
  }

  function init() {
    setupListeners();
    // Refresha quando l'utente apre la tab Cloud
    document.querySelectorAll('.config-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'cloud') setTimeout(refreshStatus, 50);
      });
    });
    // Se la tab Cloud e' gia' attiva al load (es. arrivati da link diretto)
    if (document.getElementById('cloud-tab')?.classList.contains('active')) {
      refreshStatus();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
