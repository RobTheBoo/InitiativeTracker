# Script per aggiungere regola firewall per RPG Initiative Tracker
# Eseguire come amministratore: clic destro -> "Esegui come amministratore"

Write-Host "🔧 Configurazione Firewall per RPG Initiative Tracker..." -ForegroundColor Cyan

# Rimuovi regola vecchia se esiste (porta 3000)
netsh advfirewall firewall delete rule name="RPG Initiative Tracker" 2>$null

# Aggiungi nuova regola per porta 3001
netsh advfirewall firewall add rule name="RPG Initiative Tracker" dir=in action=allow protocol=TCP localport=3001

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Regola firewall creata con successo!" -ForegroundColor Green
    Write-Host "   Porta: 3001" -ForegroundColor Yellow
    Write-Host "   Direzione: In entrata" -ForegroundColor Yellow
    Write-Host "   Azione: Consenti" -ForegroundColor Yellow
} else {
    Write-Host "❌ Errore durante la creazione della regola firewall" -ForegroundColor Red
    Write-Host "   Assicurati di eseguire questo script come amministratore!" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "📋 Verifica regola:" -ForegroundColor Cyan
netsh advfirewall firewall show rule name="RPG Initiative Tracker"

