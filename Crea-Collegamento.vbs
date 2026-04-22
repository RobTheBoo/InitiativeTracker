' Script VBScript per creare collegamento sul desktop
' Questo script può essere eseguito direttamente senza Node.js

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' Ottieni il percorso dello script
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName)
projectRoot = scriptPath

' Percorso dell'eseguibile principale
exePath = projectRoot & "\dist\win-unpacked\RPG Initiative Tracker.exe"

' Verifica che l'eseguibile esista
If Not fso.FileExists(exePath) Then
    MsgBox "❌ Errore: Eseguibile non trovato!" & vbCrLf & vbCrLf & _
           "Percorso cercato: " & exePath & vbCrLf & vbCrLf & _
           "Assicurati di aver compilato il progetto con: npm run build:win", _
           vbCritical, "Errore"
    WScript.Quit
End If

' Percorso del desktop
desktopPath = shell.SpecialFolders("Desktop")
shortcutPath = desktopPath & "\RPG Initiative Tracker.lnk"

' Crea il collegamento
Set shortcut = shell.CreateShortcut(shortcutPath)
shortcut.TargetPath = exePath
shortcut.WorkingDirectory = fso.GetParentFolderName(exePath)
shortcut.Description = "RPG Initiative Tracker - Pathfinder 1E Combat Manager"
shortcut.Save

MsgBox "✅ Collegamento creato con successo sul desktop!" & vbCrLf & vbCrLf & _
       "Nome: RPG Initiative Tracker.lnk" & vbCrLf & _
       "Destinazione: " & exePath, _
       vbInformation, "Successo"

