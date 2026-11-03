@echo off
rem Autostart und Firewall-Freigabe von ScreenDeck wieder entfernen (Daten bleiben erhalten).
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  echo Administratorrechte werden angefordert ...
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)
schtasks /end /tn "ScreenDeck" >nul 2>&1
schtasks /delete /tn "ScreenDeck" /f >nul 2>&1
netsh advfirewall firewall delete rule name="ScreenDeck" >nul 2>&1
echo ScreenDeck startet nicht mehr automatisch. Die Daten im Ordner „data“ bleiben erhalten.
pause
