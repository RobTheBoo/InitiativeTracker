# Apri porta 3001 nel firewall (telefono -> PC). Esegui come Amministratore.
$n = "RPG Initiative Tracker 3001"
if (Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue) { Write-Host "Gia presente."; exit 0 }
New-NetFirewallRule -DisplayName $n -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow
Write-Host "Porta 3001 aperta."
