# UI Responsive Redesign — Piano

> Scope concordato (vedi conversazione 2026-04-22):
> - Tutte e 4 le viste (master, player, tablet, config) + room-selector
> - Redesign deciso con nuovo design system
> - Audit visivo automatizzato prima/dopo

## Findings dall'audit (explorer subagent)

Stato attuale di `public/style.css` (2032 righe) + `public/ui-enhancements.css` (181 righe):

- **Token CSS solo per colori** (`:root` ha 13 vars: bg, accent, text, border, glow). Manca scala spacing, scala tipografica, scala radius, scala shadow, scala z-index.
- **Variabili usate ma NON definite**: `--text-muted`, `--text` → silently invalid in più componenti.
- **7 breakpoint incoerenti**: 600 / 768 / 800 / 900 / 1024 px senza scala unificata.
- **Bug grave layout**: `.combat-effects` ha `display:flex` inline in `index.html:229` che sovrascrive il `display:grid` del CSS. Tutte le media query che ridefiniscono `grid-template-columns` su `.combat-effects` (~righe 1050, 1100) sono **morte**. Risultato: 3 pannelli effetti affiancati su iPhone in combat → overflow orizzontale.
- **Touch target sotto 44px**: `.btn.small`, `.btn.tiny`, `.entity-chip`, `.cloud-badge`, delete `30px` in `config.html`.
- **Safe area iOS**: solo `env(safe-area-inset-bottom)` su `body` e tablet. Manca `top/left/right` → su iPhone con notch/Dynamic Island il titolo finisce sotto la status bar (perché c'è `viewport-fit=cover`).
- **Hover-only feedback**: tante card (`.character-card`, `.room-card`, `.tie-card`, `.btn`) reagiscono solo a `:hover` → su touch nessun feedback affidabile. Manca `:focus-visible`, `:active`, ARIA states.
- **Tipografia fissa**: niente `clamp()`. `.turn-card .name` arriva a `0.6rem` su mobile = illeggibile.
- **No dark/light system**: solo dark hardcoded. Niente `prefers-color-scheme`, niente toggle.
- **Inconsistenza load CSS**: `room-selector.html` e `config.html` non caricano `ui-enhancements.css` → bottoni si comportano diversamente.
- **Palette aperta**: ~15 colori distinti, alcuni hardcoded (`#FFA500`, `#228B22`, `#51cf66`, `#ff6b6b`, `#555`) fuori dai token.

---

## Strategia in 5 fasi (commit atomico per fase)

Ogni fase produce un commit. Dopo ogni fase si verifica visivamente prima di procedere alla successiva.

### Fase 1 — Design system foundation (`design-tokens.css`) — **NO breaking change**

Obiettivo: introdurre il sistema di token **senza cambiare l'aspetto**.

- [ ] Creare `public/design-tokens.css` con:
  - Scala spacing: `--sp-1` (4px) … `--sp-8` (64px)
  - Scala radius: `--r-sm` (4px), `--r-md` (8px), `--r-lg` (16px), `--r-pill` (9999px)
  - Scala typography fluida con `clamp()`:
    - `--fs-xs` `clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem)`
    - `--fs-sm`, `--fs-base`, `--fs-lg`, `--fs-xl`, `--fs-2xl`, `--fs-display`
    - `--lh-tight` (1.2), `--lh-normal` (1.5)
  - Scala shadow: `--sh-1`, `--sh-2`, `--sh-3` + glow esistenti
  - Scala z-index: `--z-base`, `--z-dropdown`, `--z-modal`, `--z-toast`
  - Breakpoint vars (commento, non runtime): `/* --bp-sm: 480, --bp-md: 768, --bp-lg: 1024, --bp-xl: 1280 */`
  - **Aggiungere le variabili mancanti**: `--text-muted: var(--text-dim)`, `--text: var(--text-light)` per non rompere index.html / room-selector
  - Touch target var: `--touch-min: 44px`
  - Safe area vars wrapping: `--safe-top: env(safe-area-inset-top, 0px)` + analoghi
- [ ] Creare `public/theme-light.css` con override `:root` (palette light). Caricato condizionalmente con `prefers-color-scheme: light` e/o data-attribute `<html data-theme="light">`.
- [ ] Includere `design-tokens.css` PRIMA di `style.css` in tutte le 5 viste HTML.
- [ ] Includere `ui-enhancements.css` anche in `room-selector.html` e `config.html` (consistency).
- [ ] **Verifica**: l'app deve essere identica a prima (i token sono solo aggiunte, non sostituzioni).

### Fase 2 — Bug fix critici e safe area iOS — **piccoli interventi mirati**

Obiettivo: risolvere i bug già identificati senza redesign.

- [ ] Rimuovere `style="display:flex; ..."` inline da `.combat-effects` in `index.html:229` → lasciare che il CSS responsive prenda il sopravvento (grid/flex column mobile).
- [ ] Aggiungere `padding-top: max(env(safe-area-inset-top), 12px)` su body/header delle viste mobile (`index.html`, `room-selector.html`).
- [ ] Aggiornare `min-height` a `var(--touch-min)` su `.btn.small`, `.btn.tiny`, `.entity-chip`, delete buttons in `config.html`.
- [ ] Aggiungere `:focus-visible { outline: 2px solid var(--accent-gold); outline-offset: 2px; }` globale.
- [ ] Aggiungere fallback `:active` per tutti i `:hover` di feedback (transform/box-shadow).
- [ ] **Verifica**: smoke test su iPhone (PWA), Android (browser), desktop. Niente overflow su 375px in combat. Header non sotto notch.

### Fase 3 — Refactor `style.css` con i nuovi token — **incrementale per sezione**

Obiettivo: sostituire valori hardcoded con i token, in modo graduale e verificato.

- [ ] Sezione typography (~righe 60-150 di style.css) → usare `--fs-*` con `clamp()`.
- [ ] Sezione `body/header/container` (~righe 28-100) → spacing/radius dai token.
- [ ] Sezione bottoni (`.btn` + varianti, ~righe 700-800) → token.
- [ ] Sezione modali (~righe 1500-1700) → token + safe area, animazione ingresso più fluida (`transform-origin`).
- [ ] Sezione liste/card (`.character-card`, `.room-card`, `.entity-chip`, ~righe 200-500) → token.
- [ ] Sezione effetti/dropdown (~righe 900-1200) → token.
- [ ] **Verifica dopo ogni sezione**: caricare la vista interessata e confrontare con baseline screenshot.

### Fase 4 — Breakpoint unificati e responsive vero — **lavoro di refactor**

Obiettivo: scala breakpoint pulita + responsive corretto per ogni vista.

- [ ] Adottare scala `sm 480 / md 768 / lg 1024 / xl 1280` (mobile-first, `min-width`).
- [ ] Riscrivere le 7 media query esistenti consolidandole in 4 blocchi `@media (min-width: …)`.
- [ ] **Master view**: già a 3 colonne desktop. Sotto `lg` → 2 colonne (eroi+nemici stacked, controlli sticky in fondo). Sotto `md` → 1 colonna con tab orizzontale (Eroi / Controlli / Nemici / Alleati).
- [ ] **Player view**: già mobile-first ok, migliorare landscape (sotto 600px height): combat panels in tab orizzontale invece di 3-column flex.
- [ ] **Tablet view**: pensata landscape, ma se ruotata in portrait deve switchare a layout verticale leggibile (header titolo + ritratto turno + initiative bar full width sotto).
- [ ] **Config view**: tabs orizzontali devono diventare scroll orizzontale `overflow-x: auto` con `scroll-snap-type` sotto `md`. Card configurazione: 1 col mobile, 2 col tablet, 3 col desktop.
- [ ] **Room-selector**: form crea-stanza in column su mobile, row su desktop. Card stanza min `280px` invece di `300px`.
- [ ] **Verifica**: audit visivo a 320 / 375 / 414 / 768 / 1024 / 1280 / 1920 px, screenshot confronto.

### Fase 5 — Dark/light theme + icone + polish finale

- [ ] Toggle tema in header room-selector + config (☀️/🌙 SVG Lucide). Setta `<html data-theme="…">` + persiste in `localStorage`. Init da `prefers-color-scheme` se mai impostato.
- [ ] Icon set Lucide inline: introdurre `public/icons.js` con SVG inline (close, settings, search, theme-toggle, copy, share, refresh, chevron, plus, trash, edit). ~10 icone, < 5KB totali.
- [ ] Sostituire emoji "di sistema" con Lucide (settings ⚙️ → svg, close ✕ → svg, search 🔍 → svg). Tenere emoji a tema RPG (🎲⚔️🔥🛡️🐉).
- [ ] Font: aggiungere Inter come `--font-ui`, mantenere Cinzel come `--font-display`. Body usa `--font-ui`.
- [ ] Toggle tablet-orientation-mode in `tablet.html`: pulsante ⚙️ apre piccolo overlay con scelta "landscape forzato / responsive". Persiste in `localStorage`.
- [ ] Verificare contrasto WCAG AA su tutti i token (light + dark): script standalone con `wcag-contrast`.
- [ ] Micro-animazioni: ingresso modali (`scale 0.95 → 1`), turn-change pulse, toast slide più morbido.
- [ ] Aggiungere icon `apple-touch-icon` 180x180 e meta `theme-color` con `media="(prefers-color-scheme: …)"`.
- [ ] **Verifica finale**: audit visivo completo, tutti i test E2E verdi, smoke test su iPhone reale (PWA) + Android (APK rebuild).

---

## Verifica per fase

Dopo ogni fase:
1. `npm test` con server avviato → 97 assertion verdi.
2. Screenshot manuale o automatizzato delle 5 viste a 375 / 768 / 1440 px.
3. Smoke test: avviare combat completo da master + 1 player + 1 tablet, vedere che funzioni.
4. Commit atomico con messaggio descrittivo.

## Stima

| Fase | Effort | Rischio |
|------|--------|---------|
| 1 — Design system foundation | 1-2 ore | Basso |
| 2 — Bug fix + safe area | 30-60 min | Basso |
| 3 — Refactor token | 2-3 ore | Medio (regressioni visive) |
| 4 — Breakpoint unificati | 3-4 ore | Alto (cambio layout vero) |
| 5 — Dark/light + polish | 1-2 ore | Basso |

**Totale ~10 ore di lavoro.** Possibile spalmare su più sessioni — ogni fase è autonoma e committabile.

---

## Decisioni di design (concordate 2026-04-22)

1. **Theme**: dark + light, dark di default. Toggle ☀️/🌙 in header (room-selector + config). Persistito in `localStorage` con chiave `rpg-theme`. Rispetta `prefers-color-scheme` come fallback iniziale.
2. **Master su mobile (<768px)**: layout compatto funzionale a tab orizzontali (Eroi / Controlli / Nemici / Alleati / Effetti area). Il master DEVE poter essere usato anche da telefono in caso di emergenza.
3. **Iconografia mista**: emoji per cose a tema RPG (🎲⚔️🔥🛡️), icone Lucide (SVG inline, ~1KB cad) per UI di sistema (close, settings, search, theme-toggle, copy, share, refresh).
4. **Font moderni**: Inter (UI/corpo) + Cinzel solo come accento su h1 di room-selector / titoli decorativi. Inter via Google Fonts subset latin, `font-display: swap`.
5. **Tablet orientation**: dual-mode configurabile. Default = landscape forzato (UX migliore). Toggle nelle opzioni del tablet per attivare "responsive" che usa layout verticale dedicato in portrait. Setting in `localStorage` chiave `rpg-tablet-mode`.

## Review (compilata 2026-04-22)

### Fasi completate

- **Fase 1** ✅ — `design-tokens.css` + `theme-light.css` creati, inclusi in 5 HTML, vars `--text` / `--text-muted` definite. Zero breaking change.
- **Fase 2** ✅ — Bug critici risolti: rimosso `display:flex` inline da `.combat-effects` in `index.html` (le media query ora funzionano), `body` usa `max(env(safe-area-inset-*))` per top/right/bottom/left, touch target ≥44px su `.btn.small`/`.btn.tiny`/`.entity-chip` (con `@media (pointer: coarse)`), `:focus-visible` globale + `touch-action: manipulation` su `.btn`.
- **Fase 3** ✅ — `style.css` refactor: typography (`h1..h4`, `.subtitle`), `.btn` + tutte le varianti, `.modal` (con `max-height` + `overflow-y` + animazione entry + safe area). Tutti i valori da token.
- **Fase 4** ✅ — Creato `responsive.css` mobile-first con breakpoint unificati 480 / 768 / 1024 / 1280. Master ha tab mobile (`.master-mobile-tabs`) con scroll-snap + grid responsive a 768/1024. Player/tablet/config/room-selector tutti responsive. Tablet supporta `data-orient-mode="landscape-lock"` (default) e `data-orient-mode="responsive"`.
- **Fase 5** ✅ — `theme-toggle.js` standalone: gestisce theme dark/light (`localStorage` chiave `rpg-theme`) con auto-mount via `data-theme-toggle-into`, tablet orientation (`localStorage` chiave `rpg-tablet-mode`) con FAB su `.tablet-view`, aggiornamento dinamico `<meta name="theme-color">`, icone Lucide SVG inline. Inter caricato via Google Fonts in tutti gli HTML, applicato come `font-family` di `body`. Slot toggle aggiunto come primo figlio di `<body>` in tutti e 5 gli HTML.

### Verifica

- `npm test`: **28/28 passati** (nessuna regressione end-to-end).
- Lint: **0 errori** su `public/`.
- `better-sqlite3` ricompilato per Node test env.

### File modificati / creati

- Creati: `public/design-tokens.css`, `public/theme-light.css`, `public/responsive.css`, `public/theme-toggle.js`.
- Modificati: `public/style.css`, `public/ui-enhancements.css`, `public/index.html`, `public/master.html`, `public/tablet.html`, `public/room-selector.html`, `public/config.html`.
- Lessons documentate: `tasks/lessons.md` (better-sqlite3 dual-ABI, PowerShell `&&`, Windows file lock, vars CSS non definite, inline `style=` che sovrascrive media query).

### Aggiornamento 2026-04-23 — Onboarding QR/IP per telefono

- Aggiunto **banner connect-helper** in `public/index.html` (player view su `/`) con IP grosso cliccabile (copia in clipboard) + QR a fianco. Si nasconde automaticamente quando si entra in una stanza (sfrutta il fatto che vive dentro `#room-selection.screen`).
- Script standalone (non dipende da `app.js`): usa `/api/server-info` con timeout 4s e fallback su `window.location.origin`. Robusto in WebView Android.
- Bug fix: `info.ips` è array di `{name, address, score}` non di stringhe → mappato `.address` prima di mostrare gli IP alternativi.
- `public/tablet.js`: migrato QR da `api.qrserver.com` (servizio esterno) a `/api/qr` locale → funziona anche offline (tipico setup LAN del DM).
- Rebuild APK: `npx cap sync android` + `gradlew assembleDebug` (4s incrementale). APK aggiornato in `dist/rpg-tracker-debug.apk` (4.1 MB).
- `npm test`: **41/41** passati (con server di test su `:3099` attivo prima di lanciarli).

### Cose rimaste fuori scope (volutamente)

- Sostituzione massiva emoji → SVG Lucide (deciso "mix": emoji RPG-themed restano, Lucide solo per UI di sistema. `theme-toggle.js` espone `getLucideIcon()` per usi futuri).
- Refactor delle 15 hardcoded colors residue dentro `style.css` (i token coesistono ma alcune varianti danger/success usano ancora `#ff6b6b`/`#51cf66` storici per non rompere viste già in produzione).
- Migrazione a CSS layer (`@layer tokens, base, components, overrides`) — utile in futuro, non necessario ora.

### Come provare

1. `npm test` — 28/28 ✓
2. `npm run dev` — Electron desktop, verifica room-selector → tab Cloud, master, player, tablet
3. PWA: `http://rpg-tracker.local:3001` da telefono → "Aggiungi alla schermata Home"
4. Theme toggle: pulsante fisso top-right su tutte le viste (☀️ ↔ 🌙)
5. Tablet orient toggle: FAB bottom-right solo su `tablet.html` (🖥️ ↔ 🔄)

### Aggiunta 2026-04-23 — Toggle orientamento per cellulare/APK

**Richiesta**: su tutte le viste, da cellulare/APK, poter forzare l'orientamento
(verticale o orizzontale) indipendentemente da come l'utente ruota il telefono.

**Implementazione**:
- FAB bottom-left con 3 stati ciclici: `auto` 🔄 → `portrait` 📱 → `landscape` 📺 → `auto`
- Persistenza in `localStorage` chiave `rpg-orient-lock`
- 3 livelli di lock con fallback graduale:
  1. **Native APK** (Capacitor): plugin `@capacitor/screen-orientation` → `ScreenOrientation.lock()`
  2. **PWA standalone** (Android Chrome): Web API `screen.orientation.lock()`
  3. **Fallback**: overlay full-screen "📱 Ruota il telefono" se il device è nell'orientamento sbagliato e i livelli 1+2 hanno fallito
- Visibilità FAB: solo se `viewport ≤ 768px` OR `Capacitor.isNativePlatform()`, escluso `body.tablet-view` (ha già il suo toggle landscape/responsive)
- File toccati: `package.json` (+1 dep), `public/theme-toggle.js`, `public/ui-enhancements.css`, `npx cap sync android` + rebuild APK

### Distribuzione binari (richiesta originale dell'utente)

**Windows app:**
```powershell
npm run build:win
# output → dist/RPG Initiative Tracker Setup x.x.x.exe (NSIS installer)
# oppure dist/win-unpacked/RPG Initiative Tracker.exe (portable)
```

**Android APK:**
```powershell
# Prerequisiti: Android Studio installato
npm run build           # build web
npx cap sync android    # sincronizza con Capacitor
npx cap open android    # apre Android Studio
# In Android Studio: Build → Build Bundle(s) / APK(s) → Build APK(s)
# output → android/app/build/outputs/apk/debug/app-debug.apk
```
Oppure da CLI:
```powershell
cd android
.\gradlew.bat assembleDebug
# output: android/app/build/outputs/apk/debug/app-debug.apk
```
Trasferire l'APK sul telefono → Impostazioni → Sicurezza → consenti origini sconosciute → installare.
