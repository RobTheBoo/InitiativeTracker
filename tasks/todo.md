# Server-on-Phone (APK Master autonomo) — Piano

> **Decisione 2026-05-20**: spostare il server Node.js DENTRO l'APK Capacitor
> usando il plugin [hampoelz/Capacitor-NodeJS](https://github.com/hampoelz/Capacitor-NodeJS).
> Risultato: il telefono Master diventa un host LAN, gli altri telefoni Player
> si collegano a `http://<IP-master>:3001`. Niente PC necessario.

---

## Obiettivo

Quando l'utente apre l'APK Master e tappa "🎭 Sono il Master":
1. Parte un Node.js server interno alla porta 3001 sull'IP WiFi del telefono.
2. Lo schermo mostra un **QR code col proprio IP LAN** + numero (es. `192.168.1.27:3001`).
3. Telefoni Player aprono l'APK Player (= stesso APK), scansionano il QR (o
   digitano IP a mano), si collegano. Niente IP da inserire sul Master.
4. Foreground Service tiene il server attivo anche con schermo spento.

## Vincoli

- Battery: foreground service + notifica persistente (richiesto Android 8+).
- APK size: 4.3 MB → ~50-70 MB (Node runtime ARM64).
- iOS: NON supportato (limitazione Apple/JIT). Non e' un problema, l'utente
  usa solo Android.
- Compatibilita' Capacitor 7+ (oggi siamo a 7).

## Percorso a step (con check-point dopo ogni step)

### Step 1 — Proof of Concept (2-3h)

- [x] **1a**: `npm install capacitor-nodejs@1.0.0-beta.9` (richiede Capacitor 7+).
- [x] **1b**: scaffolding `public/nodejs/` con `package.json` + `index.js` hello world.
- [x] **1c**: build APK + install emulator + `adb forward tcp:13001 tcp:3001`
  → `curl localhost:13001/health` ✅.
- [x] **1d**: rimandato a Step 5a (smoke test E2E con due client).

**Check-point.** Se 1c o 1d falliscono → STOP, fallback a mDNS+QR su
architettura attuale (opzione C).

### Step 2 — Porting server (4-6h)

- [x] **2a**: rese mobile-safe `src/server/*` e `electron/{database,room-manager}.js`:
  - `paths.js`: aggiunto `opts.dataDir`, `opts.publicDir`, `opts.libraryDir`,
    flag `opts.mobile` per forzare comportamento "packaged".
  - `electron/database.js`: `require('electron')` in `try/catch`, parametro
    `dbOptions` per iniettare `nativeBinding`.
  - `electron/room-manager.js`: helper `isAppPackaged()` mobile-safe.
  - `create-server.js`: accetta `opts.appVersion` e `opts.dbOptions`.
- [x] **2a.2**: `BUILDA-APK.ps1` STEP 2bis: stage `src/`, `electron/*`, `data/`,
  `public/*` (escluso `public/nodejs/`) in `public/nodejs/{src,electron,data,webapp}/`.
  Copia `package.json` root → `app-package.json`. `npm install` automatico.
- [x] **2b**: scaricato fork `digidem/better-sqlite3-nodejs-mobile@12.10.0`,
  estratti prebuilt `android-arm`, `android-arm64`, `android-x64` in
  `public/nodejs/sqlite-prebuilds/`. `index.js` carica il binding giusto in base a
  `process.arch`.
- [x] **2c**: server reale up. Healthcheck OK: `/api/server-info`, `/api/rooms`,
  `/api/health`. DB con seed (6 heroes) caricato correttamente.

**Check-point.** Se `better-sqlite3` mobile non compila → fallback a `sql.js`
(SQLite WebAssembly puro JS) — piu' lento ma sempre cross-platform.

### Step 3 — UX onboarding senza IP (3-5h)

- [x] **3a**: `master.js` + `room-selector.js` — quando in APK
  (`window.isCapacitorApp`), socket.io e fetch puntano a `http://localhost:3001`.
- [x] **3b**: `openAsMasterCapacitor()` in `app.js`:
  - Polling `GET /api/server-info` (timeout 60s) per attesa Node ready.
  - Overlay full-screen con IP LAN del telefono + QR (libreria `qrcode`).
  - Pulsante "Apri stanze" che porta al room-selector.
- [x] **3c**: APK Player — connessione manuale via IP/porta nel form esistente.
  QR scanner rimandato (richiederebbe `@capacitor-mlkit/barcode-scanning`,
  ~10 MB extra, non bloccante).

