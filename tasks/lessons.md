# Lessons learned

Memo di pattern/bug ricorrenti e workaround. Aggiungere ogni volta che l'utente
corregge un errore o emerge un problema strutturale.

---

## 2026-04-22 — `better-sqlite3` dual-ABI (Electron vs Node)

**Problema.** `better-sqlite3` è un modulo nativo: la sua `.node` library
viene compilata per UN SOLO ABI (NODE_MODULE_VERSION). Ma noi lo usiamo:
- da **Electron** (`npm run dev` / `npm run build:win`) → ABI 130 (Electron 33)
- da **Node sistemico** (`npm test`, `npm start`) → ABI 127 (Node 22)

Se compili per uno, l'altro va in `ERR_DLOPEN_FAILED`.

**Workaround attuale.** Switchare manualmente:

```powershell
# Per usare con Node (npm test, npm start, server headless):
npm rebuild better-sqlite3

# Per usare con Electron (npm run dev, npm run build:win):
npx electron-rebuild -f -w better-sqlite3
```

⚠️ Se la `.node` è in uso (server già aperto), `unlink EPERM`. Bisogna
killare i processi node leftover (`Get-Process node | Stop-Process`).

**TODO follow-up.** Considerare:
- Aggiungere script npm `rebuild:node` e `rebuild:electron`
- Far girare i test E2E DENTRO Electron (es. con `electron-mocha`) per
  evitare il dual-rebuild
- Oppure aggiungere uno script `pretest` che fa rebuild automatico per Node

---

## 2026-04-22 — PowerShell non supporta `&&`

In Cursor su Windows la shell di default è PowerShell, non bash. Usare
`;` per chain o `if ($LASTEXITCODE -eq 0)` per fail-fast. Esempio:

```powershell
# NO: git pull && npm install
# YES:
git pull; if ($LASTEXITCODE -eq 0) { npm install }
# OPPURE separare in due chiamate Shell distinte.
```

---

## 2026-04-22 — Process leftover lockano file su Windows

Dopo aver killato un processo Electron / node, alcuni file restano lockati
(specie `.node` nativi e cache di `dist/`). Pattern di pulizia:

```powershell
Get-Process electron, node -ErrorAction SilentlyContinue |
  Where-Object { $_.StartTime -gt (Get-Date).AddHours(-1) } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
```

Altrimenti `electron-rebuild` e `electron-builder` falliscono con `EPERM`.

---

## 2026-04-22 — UI: variabili CSS usate ma mai definite

In `index.html` e `room-selector.html` e `style.css:1584` venivano usate
`var(--text)` e `var(--text-muted)` MA mai dichiarate nel `:root` di
`style.css`. Il browser le tratta come invalid value silently — il colore
finiva al default del browser senza warning.

**Pattern di prevenzione.** Quando aggiungi una `var(--xxx)`, verifica che
sia definita (grep nel CSS). Considera `linter` CSS (`stylelint`) con regola
`custom-property-no-missing-var-function`.

Risolto in `public/design-tokens.css` aggiungendo `--text` e `--text-muted`
come alias verso le variabili esistenti.

---

## 2026-04-22 — Inline `style=` HTML sovrascrive media query CSS

Bug grave in `index.html`: `.combat-effects` aveva `style="display: flex;
gap: 15px"` inline. Tutte le media query in `style.css` che ridefinivano
`.combat-effects { grid-template-columns: ... }` erano morte (style inline
ha specificity più alta di qualsiasi selettore).

**Pattern di prevenzione.** No layout in `style="..."` HTML inline. Solo
classi → CSS. Se serve "modificatore", usare classi modifier (`.combat-effects.is-vertical`).

---

## 2026-04-23 — `dist\win-unpacked\resources\app.asar` lockato → build:win fallisce

