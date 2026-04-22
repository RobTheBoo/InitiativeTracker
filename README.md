# RPG Initiative Tracker

Tracker di iniziativa per Pathfinder 1E - Gestione combattimenti D&D-style

## Descrizione

Applicazione desktop (Electron) per gestire combattimenti di ruolo con sistema di iniziativa, effetti, condizioni e molto altro.

## Funzionalità

- ✅ Gestione iniziativa e turni di combattimento
- ✅ Supporto per Eroi, Nemici e Alleati NPC
- ✅ Effetti e condizioni sui personaggi
- ✅ Effetti ad area
- ✅ Libreria Pathfinder 1E (condizioni, bonus, incantesimi)
- ✅ Interfaccia Master separata
- ✅ Vista Tablet per display pubblici
- ✅ Supporto multi-giocatore tramite rete locale

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
├── electron/          # Codice Electron (main process)
├── public/            # Frontend (HTML, CSS, JS)
├── data/              # Libreria Pathfinder 1E (JSON)
└── server.js          # Server standalone (per sviluppo)
```

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

