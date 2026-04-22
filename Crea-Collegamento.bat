@echo off
REM Script batch per creare collegamento sul desktop
REM Questo script può essere eseguito direttamente senza Node.js

echo.
echo 🔨 Creazione collegamento sul desktop...
echo.

REM Ottieni il percorso dello script
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%"

REM Percorso dell'eseguibile principale
set "EXE_PATH=%PROJECT_ROOT%dist\win-unpacked\RPG Initiative Tracker.exe"

REM Verifica che l'eseguibile esista
if not exist "%EXE_PATH%" (
    echo ❌ Errore: Eseguibile non trovato!
    echo    Percorso cercato: %EXE_PATH%
    echo.
    echo    Assicurati di aver compilato il progetto con: npm run build:win
    echo.
    pause
    exit /b 1
)

REM Esegui lo script PowerShell
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\create-shortcut.ps1"

