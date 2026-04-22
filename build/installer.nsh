; Custom NSIS hooks per electron-builder.
;
; Scopo: chiudere automaticamente RPG Initiative Tracker prima di
; install/uninstall cosi' l'utente non vede mai il dialog
; "Per favore chiudilo manualmente e clicca Riprova".
;
; Il server interno (Express + Socket.IO) puo' tenere vivo il processo
; anche dopo che la finestra principale e' stata chiusa, quindi
; taskkill /F /T (tree kill, force) e' la soluzione affidabile.

!macro customInit
  DetailPrint "Chiusura eventuali istanze di RPG Initiative Tracker in esecuzione..."
  nsExec::Exec 'taskkill /F /IM "RPG Initiative Tracker.exe" /T'
  Pop $0
  Sleep 1500
!macroend

!macro customUnInit
  DetailPrint "Chiusura eventuali istanze di RPG Initiative Tracker in esecuzione..."
  nsExec::Exec 'taskkill /F /IM "RPG Initiative Tracker.exe" /T'
  Pop $0
  Sleep 1500
!macroend
