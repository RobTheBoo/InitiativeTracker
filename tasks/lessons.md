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