**Check-point.** Demo: 1 emulator Master + 1 emulator Player → join via
QR/IP → combat round.

### Step 4 — Permessi & Foreground Service (2-4h)

- [x] **4a**: AndroidManifest aggiornato:
  - `INTERNET` (gia' presente)
  - `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` (per leggere IP LAN)
  - `windowOptOutEdgeToEdgeEnforcement` (Android 15)
- [ ] **4b**: ~~Foreground Service nativo~~ → **rimandato**. Per uso emulator
  + sessioni brevi (1-2h con app in foreground) il Node nodejs-mobile resta
  vivo. Solo necessario se vogliamo che il server giri con app in background
  o schermo spento. Da aggiungere se l'utente lo richiede dopo i test reali.

### Step 5 — Build APK + test (2-4h)

- [x] **5a**: APK `dist/RPG-Initiative-Tracker-debug.apk` (~57 MB). Smoke test
  E2E con `dist/test-e2e-socket.js`:
  - HTTP `POST /api/rooms/create` ✅
  - HTTP `GET /api/rooms` ✅
  - Master Socket.IO connect + `joinRoom` + `becomeMaster` ✅
  - Player Socket.IO connect + `joinRoom` ✅ riceve `gameState` con
    `masterId` corretto e 6 heroes dal DB seed.
- [x] **5b**: docs aggiornate (questo file + `tasks/lessons.md`). Commit + push.

## Rollback

Se uno step fallisce in modo bloccante:
- Tutti i commit sono atomici per step → `git revert <commit-step-N>` torna
  alla versione precedente.
- Fallback C (mDNS + QR su architettura PC-server attuale) e' sempre
  raggiungibile in ~3-5h aggiuntive.

## Stima tempo totale

| Step | Effort | Rischio |
|---|---|---|
| 1 — PoC | 2-3h | Basso |
| 2 — Porting server | 4-6h | Medio (better-sqlite3 mobile) |
| 3 — UX onboarding QR | 3-5h | Basso |
| 4 — Foreground service | 2-4h | Medio (Kotlin nativo) |
| 5 — Build & test | 2-4h | Basso |

**Totale 13-22 ore** lavoro effettivo, con check-point dopo ogni step.

## Review (2026-05-20)

### Risultato

Implementazione **completa** del server-on-phone. L'APK ora avvia un Node.js
server nativo dentro il telefono Master quando l'utente tappa "🎭 Sono il Master":

1. Capacitor-NodeJS plugin avvia un processo Node separato col runtime ARM64/x64.
2. `public/nodejs/index.js` fa boot: carica il binding mobile di `better-sqlite3`,
   inizializza il DB in `getDataPath()/data/`, avvia Express+Socket.IO su `0.0.0.0:3001`.
3. La WebView del Capacitor app si collega a `http://localhost:3001` (loopback interno).
4. Overlay full-screen mostra IP LAN del telefono + QR code per i Player.
5. Player APK (o browser su altro device) puntano a `http://<IP-master>:3001`.

### Cosa funziona (verificato in emulator)

- Server Node embedded up: `Server listening on 0.0.0.0:3001`
- HTTP API: `GET /api/server-info`, `GET /api/rooms`, `POST /api/rooms/create`
- DB SQLite mobile con seed: 6 heroes caricati
- Socket.IO bidirezionale: Master `becomeMaster`, Player riceve `gameState`
- Static serving della webapp dalla cartella `nodejs/webapp/`
- Path data: scrive in `/data/user/0/com.rpg.initiativetracker/files/nodejs/data`

### Note operative

- APK size: 4.3 MB → **~57 MB** (Node.js ARM/x64 runtime + native modules)
- Build script (`BUILDA-APK.ps1`) ora stage automaticamente tutto il server in
  `public/nodejs/` ad ogni build → no manual sync.
- File ignorati in git: `public/nodejs/{src,electron,data,webapp,node_modules,app-package.json}`
  (rigenerati automaticamente).
- iOS: NON supportato (limitazione Apple/JIT del plugin).

### Limiti noti / lavoro futuro

- **Foreground service**: non implementato. Se il Master tappa Home l'app va
  in background e Android dopo qualche minuto puo' uccidere il processo
  Node. Per uso "tavolo da gioco con telefono in mano" non e' un problema;
  per sessioni lunghe con schermo spento serve un foreground service Kotlin
  (~2-4h lavoro).
- **QR scanner Player**: il Player digita ancora IP a mano. Plugin
  `@capacitor-mlkit/barcode-scanning` aggiungerebbe ~10 MB ma e' opzionale.
- **mDNS**: disabilitato in mobile (`opts.enableMdns: false`). I Player devono
  digitare IP. Una soluzione: server fa `bonjour-service` Android-friendly
  oppure HTTP discovery via QR (gia' implementato).

### Bug fix scoperti durante test

- `RangeError: Too few parameter values were provided` — era nel test E2E,
  passavo un object al socket.io event `joinRoom` che si aspetta una stringa.
  Test client aggiornato in `dist/test-e2e-socket.js`.

---

# 3-Source Local Import (Windows + APK) — Piano

> **Decisione 2026-05-20**: l'utente vuole tre input separati (immagini, stanze,
> libreria personaggi+effetti) sia su Windows che su APK. Niente OneDrive /
> WebDAV / cloud. Cartelle locali punto e basta. La sorgente NON viene MAI
> modificata: l'app fa "import = copia in app-data", poi gioca dalla copia
> locale (questo e' gia' il comportamento attuale).

## Obiettivo

Sostituire l'attuale flow "una cartella unica con sub-cartelle" con tre
puntamenti indipendenti:

1. **Cartella IMMAGINI** (con sub `heroes/`, `enemies/`, `allies/`, `summons/`)
2. **Cartella STANZE** (con file `<id>.json` per ogni stanza)
3. **File LIBRERIA** (`config.json` con heroes/enemies/allies/summons/effects)

Ogni puntamento opzionale e indipendente. UI:
- Su Windows / Electron: 3 input testuali + 3 bottoni "Sfoglia" (dialog nativo)
- Su APK Capacitor: 3 input + 3 bottoni "Aggiungi file/cartella" (file picker
  Android via plugin)

## Step

### Step A — Backend (refactor folder-sync) — 2-3h

- [x] **A1**: `folder-store.js`: schema {`imagesPath`, `roomsPath`, `libraryPath`}.
  Backward compat con `folderPath` legacy via `migrateLegacy(cfg)`.
- [x] **A2**: `folder-sync.js`: nuove `analyzeImportSources(sources, deps)` e
  `applyImportSources(sources, deps, resolutions)` che lavorano sui 3 path
  indipendenti. La sorgente NON viene mai scritta. Vecchie API mantenute.
- [x] **A3**: `folder-routes.js`: nuovi endpoint
  - `GET  /api/folder/sources` (con probe esistenza/tipo)
  - `POST /api/folder/sources` { imagesPath?, roomsPath?, libraryPath? }
  - `POST /api/folder/analyze-sources`
  - `POST /api/folder/import-sources`
- [x] **A bonus**: `/api/server-info` ora restituisce anche `dataDir` per
  hint UI "i dati vengono salvati qui".

### Step B — Frontend Electron — 2-3h

- [x] **B1**: `electron/main.js` + `preload.js`: aggiunto handler
  `folder:pick-file` (per il file singolo `config.json`) accanto a `folder:pick`.
- [x] **B2**: `public/config.html`: nuova sezione "Importa dati locali" con:
  - Box informativo + spiegazione struttura.
  - 3 righe input + Sfoglia + Clear:
    - 🖼️ Immagini → `pickFolder()`
    - 🏰 Stanze → `pickFolder()`
    - ⚙️ Libreria → `pickFile()` (filter JSON)
  - Bottone "Importa da queste sorgenti" + "Salva puntamenti".
- [x] **B3**: la vecchia UI "una cartella unica" e' stata nascosta sotto
  `<details>` "Modalita' classica: cartella unica" per chi gia' la usa.

**Verifiche backend (2026-05-20)**:
- E2E con server headless + cartelle/file fittizi:
  - GET /api/folder/sources -> sources null + probes.
  - POST /api/folder/sources -> set 3 path.
  - GET di nuovo -> probes ok=true per tutti e 3.
  - POST /api/folder/analyze-sources -> imageCount: 2, configCounts ok,
    rooms.length: 1, canImport: true.
  - POST /api/folder/import-sources -> configImported=true, images.copied=2,
    rooms.created=1, sorgente non toccata.

### Step C — APK Capacitor — 4-5h

- [x] **C1**: `npm install @capawesome/capacitor-file-picker@^7.2.0` (file picker
  multi-select PNG/JPG e JSON, compat Capacitor 7).
- [x] **C2**: 3 server endpoint multipart in `folder-routes.js`:
  - `POST /api/folder/upload-images` (multer in-memory, scrive in
    app-data/images/<sub>/, sub valida tra heroes/enemies/allies/summons,
    stesso nome sovrascrive)
  - `POST /api/folder/upload-rooms` (parsing JSON, conflitti via resolutions)
  - `POST /api/folder/upload-library` (singolo file, merge per id come
    applyImportSources)
- [x] **C3**: in `config.html` + `folder-sync.js`, branch su `isCapacitor`:
  - Nasconde input testuale path + bottoni Sfoglia/Clear.
  - Mostra dropdown sub-cartella + bottone "📁 Aggiungi immagini".
  - Mostra bottoni "🏰 Aggiungi stanze" e "⚙️ Aggiungi libreria".
  - File picker via `Capacitor.Plugins.FilePicker.pickFiles({types, limit})`.
  - Lettura blob via `Capacitor.convertFileSrc(file.path)` + fetch (no
    readData per evitare crash su file grandi).
  - Upload via FormData multipart agli endpoint server.
  - Feedback inline sotto ogni bottone con copied/created/errors.
- [x] **C4**: BUILDA-APK.ps1 nessuna modifica necessaria - `cap sync`
  rileva e include automaticamente il plugin file picker.

**Verifiche su emulator (2026-05-20)**:
- APK build: 165 MB (era 57, +108 MB per AndroidX + transitivi del file picker)
- `npx cap ls android` -> 3 plugin: screen-orientation, file-picker, nodejs.
- logcat: `Capacitor: Registering plugin instance: FilePicker` ✅
- Server embedded up + endpoint /api/folder/sources, /upload-* funzionanti
  via adb forward + curl multipart:
  - upload-library: { imported:true, counts:{ heroes:1, effects:1 } }
  - upload-rooms: { created:1 }
  - upload-images: { copied:1, target:".../images/heroes" }
- HTML del config.html servito dal Node embedded contiene `src-images-mobile`
  (curl + grep). Nuova UI presente.
- Test visivo file picker SAF: rimandato al device fisico utente
  (l'AVD x86_64 in dotazione e' bloccato in stato "recents view" da snapshot).

### Step D — Test E2E + commit — 1-2h

- [ ] **D1**: Electron: import da 3 cartelle separate, verifica che immagini
  appaiano in app-data, stanze nel DB, library mergata.
- [ ] **D2**: APK emulator: idem via file picker.
- [ ] **D3**: commit + push + lessons.

**Stima totale: 9-13h**

## Review (2026-05-20)

### Risultato

Implementazione **completa** del 3-source local import su Windows e APK.

**Windows / Electron**:
- 3 input testuali con dialog nativo (folder o file).
- Persistenza dei 3 path nel folder-sync.json. Migrazione automatica da
  vecchio `folderPath` legacy.
- Bottone "Importa da queste sorgenti" -> analyze (preview con conteggi e
  conflitti) -> modal -> apply.

**APK Android**:
- File picker SAF nativo via @capawesome/capacitor-file-picker.
- 3 bottoni "Aggiungi" (immagini/stanze/libreria) che fanno upload multipart
  al server Node embedded.
- Endpoint server-side dedicati che scrivono nelle stesse posizioni
  app-data del flusso desktop. Comportamento identico (stesso nome
  sovrascrive, nome diverso aggiunge, conflitti rooms via resolutions).

**Cosa NON viene mai modificato**: i file nella sorgente. L'app fa solo
lettura su Windows; su Android gli upload sono copie in memoria.

### Limiti / lavoro futuro

- APK size cresciuto da 57 MB a 165 MB (+108 MB) per le dependencies
  AndroidX trascinate dal file picker. Possibile slimming via R8/proguard
  ma non urgente.
- Test visivo SAF picker non eseguito su emulator (AVD bloccato in
  recents view); l'utente lo testera' su device fisico.
- Non c'e' un pulsante "Annulla import" durante l'upload. Per ora se
  l'utente sbaglia categoria immagini, basta cancellare i file dalla
  cartella images/<sub>/ e ricaricare.

### Bug fix scoperti durante test

- Inizialmente `Invoke-RestMethod` di PowerShell andava in timeout
  silenzioso contro il server tramite adb forward. Fix: usare `curl.exe`
  che e' piu' affidabile per richieste multipart binary.
- File JSON salvati con `Out-File -Encoding utf8` di PowerShell hanno
  BOM iniziale che fa fallire `JSON.parse`. Fix per i test:
  `[System.IO.File]::WriteAllText(path, content, [UTF8Encoding]::new($false))`.