`electron-builder --windows` deve cancellare `dist\win-unpacked` prima di
ripopolarla. Su Windows quel `app.asar` (l'archivio dell'app) viene spesso
lockato da:
- OneDrive (anche se la cartella e' fuori da OneDrive sync, scansiona)
- Defender real-time scan post-write
- Windows Search Indexer
- preview pane di Esplora risorse

Sintomo: `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` con
`remove ...\app.asar: The process cannot access the file because it is being
used by another process`. NON e' un Electron zombie: anche `Get-Process electron`
restituisce vuoto. Anche `Remove-Item -Recurse -Force` mente (dice OK ma
la dir resta). Anche `Rename-Item` fallisce con "Accesso negato".

**Workaround che funziona sempre.** Buildare in una dir alternativa con
`--config.directories.output`, poi copiare solo l'EXE finale dentro `dist\`:

```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$tmp = "dist-build-$ts"
npx electron-builder --windows --config.directories.output=$tmp
Copy-Item "$tmp\RPG-Initiative-Tracker-Setup-1.0.0.exe" "dist\" -Force
Copy-Item "$tmp\latest.yml"  "dist\" -Force -ErrorAction SilentlyContinue
Copy-Item "$tmp\RPG-Initiative-Tracker-Setup-1.0.0.exe.blockmap" "dist\" -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
# La rimozione di $tmp\win-unpacked puo' fallire (stesso lock) ma non importa:
# il prossimo build creera' un nuovo $tmp con timestamp diverso.
```

Le cartelle `dist-build-*` orfane che si accumulano sono il fingerprint di
questo workaround applicato in passato — possono essere cancellate quando
il lock si rilascia (di solito dopo un riavvio o un logout).

**TODO follow-up.** Considerare di:
1. Inserire questo workaround direttamente in uno script `BUILDA-EXE.ps1`
   speculare a `BUILDA-APK.ps1`
2. Aggiungere `dist` a Defender exclusion (richiede admin)
3. Verificare se OneDrive sta davvero scansionando `C:\dev` (Settings -> Backup)

---

## 2026-04-23 — `$ErrorActionPreference='Stop'` + native command stderr = build killata

In `BUILDA-APK.ps1` avevo messo `$ErrorActionPreference = "Stop"` in cima
(per fail-fast su errori PS) e chiamato gradlew con `2>&1 | ForEach-Object`.
Risultato: la build veniva killata a metà con `NativeCommandError`, anche
se l'APK si stava compilando perfettamente.

**Causa.** `javac` (e altri tool della build chain Android) stampano note
informative su STDERR — non solo errori. Esempio classico:

```
Note: Some input files use unchecked or unsafe operations.
```

Con `2>&1` lo stderr viene unito allo stdout e finisce nel pipe verso
`ForEach-Object`. Con `$ErrorActionPreference='Stop'`, **qualsiasi riga
proveniente da STDERR di un native command viene promossa a terminating
error** e fa esplodere lo script con `NativeCommandError`.

**Fix.** Per chiamate a tool nativi che possono scrivere su stderr in modo
benigno (gradle, npm, javac, msbuild, ...): scope locale di `'Continue'`
e niente pipe redirect. Si usa `$LASTEXITCODE` per il vero esito.

```powershell
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& .\gradlew.bat assembleDebug          # niente 2>&1, niente pipe
$exit = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($exit -ne 0) { ... fail ... }
```

**Pattern di prevenzione.** In script PowerShell che orchestrano tool
nativi: NON usare `$ErrorActionPreference='Stop'` globalmente, oppure
isolare ogni chiamata nativa fra `Continue` ... `$prev`. Il fail-fast su
codice PS si fa con `try/catch` puntuale, non con la preference globale.

---

## 2026-04-22 — `\\'` dentro single-quoted string in template literal = SyntaxError silenzioso

Bug critico in `public/master.js` riga 325. Avevo scritto:

```js
return `
  <input title="${hasTie ? 'Modifica per cambiare l\\'ordine.' : '...'}" ...>
`;
```

Il parser dentro `${...}` torna in modalità JS standard. La stringa
single-quoted vede:
- `\\` → unescape a `\`
- `'` → **chiude la stringa**

Risultato: la stringa diventa `'Modifica per cambiare l\'`, poi il parser
incontra l'identifier `ordine` e lancia `SyntaxError: Unexpected identifier`.

**Conseguenza.** L'intero file JS non viene parsato → nessuna funzione
globale registrata → tutti gli `onclick="foo()"` dell'HTML diventano
no-op silenziosi. L'utente vede "nessun pulsante funziona" senza errori
visibili (devtools mostrano solo l'errore al primo load).

**Fix.** Mai usare `\'` dentro stringhe single-quoted in `${...}`. Opzioni:
1. Riformulare il testo per evitare l'apostrofo (scelto qui)
2. Usare double-quote: `"l'ordine"`
3. Backtick annidato: `` `l'ordine` ``
4. Escapare con codepoint: `'l\u0027ordine'`

**Pattern di prevenzione.** SEMPRE `node -c <file.js>` su qualunque file JS
modificato prima di committare. Errori di sintassi in JS frontend NON sono
visibili finché qualcuno non apre la pagina nel browser. Aggiungere un
pre-commit hook `npx eslint --no-eslintrc --parser-options=ecmaVersion:2022
public/*.js electron/*.js` o almeno `node -c` su tutti i .js touched.

---

## 2026-04-26 — App installata "non si apre" = porta 3001 zombie da dev

**Sintomo.** L'utente installa `RPG-Initiative-Tracker-Setup-1.0.0.exe`,
l'installer completa OK, ma cliccando sull'eseguibile/scorciatoia la finestra
**non compare mai**. Nessun errore visibile. Task Manager può mostrare
processi `RPG Initiative Tracker` leftover (invisibili) o nessuno.

**Causa.** Un processo `node.exe` zombie (tipicamente `node server.js`
rimasto acceso da una sessione di sviluppo di giorni prima) tiene occupata
la porta 3001.

Il flow rotto era:
1. `main.js` → `startServer()` → `httpServer.listen(3001)` → `EADDRINUSE`
2. L'errore veniva LOGGATO ma non era fatale (nessun throw, nessuna UI).
3. `createWindow()` veniva comunque chiamato con `show: false`.
4. `loadURL('http://localhost:3001/room-selector.html')` tentava di caricare
   ma o falliva (niente server) o colpiva il processo zombie (serve pagine
   sbagliate / stato stantio).
5. `ready-to-show` **non scattava mai** → finestra invisibile per sempre.

Diagnosi rapida:
```powershell
Get-NetTCPConnection -LocalPort 3001 | Format-Table LocalPort,State,OwningProcess
(Get-CimInstance Win32_Process -Filter "ProcessId=$pid").CommandLine
```

**Fix strutturale (commit 2026-04-26).** In `electron/main.js`:
- **Port fallback**: loop 3001→3010, il port effettivo va in `actualPort`
  (usato da `pageUrl()` per il loadURL). Se 3001 è occupata si apre su 3002.
- **Error dialog** (`dialog.showErrorBox` + `app.exit(1)`) se tutte le 10
  porte sono occupate, con istruzioni chiare per l'utente (Task Manager →
  chiudi node.exe).
- **Safety net 8s**: se `ready-to-show` non scatta entro 8s, la finestra
  viene mostrata COMUNQUE (evita finestra invisibile in caso di qualunque
  altro stall del loader).
- **`did-fail-load`** handler: carica una pagina di errore HTML inline
  (`data:text/html,...`) con diagnostica se il loadURL fallisce. L'utente
  vede SEMPRE qualcosa invece di una finestra bianca o invisibile.

**Cleanup zombie (quando serve):**
```powershell
$today = (Get-Date).Date
Get-Process -Name node -EA 0 | Where-Object { $_.StartTime -lt $today } |
  Stop-Process -Force
# Oppure piu' aggressivo:
Get-Process -Name node, "RPG Initiative Tracker" -EA 0 | Stop-Process -Force
```

**Pattern di prevenzione.** In qualunque app Electron/desktop con server
HTTP interno:
1. MAI bindare porta fissa senza fallback — un solo port clash = app morta.
2. MAI `show: false` senza un setTimeout di safety che forzi show().
3. SEMPRE handler `did-fail-load` con pagina di errore visibile.
4. SEMPRE `dialog.showErrorBox` prima di `app.exit()` su errori fatali
   di startup, altrimenti il processo esce silenzioso e l'utente non
   capisce se ha cliccato bene.

---

## 2026-05-19 — HTML5 drag-and-drop NON funziona su touch device

**Problema.** Le API `dragstart` / `dragover` / `drop` di HTML5 non scattano
sul tocco di Android/iOS. Sulla initiative bar questo significa che il
master da telefono NON puo' riordinare i pareggi di iniziativa.

**Workaround.** Pattern long-press 250ms con touch events + cleanup robusto:

```js
let touchState = null;
card.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  touchState = { startX: t.clientX, startY: t.clientY, active: false };
  touchState.longPressTimer = setTimeout(() => {
    if (!touchState) return;
    touchState.active = true;
    // ... popola dragState come dragstart ...
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
  }, 250);
}, { passive: true });
card.addEventListener('touchmove', (e) => {
  if (!touchState) return;
  if (!touchState.active) {
    // se l'utente si muove >8px PRIMA del long-press → annulla, lascia scroll
    const dx = Math.abs(e.touches[0].clientX - touchState.startX);
    const dy = Math.abs(e.touches[0].clientY - touchState.startY);
    if (dx > 8 || dy > 8) { clearTimeout(touchState.longPressTimer); touchState = null; }
    return;
  }
  e.preventDefault();          // NON va da passive: false
  const el = document.elementFromPoint(t.clientX, t.clientY);
  // ... resto del dragover ...
}, { passive: false });
```

**Pattern fondamentali:**
1. Default `touch-action: manipulation` su elementi draggable, override
   `touch-action: none` SOLO mentre `.dragging` e' attivo. Cosi' il tap
   semplice resta normale, ma durante il drag il browser non scrolla.
2. `touchmove` deve essere `{ passive: false }` per poter chiamare
   `preventDefault()` (le API moderne richiedono passive esplicito).
3. SEMPRE gestire `touchcancel` oltre a `touchend` (interruzioni tipo
   chiamata in arrivo, swipe di sistema, etc.) per evitare stato sporco.
4. SEMPRE clearTimeout sul `longPressTimer` in entrambi gli end e quando
   l'utente si muove troppo, altrimenti il timer "scatta dopo" e cambia
   stato in maniera inattesa.
5. `navigator.vibrate(30)` come haptic feedback (Android) per dare
   conferma all'utente che il long-press ha attivato il drag.

---

## 2026-05-20 — Android ANR (Application Not Responding) da fetch con timeout lungo

**Problema.** L'APK Capacitor mostrava il dialogo "RPG Initiative Tracker
isn't responding" dopo l'avvio, anche se i fix UX precedenti rendevano
il login chiaro. Sintomo: l'app sembrava "freezata" per 30-60 secondi
e poi il sistema mostrava il dialogo ANR.

**Causa.** `loadRooms()` aveva `setTimeout(() => controller.abort(), 60000)`
ovvero 60 SECONDI. Quando localStorage conteneva un `serverUrl` residuo
(es. da una build precedente o testing), la fetch a quell'IP non piu'
raggiungibile bloccava la JS engine main thread fino al timeout. Android
considera ANR qualunque blocco del main thread > ~5 secondi, e il
WebView Capacitor non sfugge alla regola: se la fetch tiene il loop
bloccato (anche se "asincrona"), Android la rileva.

**Fix.** Timeout fetch ragionevole. Per LAN domestiche: 8 secondi e'
piu' che sufficiente. Esempio:

```js
const ctrl = new AbortController();
const tmo = setTimeout(() => ctrl.abort(), 8000);
try {
  const res = await fetch(url, { signal: ctrl.signal });
  clearTimeout(tmo);
  // ...
} catch (e) {
  if (e.name === 'AbortError') alert('Timeout: server non risponde entro 8s');
}
```

**Pattern fondamentali:**
1. MAI usare timeout > 15s per fetch in WebView mobile, NEMMENO con la
   scusa "rete lenta": l'ANR scatta a 5s di main thread bloccato, e
   anche fetch presumibilmente "asincrone" possono bloccare se il
   thread JS sta processando heavily.
2. SEMPRE wrappare timeouts in try/catch con messaggio d'errore chiaro
   ("Timeout: server non risponde entro Xs") cosi' l'utente capisce.
3. PRE-FLIGHT FETCH prima dei redirect/azioni costose: se il server
   non risponde, mostra subito un errore invece di redirect a una
   pagina che fara' la stessa fetch fallita.
4. SVUOTARE localStorage default values come `http://localhost:3001`:
   in APK Capacitor `localhost` punta all'APK stesso (vedi lesson
   2026-05-19), quindi un default cosi' fa fallire silenziosamente
   ogni fetch al primo avvio.

