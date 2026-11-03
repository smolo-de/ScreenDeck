#!/bin/sh
# ScreenDeck-Dienst entfernen. Die Daten in /var/lib/screendeck bleiben erhalten.
set -e
if [ "$(id -u)" != "0" ]; then
  echo "Bitte mit Administratorrechten ausführen: sudo sh uninstall.sh"
  exit 1
fi
systemctl disable --now screendeck 2>/dev/null || true
rm -f /etc/systemd/system/screendeck.service
systemctl daemon-reload
rm -rf /opt/screendeck
echo "ScreenDeck wurde entfernt. Daten liegen weiter in /var/lib/screendeck (bei Bedarf selbst löschen)."
