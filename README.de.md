# ScreenDeck

[English](README.md) · **Deutsch**

Steuert die Inhalte beliebig vieler Screens (Tablets, Beamer, Smart-TVs …) zentral über eine Web-Verwaltung.
Jeder Screen ist einfach eine Browser-Seite, auf den Geräten wird nichts installiert.

## Start

```bash
npm install
npm start          # oder: npm run dev (Neustart bei Änderungen)
```

- **Verwaltung:** `http://localhost:3000/admin`
- **Screens:** `http://<IP-des-Servers>:3000/screen` auf jedem Gerät öffnen (die IP zeigt die Konsole bzw. die Verwaltung an). Die reine Server-Adresse `http://<IP-des-Servers>:3000/` führt ebenfalls zum Screen; die Verwaltung gibt es nur ausdrücklich unter `/admin`.

**Per QR-Code verbinden:** `http://<server>/connect` zeigt einen QR-Code mit der Screen-Adresse. Er enthält die IP-Adresse statt des Namens und klappt damit auch auf Android. Aus der Verwaltung („▦ QR-Code“ bei den Screen-Adressen) kommt ein zweiter Code für die Verwaltung dazu. Am Screen zeigt „Gerät verbinden“ im Menü den QR-Code direkt an, z. B. auf dem Fernseher, damit ein Smartphone ihn abscannen kann. Die Codes erzeugt der Server selbst, Internet ist nicht nötig.

**Ohne Portangabe:** Der Server lauscht zusätzlich auf Port 80. Dann reicht `http://<IP-des-Servers>` bzw. `http://screendeck.local` ohne `:3000`. Ist Port 80 belegt (z. B. durch einen anderen Webserver), läuft alles wie gewohnt nur auf 3000, und die Konsole weist darauf hin. Unter **⚙ Einstellungen → Netzwerk → Ports** lässt sich der zusätzliche Port ändern (z. B. 8080, 0 = aus), das wirkt sofort und zeigt an, ob der Port frei ist. Dort ist auch der Hauptport einstellbar, er gilt nach einem Neustart. Die Umgebungsvariablen `PORT` und `EXTRA_PORT` haben Vorrang vor den Einstellungen. Lässt die Windows-Firewall nur Port 3000 durch, muss Port 80 dort ebenfalls freigegeben werden.

**Name im Netzwerk:** Der Server ist zusätzlich als `http://screendeck.local` erreichbar, ohne IP-Adresse (mDNS). Das klappt mit Windows, macOS, iPhone/iPad und neueren Android-Geräten. Manche ältere Android-Fernseher kennen solche Namen nicht, dort die IP-Adresse verwenden. Den Namen änderst du unter ⚙ Einstellungen → „Name im Netzwerk“, leer schaltet es ab. Mit mehreren ScreenDeck-Servern im selben Netz bitte verschiedene Namen wählen.
Tipp: Viele Router (z. B. Fritz!Box) machen Geräte auch selbst unter ihrem Namen erreichbar, etwa `http://<PC-Name>.fritz.box`. Das funktioniert auch auf älteren Fernsehern.

Port ändern: `PORT=8080 npm start` (PowerShell: `$env:PORT=8080; npm start`)
Datenverzeichnis ändern: `DATA_DIR=...` (Standard: `./data`)

## Bereitstellung

Neben dem Start mit Node.js (oben) gibt es drei fertige Wege. `npm run dist` baut die Pakete für Windows und Linux nach `dist/`, einzelne Ziele z. B. mit `npm run dist -- win-x64`. Gebaut wird mit der Node-Version des Rechners; für Linux lädt das Skript das passende Node von nodejs.org (mit Prüfsumme).

**Windows – ohne Installation** (`ScreenDeck-win-x64.zip`)
- Entpacken und `ScreenDeck.exe` doppelklicken: Ein Fenster zeigt die Adressen, die Verwaltung öffnet sich im Browser. Fenster schließen = beenden.
- Daten liegen im Ordner `data` neben der Exe. Für ein Update `ScreenDeck.exe` und `app` ersetzen, `data` behalten.
- **Autostart:** `Autostart einrichten.cmd` startet ScreenDeck bei jedem Hochfahren im Hintergrund (geplante Aufgabe unter dem Systemkonto, ohne Zeitlimit, Neustart nach Absturz) und gibt es in der Firewall frei. `Autostart entfernen.cmd` macht das rückgängig.
- Die Exe ist Node.js mit eingebautem Starter (Node „Single Executable Application“). Der Ordner `app` daneben enthält Server und Abhängigkeiten, weil die Bildverarbeitung (sharp) native Bibliotheken braucht. Die Exe ist nicht signiert, SmartScreen kann beim ersten Start warnen.

**Linux – x64 und arm64, z. B. Raspberry Pi** (`ScreenDeck-linux-x64.tar.gz`, `…-linux-arm64.tar.gz`)
- `tar -xzf ScreenDeck-linux-x64.tar.gz && cd ScreenDeck-linux-x64`, dann `./start.sh` (Daten in `data/` daneben, Port 3000).
- **Als Dienst:** `sudo sh install.sh` richtet einen systemd-Dienst ein: Programm in `/opt/screendeck`, Daten in `/var/lib/screendeck`, eigener Benutzer `screendeck`, Port 80 ohne root. Update: neues Archiv auspacken und erneut `sudo sh install.sh`. Entfernen: `sudo sh /opt/screendeck/uninstall.sh` (Daten bleiben).
- Kein Node.js nötig. Netzwerkfreigaben im System einbinden (mount); die Anmeldung in der Verwaltung gibt es nur unter Windows.