---

## 2026-05-20 — Capacitor APK debugging: emulator + adb logcat + screencap

**Workflow.** Per debuggare l'APK Capacitor in locale senza dover ogni
volta installare sul telefono fisico:

1. **AVD pronto via Android Studio**. Una volta installato Android Studio,
   gli AVD esistono nella cartella `~/.android/avd/`. Si listano con:
   ```powershell
   $env:Path = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator;" + $env:Path
   emulator -list-avds
   ```

2. **Lanciare l'emulator come processo detached** (mai inline con la
   shell, perche' l'emulator non termina e il pipe `Out-Null` non
   funziona):
   ```powershell
   Start-Process -FilePath "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" `
                 -ArgumentList "-avd","Pixel_8","-no-snapshot-save","-no-boot-anim"
   ```

3. **Aspettare boot completo**:
   ```powershell
   adb wait-for-device
   adb shell getprop sys.boot_completed   # ritorna "1" quando e' OK
   ```

4. **Install APK** (`-r` = sostituisce installazione esistente
   preservando dati):
   ```powershell
   adb install -r dist/RPG-Initiative-Tracker-debug.apk
   ```

5. **Pulizia dati app** (per testare onboarding pulito):
   ```powershell
   adb shell pm clear com.rpg.initiativetracker
   ```

6. **Lanciare l'app**:
   ```powershell
   adb shell am force-stop com.rpg.initiativetracker
   adb shell am start -n com.rpg.initiativetracker/.MainActivity
   ```

7. **Screenshot** (NON usare `>` redirect in PowerShell, aggiunge BOM
   che corrompe il PNG):
   ```powershell
   adb shell "screencap -p /sdcard/s.png"
   adb pull /sdcard/s.png "C:\path\screenshot.png" 2>$null
   ```

8. **Logcat filtrato** (Capacitor: tutti i log di fetch + JS):
   ```powershell
   adb logcat -d -s chromium:* Capacitor:* "*:S"
   ```

9. **Network host dall'emulator**: `localhost` punta all'APK, quindi per
   raggiungere il server sul PC host **dall'emulator usa `10.0.2.2`**
   come IP. Esempio: server PC su `:3099` -> nell'app emulator inserisci
   `10.0.2.2:3099`.

**Pattern fondamentali:**
- L'emulator si comporta come un device reale: stessi bug, stessi log,
  stesso WebView. Buon proxy per i test, soprattutto per UX/timeout/ANR.
- Per ANR e timing: l'emulator software-only puo' essere piu' lento del
  telefono reale, quindi un timeout che funziona sul telefono potrebbe
  triggerare ANR sull'emulator. Setta i timeout sull'emulator, e
  funzioneranno sicuramente sul telefono.
- Se non puoi cliccare facilmente i bottoni via `adb shell input tap`
  (coordinate scale!), usa Chrome DevTools remote: connetti il device
  via USB con USB debugging attivo, vai a `chrome://inspect#devices`
  su Chrome desktop, ispeziona il WebView dell'app come una pagina
  qualunque (DOM, console, network, sources).

