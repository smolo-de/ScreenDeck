#!/bin/bash
# ScreenDeck – auf Unraid ausführen, aus dem Ordner, in dem dieses Skript und my-screendeck.xml liegen:
#   bash /mnt/user/<freigabe>/screendeck/install.sh
# Kopiert das Template zu den Benutzer-Templates von Unraid, legt den Datenordner an und legt das Symbol ab.
# Anderer Datenordner: TT_DATA=/mnt/user/appdata/xyz bash install.sh (dann auch im Template ändern).
set -euo pipefail

SRC="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
TEMPLATES=/boot/config/plugins/dockerMan/templates-user
DATA="${TT_DATA:-/mnt/user/appdata/screendeck}"

if [ ! -f "$SRC/my-screendeck.xml" ]; then
  echo "Fehlt: $SRC/my-screendeck.xml" >&2
  exit 1
fi

mkdir -p "$TEMPLATES"
if [ -f "$TEMPLATES/my-screendeck.xml" ] && ! cmp -s "$SRC/my-screendeck.xml" "$TEMPLATES/my-screendeck.xml"; then
  cp "$TEMPLATES/my-screendeck.xml" "$TEMPLATES/my-screendeck.xml.bak"
  echo "Altes Template gesichert: $TEMPLATES/my-screendeck.xml.bak"
fi
cp "$SRC/my-screendeck.xml" "$TEMPLATES/my-screendeck.xml"
echo "Template kopiert: $TEMPLATES/my-screendeck.xml"

if [ ! -d "$DATA" ]; then
  mkdir -p "$DATA" && chown 99:100 "$DATA"
  echo "Datenordner angelegt: $DATA (99:100)"
fi
# Das Symbol: Unraid lädt es sonst von der laufenden Anwendung. Beim ersten Anlegen läuft sie noch nicht,
# und ein fehlgeschlagener Abruf bleibt hängen. Darum wird es hier direkt an die Stellen gelegt,
# an denen Unraid die Symbole der Container aufbewahrt (Name des Containers: screendeck).
ICON="$SRC/icon.png"
# icon.png liegt im selben Ordner (unraid/ im Repo oder die Kopie in der Freigabe)
if [ -f "$ICON" ]; then
  for DIR in /var/lib/docker/unraid/images /usr/local/emhttp/state/plugins/dynamix.docker.manager/images; do
    mkdir -p "$DIR" && cp "$ICON" "$DIR/screendeck-icon.png"
  done
  echo "Symbol abgelegt (die Docker-Seite in Unraid neu laden)."
else
  echo "Hinweis: icon.png fehlt, das Symbol kommt dann von der laufenden Anwendung." >&2
fi

echo "Fertig. Docker -> Add Container -> Template 'screendeck' -> Apply."
