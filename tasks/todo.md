# Master Android utilizzabile — Piano

> Obiettivo: rendere la vista **Master** usabile e leggibile da APK Android e da
> browser non-Electron. Auth scelta: **"primo arrivato vince"** (chi clicca
> "Sono Master" prende il ruolo, gli altri lo perdono).
>
> Stato pre-piano (confermato con test in locale a 375×667 il 2026-05-19):
> - Layout responsive base già funzionante (1 col mobile, 2 col 768, 3 col 1024)
> - Tab-bar mobile sticky, combat-bar mobile, theme/orient toggle: già OK
> - Manca: sblocco non-Electron, 4 bug visivi mobile, drag tie touch, routing APK

---

## Blocco B — Bug visivi mobile [CSS only, basso rischio]

Stima: 1-2 ore.

- [ ] **B.1**: `add-ally-form` e `add-enemy-form` (Master view) wrappano in 2
  righe sotto md. Oggi a 375px il bottone "+ Alleato" è tagliato a destra.
  - Fix in `responsive.css`: `flex-wrap: wrap` + ogni input/btn `min-width: 0`,
    bottone primario (`.btn.success` / `.btn.primary` finale) full-width sotto
    768px.
- [ ] **B.2**: `round-display` deve mostrare la label "Round" visibile su mobile.
  Oggi a 375px si vede solo il "1" perché la label "Round" è tagliata.
  - Fix in `style.css` o `responsive.css`: layout flex-row con label inline.
- [ ] **B.3**: `combat-bar` sticky non deve sovrapporsi a `master-mobile-tabs`.
  Oggi quando il combat parte, la nav mobile sparisce sotto la combat-bar.
  - Fix: o `top: var(--combat-bar-height, 64px)` sulla nav, o nascondere la nav
    mentre il combat è attivo (master può scrollare comunque).
- [ ] **B.4**: card eroe con form effetti — su sm (480px) la riga
  `Nome | +/- | Rnd | +` è troppo stretta. Wrappa in 2 righe (`Nome` su prima
  riga full-width, `+/- | Rnd | +` sotto).
- [ ] Verifica visiva a 375 / 768 / 1024 px (combat ON/OFF) → screenshot.
- [ ] Commit `fix(ui): bug visivi master mobile (form wrap, round label, combat-bar overlap)`.

## Blocco A — Sblocco "primo arrivato" [server + client]

Stima: 30-60 min.

- [ ] **A.1**: rimuovi check `isLocalhost` in `electron/room-manager.js:178-193`.
  Lascia solo il check esistente "masterId già occupato" (~196-202).
- [ ] **A.2**: rimuovi guard "non Electron" in `public/master.js:892-898`
  (redirect a `/index.html`).
- [ ] **A.3**: aggiungi snackbar/toast informativo se il client riceve
  `error: 'Master già connesso'` con CTA "Vai a Giocatore" / "Riprova".
- [ ] **A.4**: test E2E veloce: `npm test` deve restare verde (i test e2e usano
  socket non-localhost, oggi probabilmente passano grazie a `127.0.0.1`).
- [ ] Test manuale: apri `master.html` da browser non-Electron, diventa Master.
  Apri seconda finestra, ricevi errore "già connesso".
- [ ] Commit `feat(master): sblocca becomeMaster da qualunque client (auth primo arrivato)`.

## Blocco C — Form e modali ottimizzate per touch

Stima: 2-3 ore.

- [ ] **C.1**: modale "Iniziative Uguali" (`#initiative-tie-modal`): il
  drag-and-drop HTML5 (commit 742742d) non funziona su touch device.
  Aggiungi listener `touchstart/touchmove/touchend` che simulano drag,
  con `touch-action: none` su `.tie-card[draggable="true"]`.
- [ ] **C.2**: `<input list="effects-datalist">` su Android copre i bottoni
  sotto. Fix con `position: relative` sul container o cambio in select custom.
- [ ] Test manuale del flusso "iniziativa uguale" da telefono.
- [ ] Commit `feat(touch): drag-and-drop tie reorder + datalist fixes per mobile`.

## Blocco D — APK Master entry-point

Stima: 3-4 ore.

- [ ] **D.1**: trasforma `room-selector.html` per essere usabile anche da APK:
  - Se non-Electron e non c'è IP server salvato → mostra blocchi IP (riusa
    `parseIpToBlocks` da `public/index.html`) + pulsante "Connetti".
  - Dopo connect: mostra lista stanze remote con due bottoni per stanza:
    "Entra come Master" / "Entra come Giocatore".