---

## 2026-05-19 — Capacitor APK: `window.location.origin` punta all'APK, non al server LAN

**Problema.** Quando l'app gira come APK Android (Capacitor), gli asset
HTML/CSS/JS vengono caricati dal filesystem dell'APK con scheme `http://`
ma origin `localhost`. Significato concreto:
- `window.location.origin` = `http://localhost` → fetch RELATIVI cadono
  dentro l'APK e fanno 404 (non c'e' nessun server li').
- Le pagine vedono se stesse come "stessa origine" anche se in realta'
  vogliono parlare con il server LAN su `192.168.X.Y:3001`.

Risultato: room-selector / master.html da APK non riescono a fare
`fetch('/api/rooms')` perche' va all'APK.

**Pattern corretto.** Tre livelli di server URL resolution:

```js
const isCapacitorApp = !!(window.Capacitor &&
  typeof window.Capacitor.isNativePlatform === 'function' &&
  window.Capacitor.isNativePlatform());

let serverUrl = '';
const params = new URLSearchParams(window.location.search);
const fromUrl = params.get('server');
if (fromUrl) {
  // 1. Override esplicito via ?server=<URL> (es passato dal flow di onboarding)
  serverUrl = decodeURIComponent(fromUrl);
  try { localStorage.setItem('serverUrl', serverUrl); } catch (_) {}
} else if (isCapacitorApp) {
  // 2. APK: cerca in localStorage da sessione precedente
  serverUrl = localStorage.getItem('serverUrl') || '';
} else {
  // 3. Browser/Electron: l'origin E' il server
  serverUrl = window.location.origin;
}

function apiUrl(path) {
  if (!serverUrl) return path;
  if (serverUrl === window.location.origin) return path; // relativo
  return serverUrl.replace(/\/$/, '') + path;            // assoluto
}
```

