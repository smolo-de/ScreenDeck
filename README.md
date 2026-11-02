# ScreenDeck

Steuert die Inhalte beliebig vieler Screens (Tablets, Beamer, Smart-TVs …) zentral über eine Web-Verwaltung.
Jeder Screen ist einfach eine Browser-Seite, auf den Geräten wird nichts installiert.

## Start

```bash
npm install
npm start          # oder: npm run dev (Neustart bei Änderungen)
```

- **Verwaltung:** `http://localhost:3000/admin`
- **Screens:** `http://<IP-des-Servers>:3000/screen` auf jedem Gerät öffnen (die IP zeigt die Konsole bzw. die Verwaltung an)

Port ändern: `PORT=8080 npm start` (PowerShell: `$env:PORT=8080; npm start`)
Datenverzeichnis ändern: `DATA_DIR=...` (Standard: `./data`)

## Screens einbinden

1. Auf dem Gerät `http://<server>:3000/screen` öffnen und einmal tippen, um in den Vollbildmodus zu wechseln.
2. Der Screen meldet sich automatisch an und erscheint in der Verwaltung.
3. Jedes Gerät bekommt eine feste ID (im Browser gespeichert). Nach einem Neustart erkennt der Server das Gerät wieder.

Optionale URL-Parameter:

| Parameter | Bedeutung |
|-----------|-----------|
| `?name=Beamer%20Saal` | Name bei der ersten Anmeldung (später in der Verwaltung änderbar) |
| `?id=beamer1` | Feste ID statt der automatisch erzeugten, z. B. für Kiosk-Geräte mit gelöschtem Speicher |

## Verwaltung

**Screens:** Liste aller Screens mit Online-Status, Vorschau und Titel des aktuellen Inhalts, IP und „zuletzt gesehen“.
- Namen direkt in der Liste ändern
- Reihenfolge per Drag & Drop am ⋮⋮ ändern (relevant für „Der Reihe nach“)
- Zuordnung: *Automatisch (Playlist)* oder *Fest: \<Eintrag\>*
- 👁 blendet den Namen 5 s groß auf dem Gerät ein, ↻ lädt den Screen neu, ✕ entfernt einen Offline-Screen

**Modus pro Screen** (Buttons ▶ ⏸ 🖼 ⬛ am Screen bzw. „Alle Screens“ in der Steuerleiste):

| Modus | Verhalten |
|---|---|
| ▶ Play | Normalbetrieb |
| ⏸ Pause | Inhalt bleibt stehen, Video wird angehalten. Der Screen wechselt nicht mit. |
| 🖼 Bild | Zeigt das Standbild des Screens: ein Bild aus der Playlist oder ein eigenes Bild per „Eigenes Bild hochladen…“. Ohne gewähltes Bild ist der Screen schwarz. |
| ⬛ Dunkel | Schwarzer Bildschirm |

**Standbild: Text & Optionen** (aufklappbar am Screen): zusätzlicher Text im Bild-Modus mit Schrift, Farbe und Position (oben/Mitte/unten). Dazu weiche Ecken für das Standbild.
Text und Bild lassen sich kombinieren, oder du nutzt nur Text auf Schwarz.

Bei Pause, Bild und Dunkel bleibt der eigentliche Inhalt im Hintergrund geladen. Nach „Play“ läuft er an derselben Stelle weiter.
Inaktive Screens werden beim Wechseln übersprungen. Verdeckte Inhalte (Bild/Dunkel) dürfen gleichzeitig auf anderen Screens laufen.

**Ton:** Pro Screen per Schalter 🔊/🔇 mit Lautstärke-Regler (Standard: aus). Gilt für Videos.
Browser erlauben Ton erst, nachdem am Gerät einmal getippt wurde, danach für alle folgenden Videos. Bis dahin laufen Videos stumm weiter, und die Verwaltung zeigt „🔇 Ton blockiert – am Gerät einmal tippen“.
Für Kiosk-PCs ohne Bedienung den Browser mit freigegebenem Autoplay starten:

```
chrome --kiosk --autoplay-policy=no-user-gesture-required http://<server>:3000/screen
msedge --kiosk http://<server>:3000/screen --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required
```

Webseiten (iframe) steuern ihren Ton selbst und sind von der Einstellung nicht betroffen.

**Wiedergabe-Kontrolle:** Jeder Screen meldet zurück, was er tatsächlich anzeigt. Die Verwaltung zeigt pro Screen:
- ✓ *wird angezeigt* / *Video läuft*: bestätigt
- ⏳ *wird übertragen* / *lädt*: noch keine Bestätigung
- ✗ *Fehler*, *Video hängt*, *Autoplay blockiert*, *zeigt stattdessen …*, *keine Rückmeldung*

Kommt innerhalb von 10 s keine Bestätigung, schickt der Server den Inhalt erneut (bis zu 3 Mal). Danach lässt er sich per „erneut senden“ manuell anstoßen.
Videos werden laufend überwacht: Pausierte Videos werden neu gestartet, hängende als Fehler gemeldet.

