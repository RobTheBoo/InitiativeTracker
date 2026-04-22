# Dove sta l’app e come costruire l’APK

## Regola

- **Tutto resta su OneDrive:**  
  `c:\Users\ercole\OneDrive\rpg-initiative-tracker`  
  Codice, `public/`, `android/`, server, Electron: tutto qui. **Non serve copiare nulla fuori da OneDrive** per la build.

---

## Passi per costruire l’APK (da OneDrive)

### 1. Terminale nella cartella del progetto (OneDrive)

Apri il terminale in:

`c:\Users\ercole\OneDrive\rpg-initiative-tracker`

Poi:

```bash
npm install
npx cap sync android
```

### 2. Apri il progetto Android in Android Studio

- **File → Open**
- Scegli la cartella **`android`** dentro il progetto:
  `c:\Users\ercole\OneDrive\rpg-initiative-tracker\android`
- **Non** aprire la root `rpg-initiative-tracker` e **non** `android\app`.

### 3. Build e avvio

- **Build → Rebuild Project**
- **Run** (emulatore o dispositivo fisico).

L’APK è generato da OneDrive, senza copiare il progetto fuori.

---

## Se la build da OneDrive fallisce

Se da OneDrive compaiono errori di Gradle / path lunghi / sync (es. “IllegalStateException”, build che non parte, file bloccati):

1. **Prova prima:**  
   **File → Invalidate Caches → Invalidate and Restart** in Android Studio, poi riapri `...\rpg-initiative-tracker\android` e rifai **Build → Rebuild**.

2. **Solo se proprio non va:**  
   usa una cartella **fuori** da OneDrive (es. `C:\Users\ercole\RPG_V2`), copia lì da OneDrive almeno `package.json`, `capacitor.config.json`, `server.js`, le cartelle `public/` e `android/`, esegui `npm install` e `npx cap sync android` in quella cartella e apri **quella** `android` in Android Studio. Consideralo un ripiego, non il flusso normale.

---

## Riassunto

| Cosa              | Dove |
|-------------------|------|
| Codice e build APK | **OneDrive** `rpg-initiative-tracker` – niente copia fuori in condizioni normali. |
| Aprire in Android Studio | La cartella **`android`** dentro il progetto su OneDrive. |

Dopo modifiche in `public/`: dalla root del progetto su OneDrive esegui `npx cap sync android`, poi in Android Studio **Sync Project with Gradle** e di nuovo **Run**.