**Pattern fondamentali:**
1. SEMPRE rilevare Capacitor con `window.Capacitor.isNativePlatform()`.
   `window.Capacitor` esiste anche in browser desktop senza essere "native"
   se il bundle viene caricato — il check su isNativePlatform e' l'unico
   affidabile.
2. SEMPRE propagare `serverUrl` via query string `?server=<URL>` quando
   si naviga tra pagine in APK. localStorage e' un fallback, non l'unico
   canale: in alcune versioni di Capacitor cambia di scope tra view.
3. MAI assumere che `window.location.origin` sia il server. Costruire un
   helper `apiUrl(path)` ed usarlo OVUNQUE per fetch / socket.io / `<img src>`.
4. Per le navigazioni interne (es bottone "← Torna alle Stanze") preservare
   il `?server=...` nelle URL, altrimenti l'utente perde il context al primo
   redirect.
5. Quando una pagina arriva senza serverUrl noto in APK Capacitor (es deep
   link diretto) NON fare fetch silenziosi che falliscono → mostrare un
   prompt esplicito che porti l'utente a un onboarding (es vista giocatore).

---

## 2026-05-20 — Capacitor-NodeJS embedding: gotchas

**Contesto.** Per evitare il PC host abbiamo embedded un Node.js server
DENTRO l'APK Capacitor col plugin `capacitor-nodejs@1.0.0-beta.9`. Il
runtime ARM64/x64 di Node gira in un processo separato, esposto via
`http://localhost:3001` alla WebView.