**Docker** (`Dockerfile`, `docker-compose.yml`)
- `docker compose up -d` – Daten im Volume `screendeck-data`, erreichbar auf Port 3000 und 80.
- Im Container sieht ScreenDeck nur seine interne Adresse. Damit QR-Codes und angezeigte Adressen stimmen, in `docker-compose.yml` `PUBLIC_HOST` auf die IP des Rechners setzen (und `PUBLIC_PORT` passend zur Portweiterleitung). Unter Linux geht alternativ `network_mode: host` – dann funktioniert auch `screendeck.local`.
- Medienordner des Rechners als Volume einbinden (Beispiel in der Datei) und in der Verwaltung den Pfad im Container angeben.

| | Windows-Exe | Linux-Paket | Docker |
|---|---|---|---|
| Installation nötig | nein | nein (Dienst optional) | Docker |
| Start beim Hochfahren | `Autostart einrichten.cmd` | `install.sh` | `restart: unless-stopped` |
| Netzwerkfreigaben mit Anmeldung | ja | im System einbinden | als Volume einbinden |
| `screendeck.local` | ja | ja | nur mit Host-Netzwerk |

**Automatische Builds (GitHub Actions)**
- Jeder Push und Pull Request startet `.github/workflows/ci.yml`: Syntaxprüfung, Rauchtest unter Linux und Windows (`npm test` startet den Server mit leerem Datenordner und prüft Seiten, API, Upload und Vorschaubild) und ein Docker-Build, der ebenfalls gestartet und geprüft wird.
- Ein Release entsteht durch einen Versions-Tag: `git tag v1.2.0 && git push origin v1.2.0`. `.github/workflows/release.yml` führt dann die Tests aus, baut alle drei Pakete, packt jedes aus und startet das Programm darin (linux-arm64 per QEMU emuliert), veröffentlicht das Docker-Image für amd64 und arm64 unter `ghcr.io/<besitzer>/screendeck` und legt ein GitHub-Release mit den Archiven und `SHA256SUMS.txt` an. Die Version kommt aus dem Tag. Tags mit Bindestrich (`v1.2.0-beta.1`) werden Vorabversionen.
- Von Hand gestartet (Actions → Release → Run workflow) wird alles gebaut und getestet, aber nichts veröffentlicht.
- **Sicherheitsprüfungen** gehören zu `ci.yml` und laufen zusätzlich jeden Montag: `npm audit`, Gitleaks (Passwörter und Tokens im Git-Verlauf) und Trivy (Docker-Image). Hohe oder kritische Funde lassen den Lauf scheitern, beim Image nur, wenn es eine Korrektur gibt; das stoppt auch ein Release. Actions sind auf Commit-Hashes festgelegt, die Scanner auf eine Version mit hinterlegter Prüfsumme. Dependabot (`.github/dependabot.yml`) schlägt wöchentlich Updates für npm, Actions und das Docker-Basisimage vor; die Scanner-Versionen in `ci.yml` werden von Hand aktualisiert.

## Sprache

Die Oberfläche gibt es auf **Deutsch** und **Englisch**. Standard ist die Sprache des Browsers.
- **Umschalten:** in der Verwaltung oben rechts (DE/EN), am Screen unten im Menü (🌐, neben der Bildqualität).
- **Speicherung:** Die Wahl gilt pro Gerät und wird im Browser gespeichert.
- **Kiosk-Geräte:** `?lang=en` bzw. `?lang=de` in der Adresse, z. B. `/screen?lang=en`.

Die Übersetzungen stehen in `public/i18n.js`. Die Seiten selbst sind auf Deutsch geschrieben, für Englisch übersetzt das Skript alle sichtbaren Texte.

## Screens einbinden

1. Auf dem Gerät `http://<server>:3000/screen` öffnen, antippen und im Menü „⛶ Vollbild“ wählen.
2. Der Screen meldet sich automatisch an und erscheint in der Verwaltung.
3. Jedes Gerät bekommt eine feste ID (im Browser gespeichert). Nach einem Neustart erkennt der Server das Gerät wieder.

Optionale URL-Parameter:

| Parameter | Bedeutung |
|-----------|-----------|
| `?name=Beamer%20Saal` | Name bei der ersten Anmeldung (später in der Verwaltung änderbar) |
| `?id=beamer1` | Feste ID statt der automatisch erzeugten, z. B. für Kiosk-Geräte mit gelöschtem Speicher |

