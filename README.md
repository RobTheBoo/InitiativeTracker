# RPG Initiative Tracker

Tracker di iniziativa per Pathfinder 1E - Gestione combattimenti D&D-style

## Descrizione

Applicazione desktop (Electron) per gestire combattimenti di ruolo con sistema di iniziativa, effetti, condizioni e molto altro.

## Funzionalità

### Gioco
- ✅ Gestione iniziativa e turni di combattimento (Pathfinder 1E)
- ✅ Eroi (giocatori), Nemici (master), Alleati NPC (master), Evocazioni (giocatori)
- ✅ Effetti su personaggio + Effetti ad area, con decremento automatico per round
- ✅ Risoluzione iniziative uguali via popup Master
- ✅ "Ritarda turno" (delay) e ripristino con scelta posizione
- ✅ Libreria Pathfinder 1E (condizioni, tipi di bonus, incantesimi) consultabile

### Architettura
- ✅ **3 viste**: Master (PC), Giocatore (telefono in browser/PWA o APK), Tablet (display per il tavolo)
- ✅ **Una sola codebase server** condivisa tra Electron e modalità headless
- ✅ **clientId persistente**: il giocatore non perde il personaggio se ricarica la pagina o chiude la app
- ✅ **mDNS / Bonjour**: il telefono trova il Master come `rpg-tracker.local`, niente IP da digitare
- ✅ **QR code**: dal Master, inquadra col telefono per connetterti in un tap
- ✅ **OneDrive Personal**: carica le immagini di stanze/nemici/alleati in cloud, ritrovi tutto se cambi PC

### Mobile / PWA
- ✅ APK Android (Capacitor) con auto-discovery del server
- ✅ PWA installabile su iPhone (Safari) — niente App Store, niente account Apple
- ✅ Auto-reconnection robusta con backoff esponenziale

## Installazione

1. Installa le dipendenze:
```bash
npm install
```

2. Avvia l'app in modalità sviluppo:
```bash
npm run dev
```

3. Build dell'eseguibile (deploy):
```bash
npm run build:win
```

**Path dell'eseguibile dopo il build** (progetto in OneDrive):
```
c:\Users\ercole\OneDrive\rpg-initiative-tracker\dist\win-unpacked\RPG Initiative Tracker.exe
```
Cartella di deploy: `c:\Users\ercole\OneDrive\rpg-initiative-tracker\dist\win-unpacked\`

## Utilizzo

### Installazione per Utenti Finali

1. **Scarica o ricevi la cartella del programma** contenente:
   - `RPG Initiative Tracker.exe` in `dist\win-unpacked\`
   - Path completo (es. da OneDrive): `c:\Users\ercole\OneDrive\rpg-initiative-tracker\dist\win-unpacked\RPG Initiative Tracker.exe`
   - Tutti i file necessari nella stessa cartella di `win-unpacked`

2. **Crea un collegamento sul desktop**:
   - **Opzione 1 (Consigliata)**: Doppio clic su `Crea-Collegamento.bat` (si trova nella root del progetto)
   - **Opzione 2**: Doppio clic su `Crea-Collegamento.vbs` (alternativa senza finestra di comando)
   - **Opzione 3**: Esegui `npm run create-shortcut` (se hai Node.js installato)
   - Verrà creato un collegamento "RPG Initiative Tracker.lnk" sul desktop

3. **Avvia l'applicazione**:
   - Doppio clic sul collegamento sul desktop
   - Oppure doppio clic su `RPG Initiative Tracker.exe` in `c:\Users\ercole\OneDrive\rpg-initiative-tracker\dist\win-unpacked\`

### Modalità Sviluppo

Avvia l'app con:
```bash
npm run dev
```

L'applicazione si aprirà automaticamente e il server sarà disponibile su `http://localhost:3000`

### Produzione