### Gotcha 1 — `require('electron')` esplode

Il codice condiviso (`electron/database.js`, `electron/room-manager.js`)
faceva `const { app } = require('electron')` senza guardia. In Node mobile
il modulo non esiste -> il processo crasha all'import.

**Fix.** Wrappare in `try/catch` con flag boolean:

```js
let isPackaged = true;
try {
  const electron = require('electron');
  isPackaged = electron.app ? electron.app.isPackaged : true;
} catch (_) {
  // fuori da Electron (Node mobile, test headless): assume packaged
}
```

### Gotcha 2 — Path relativi falliscono

`require('../../package.json')` dentro l'APK risolve a un path che NON
esiste: gli asset Capacitor sono in `files/nodejs/...` ma `__dirname`
varia in modo non documentato. Soluzione: copiare i file richiesti in
posti deterministici e leggerli runtime:

```js
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-package.json'), 'utf8'));
const appVersion = pkg.version;
```

E in `BUILDA-APK.ps1` STEP 2bis: `Copy-Item package.json public/nodejs/app-package.json`.

### Gotcha 3 — `better-sqlite3` non ha prebuilt Android

Il pacchetto ufficiale compila solo per Node desktop (NODE_MODULE_VERSION
mismatch + ABI Android). Soluzione: fork
[`digidem/better-sqlite3-nodejs-mobile`](https://github.com/digidem/better-sqlite3-nodejs-mobile)
con prebuilt per `android-arm`, `android-arm64`, `android-x64`.

```js
const sqliteBinding = path.join(
  __dirname, 'sqlite-prebuilds',
  `android-${process.arch}`,           // 'android-x64' su emulator, 'android-arm64' su device
  'better_sqlite3.node'
);
const Database = require('better-sqlite3');
const db = new Database(dbPath, { nativeBinding: sqliteBinding });
```

Trick: in CI/build, scaricare i prebuilt via `gh release download` dal
repo digidem ed estrarli in `public/nodejs/sqlite-prebuilds/`.

### Gotcha 4 — `process.arch` su emulator x86_64

L'emulator Android x86_64 (`Pixel_8` AVD) riporta `process.arch === 'x64'`,
NON `'x86_64'` come ci si potrebbe aspettare dal nome AVD. Il binding
giusto e' `android-x64`. Su device fisico moderno: `android-arm64`. Su
device vecchio (~2018): `android-arm`.

### Gotcha 5 — Static webapp serving

L'app Capacitor serve gli HTML/JS dal proprio bundle (scheme
`http://localhost`), MA il server Node embedded vorrebbe servirli a
client esterni (Player browser, altri telefoni). Bisogna duplicare gli
asset web in `public/nodejs/webapp/` e fare `app.use(express.static(...))`
puntando li'. Il build script copia automaticamente, MA con esclusione
ricorsiva di `public/nodejs/` stesso (altrimenti loop infinito).