**Menü auf dem Screen:** Antippen oder Klicken zeigt unten ein Menü mit Name, ID, Verbindung und aktuellem Inhalt.
- **Buttons:** „Vollbild“ bzw. „Vollbild beenden“, „Anhalten“ bzw. „Fortsetzen“ und „Neu laden“.
- **Am Screen anhalten:** Die Verwaltung zeigt dann am Pause-Button „⏸ Client“, mit ▶ geht es weiter. Fortsetzen geht dort oder am Screen. Hat die Verwaltung pausiert oder Bild bzw. Dunkel gewählt, lässt sich das am Screen nicht aufheben.
- **Ausblenden:** „✕ Ausblenden“, erneutes Antippen oder Esc schließt das Menü sofort, ohne Bedienung verschwindet es nach 10 s von selbst.
- **Zoomen (Touch-Screens):** Mit zwei Fingern vergrößern (bis 5-fach), mit einem Finger verschieben, Doppeltippen vergrößert an der Stelle bzw. setzt zurück. Gilt für Bilder, Texte und Videos, nicht für Webseiten.
  - Solange vergrößert ist, hält der Screen Bilder und Texte an. Die Verwaltung zeigt dann „⏸ Client“ und kann fortsetzen. Videos laufen weiter.
  - Zurückgesetzt wird nach 60 s ohne Berührung, beim nächsten Inhalt oder per Doppeltippen. Danach läuft der Screen normal weiter.
  - Abschaltbar unter ⚙ Einstellungen („Zoomen per Fingergeste“). Mit Zoom wartet ein einzelnes Antippen kurz (0,3 s), ob ein zweites folgt.
