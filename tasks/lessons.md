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
