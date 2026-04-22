# Script per aprire la porta 3001 nel firewall Windows
# Esegui questo script come amministratore

Write-Host "🔥 Apertura porta 3001 nel firewall Windows..." -ForegroundColor Yellow

# Verifica se la regola esiste già
$existingRule = Get-NetFirewallRule -DisplayName "RPG Initiative Tracker - Port 3001" -ErrorAction SilentlyContinue

if ($existingRule) {
    Write-Host "✅ Regola firewall già esistente. Rimozione..." -ForegroundColor Yellow
    Remove-NetFirewallRule -DisplayName "RPG Initiative Tracker - Port 3001" -ErrorAction SilentlyContinue
}

# Aggiungi regola in entrata
New-NetFirewallRule -DisplayName "RPG Initiative Tracker - Port 3001" `
    -Direction Inbound `
    -LocalPort 3001 `
    -Protocol TCP `
    -Action Allow `
    -Description "Permette connessioni in entrata sulla porta 3001 per RPG Initiative Tracker" | Out-Null

Write-Host "✅ Porta 3001 aperta nel firewall!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 La porta è ora accessibile da altri dispositivi sulla stessa rete." -ForegroundColor Cyan
Write-Host "   I giocatori possono connettersi usando l'IP del Master (es: http://192.168.1.27:3001)" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠️  Nota: Se usi un antivirus con firewall integrato, potrebbe essere necessario" -ForegroundColor Yellow
Write-Host "   configurare anche quello per permettere la porta 3001." -ForegroundColor Yellow

