@echo off
chcp 65001 >nul
:: Richiedi diritti amministratore (se non li hai, rilancia come admin)
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Avvio come Amministratore...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo ========================================
echo   Apertura Firewall per porta 3001
echo   (necessario per telefono/tablet)
echo ========================================
echo.

netsh advfirewall firewall delete rule name="RPG Initiative Tracker 3001" >nul 2>&1
netsh advfirewall firewall add rule name="RPG Initiative Tracker 3001" dir=in action=allow protocol=TCP localport=3001 profile=any

if %errorlevel% equ 0 (
  echo OK. Firewall: porta 3001 aperta.
  echo.
  echo Sul telefono: stessa Wi-Fi, poi inserisci IP_PC:3001
  echo Esempio: 192.168.1.5:3001
  echo.
  echo Se ancora "Rete non raggiungibile" vedi CONNESSIONE-TELEFONO.txt
) else (
  echo ERRORE. Tasto DESTRO su questo file - "Esegui come amministratore"
)
echo.
pause
