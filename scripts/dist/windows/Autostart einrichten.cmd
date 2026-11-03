@echo off
rem ScreenDeck beim Hochfahren automatisch starten (im Hintergrund, auch ohne Anmeldung)
rem und in der Windows-Firewall freigeben. Braucht Administratorrechte.
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  echo Administratorrechte werden angefordert ...
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)
set "EXE=%~dp0ScreenDeck.exe"
if not exist "%EXE%" (
  echo ScreenDeck.exe nicht gefunden: %EXE%
  pause
  exit /b 1
)

rem Geplante Aufgabe beim Systemstart, als SYSTEM, ohne Zeitlimit, bei Absturz neu starten
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$a = New-ScheduledTaskAction -Execute '%EXE%' -Argument '--no-browser' -WorkingDirectory '%~dp0';" ^
  "$t = New-ScheduledTaskTrigger -AtStartup;" ^
  "$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable;" ^
  "Register-ScheduledTask -TaskName 'ScreenDeck' -Action $a -Trigger $t -Settings $s -User 'SYSTEM' -RunLevel Highest -Force | Out-Null"
if errorlevel 1 (
  echo Die Aufgabe konnte nicht angelegt werden.
  pause
  exit /b 1
)

rem Firewall: eingehende Verbindungen für ScreenDeck.exe im privaten Netz/Domänennetz erlauben
netsh advfirewall firewall delete rule name="ScreenDeck" >nul 2>&1
netsh advfirewall firewall add rule name="ScreenDeck" dir=in action=allow program="%EXE%" enable=yes profile=private,domain >nul

schtasks /run /tn "ScreenDeck" >nul
echo.
echo ScreenDeck startet jetzt und künftig bei jedem Hochfahren im Hintergrund.
echo Verwaltung: http://localhost/admin  (bzw. http://localhost:3000/admin)
echo.
echo Hinweis: Läuft ScreenDeck gleichzeitig per Doppelklick, belegen beide denselben Port –
echo dann das Fenster schließen. Entfernen mit „Autostart entfernen.cmd“.
echo.
pause