Dopo il build, l'eseguibile e i file di deploy sono in:
`c:\Users\ercole\OneDrive\rpg-initiative-tracker\dist\win-unpacked\`

**Nota**: 
- I file `Crea-Collegamento.bat` e `Crea-Collegamento.vbs` sono già presenti nella root del progetto e funzionano immediatamente
- Se preferisci un file `.exe` invece di `.bat` o `.vbs`, puoi eseguire `npm run build-shortcut` (richiede tempo per scaricare i binari la prima volta)

### Interfacce Disponibili

- **Master**: `/master.html` - Interfaccia completa per il Master
- **Tablet**: `/tablet.html` - Display pubblico per il tavolo
- **Giocatori**: `/` o `/index.html` - Interfaccia per i giocatori

## Struttura del Progetto

```
rpg-initiative-tracker/
├── src/
│   ├── server/         # Factory server unificata (HTTP, Socket.IO, config, paths, mDNS)
│   └── cloud/          # Integrazione OneDrive (Microsoft Graph)
├── electron/           # Solo BrowserWindow + IPC + lifecycle (~140 righe)
├── public/             # Frontend (HTML, CSS, JS vanilla)
│   ├── index.html      # Vista giocatore (PWA installabile)
│   ├── master.html     # Vista master (Electron)
│   ├── tablet.html     # Vista display tavolo
│   ├── config.html     # Configurazione (eroi/nemici/alleati/evocazioni/cloud)
│   └── ui-enhancements.* # Toast connessione, snackbar, animazioni turno
├── data/               # Libreria Pathfinder 1E (JSON)
├── app-data/           # Dati persistenti (DB, config, immagini, token cloud) - gitignored
└── server.js           # Thin wrapper per server headless (deploy/CLI)
```

## OneDrive (opzionale)

Nella tab `☁️ Cloud` della Configurazione puoi:
1. **Setup una-tantum**: registra una "App registration" gratuita su Azure (5 click) e incolla qui il client ID
2. **Connetti**: ti viene mostrato un codice da inserire su `microsoft.com/devicelogin` (anche dal telefono va bene)
3. **Push**: carica tutte le immagini locali su OneDrive (cartella `Apps/RPG Initiative Tracker/`)
4. **Sync**: scarica da OneDrive le immagini mancanti localmente (utile su un nuovo PC)
5. Da quel momento, **ogni nuovo upload** di immagine va automaticamente anche su OneDrive (best-effort, non blocca il salvataggio locale)

> **Importante**: il database SQLite e `config.json` restano locali, mai su OneDrive (il sync di SQLite WAL può corromperlo). Solo le immagini vanno in cloud.

## Discovery sulla rete locale

- Sul Master appare il QR code: il giocatore lo inquadra col telefono e si connette istantaneamente.
- Su iPhone/iPad e Mac, e su molti Android, funziona anche `http://rpg-tracker.local:3001/` direttamente nel browser, senza conoscere l'IP.
- La vista Giocatore ha il pulsante **🔍 Trova automaticamente** che prova `rpg-tracker.local`, gli IP `.1` e `.254` della tua subnet.

## Dati e Immagini

I dati vengono salvati in base all'ambiente:

### Produzione (EXE portable)
Quando usi l'EXE compilato, **tutto viene salvato nella stessa cartella dell'eseguibile**:
- **Immagini**: `images/heroes/`, `images/enemies/`, `images/allies/`
- **Database**: `rpg-tracker.db`
- **Configurazione**: `config.json`

Questo permette di passare l'intera cartella ad un altro Master mantenendo tutte le configurazioni.

### Sviluppo (`npm run dev`)
- **Immagini**: `public/images/`
- **Database**: `%APPDATA%/RPG Initiative Tracker/rpg-tracker.db`
- **Configurazione**: `data/config.json`

## Tecnologie

- Electron
- Express.js
- Socket.IO
- Better-SQLite3
- Pathfinder 1E Library

## Licenza

MIT

