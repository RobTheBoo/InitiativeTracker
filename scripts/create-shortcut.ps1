# Script PowerShell per creare collegamento sul desktop
# Questo script può essere eseguito direttamente senza Node.js

$scriptPath = $PSScriptRoot
if (-not $scriptPath) {
    $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# Se lo script è nella cartella scripts/, torna alla root
if ($scriptPath -like "*\scripts") {
    $projectRoot = Split-Path -Parent $scriptPath
} else {
    $projectRoot = $scriptPath
}

# Percorso dell'eseguibile principale
$exePath = Join-Path $projectRoot "dist\win-unpacked\RPG Initiative Tracker.exe"

# Verifica che l'eseguibile esista
if (-not (Test-Path $exePath)) {
    Write-Host "❌ Errore: Eseguibile non trovato!" -ForegroundColor Red
    Write-Host "   Percorso cercato: $exePath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   Assicurati di aver compilato il progetto con: npm run build:win" -ForegroundColor Yellow
    Read-Host "Premi INVIO per uscire"
    exit 1
}

# Percorso del desktop
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "RPG Initiative Tracker.lnk"

# Crea il collegamento
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = $exePath
$Shortcut.WorkingDirectory = Split-Path -Parent $exePath
$Shortcut.Description = "RPG Initiative Tracker - Pathfinder 1E Combat Manager"
$Shortcut.Save()

Write-Host ""
Write-Host "✅ Collegamento creato con successo sul desktop!" -ForegroundColor Green
Write-Host "   Nome: RPG Initiative Tracker.lnk" -ForegroundColor Cyan
Write-Host "   Destinazione: $exePath" -ForegroundColor Cyan
Write-Host ""
Read-Host "Premi INVIO per uscire"

