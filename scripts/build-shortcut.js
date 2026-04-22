const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Creazione eseguibile "Crea Collegamento"...\n');

// Verifica che pkg sia installato
try {
  require.resolve('pkg');
} catch (e) {
  console.log('📦 Installazione pkg...');
  execSync('npm install --save-dev pkg', { stdio: 'inherit' });
}

// Crea l'eseguibile nella root del progetto
const outputPath = path.join(__dirname, '..', 'Crea-Collegamento.exe');
try {
  execSync(`npx pkg scripts/create-shortcut.js --targets node18-win-x64 --output "${outputPath}"`, {
    stdio: 'inherit'
  });
  
  if (fs.existsSync(outputPath)) {
    console.log('\n✅ Eseguibile creato con successo!');
    console.log(`   Percorso: ${outputPath}`);
    console.log('\n📋 Istruzioni:');
    console.log('   1. L\'eseguibile "Crea-Collegamento.exe" si trova nella root del progetto');
    console.log('   2. Esegui "Crea-Collegamento.exe" per creare il collegamento sul desktop');
    console.log('   3. L\'eseguibile cercherà automaticamente "RPG Initiative Tracker.exe" in dist/win-unpacked/');
  } else {
    console.error('\n❌ Errore: Eseguibile non trovato dopo la compilazione');
    process.exit(1);
  }
} catch (error) {
  console.error('\n❌ Errore durante la compilazione:');
  console.error(error.message);
  process.exit(1);
}