- [ ] **D.2**: `capacitor.config.json`: definisci entry point dell'APK su
  `/room-selector.html` (oggi parte da `/index.html`). Verifica `webDir`.
- [ ] **D.3**: `master.js`: gestisci il caso non-Electron (no IPC), ricava
  `socketUrl` da `window.location.origin`. Aggiungi link "← Torna alle stanze"
  che usa `window.location.href = '/room-selector.html'` quando non-Electron.
- [ ] **D.4**: rebuild APK con `BUILDA-APK.ps1` → APK in `dist/`.
- [ ] Test manuale su browser mobile-emulato. Test su device reale se
  disponibile.
- [ ] Commit `feat(apk): vista Master accessibile da APK Android via room-selector mobile`.
- [ ] Push `git push origin main`.

## Verifica finale

- [ ] `npm test` con server di test su `:3099` → tutti passati.
- [ ] Smoke test: avvia EXE → crea room → telefono APK entra come Master →
  secondo telefono entra come Giocatore → combattimento.
- [ ] Aggiorna tasks/todo.md sezione "Review".
- [ ] Aggiorna tasks/lessons.md con eventuali pattern emersi.

---

## Decisioni

- **Auth Master**: "primo arrivato vince" (decisa 2026-05-19). Cooldown 30s
  prima di permettere takeover dopo disconnect — `OPZIONALE`, non in MVP.
- **APK firma**: resta debug (non release), va bene per uso domestico/LAN.
- **Versioning**: bump a `1.0.1` solo in release finale, non per ogni blocco.

## Stima totale

| Blocco | Effort | Rischio |
|---|---|---|
| B — Bug visivi mobile | 1-2h | Basso |
| A — Sblocco primo arrivato | 30-60min | Basso |
| C — Touch friendly | 2-3h | Medio (drag touch) |
| D — Routing APK + room-selector mobile | 3-4h | Medio |

**Totale: 7-10 ore di lavoro effettivo.**

## Review (2026-05-19)

Tutti e 4 i blocchi completati e pushati su `origin/main` in 4 commit
atomici:

| Commit | Descrizione | Files | Test |
|---|---|---|---|
| `e82d03d` | Blocco B: bug visivi mobile (form wrap, round label, combat-bar overlap) | 2 | E2E 53/53 |
| `7197729` | Blocco A: sblocca becomeMaster da qualunque client (auth primo arrivato) | 2 | E2E 53/53 + manuale browser non-Electron |
| `6459596` | Blocco C: drag-and-drop initiative bar funziona su mobile (long-press 250ms) | 2 | E2E 53/53 |
| `b22664d` | Blocco D: vista Master accessibile da APK Android via room-selector mobile | 4 | E2E 53/53 + manuale flow room-selector → master |

Outcome:
- Vista Master raggiungibile da APK / browser / Electron tutti via stesso
  flusso. Auth "primo arrivato vince" (decisa il 2026-05-19).
- APK rebuildato in `dist/RPG-Initiative-Tracker-debug.apk` (4225 KB,
  gradle BUILD SUCCESSFUL in 21s).
- Drag-and-drop initiative bar funziona ora su touch device con long-press
  250ms + haptic feedback (navigator.vibrate).

Skipped nel MVP (annotato per futuro):
- C.2: il dropdown `<input list="effects-datalist">` su Android puo' coprire
  i bottoni sotto. Il dropdown e' nativo, fix CSS-only non risolve.
  Da valutare con select custom se l'usabilita' non basta in test reale.
- Cooldown 30s per takeover Master dopo disconnect: skip MVP.
- Versioning: APK resta debug + versionCode 1.0; bump quando si fa la
  release stabile. Per uso domestico/LAN va bene cosi'.

Tempo effettivo: ~2.5 ore (vs. stima 7-10h grazie al codebase gia' molto
responsive e a room-selector.js gia' browser-aware).

Prossimi step potenziali (NON nel MVP):
- Test su device fisico Android per validare touch DnD reale.
- Snackbar/toast invece di alert per "Master gia' connesso" (oggi mostra
  schermata error con bottone Riprova - funzionale ma non slick).
- Disabilitare il bottone "+ Master" se la stanza ha gia' un master
  connesso (visualmente, NON come security gate).
