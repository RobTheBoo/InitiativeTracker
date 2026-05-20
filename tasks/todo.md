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

- [ ] **1a**: `npm install @hampoelz/capacitor-nodejs` (o fork mantenuto).
- [ ] **1b**: scaffolding `nodejs/` directory in `public/`. Hello world Node:
  un Express che risponde `{ ok: true, ip: <IP> }` su `/health`.
- [ ] **1c**: build APK (rebuild script gia' funziona). Install emulator.
  Verifica via `adb forward tcp:3001 tcp:3001` + `curl localhost:3001/health`
  che il server risponda.
- [ ] **1d**: secondo emulator (o device fisico) → test LAN reale (non solo
  via adb forward). NB: `emulator -netdelay none -netspeed full -dns-server
  192.168.1.1` per propagazione DNS, oppure `adb -s <emul-2> shell` con
  `192.168.X.Y`.

**Check-point.** Se 1c o 1d falliscono → STOP, fallback a mDNS+QR su
architettura attuale (opzione C).

### Step 2 — Porting server (4-6h)

- [ ] **2a**: spostare `src/server/`, `src/storage/`, `src/sync/` in
  `nodejs/server/` (o equivalente). Tutto il codice e' gia' modulare.
- [ ] **2b**: sostituire `better-sqlite3` con il fork
  [`digidem/better-sqlite3-nodejs-mobile`](https://github.com/digidem/better-sqlite3-nodejs-mobile).
  Verificare ABI (ARM64 + ARMv7).
- [ ] **2c**: avviare il server reale dentro Capacitor-NodeJS process.
  Healthcheck: `/api/server-info`, `/api/rooms`, `/api/health`.

**Check-point.** Se `better-sqlite3` mobile non compila → fallback a `sql.js`
(SQLite WebAssembly puro JS) — piu' lento ma sempre cross-platform.

### Step 3 — UX onboarding senza IP (3-5h)

- [ ] **3a**: master.html / master.js — quando in APK Master, socket.io si
  collega a `http://localhost:3001` (in-app, dentro il telefono).
- [ ] **3b**: nuova pagina o sezione "🎭 Master attivo" che mostra:
  - IP LAN del proprio telefono (via plugin `@capacitor/network` o nativo).
  - QR code dell'URL completo.
  - Pulsante "Stop server".
- [ ] **3c**: APK Player — pulsante "📷 Scansiona QR" (plugin
  `@capacitor-mlkit/barcode-scanning` o `@capacitor-community/barcode-scanner`),
  riempie automaticamente i blocchi IP e clicca Connetti.

**Check-point.** Demo: 1 emulator Master + 1 emulator Player → join via
QR/IP → combat round.

### Step 4 — Permessi & Foreground Service (2-4h)

- [ ] **4a**: AndroidManifest:
  - `FOREGROUND_SERVICE`
  - `FOREGROUND_SERVICE_DATA_SYNC` (Android 14+)
  - `POST_NOTIFICATIONS` (Android 13+, runtime)
  - `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` (per leggere IP LAN)
- [ ] **4b**: Foreground Service Android nativo (Kotlin/Java) che mantiene
  il Node process vivo + notifica persistente "Server attivo - tap per fermare".
  Il plugin Capacitor-NodeJS forse lo include gia'; se no, scriverlo.
- [ ] Test stabilita': spegni schermo, ricevi chiamata, ruota telefono → server
  deve restare up.

### Step 5 — Build APK + test (2-4h)

- [ ] **5a**: build APK release-unsigned in `dist/RPG-Initiative-Tracker-server-debug.apk`.
  Install su 2 emulator. Smoke test: crea stanza Master, Player si connette,
  combat 2 round.
- [ ] **5b**: aggiorna `tasks/todo.md` Review + nuova sezione in `tasks/lessons.md`
  ("Capacitor-NodeJS embedding: gotchas"). Commit + push.

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

## Review

> Da compilare al termine.