- **Fernsteuerung:** Ein Screen (z. B. ein Smartphone) steuert andere (z. B. den Fernseher). Im Menü „Fernsteuerung“ wählen, die mitlaufenden Screens antippen (vorausgewählt: alle verbundenen), „Starten“.
  - **Freigabe:** Nur Screens, die in der Verwaltung freigeschaltet sind (beim Screen „Fernsteuerung: erlaubt“, in der kompakten Ansicht unter ▾), zeigen den Knopf im Menü. Standard ist „gesperrt“. Wird die Freigabe entzogen, endet eine laufende Fernsteuerung sofort.
  - **📱 Smartphone koppeln (schnell):** In der Verwaltung neben den Screen-Adressen „📱 Smartphone koppeln“ öffnen und den QR-Code scannen. Das Smartphone ist sofort Fernbedienung für alle verbundenen Screens, ohne Freischaltung und ohne Screen-PIN. Der Code enthält einen Schlüssel und wird nur der Verwaltung angezeigt. „Neuer Code“ unter ⚙ Einstellungen → Screens macht ihn ungültig, gekoppelte Geräte bleiben freigeschaltet (in der Screen-Liste sperrbar).
  - **▦ Playlist** (in der Leiste): Vorschaubilder aller aktiven Einträge, der laufende ist blau umrandet. Antippen zeigt den Eintrag sofort auf allen gesteuerten Screens. Änderungen an der Playlist erscheinen von selbst. Oben lässt sich die **Playlist wechseln**, sie läuft dann sofort auf den gesteuerten Screens. **„＋ Neu“** legt eine leere Playlist an und spielt sie ab, danach landet alles Hochgeladene direkt darin. **🗑** schaltet den Löschmodus ein: Kacheln antippen wählt sie aus („Alle“ wählt alle bzw. keine), „Löschen (n)“ fragt einmal nach. Läuft ein gelöschter Eintrag gerade, zeigen die Screens den nächsten. Hochgeladene Dateien werden mitgelöscht, sofern keine andere Playlist sie verwendet, Dateien aus Medienordnern bleiben erhalten.
  - **⬚ Maske** (in der Leiste) – für Beamer, die auf Wände oder Häuser projizieren: Bereiche, in denen der gewählte Screen keinen Inhalt zeigt, z. B. die Fenster eines Hauses. Der Inhalt wird dort ausgeschnitten, nicht übermalt. Der Beamer gibt an diesen Stellen kein Licht ab, sie bleiben an der Wand unbeleuchtet. Mit `?transparent=1` in der Screen-Adresse ist auch der Seitenhintergrund durchsichtig, z. B. als Browser-Quelle in OBS, dann scheint durch die Bereiche durch, was darunter liegt.
    - Oben den Screen wählen (vorgewählt: der erste gesteuerte). Solange der Editor offen ist, zeigt der Screen selbst ein **Drahtgitter** mit Umrissen und Eckpunkten, so lässt sich alles direkt an der Wand ausrichten.
    - **Formen:** **▭ Rechteck**, **◯ Kreis/Ellipse** und **△ Dreieck** auf der Fläche aufziehen. Ein einzelnes Antippen setzt eine Standardgröße, auf dem Screen quadratisch bzw. kreisrund. Rechteck und Dreieck haben danach freie Ecken, so passt man sie z. B. an perspektivisch verzerrte Fenster an. Der Kreis bleibt rund und lässt sich an den vier Ecken seines Rahmens zur Ellipse ziehen.
    - **Breite/Höhe:** Am gewählten Rechteck bzw. Kreis sitzt auf jeder Seitenmitte ein quadratischer **Kantengriff**. Ziehen verschiebt die ganze Kante, das Rechteck bleibt dabei gerade, auch wenn es schon schräg ist. So ändert sich gezielt nur die Breite oder nur die Höhe. Im Skalier-Modus geht die gegenüberliegende Kante mit, die Form wird symmetrisch um ihre Mitte breiter bzw. höher. Die Pfeile verschieben eine gewählte Kante fein.
    - **Umkehren:** Mit „Umkehren“ ist der Inhalt nur **innerhalb** der Bereiche zu sehen, außen wird nichts gezeigt, z. B. um nur in die Fenster zu projizieren. Auch in der Verwaltung schaltbar („Umkehren“/„Normal“).
    - **Weiche Kanten:** Der Regler (0–50) lässt die Ränder aller Bereiche sanft auslaufen statt hart abzubrechen, auch beim Umkehren. Die Stärke bezieht sich auf die kürzere Bildschirmseite, sie wirkt also auf jedem Beamer gleich. In der Verwaltung steht beim Screen „◌ n“.
    - **⤢ Skalieren:** Im Skalier-Modus vergrößert bzw. verkleinert Ziehen den angetippten Bereich gleichmäßig um seine Mitte, nach außen größer, nach innen kleiner. ← → machen ihn schmaler/breiter, ↑ ↓ höher/niedriger (je 1 %). Mit zwei Fingern lässt sich ein gewählter Bereich jederzeit zoomen, auch ohne Modus. Bereiche dürfen über den Rand ragen.
    - **⬠ Freies Vieleck:** Ecken nacheinander antippen. Den ersten Punkt erneut antippen oder „✓ Schließen“ schließt den Bereich.
    - **Bearbeiten:** Ecken ziehen, in einen Bereich fassen verschiebt ihn ganz. **← ↑ ↓ →** schieben den gewählten Punkt bzw. Bereich fein um 0,2 % (gedrückt halten wiederholt). **↶** nimmt beim Zeichnen den letzten Punkt zurück, sonst löscht es den gewählten Punkt. **🗑** löscht den Bereich.
    - **„Maske aktiv“** schaltet sie vorübergehend aus. Die Maske bleibt pro Screen gespeichert, auch nach einem Neustart, und gilt über Bild, Video, Text und Standbild hinweg. Punkte beziehen sich auf die Bildschirmfläche.
    - In der Verwaltung steht beim Screen „Maske: Bereiche: n“ mit „Ausschalten“ und „Entfernen“.
  - **⤒ Hochladen** (in der Leiste): öffnet am Smartphone die Galerie bzw. Kamera. Fotos und Videos kommen in die aktive Playlist, Musik in die Musikliste, doppelte werden aussortiert. Das erste neue Bild/Video läuft sofort auf allen gesteuerten Screens. Oben zeigt ein Balken den Fortschritt. Nur das steuernde Gerät darf hochladen, abgesichert über einen Schlüssel, der mit der Fernsteuerung endet.
  - Alle beteiligten Screens zeigen denselben Eintrag, der automatische Wechsel ruht für sie. Die übrigen Screens laufen normal weiter.
  - Am steuernden Gerät erscheint unten eine Leiste: ‹ › schaltet durch die aktiven Einträge der Playlist, alternativ waagerecht wischen oder die Pfeiltasten. Dazu „Zoom zurücksetzen“ und ✕ (beenden).
  - **Zoom** am steuernden Gerät (zwei Finger, Verschieben, Doppeltippen) wird auf die gesteuerten Screens übertragen, bezogen auf das Bild. Auch bei anderem Seitenverhältnis (Smartphone hochkant, Fernseher quer) ist derselbe Bildpunkt in der Mitte.
  - **Stift** (✏ in der Leiste): Der Finger bzw. die Maus zeichnet auf das Bild, die Striche erscheinen live auf den gesteuerten Screens. Darüber stehen 5 Farben, 3 Dicken, 🗑 zum Löschen der ganzen Zeichnung und ↶ zum Zurücknehmen des letzten Strichs (auch Strg+Z). Die Striche liegen auf dem Bild, zoomen also mit und sitzen auch bei anderem Seitenverhältnis an derselben Stelle. Beim nächsten Inhalt sind sie weg. Solange der Stift an ist, wird nicht gezoomt oder gewischt, und Antippen setzt einen Punkt statt das Menü zu öffnen. Farbe und Dicke merkt sich das Gerät.
  - **Drehen** (↻ in der Leiste, nur Bilder und Videos): dreht um 90° im Uhrzeigersinn, auf allen gesteuerten Screens. Das gedrehte Bild wird neu eingepasst, Striche drehen mit. Beim nächsten Inhalt ist die Drehung weg.
  - **Ton** (🔊 in der Leiste): Oben wählst du den Screen, dessen Ton du steuerst. Das kann jeder andere Screen sein, auch einer, der nicht mitläuft. Vorgewählt ist der erste gesteuerte. Für ihn lassen sich Musik und Video-Ton stumm/laut schalten und die Lautstärke einstellen. Dazu kommen Musiktitel zurück, abspielen/anhalten und weiter. Außerdem lässt sich einstellen, was die Musik „bei Video mit Ton“ macht (leiser weiterspielen, pausieren, nichts ändern), und beim Leiserwerden die Stufe („Musik dabei“, in %), wie in der Verwaltung. Titelwahl, dieses Verhalten und Abspielen betreffen die Musik aller Screens, da sie überall synchron läuft. Ist die Musik auf einem gesteuerten Screen aus, schaltet „laut“ sie dort ein.
  - Die Verwaltung zeigt „📱 steuert …“ bzw. „📱 gesteuert von …“, mit „beenden“. Im Verlauf steht „Fernsteuerung“.
  - Ist das steuernde Gerät 2 Minuten nicht verbunden (z. B. Bildschirmsperre), endet die Fernsteuerung von selbst. Nach einem Neustart des Servers muss sie neu gestartet werden.
- **Abschalten:** Unter ⚙ Einstellungen lässt sich das Menü für alle Screens ausschalten, z. B. bei öffentlich zugänglichen Touch-Screens. Antippen schaltet dann nur in den Vollbildmodus.

## Verwaltung

