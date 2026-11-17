# ScreenDeck auf Unraid

1. Das Image bauen oder in die eigene Registry legen und in `my-screendeck.xml` unter `<Repository>` eintragen.
   Der Standard `screendeck:latest` passt, wenn das Image direkt auf dem Unraid-Server gebaut wurde (`docker build -t screendeck .`).
2. Diesen Ordner auf den Server kopieren (z. B. in eine Freigabe) und dort ausführen:
   `bash /mnt/user/<freigabe>/screendeck/install.sh`.
   Das Skript kopiert das Template zu den Benutzer-Templates, legt `/mnt/user/appdata/screendeck` an (Besitzer 99:100) und legt das Symbol ab.
3. *Docker → Add Container → Template „screendeck“*. Dort **„Adresse von Unraid“** (`PUBLIC_HOST`) auf die IP oder den Namen
   des Servers setzen, optional einen Medienordner einbinden, dann *Apply*.
4. Verwaltung: `http://<unraid>:8092/admin`, Screens: `http://<unraid>:8092/`.

Unraid belegt Port 80 selbst. Darum ist der zusätzliche Port im Container aus (`EXTRA_PORT=0`), und Adressen enthalten immer `:8092`.
`screendeck.local` funktioniert im Bridge-Netz nicht; dafür bräuchte der Container das Host-Netzwerk.
Sichern: den Ordner `/mnt/user/appdata/screendeck` kopieren.
