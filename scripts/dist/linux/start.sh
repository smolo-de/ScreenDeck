#!/bin/sh
# ScreenDeck ohne Einrichtung starten (Daten im Ordner data/ daneben). Beenden mit Strg+C.
# Port 80 braucht unter Linux Administratorrechte – sonst läuft ScreenDeck auf Port 3000.
cd "$(dirname "$0")"
chmod +x ./screendeck 2>/dev/null || true
exec ./screendeck "$@"
