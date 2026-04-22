# Come creare l’APK (Android)

L’APK è un’app che apre la vista Giocatore in fullscreen. **A ogni avvio chiede l’indirizzo del server** (es. `http://192.168.1.10:3001`), così puoi essere in un posto diverso ogni volta. Il backend deve essere in esecuzione su un PC in LAN o online (deploy).

---

## 1. Cosa ti serve

- **Node.js** (già usato per il progetto)
- **Android Studio** (per compilare l’APK e avere Android SDK)
  - Scarica: [developer.android.com/studio](https://developer.android.com/studio)
- **Account / deploy** del Tracker su un URL pubblico (es. Render) **oppure** il server avviato sul PC con IP raggiungibile dal telefono (es. `http://192.168.1.10:3000`)

---

## 2. Configurazione (nessun URL fisso)

Non impostare `server.url` in **`capacitor.config.json`**. L’app viene caricata dai file locali; a ogni avvio chiede l’indirizzo del server (es. `192.168.1.27:3001`). La config deve contenere solo `appId`, `appName`, `webDir`.

---

## 3. Primo setup (una sola volta)

Nella cartella del progetto (dove c’è `package.json`):

```bash
npm install
npx cap add android
```

Se ti chiede di installare `@capacitor/cli` o pacchetti Android, conferma.

---

## 4. Sincronizzare e aprire il progetto Android

Ogni volta che cambi `capacitor.config.json` (in particolare l’URL) o i file in `public/`:

```bash
npm run cap:sync
npm run cap:open:android
```

Si aprirà **Android Studio** con il progetto `android/`.

---

## 5. Orientamento sempre orizzontale (landscape)

L’app deve restare sempre in orizzontale. Dopo aver aperto il progetto in Android Studio (**npm run cap:open:android**):

1. Nel pannello **Project** (a sinistra) apri: **android** → **app** → **src** → **main**.
2. Apri il file **AndroidManifest.xml**.
3. Trova la riga con `<activity` che contiene `android:name=".MainActivity"` (è la prima `<activity>` del file).
4. All’interno di quella tag `<activity>`, aggiungi: **`android:screenOrientation="landscape"`** (puoi metterla dopo `android:configChanges` o in un altro punto della stessa tag).
5. Salva. Da quel momento l’APK resterà sempre in orizzontale.

Esempio: la tag può diventare  
`<activity ... android:screenOrientation="landscape" ...>`  
(con gli altri attributi che già ci sono).

---

## 6. Generare l’APK in Android Studio

1. In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
2. Attendi la fine della build.
3. Clicca su **“Locate”** nella notifica in basso: l’APK si trova in  
   `android/app/build/outputs/apk/debug/app-debug.apk`.

Puoi copiare `app-debug.apk` sul telefono e installarlo (installa da “File sconosciuti” se richiesto).

---

## 7. Comandi utili

| Comando | Cosa fa |
|--------|---------|
| `npm run cap:sync` | Copia la config e i file web nel progetto Android |
| `npm run cap:open:android` | Apre il progetto in Android Studio |

Dopo aver cambiato l’URL in `capacitor.config.json`, esegui di nuovo `npm run cap:sync` e poi ricompila l’APK da Android Studio.

---

## 8. Menù a tendina (effetti / evocazioni) nell’APK

L’app usa **dropdown e picker custom** (pulsante ▼ per gli effetti, pulsante “Seleziona evocazione…”) che funzionano anche nel WebView Android. Se nell’APK i menù non si aprono o non rispondono al tocco:

1. **Risincronizza il progetto** dopo aver aggiornato il codice: `npm run cap:sync` e ricompila l’APK.
2. **WebView Android**: in Android Studio, nel modulo `app`, puoi verificare che il WebView non abbia opzioni che bloccano il tocco. In genere con Capacitor non serve toccare nulla; in casi rari si può provare in `MainActivity` (o nella classe che carica il WebView) a non disabilitare JavaScript o i dom storage.

Se dopo un `cap sync` e una nuova build i menù funzionano nel browser ma non nell’APK, segnalalo: si può valutare un’opzione aggiuntiva lato Android (es. flag sul WebView).

---

## Riassunto

1. Imposta l’URL corretto in **`capacitor.config.json`** (deploy o IP LAN).
2. `npm install` → `npx cap add android` (solo la prima volta).
3. `npm run cap:sync` → `npm run cap:open:android`.
4. In **AndroidManifest.xml** aggiungi `android:screenOrientation="landscape"` all’activity principale (sempre orizzontale).
5. In Android Studio: **Build → Build APK(s)** e prendi l’APK da `android/app/build/outputs/apk/debug/`.

L’APK non include il server: apre semplicemente il Tracker all’URL che hai configurato, in fullscreen.