**Screens:** Liste aller Screens mit Online-Status, Vorschau und Titel des aktuellen Inhalts, IP und „zuletzt gesehen“.
- Namen direkt in der Liste ändern
- Reihenfolge per Drag & Drop am ⋮⋮ ändern (relevant für „Der Reihe nach“)
- Zuordnung: *Automatisch (Playlist)* oder *Fest: \<Eintrag\>*
- **📌 Fixieren** (neben dem aktuellen Inhalt) macht den gerade laufenden Eintrag zum festen Inhalt des Screens, **Lösen** schaltet zurück auf Automatik.
- 👁 blendet den Namen 5 s groß auf dem Gerät ein, ↻ lädt den Screen neu, ✕ entfernt einen Offline-Screen
- **☰ Kompakt:** eine kurze Zeile pro Screen mit Name, Modus-Buttons, aktuellem Inhalt, Status und Spielzeit. Standbild, Ton, Zuordnung, „Als Nächstes“ und Verlauf erscheinen per ▾ ganz rechts oder per Klick aufs Vorschaubild. Die Einstellung merkt sich der Browser.
- „Alle löschen“ leert die Screen-Liste. Gerade verbundene Screens melden sich danach automatisch neu an, mit Standard-Einstellungen.

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

**Hinzufügen, Medien, Musik** (rechte Spalte): drei eigene Bereiche, jeder per Klick auf die Kopfzeile (▾/▸) einklappbar. Den Zustand merkt sich der Browser. Auch die **Playlist** lässt sich so einklappen; sichtbar bleiben dann Auswahl, Status und „Auf Screens abspielen“.

**Steuerleiste oben** (Verteilung, Auto-Wechsel, „Weiter ⏭“ für den nächsten Wechsel, Alle Screens): ein durchgehendes Band in einer Zeile direkt unter der Kopfzeile. Auf großen Bildschirmen bleibt es beim Scrollen stehen. Die Erklärung zur Verteilung blendet ⓘ ein und aus.

**Aktuelle Position in der Playlist:** Einträge, die gerade auf einem verbundenen Screen zu sehen sind, haben einen grünen Rand und ein Abzeichen mit dem Screen-Namen (● Fernseher). „◉ Aktuelle Position“ springt dorthin, weitere Klicks gehen reihum durch alle angezeigten Einträge.