```powershell
robocopy public public/nodejs/webapp /E /XD public/nodejs
```

### Gotcha 6 — `0.0.0.0` listen su Android

Il server deve bindare su `0.0.0.0`, non `localhost` o `127.0.0.1`,
altrimenti gli altri telefoni in LAN non possono connettersi. Verifica
con `adb shell ss -tlnp | grep 3001` che lo state sia `LISTEN
0.0.0.0:3001`.

### Gotcha 7 — Test E2E via `adb forward`

Per testare Socket.IO da PC senza altro emulator:
```powershell
adb forward tcp:13001 tcp:3001
node test-socket.js  # punta a 127.0.0.1:13001
```

Funziona col transport `polling`. Il transport `websocket` puo' avere
problemi via il tunnel `adb forward` (HTTP upgrade non supportato pulito)
ma funziona da WebView interna o da LAN reale. Test pragmatico:
`transports: ['polling']` per test E2E, default `['websocket', 'polling']`
in produzione.

### Gotcha 8 — Capacitor 7 obbligatorio

Il plugin `capacitor-nodejs@1.0.0-beta.9` richiede Capacitor 7+. Bisogna
upgradare TUTTI i pacchetti `@capacitor/*` insieme (core, cli, android,
plugins) con la stessa major version. Mismatch -> Gradle compile errors
in `CapacitorWebView.java` (simboli Android API 35).

```bash
npm install @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7 \
  @capacitor/screen-orientation@7
```

E in `android/variables.gradle`: `compileSdkVersion = 35`,
`targetSdkVersion = 35`, `minSdkVersion = 23`.

### Pattern di prevenzione

1. SEMPRE wrappare `require('electron')` in try/catch nei moduli
   condivisi tra Electron e Node mobile.
2. SEMPRE leggere file relativi via `path.join(__dirname, ...)` e mai
   con `require('../../...')`. Per dati di build (es package.json)
   copiarli in posti deterministici.
3. SEMPRE testare con `adb forward` PRIMA di provare LAN reale: isola
   problemi di binding/codice da problemi di rete WiFi.
4. SEMPRE avere un fallback se `process.arch` non corrisponde a un
   prebuilt: log di errore chiaro, NO crash silenzioso.
