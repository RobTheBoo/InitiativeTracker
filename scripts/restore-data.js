const fs = require('fs');
const path = require('path');

// Script per copiare i dati dalla cartella app-data alla nuova build
const appDataPath = path.join(__dirname, '../app-data');
const buildDataPath = path.join(__dirname, '../dist/app-data');
const winUnpackedPath = path.join(__dirname, '../dist/win-unpacked');

console.log('📦 Ripristino dati nella nuova build...');

// Se esiste app-data, copialo in dist/app-data
if (fs.existsSync(appDataPath)) {
  console.log('📁 Trovata cartella app-data:', appDataPath);
  
  // Crea dist/app-data se non esiste
  if (!fs.existsSync(buildDataPath)) {
    fs.mkdirSync(buildDataPath, { recursive: true });
    console.log('✅ Creata cartella dist/app-data');
  }
  
  // Copia tutti i file e cartelle
  function copyRecursive(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    
    if (isDirectory) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      fs.readdirSync(src).forEach(childItemName => {
        copyRecursive(
          path.join(src, childItemName),
          path.join(dest, childItemName)
        );
      });
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  
  try {
    copyRecursive(appDataPath, buildDataPath);
    console.log('✅ Dati copiati da app-data a dist/app-data');
  } catch (error) {
    console.error('❌ Errore durante la copia dei dati:', error);
  }
} else {
  console.log('ℹ️ Nessuna cartella app-data trovata (prima build?)');
}

// Se esiste dist/app-data, copialo anche in win-unpacked (per compatibilità)
if (fs.existsSync(buildDataPath) && fs.existsSync(winUnpackedPath)) {
  console.log('📁 Copia dati in win-unpacked per compatibilità...');
  try {
    copyRecursive(buildDataPath, path.join(winUnpackedPath, 'app-data'));
    console.log('✅ Dati copiati anche in win-unpacked/app-data');
  } catch (error) {
    console.error('❌ Errore durante la copia in win-unpacked:', error);
  }
}

console.log('✅ Ripristino dati completato!');

