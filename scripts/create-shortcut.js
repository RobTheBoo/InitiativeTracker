const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Ottieni il percorso dell'eseguibile corrente (quando compilato con pkg)
// Se siamo in esecuzione come script Node.js normale, usa __dirname
// Se siamo compilati con pkg, usa process.execPath
let projectRoot;
if (process.pkg) {
  // Siamo compilati con pkg - il percorso dell'eseguibile è process.execPath
  // L'eseguibile è nella root del progetto
  projectRoot = path.dirname(process.execPath);
} else {
  // Siamo in esecuzione come script Node.js normale
  // Torna alla root del progetto (scripts/ -> ..)
  projectRoot = path.resolve(__dirname, '..');
}

// L'eseguibile principale si trova sempre in dist/win-unpacked/ relativo alla root
const exePath = path.join(projectRoot, 'dist', 'win-unpacked', 'RPG Initiative Tracker.exe');

// Verifica che l'eseguibile esista
if (!fs.existsSync(exePath)) {
  console.error('❌ Errore: Eseguibile non trovato!');
  console.error(`   Percorso cercato: ${exePath}`);
  console.error('\n   Assicurati di aver compilato il progetto con: npm run build:win');
  process.exit(1);
}

// Percorso del desktop
const desktopPath = path.join(require('os').homedir(), 'Desktop');
const shortcutPath = path.join(desktopPath, 'RPG Initiative Tracker.lnk');

// Crea il collegamento usando PowerShell
const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
$Shortcut.TargetPath = "${exePath.replace(/\\/g, '\\\\')}"
$Shortcut.WorkingDirectory = "${path.dirname(exePath).replace(/\\/g, '\\\\')}"
$Shortcut.Description = "RPG Initiative Tracker - Pathfinder 1E Combat Manager"
$Shortcut.Save()
Write-Host "✅ Collegamento creato con successo!"
Write-Host "   Destinazione: ${shortcutPath}"
`;

try {
  // Esegui PowerShell
  execSync(`powershell -ExecutionPolicy Bypass -Command "${psScript}"`, {
    stdio: 'inherit',
    encoding: 'utf8'
  });
  
  console.log('\n✅ Collegamento creato con successo sul desktop!');
  console.log(`   Nome: RPG Initiative Tracker.lnk`);
  console.log(`   Destinazione: ${exePath}`);
} catch (error) {
  console.error('❌ Errore durante la creazione del collegamento:');
  console.error(error.message);
  process.exit(1);
}

