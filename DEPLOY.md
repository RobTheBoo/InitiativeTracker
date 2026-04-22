# Deploy – RPG Initiative Tracker

## Dove viene servita l’app (path)

Dopo il deploy, l’app è sulla **root** del dominio. Niente sottocartella tipo `/app` o `/rpg`.

| Path | Cosa apre |
|------|-----------|
| **`/`** | Interfaccia giocatori (scelta stanza e personaggio) |
| **`/master.html`** | Vista Master |
| **`/tablet.html`** | Display tavolo |
| **`/room-selector.html`** | Selettore stanza (se usato) |

Esempio se il deploy è su `https://rpg-initiative.onrender.com`:

- Giocatori: `https://rpg-initiative.onrender.com/`
- Master: `https://rpg-initiative.onrender.com/master.html`
- Tablet: `https://rpg-initiative.onrender.com/tablet.html`

---

## Come fare il deploy (tu, non l’assistente)

L’assistente **non** può eseguire il deploy (servono i tuoi account). Puoi farlo così:

### Opzione 1: Render.com (consigliata, free tier)

1. Vai su [render.com](https://render.com), registrati/login.
2. **Dashboard** → **New** → **Web Service**.
3. Collega il repo (GitHub/GitLab) di questo progetto.
4. Render rileva Node e usa:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
5. Clicca **Create Web Service**. Al primo deploy avrai un URL tipo `https://rpg-initiative-tracker-xxx.onrender.com`.
6. I path sono quelli della tabella sopra (root = `/`, master = `/master.html`, tablet = `/tablet.html`).

Se nel repo c’è `render.yaml`, puoi usare **New → Blueprint** e collegare lo stesso repo: Render userà quella config.

### Opzione 2: Railway.app

1. [railway.app](https://railway.app) → **Start a New Project** → **Deploy from GitHub**.
2. Seleziona il repo di questo progetto.
3. Railway rileva `package.json` e usa `npm start`. Non serve Dockerfile.
4. In **Settings** → **Networking** → **Generate Domain** per ottenere l’URL.
5. Stessi path: `/`, `/master.html`, `/tablet.html` sulla root del dominio generato.

### Opzione 3: VPS / tuo server

Sul server:

```bash
git clone <url-del-tuo-repo>
cd rpg-initiative-tracker
npm install
PORT=3000 npm start
```

Oppure con `pm2`:

```bash
PORT=3000 pm2 start server.js --name rpg-tracker
```

L’app sarà su `http://TUO_IP:3000/` (e quindi `/master.html`, `/tablet.html` come sopra).

---

## Riassunto path

- **Path di deploy:** root del sito (`/`), non in una sottocartella.
- **Pagine:** `/`, `/master.html`, `/tablet.html` (e eventualmente `/room-selector.html`).

Se mi dici su quale servizio fai deploy (Render, Railway, altro), posso adattare i passi o il file di config a quello.
