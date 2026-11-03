#!/bin/sh
# ScreenDeck als Dienst einrichten: Programm nach /opt/screendeck, Daten nach /var/lib/screendeck,
# Start beim Hochfahren (systemd), eigener Benutzer „screendeck“. Aufruf: sudo sh install.sh
set -e
if [ "$(id -u)" != "0" ]; then
  echo "Bitte mit Administratorrechten ausführen: sudo sh install.sh"
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd nicht gefunden – ScreenDeck stattdessen mit ./start.sh starten."
  exit 1
fi

SRC=$(cd "$(dirname "$0")" && pwd)
DIR=/opt/screendeck
DATA=/var/lib/screendeck

id screendeck >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin screendeck
mkdir -p "$DIR" "$DATA"

# Update: laufenden Dienst anhalten, Programm und app/ ersetzen (Daten bleiben)
systemctl stop screendeck 2>/dev/null || true
if [ "$SRC" != "$DIR" ]; then
  rm -rf "$DIR/app"
  cp -a "$SRC/screendeck" "$SRC/app" "$SRC/screendeck.service" "$SRC/uninstall.sh" "$SRC/LIESMICH.txt" "$DIR/"
fi
chmod 755 "$DIR/screendeck" "$DIR/uninstall.sh"
chown -R screendeck:screendeck "$DATA"

cp "$DIR/screendeck.service" /etc/systemd/system/screendeck.service
systemctl daemon-reload
systemctl enable --now screendeck

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "ScreenDeck läuft als Dienst und startet bei jedem Hochfahren."
echo "  Verwaltung: http://${IP:-<IP-dieses-Rechners>}/admin"
echo "  Status:     systemctl status screendeck"
echo "  Protokoll:  journalctl -u screendeck -f"
echo "  Daten:      $DATA"
echo "  Entfernen:  sudo sh $DIR/uninstall.sh"