**⚙ Einstellungen** öffnen sich als Fenster über der Seite, mit den Rubriken Screens, Netzwerk, Bildqualität, Medienquellen und Zugriffsschutz. Esc, ✕ oder ein Klick daneben schließt es. Die zuletzt gewählte Rubrik merkt sich der Browser.
- **Hinzufügen:** Upload per Drag & Drop, Umgang mit doppelten Dateien, Webseite/URL und Text.
- **Medien:** der Inhalt der **Medienquellen** bzw. der hochgeladenen Dateien (siehe unten).
- **Musik:** siehe [Musik](#musik).

**Medien:**
- **Medienquellen** sind beliebig viele Ordner, eingebunden unter ⚙ Einstellungen → Medienquellen: lokale Ordner (`D:\Medien`), Netzlaufwerke (`Z:\Videos`) oder Netzwerkpfade (`\\NAS\Freigabe\Videos`). Standard ist `data/media`.
  - Jede Quelle bekommt einen Namen (umbenennbar). Beim Einbinden prüft der Server, ob der Ordner erreichbar ist.
  - Wird eine Quelle entfernt, bleiben die Dateien und die Playlist-Einträge daraus unberührt.
  - Netzlaufwerke müssen für das Benutzerkonto erreichbar sein, unter dem der Server läuft. Läuft er als Dienst oder „als Administrator“, sind verbundene Laufwerksbuchstaben oft unsichtbar, dann den Netzwerkpfad verwenden.
  - **Ordner suchen:** „📂 Durchsuchen“ neben dem Pfad öffnet einen Ordner-Browser. Ohne Pfad zeigt er die Laufwerke, bei `\\Servername` (z. B. `\\sugo`) dessen Freigaben, danach die Unterordner. ⬆ geht eine Ebene höher, „✓ Diesen Ordner wählen“ übernimmt den Pfad und schlägt den Ordnernamen als Namen vor. Braucht der Server eine Anmeldung, vorher Benutzer und Kennwort eintragen.
  - **Anmeldung an Freigaben (Windows):** Bei Netzwerkpfaden (`\\Server\Freigabe`) lassen sich Benutzer und Kennwort angeben, beim Einbinden oder später über 🔑. Der Server meldet sich damit per `net use` an, auch nach jedem Neustart. Das Kennwort wird mit dem Windows-Konto des Servers verschlüsselt (DPAPI) in `data/state.json` gespeichert und nie an die Oberfläche geschickt. Läuft der Server später unter einem anderen Konto, muss es neu eingegeben werden. Windows erlaubt je Server nur eine Anmeldung, alle Freigaben desselben Servers nutzen also denselben Benutzer. Unter Linux/macOS die Freigabe im System einbinden (mount).
- Oben im Bereich wählst du die Quelle (oder „⬆ Hochgeladen“). Bilder und Videos darin werden mit Unterordnern, Vorschau und Suche aufgelistet.
- Dateien **in die Playlist ziehen**: Eine Linie zeigt, wo der Eintrag landet. Alternativ ＋ (anhängen) oder „Alle hinzufügen“ für den ganzen Ordner. „✓ in Playlist“ markiert bereits enthaltene Dateien.
- Die Dateien werden **nicht kopiert**, sondern direkt aus dem Ordner abgespielt. Wird ein Eintrag aus der Playlist gelöscht, bleibt die Originaldatei erhalten.
- **„⬆ Hochgeladen“** zeigt stattdessen die hochgeladenen Dateien (`data/uploads`), neueste zuerst, mit Titel und Vorschau. Von dort lassen sich Dateien ohne erneuten Upload (nochmal) in die Playlist ziehen. Eine hochgeladene Datei wird erst gelöscht, wenn kein Playlist-Eintrag und kein Standbild sie mehr verwendet.
- Breite Bildschirme zeigen drei Spalten (Screens | Playlist | Medien), mittlere die Playlist unter den Screens und „Hinzufügen“, „Medien“ und „Musik“ rechts daneben.

**Mehrere Playlisten:** Im Kopf der Playlist wählst du, welche Playlist angezeigt und bearbeitet wird. Daneben: ＋ neu, ⧉ duplizieren, ✎ umbenennen, 🗑 löschen.
- **Aktiv** ist die Playlist, die auf den Screens läuft (▶ in der Auswahl, grünes „läuft auf den Screens“). Eine andere Playlist lässt sich in Ruhe vorbereiten („läuft gerade nicht“, oranger Rahmen) und mit **„▶ Auf Screens abspielen“** aktivieren. Die Screens verteilen sich dann sofort neu.
- Feste Zuordnungen gelten für die Einträge ihrer Playlist. Sie ruhen, solange eine andere Playlist läuft, und greifen nach dem Zurückwechseln wieder.
- Die Medienliste zeigt, in welchen Playlisten eine Datei steckt (z. B. „✓ in Playlist +1“ oder „in „Party““, Details per Tooltip). Dieselbe Datei kann in mehreren Playlisten stecken und wird nur einmal gespeichert. Gelöscht wird sie erst, wenn keine Playlist sie mehr verwendet.

**Playlist:** Bilder und Videos (Upload per Drag & Drop), Webseiten (URL) und Texte (mit Farben).
- Reihenfolge per Drag & Drop, Einträge umbenennen, aktivieren/deaktivieren, löschen
- **Doppelte Dateien:** Beim Upload wird der Dateiinhalt verglichen, nicht der Name. Unter dem Upload-Feld wählst du, ob Doppelte *aussortiert* (Standard) oder *trotzdem hinzugefügt* werden. Schon vorhandene Doppelte sind in der Playlist mit „doppelt“ markiert, und der Tooltip nennt den gleichen Eintrag.
  Mit „🧹 … doppelte Einträge entfernen“ räumst du sie auf: Ein Dialog zeigt vorher, welche Einträge entfernt werden. Pro Inhalt bleibt jeweils der oberste Eintrag erhalten.
- **Suche & Filter** über der Playlist: nach Titel, Text oder URL suchen, nach Typ filtern sowie „nur aktive / deaktivierte / doppelte“ anzeigen. Die Leiste bleibt beim Scrollen oben stehen.
- **☰ Kompakt:** eine Zeile pro Eintrag. Text-Optionen und Screen-Buttons erscheinen per ▾. Die Einstellung merkt sich der Browser.
- **Mehrfachauswahl:** Checkbox pro Eintrag, Shift-Klick wählt einen Bereich, „Alle auswählen“ nimmt alle angezeigten (also gefilterten) Einträge. Ausgewählte lassen sich gemeinsam aktivieren, deaktivieren, löschen oder bei einem Screen einreihen.
- **Video-Vorschaubilder** erzeugt die Verwaltung einmalig, nacheinander und einzeln. Sie nimmt ein Standbild nach 1 Sekunde, bei dunklem Anfang weiter hinten, und speichert es als kleines JPG auf dem Server. Solange das läuft, zeigt das Vorschaufenster einen Ladebalken. Danach laden die Vorschauen sofort.
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

**Verteilung:** zwei unabhängige Schalter – *was* die Screens zeigen (**⇉ Alle gleich** oder **▦ Verschieden**) und *in welcher Reihenfolge* (**→ Der Reihe nach** oder **🎲 Zufall**). Damit gibt es vier Kombinationen:

| | → Der Reihe nach | 🎲 Zufall |
|---|---|---|
| **▦ Verschieden** | Screen 1 zeigt Eintrag 1, Screen 2 Eintrag 2 … Bei einem Wechsel bekommt jeder Screen den nächsten Eintrag, der nicht schon auf einem anderen Screen läuft. | Jeder Screen bekommt einen zufälligen Eintrag. Doppelungen und Wiederholungen werden nach Möglichkeit vermieden. |
| **⇉ Alle gleich** | Alle Screens zeigen denselben Eintrag und gehen gemeinsam durch die Playlist. | Alle Screens zeigen denselben Eintrag, bei jedem Wechsel einen zufälligen (nie zweimal hintereinander denselben). |

ⓘ neben „Verteilung“ erklärt die gerade gewählte Kombination. Eine ältere Einstellung „Zufall“ wird beim Start als „Verschieden + Zufall“ übernommen.

- **⇉ Alle gleich (Sync):** Alle Screens zeigen denselben Inhalt. Videos starten zu einem gemeinsamen Zeitpunkt, rund 2 s nach dem Wechsel, damit alle laden können. Danach führen die Screens ihre Position laufend nach. Kleine Abweichungen gleichen sie über eine minimal schnellere oder langsamere Wiedergabe aus, große per Sprung.
  - **Gemeinsam für alle:** „Weiter“, Warteschlange, Klick in den Fortschrittsbalken und Videoende gelten für die ganze Gruppe.
  - **Spät einsteigen:** Ein neu geladener oder später verbundener Screen steigt an der aktuellen Stelle ein.
  - **Pause:** Pausierte Screens springen nach „Play“ zurück an die gemeinsame Stelle.
  - **Ausnahme:** Fest zugeordnete Screens machen nicht mit.
  - **Uhrzeit:** Die Uhrzeit der Geräte muss nicht stimmen, die Screens gleichen sie mit der des Servers ab.
- **Fest zugeordnete Screens** bleiben in allen Modi unverändert, und ihre Inhalte werden nicht zusätzlich auf anderen Screens gezeigt.
- **Automatisch wechseln (Auto-Zeit):** Bilder, Webseiten und Texte ohne eigene Anzeigedauer stehen jeweils *n* Sekunden, gezählt ab ihrem Erscheinen. Jeder Screen hat seinen eigenen Takt, im Sync-Modus läuft die Gruppe gemeinsam. Nach Pause, Bild oder Dunkel beginnt die Zeit neu. Manuell geht es mit „Nächster Wechsel“.
- **Videos laufen immer bis zum Ende.** Danach wechselt nur dieser Screen zum nächsten Eintrag. Die Auto-Zeit gilt für Videos nicht, „Nächster Wechsel“ unterbricht sie dagegen schon.
  Ein fest zugeordnetes Video (oder wenn es nichts anderes gibt) startet wieder von vorne.

**Schrift & weiche Ecken (Texte):** Pro Text eine Schriftart wählen, z. B. Standard, Georgia, Impact, Bebas Neue, Montserrat oder die Halloween-Schriften Creepster, Nosifer und Butcherman.
Optional **weiche Ecken** (Weich / Stark weich): Die Textfläche wird abgerundet und zum Rand hin weich ausgeblendet, damit das Bild nicht rechteckig wirkt.
Die Web-Schriften kommen von Google Fonts und brauchen auf dem Screen Internet. Ohne Internet wird eine ähnliche Systemschrift verwendet.

**Texte mit Anzeigedauer:** Beim Hinzufügen (oder später direkt in der Playlist) lässt sich eine Anzeigedauer in Sekunden setzen. Nach Ablauf wechselt der Screen wie nach einem Videoende, und der Timer unterbricht den Text vorher nicht. Ohne Dauer gilt die Auto-Zeit. Ist „Automatisch wechseln“ aus, bleibt der Text bis zum nächsten manuellen Wechsel stehen.
Optional zeigt der Screen unter dem Text einen großen **Countdown** der Restzeit. Im Modus Pause/Bild/Dunkel hält der Countdown an.

**Spielzeit:** Bei Screens mit Video, Text mit Anzeigedauer oder Bild/Text mit Auto-Zeit stehen aktuelle Position und Gesamtdauer mit Fortschrittsbalken (z. B. `1:02 / 2:05`), sekündlich aktualisiert.
Ein **Klick in den Balken** springt an diese Stelle im Video bzw. setzt den Countdown entsprechend.

**Verlauf:** Pro Screen eine eingeklappte Liste der letzten 50 Inhalte mit Startzeit, Status der Wiedergabe (✓/⚠/✗), Anzeigedauer und Auslöser (Start, Timer, Manuell, Videoende, Fest, Playlist …).

## Updates

Screens und Verwaltung laden sich automatisch neu, sobald sich der Code im Ordner `public/` ändert oder der Server mit neuem Code startet. Ein manuelles Neuladen ist nicht nötig.
Änderungen an `server.js` greifen erst nach einem Neustart des Servers. Bis dahin zeigt die Verwaltung oben einen gelben Hinweis „Server neu starten“. Mit `npm run dev` startet der Server bei Änderungen von selbst neu.

## Technik

- Node.js + Express, WebSocket (`ws`) für Live-Updates, Uploads per `multer`
- Zustand in `data/state.json`, hochgeladene Dateien in `data/uploads/`
- `server.js` – Server, API, Verteilungslogik
- `public/admin.*` – Verwaltung
- `public/screen.html` – Screen-Client (Überblendung, automatische Neuverbindung, roter Punkt bei Verbindungsverlust)
- `public/i18n.js` – Sprachen (Deutsch/Englisch)

## Musik

Eigene **Musikliste** parallel zur Anzeige (Bereich „🎵 Musik“ unter „Medien“).
- **Quellen:**
  - Audiodateien (MP3, M4A, AAC, OGG/Opus, WAV, FLAC) aus den Medienquellen, per ＋ oder Ziehen in die Musikliste.
  - Hochgeladene Audiodateien, die automatisch in der Musikliste landen.
  - **Internetradio** über die Stream-Adresse.
- **Steuerung:** ⏮ ▶/⏸ ⏭, 🔀 Zufall, 🔁 Wiederholen, Lautstärke, Klick in den Fortschrittsbalken springt. Die Reihenfolge änderst du per Ziehen am ⋮⋮, Titel lassen sich umbenennen.
- **Spielt auf:** Wähle per Klick, welche Screens die Musik ausgeben. Alle gewählten Screens spielen **synchron** dieselbe Stelle, Radio läuft live. ♪ bedeutet „läuft“, ⚠ „Ton blockiert – am Gerät einmal tippen“.
- **Bei Video mit Ton** (auf irgendeinem Screen): *leiser weiterspielen* auf einstellbare % (Standard 20 %), *pausieren* (setzt danach an derselben Stelle fort) oder *nichts ändern*. Eine Änderung gilt sofort, auch für das gerade laufende Video.
  - Folgt auf ein Video mit Ton direkt das nächste, bleibt die Musik durchgehend leiser bzw. pausiert. Erst nach kurzer Wartezeit (1,5 s) wird sie wieder lauter.
  - Videos **ohne Tonspur** zählen nicht. Die Screens erkennen das beim ersten Abspielen, danach wird die Musik bei diesem Video gar nicht erst leiser.
- **In der Screen-Liste** hat jeder Screen neben dem Video-Ton (🔊) einen **🎵-Knopf**: Musik auf diesem Screen an/aus, mit eigenem Lautstärkeregler. Ist die Musik am Screen stumm geschaltet, zeigt der Knopf 🔇, ein Klick schaltet sie wieder ein.
- **Am Screen** (Menü): **Video-Ton** und **Musik** lassen sich getrennt stumm schalten (🔈) und in der Lautstärke regeln. Die Musiklautstärke gilt relativ zur Gesamtlautstärke und nur für diesen Screen. Die Verwaltung zeigt das an (🔇 am Chip bzw. „Musik stumm (am Screen)“).
- Wie bei Videos erlauben Browser Ton erst nach einer Berührung am Gerät (oder Kiosk-Start mit `--autoplay-policy=no-user-gesture-required`).
- Spotify ist noch nicht eingebunden (geplant: Steuerung von Spotify-Connect-Geräten, braucht Spotify Premium).

## Bildqualität (⚙ Einstellungen)

**Bildqualität für Screens** verkleinert Bilder vor der Übertragung: *Original*, *4K* (max. 3840 px), *Full HD* (1920 px), *HD* (1280 px) oder *Niedrig* (960 px), jeweils neu komprimiert. Das spart Ladezeit und Datenmenge, z. B. bei Fotos vom Netzlaufwerk oder bei Tablets im WLAN.
- Die Einstellung ist die **Vorgabe**. Pro Screen lässt sich eine eigene Stufe wählen: in der Screen-Liste („Bildqualität“, in der Kompaktansicht unter ▾) oder direkt am Screen im Menü. „Standard (…)“ übernimmt die Vorgabe.
- Die verkleinerte Fassung wird beim ersten Abruf erzeugt und in `data/cache` gespeichert. Die Originaldateien bleiben unverändert.
- Darunter steht, wie groß der **Zwischenspeicher** ist (Anzahl, Größe). **Leeren** löscht alle verkleinerten Bilder, bei Bedarf werden sie neu erzeugt.
- Der Download im Screen-Menü liefert immer das Original.
- **Vorschaubilder in der Verwaltung** (Playlist, Medienliste, Standbild) sind immer klein (320 px, wenige KB) und liegen ebenfalls im Zwischenspeicher. Große Fotos in den Listen kosten so kaum Ladezeit, unabhängig von der Einstellung oben.
- Bilder mit Transparenz werden als WebP gespeichert, alle anderen als JPEG. Videos, animierte GIFs und SVGs bleiben unverändert.
- Technik: Bibliothek [sharp](https://sharp.pixelplumbing.com/). Nach einem Update deshalb einmal `npm install` ausführen.

## Zugriffsschutz (⚙ Einstellungen)

Oben rechts unter **⚙ Einstellungen** lässt sich je eine PIN für die **Verwaltung** und für die **Screens** setzen. Standardmäßig ist keine gesetzt, dann ist alles frei erreichbar.

- **🎲 Generieren** erzeugt eine zufällige 6-stellige PIN. Mit **Speichern** wird sie aktiv, **Entfernen** hebt den Schutz wieder auf.
- Mit PIN fragt die Seite einmal danach. Das Gerät bleibt danach angemeldet (Cookie), bis sich die PIN ändert.
- **Verwaltung:** Die Verwaltung, die die PIN setzt, bleibt angemeldet. Alle anderen müssen sie eingeben. „Abmelden“ steht oben rechts.
- **Screens:** Bereits verbundene Screens bleiben angemeldet. Neue Geräte fragen nach der PIN, Kiosk-Geräte bekommen sie über die Adresse: `/screen?pin=123456`. Eine angemeldete Verwaltung darf auch Screen-Inhalte sehen.
- Gespeichert wird nur ein Prüfwert, nicht die PIN selbst. Nach 5 Fehlversuchen ist die IP eine Minute gesperrt.
- **PIN vergessen:** Server stoppen, in `data/state.json` unter `"auth"` den Eintrag `"admin"` bzw. `"screen"` löschen und neu starten.

## Hinweise

- Ohne PIN ist die Verwaltung frei erreichbar. Auch mit PIN läuft alles unverschlüsselt über http, deshalb nur im lokalen Netz betreiben.
- Ton gibt es nur bei Screens mit „🔊 Ton an“ (siehe oben).
- Viele Webseiten verbieten die Einbettung per iframe (`X-Frame-Options`). Diese bleiben dann leer.
- Damit die Geräte nicht in den Standby gehen, die Bildschirmsperre am Gerät deaktivieren oder den Kiosk-Modus nutzen. Die Wake-Lock-API funktioniert nur über https oder localhost.