**Playlist:** Bilder und Videos (Upload per Drag & Drop), Webseiten (URL) und Texte (mit Farben).
- Reihenfolge per Drag & Drop, Einträge umbenennen, aktivieren/deaktivieren, löschen
- **Doppelte Dateien:** Beim Upload wird der Dateiinhalt verglichen, nicht der Name. Unter dem Upload-Feld wählst du, ob Doppelte *aussortiert* (Standard) oder *trotzdem hinzugefügt* werden. Schon vorhandene Doppelte sind in der Playlist mit „doppelt“ markiert, und der Tooltip nennt den gleichen Eintrag.
- Neu hinzugefügte Einträge landen am Ende der Playlist. Die Verwaltung scrollt dorthin und hebt sie kurz hervor.
- **Quick-Buttons:** Unter jedem Eintrag gibt es einen Button pro Screen. Ein Klick reiht den Eintrag in die **Warteschlange** dieses Screens ein.
  `▶ Name` = läuft dort gerade, `⏳ Name` = dort eingereiht, `📌 Name` = dort fest zugeordnet.
  Alternativ einen Eintrag am ⋮⋮ auf einen Screen ziehen.
  Feste Zuordnung: über die Auswahl „Fest: …“ am Screen.

**Als Nächstes (pro Screen, über dem Verlauf):** Zeigt die Warteschlange und danach den voraussichtlich nächsten Playlist-Eintrag.
- Eingereihte Inhalte starten, sobald der aktuelle fertig ist: nach dem Videoende, beim nächsten Timer-Wechsel oder mit „⏭ Weiter“. Ein laufendes Video wird nicht unterbrochen.
- Zeigt der Screen gerade nichts, startet ein eingereihter Inhalt sofort.
- `▶ jetzt` spielt einen eingereihten Eintrag sofort ab, `✕` entfernt ihn, „leeren“ leert die Warteschlange.
- Auch fest zugeordnete Screens spielen ihre Warteschlange ab und kehren danach zu ihrem festen Inhalt zurück.

**Verteilung:**
- **Der Reihe nach:** Screen 1 zeigt Eintrag 1, Screen 2 Eintrag 2 … Bei einem Wechsel bekommt jeder Screen den nächsten Eintrag, der nicht schon auf einem anderen Screen läuft.
- **Zufall:** Jeder Screen bekommt einen zufälligen Eintrag. Doppelungen und Wiederholungen werden nach Möglichkeit vermieden.
- **Fest zugeordnete Screens** bleiben in beiden Modi unverändert, und ihre Inhalte werden nicht zusätzlich auf anderen Screens gezeigt.
- **Automatisch wechseln** alle *n* Sekunden oder manuell mit „Nächster Wechsel“.
- **Videos laufen immer bis zum Ende.** Danach wechselt nur dieser Screen zum nächsten Eintrag. Der Timer unterbricht laufende Videos nicht, „Nächster Wechsel“ dagegen schon.
  Ein fest zugeordnetes Video (oder wenn es nichts anderes gibt) startet wieder von vorne.

**Schrift & weiche Ecken (Texte):** Pro Text eine Schriftart wählen, z. B. Standard, Georgia, Impact, Bebas Neue, Montserrat oder die Halloween-Schriften Creepster, Nosifer und Butcherman.
Optional **weiche Ecken** (Weich / Stark weich): Die Textfläche wird abgerundet und zum Rand hin weich ausgeblendet, damit das Bild nicht rechteckig wirkt.
Die Web-Schriften kommen von Google Fonts und brauchen auf dem Screen Internet. Ohne Internet wird eine ähnliche Systemschrift verwendet.

**Texte mit Anzeigedauer:** Beim Hinzufügen (oder später direkt in der Playlist) lässt sich eine Anzeigedauer in Sekunden setzen. Nach Ablauf wechselt der Screen wie nach einem Videoende, und der Timer unterbricht den Text vorher nicht. Ohne Dauer bleibt der Text bis zum nächsten Wechsel stehen.
Optional zeigt der Screen unter dem Text einen großen **Countdown** der Restzeit. Im Modus Pause/Bild/Dunkel hält der Countdown an.

**Spielzeit:** Bei Screens mit Video oder Text mit Anzeigedauer stehen aktuelle Position und Gesamtdauer mit Fortschrittsbalken (z. B. `1:02 / 2:05`), sekündlich aktualisiert.
Ein **Klick in den Balken** springt an diese Stelle im Video bzw. setzt den Countdown entsprechend.

**Verlauf:** Pro Screen eine eingeklappte Liste der letzten 50 Inhalte mit Startzeit, Status der Wiedergabe (✓/⚠/✗), Anzeigedauer und Auslöser (Start, Timer, Manuell, Videoende, Fest, Playlist …).

## Updates

Screens und Verwaltung laden sich automatisch neu, sobald sich der Code im Ordner `public/` ändert oder der Server mit neuem Code startet. Ein manuelles Neuladen ist nicht nötig.

## Technik

- Node.js + Express, WebSocket (`ws`) für Live-Updates, Uploads per `multer`
- Zustand in `data/state.json`, hochgeladene Dateien in `data/uploads/`
- `server.js` – Server, API, Verteilungslogik
- `public/admin.*` – Verwaltung
- `public/screen.html` – Screen-Client (Überblendung, automatische Neuverbindung, roter Punkt bei Verbindungsverlust)

## Hinweise

- Die Verwaltung ist **nicht passwortgeschützt**. Nur im lokalen Netz betreiben.
- Ton gibt es nur bei Screens mit „🔊 Ton an“ (siehe oben).
- Viele Webseiten verbieten die Einbettung per iframe (`X-Frame-Options`). Diese bleiben dann leer.
- Damit die Geräte nicht in den Standby gehen, die Bildschirmsperre am Gerät deaktivieren oder den Kiosk-Modus nutzen. Die Wake-Lock-API funktioniert nur über https oder localhost.
