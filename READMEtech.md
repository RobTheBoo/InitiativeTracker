# RPG Initiative Tracker - Documentazione Tecnica

## Architettura

### Frontend
- **HTML/CSS/JS vanilla** - Nessun framework
- **Socket.IO Client** - Comunicazione real-time
- **Interfacce separate**:
  - `index.html` - Vista giocatori
  - `master.html` - Vista Master
  - `tablet.html` - Vista Tablet
  - `config.html` - Configurazione personaggi

### Backend
- **Electron Main Process** (`electron/main.js`)
  - Server Express integrato
  - Gestione database SQLite
  - Socket.IO server
  - Upload immagini

- **Server Standalone** (`server.js`)
  - Per sviluppo/test senza Electron

### Database
- **Better-SQLite3** - Database SQLite per stanze e dati persistenti
- Schema: vedi `electron/database.js`

## Flusso Dati

### Comunicazione Real-time
```
Client (Browser) <--Socket.IO--> Electron Main Process
                              |
                              v
                          SQLite DB
```

### Upload Immagini
```
Frontend (FormData) --> POST /api/config/[heroes|enemies|allies]/upload
                     |
                     v
                Multer Storage
                     |
                     v
         userData/images/[type]/[id].[ext]
```

## Percorsi File

### Sviluppo
- Immagini: `public/images/[heroes|enemies|allies]/`
- Database: `electron/database.db` (creato automaticamente)
- Config: `data/config.json`

### Produzione (Packaged)
- Immagini: `%APPDATA%/RPG Initiative Tracker/images/`
- Database: `%APPDATA%/RPG Initiative Tracker/database.db`
- Config: Incluso nell'app bundle

## API Endpoints

### Configurazione
- `GET /api/config/heroes` - Lista eroi
- `GET /api/config/enemies` - Lista nemici
- `GET /api/config/allies` - Lista alleati
- `POST /api/config/heroes/upload` - Upload immagine eroe
- `POST /api/config/enemies/upload` - Upload immagine nemico
- `POST /api/config/allies/upload` - Upload immagine alleato

### Libreria Pathfinder
- `GET /api/library` - Libreria completa
- `GET /api/library/conditions` - Condizioni
- `GET /api/library/spells` - Incantesimi
- `GET /api/library/bonus-types` - Tipi di bonus

### Stanze
- `GET /api/rooms` - Lista stanze
- `POST /api/rooms` - Crea stanza
- `GET /api/rooms/:id` - Dettagli stanza

### Socket.IO Events

#### Client → Server
- `becomeMaster` - Diventa Master
- `claimHero` - Scegli personaggio
- `setHeroInitiative` - Imposta iniziativa
- `addEnemy` - Aggiungi nemico (Master)
- `addAlly` - Aggiungi alleato (Master)
- `addEffect` - Aggiungi effetto
- `addAreaEffect` - Aggiungi effetto ad area
- `startCombat` - Inizia combattimento
- `nextTurn` - Prossimo turno
- `prevTurn` - Turno precedente
- `stopCombat` - Termina combattimento

#### Server → Client
- `gameState` - Stato completo del gioco
- `combatStarted` - Combattimento iniziato
- `newRound` - Nuovo round

## Build

### Electron Builder
Configurazione in `package.json` -> `build`:
- Windows: Portable EXE
- macOS: DMG
- Linux: AppImage

### Comandi
```bash
npm run build          # Build per piattaforma corrente
npm run build:win      # Build Windows
npm run build:mac      # Build macOS
npm run build:linux    # Build Linux
npm run build-shortcut # Crea eseguibile "Crea-Collegamento.exe"
npm run create-shortcut # Crea collegamento sul desktop (richiede Node.js)
```

### Eseguibile "Crea-Collegamento"

L'eseguibile `Crea-Collegamento.exe` permette agli utenti finali di creare facilmente un collegamento sul desktop senza dover installare Node.js.

**Come funziona**:
1. L'eseguibile cerca `RPG Initiative Tracker.exe` nella stessa directory o in `dist/win-unpacked/`
2. Crea un collegamento `.lnk` sul desktop dell'utente
3. Il collegamento punta all'eseguibile principale

**Distribuzione**:
- L'eseguibile `Crea-Collegamento.exe` viene creato nella root del progetto
- Cerca automaticamente `RPG Initiative Tracker.exe` in `dist/win-unpacked/`
- L'utente può eseguirlo per creare il collegamento sul desktop

## Sviluppo

### Prerequisiti
- Node.js 18+
- npm

### Setup
```bash
npm install
npm run dev
```

### Debug
- Electron DevTools: `Ctrl+Shift+I` (Windows/Linux) o `Cmd+Option+I` (macOS)
- Console server: Output nella console dove si esegue `npm run dev`

## Note Tecniche

### Persistenza Dati
- Le stanze e i dati dei personaggi sono salvati nel database SQLite
- Le immagini sono salvate nel filesystem
- **In produzione (EXE)**: Tutto è salvato nella stessa cartella dell'eseguibile (portable)
  - Database: `rpg-tracker.db` accanto all'EXE
  - Immagini: `images/` accanto all'EXE
  - Config: `config.json` accanto all'EXE
- **In sviluppo**: Database in `userData`, immagini in `public/images/`, config in `data/`

### Networking
- Server Express su porta 3000
- Socket.IO su stesso server
- Binding su `0.0.0.0` per accesso da rete locale
- CORS abilitato per sviluppo

### Sicurezza
- Nessuna autenticazione (uso locale/privato)
- File upload limitato a immagini
- Validazione input lato server

