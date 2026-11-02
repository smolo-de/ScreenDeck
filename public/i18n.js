// Sprache der Oberfläche: Deutsch (Quelltext) oder Englisch.
// Die Seiten sind auf Deutsch geschrieben; im englischen Modus übersetzt dieses Skript alle
// sichtbaren Texte (Textknoten, title/placeholder/aria-label), Meldungen und Rückfragen
// anhand des Wörterbuchs unten. Platzhalter {0}, {1} … stehen für eingesetzte Werte
// (Namen, Zahlen) – sie werden selbst wieder übersetzt, falls sie bekannte Texte sind.
// Wahl: ?lang=de|en in der Adresse, sonst gespeicherte Wahl, sonst Sprache des Browsers.

(function () {
  const LANGS = ['de', 'en'];
  const KEY = 'screendeck-lang';
  let lang = new URLSearchParams(location.search).get('lang');
  try {
    if (LANGS.includes(lang)) localStorage.setItem(KEY, lang);
    else lang = localStorage.getItem(KEY);
  } catch {}
  if (!LANGS.includes(lang)) {
    lang = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
  }
  document.documentElement.lang = lang;

  // Deutsch → Englisch. Ein Array als Übersetzung = [Einzahl, Mehrzahl] je nach erster Zahl.
  const EN = [
    // --- Allgemein -----------------------------------------------------------
    ['Abbrechen', 'Cancel'],
    ['Abspielen', 'Play'],
    ['Aktivieren', 'Enable'],
    ['Alle', 'All'],
    ['alle', 'every'],
    ['auf', 'at'],
    ['Bild', 'Image'],
    ['Bilder', 'Images'],
    ['Dunkel', 'Dark'],
    ['dunkel', 'dark'],
    ['Entfernen', 'Remove'],
    ['Farbe', 'Color'],
    ['Fehler', 'Error'],
    ['Fehler {0}', 'Error {0}'],
    ['Fehler: {0}', 'Error: {0}'],
    ['Hinzufügen', 'Add'],
    ['Leeren', 'Clear'],
    ['leeren', 'clear'],
    ['leer', 'empty'],
    ['Löschen', 'Delete'],
    ['Musik', 'Music'],
    ['Pause', 'Pause'],
    ['Schließen', 'Close'],
    ['Sek.', 'sec'],
    ['Speichern', 'Save'],
    ['Text', 'Text'],
    ['Texte', 'Texts'],
    ['Video', 'Video'],
    ['Videos', 'Videos'],
    ['Webseite', 'Web page'],
    ['Webseiten', 'Web pages'],
    ['Weiter', 'Next'],
    ['zurück', 'back'],
    ['Medien', 'Media'],
    ['Nicht gefunden', 'Not found'],
    ['Ungültig', 'Invalid'],
    ['unbekannt', 'unknown'],
    ['Strg+C', 'Ctrl+C'],
    ['Deaktivieren', 'Disable'],
    ['Aktiv', 'Enabled'],
    ['Deaktiviert', 'Disabled'],
    ['(deaktiviert)', '(disabled)'],
    ['Countdown', 'Countdown'],
    ['Schrift', 'Font'],
    ['Schriftfarbe', 'Text color'],
    ['Ecken', 'Corners'],
    ['Hintergrund', 'Background'],
    ['Anzeigedauer', 'Duration'],
    ['Position', 'Position'],
    ['Oben', 'Top'],
    ['Mitte', 'Center'],
    ['Unten', 'Bottom'],
    ['Bild-Ecken', 'Image corners'],
    ['nichts', 'nothing'],
    ['jetzt', 'now'],
    ['fest', 'fixed'],
    ['doppelt', 'duplicate'],
    ['Standard', 'Default'],
    ['Standard ({0})', 'Default ({0})'],
    ['Niedrig', 'Low'],
    ['Original (unverändert)', 'Original (unchanged)'],
    ['Niedrig – max. 960 px, 60 %', 'Low – max. 960 px, 60 %'],
    ['{0} (Kopie)', '{0} (copy)'],
    ['{0} (eigenes)', '{0} (own)'],
    ['Verbinde', 'Connecting'],
    ['Live verbunden', 'Live connected'],
    ['Getrennt – verbinde neu', 'Disconnected – reconnecting'],
    ['Neue Version verfügbar – Seite bitte neu laden', 'New version available – please reload the page'],

    // --- Schriften und Ecken (fonts.js) ---------------------------------------
    ['Schreibmaschine', 'Typewriter'],
    ['Plakativ (Impact)', 'Bold (Impact)'],
    ['Locker (Comic)', 'Casual (Comic)'],
    ['Pacifico (Schreibschrift)', 'Pacifico (script)'],
    ['Special Elite (alt)', 'Special Elite (vintage)'],
    ['Eckig', 'Square'],
    ['Weich', 'Soft'],
    ['Stark weich', 'Extra soft'],

    // --- Kopfzeile, Einstellungen ------------------------------------------------
    ['ScreenDeck Verwaltung', 'ScreenDeck Admin'],
    ['Verwaltung', 'Admin'],
    ['Screens', 'Screens'],
    ['Einstellungen', 'Settings'],
    ['Einstellungen: PIN für Verwaltung und Screens', 'Settings: PIN for admin and screens'],
    ['Verwaltung abmelden', 'Log out of the admin'],
    ['Abmelden', 'Log out'],
    ['Menü beim Antippen eines Screens anzeigen (Name/ID, Vollbild beenden, Neu laden)', 'Show a menu when a screen is tapped (name/ID, exit full screen, reload)'],
    ['Ausgeschaltet schaltet Antippen nur in den Vollbildmodus, z. B. für öffentlich zugängliche Touch-Screens.', 'When off, tapping only switches to full screen, e.g. for public touch screens.'],
    ['Zoomen per Fingergeste auf Touch-Screens (zwei Finger, Doppeltippen)', 'Zoom with finger gestures on touch screens (two fingers, double tap)'],
    ['Bilder und Texte lassen sich vergrößern und verschieben. Solange vergrößert ist, hält der Screen den Inhalt an. Nach 60 s ohne Berührung oder beim nächsten Inhalt geht es normal weiter.',
      'Images and texts can be enlarged and moved. While zoomed in, the screen holds the content. After 60 s without touch or with the next content it continues as normal.'],
    ['Name im Netzwerk', 'Network name'],
    ['Geräte im selben Netzwerk erreichen den Server unter diesem Namen statt über die IP-Adresse. Das klappt mit Windows, macOS, iPhone/iPad und neueren Android-Geräten. Manche ältere Android-Fernseher kennen solche Namen nicht, dort die IP-Adresse verwenden. Leer = aus.',
      'Devices on the same network reach the server under this name instead of the IP address. This works with Windows, macOS, iPhone/iPad and newer Android devices. Some older Android TVs do not know such names; use the IP address there. Empty = off.'],
    ['Bildqualität für Screens', 'Image quality for screens'],
    ['Bilder vor der Übertragung an die Screens verkleinern', 'Downscale images before sending them to the screens'],
    ['Zwischenspeicher:', 'Cache:'],
    // Einstellungen als Overlay
    ['Netzwerk', 'Network'],
    ['Schließen (Esc)', 'Close (Esc)'],
    ['Menü beim Antippen', 'Menu on tap'],
    ['Name/ID, Vollbild, Ton, Fernsteuerung, Neu laden. Ausgeschaltet schaltet Antippen nur in den Vollbildmodus, z. B. für öffentlich zugängliche Touch-Screens.', 'Name/ID, full screen, sound, remote control, reload. When off, tapping only switches to full screen, e.g. for public touch screens.'],
    ['Zoomen per Fingergeste', 'Zoom with finger gestures'],
    ['Vorgabe für alle Screens', 'Default for all screens'],
    ['Pro Screen abweichend einstellbar (in der Screen-Liste oder im Menü am Screen).', 'Can be set differently per screen (in the screen list or in the menu on the screen).'],
    ['Zwischenspeicher', 'Cache'],
    ['Belegt:', 'Used:'],
    ['Verkleinert und komprimiert Bilder, bevor sie an die Screens gehen – spart Ladezeit und Datenmenge (z. B. Fotos vom Netzlaufwerk oder WLAN-Tablets). Die Fassung wird beim ersten Abruf erzeugt und zwischengespeichert, die Originaldateien bleiben unverändert. Videos, GIFs und SVGs werden nicht verändert.', 'Downsizes and compresses images before they are sent to the screens – saves loading time and data (e.g. photos from a network drive or Wi-Fi tablets). The version is created on first request and cached; the original files stay unchanged. Videos, GIFs and SVGs are not changed.'],
    ['Auto-Wechsel', 'Auto switch'],
    ['Erklärung ein-/ausblenden', 'Show/hide explanation'],
    ['Anzeigedauer für Bilder, Webseiten und Texte', 'Display time for images, web pages and texts'],
    ['Aktuelle Position', 'Current position'],
    // Smartphone als Fernbedienung: Playlist, Hochladen, Kopplung
    ['Playlist: Eintrag antippen und zeigen', 'Playlist: tap an entry to show it'],
    ['Playlist wechseln – läuft sofort auf den gesteuerten Screens, Hochladen landet darin', 'Switch playlist – plays on the controlled screens right away, uploads go into it'],
    ['Neue Playlist anlegen – Hochgeladenes landet direkt darin', 'Create a new playlist – uploads go straight into it'],
    ['Neu', 'New'],
    ['Name der neuen Playlist', 'Name of the new playlist'],
    ['Noch leer – mit ⤒ Fotos, Videos oder Musik hochladen.', 'Still empty – upload photos, videos or music with ⤒.'],
    ['Fotos, Videos oder Musik von diesem Gerät hochladen', 'Upload photos, videos or music from this device'],
    ['{0} Einträge', ['{0} entry', '{0} entries']],
    ['1 Eintrag', '1 entry'],
    // Löschen in der Fernbedienung
    ['Einträge löschen: antippen zum Auswählen', 'Delete entries: tap to select'],
    ['Zum Löschen antippen', 'Tap to select for deletion'],
    ['Löschen ({0})', 'Delete ({0})'],
    ['Fertig', 'Done'],
    ['1 Eintrag aus der Playlist löschen?', 'Delete 1 entry from the playlist?'],
    ['{0} gelöscht', '{0} deleted'],
    ['Hochgeladene Dateien werden mitgelöscht, sofern keine andere Playlist sie verwendet. Dateien aus Medienordnern bleiben erhalten.',
      'Uploaded files are deleted too unless another playlist uses them. Files from media folders are kept.'],
    ['{0} Dateien', ['{0} file', '{0} files']],
    ['Lade hoch: {0}', 'Uploading: {0}'],
    ['Hochladen fehlgeschlagen', 'Upload failed'],
    ['{0} neu', '{0} new'],
    ['{0} Musik', '{0} music'],
    ['{0} schon vorhanden', '{0} already there'],
    ['Nichts hochgeladen', 'Nothing uploaded'],
    ['Nur während der Fernsteuerung', 'Only during remote control'],
    ['Smartphone als Fernbedienung', 'Smartphone as remote control'],
    ['Smartphone koppeln', 'Pair smartphone'],
    ['QR-Code: ein Smartphone wird sofort Fernbedienung (weiterschalten, Playlist, Fotos/Videos/Musik hochladen)', 'QR code: a smartphone instantly becomes a remote control (switch, playlist, upload photos/videos/music)'],
    ['Scannen – das Smartphone steuert sofort alle verbundenen Screens: weiterschalten, Playlist mit Vorschaubildern, Fotos, Videos und Musik aus der Galerie hochladen.',
      'Scan it – the smartphone instantly controls all connected screens: switch, playlist with previews, upload photos, videos and music from the gallery.'],
    ['Wer diesen Code hat, kann fernsteuern und hochladen. Nur zeigen, wem du das erlaubst – erneuern unter ⚙ Einstellungen → Screens.',
      'Anyone with this code can control and upload. Only show it to people you allow – renew it under ⚙ Settings → Screens.'],
    ['Mit der Kamera des Smartphones scannen.', 'Scan with the smartphone camera.'],
    ['Per QR-Code gekoppelte Geräte dürfen sofort fernsteuern und Fotos, Videos und Musik hochladen – ohne Freischaltung in der Screen-Liste. „Neuer Code“ macht den bisherigen ungültig; bereits gekoppelte Geräte behalten ihre Freigabe (in der Screen-Liste sperrbar).',
      'Devices paired via QR code may control and upload photos, videos and music right away – without enabling them in the screen list. “New code” invalidates the previous one; already paired devices keep their permission (can be blocked in the screen list).'],
    ['Neuer Code', 'New code'],
    ['Neuen Kopplungs-Code erzeugen?\n\nDer bisherige QR-Code funktioniert danach nicht mehr. Bereits gekoppelte Smartphones bleiben freigeschaltet.',
      'Create a new pairing code?\n\nThe previous QR code will stop working. Already paired smartphones stay enabled.'],
    ['Neuer Kopplungs-Code erzeugt', 'New pairing code created'],
    // Netzwerk → Ports
    ['Ports', 'Ports'],
    ['Zusätzlicher Port', 'Additional port'],
    ['80 = Adressen ganz ohne Portangabe. Ist Port 80 belegt oder nicht erlaubt, einen anderen freien Port wählen (z. B. 8080). 0 = aus. Wirkt sofort.',
      '80 = addresses without any port. If port 80 is in use or not permitted, choose another free port (e.g. 8080). 0 = off. Takes effect immediately.'],
    ['Hauptport', 'Main port'],
    ['Unter diesem Port ist der Server immer erreichbar (Standard 3000). Änderung wirkt nach einem Neustart des Servers.',
      'The server is always reachable on this port (default 3000). A change takes effect after restarting the server.'],
    ['Festgelegt durch die Umgebungsvariable PORT ({0}).', 'Set by the PORT environment variable ({0}).'],
    ['Festgelegt durch die Umgebungsvariable EXTRA_PORT', 'Set by the EXTRA_PORT environment variable'],
    ['Läuft noch auf {0} – {1} gilt nach einem Neustart des Servers.', 'Still running on {0} – {1} applies after restarting the server.'],
    ['Läuft auf Port {0}', 'Running on port {0}'],
    ['Aus – Adressen mit :{0}', 'Off – addresses use :{0}'],
    ['Gleich dem Hauptport – kein zusätzlicher Port nötig.', 'Same as the main port – no additional port needed.'],
    ['Aktiv – Adressen ohne Portangabe', 'Active – addresses without a port'],
    ['Aktiv – Adressen mit :{0}', 'Active – addresses use :{0}'],
    ['Port {0} {1} – Adressen laufen über :{2}. Anderen Port wählen, z. B. 8080.', 'Port {0} {1} – addresses use :{2}. Choose another port, e.g. 8080.'],
    ['ist schon belegt', 'is already in use'],
    ['ist nicht erlaubt (Berechtigung)', 'is not permitted (permission)'],
    ['Ungültiger Port (1–65535)', 'Invalid port (1–65535)'],
    ['Ungültiger Port (0–65535, 0 = aus)', 'Invalid port (0–65535, 0 = off)'],
    // Medienquellen: Anmeldung an Netzwerkfreigaben
    ['Anmeldung (optional)', 'Sign-in (optional)'],
    // Ordner-Browser beim Einbinden
    ['Durchsuchen', 'Browse'],
    ['Ordner suchen: Laufwerke oder \\\\Server eingeben, dann Freigaben und Ordner durchklicken', 'Find a folder: drives, or enter \\\\Server and click through shares and folders'],
    ['Übergeordneter Ordner', 'Parent folder'],
    ['Diesen Ordner wählen', 'Choose this folder'],
    ['Laufwerke', 'Drives'],
    ['Lade', 'Loading'],
    ['Keine Freigaben gefunden', 'No shares found'],
    ['Keine Unterordner – diesen Ordner wählen oder zurück', 'No subfolders – choose this folder or go back'],
    ['Keine Laufwerke gefunden', 'No drives found'],
    ['Ordner nicht gefunden', 'Folder not found'],
    ['Kein Zugriff – ggf. Benutzer und Kennwort angeben', 'No access – enter user and password if needed'],
    ['Nicht erreichbar: {0}', 'Not reachable: {0}'],
    ['Freigaben auflisten geht nur unter Windows – den Pfad bitte direkt eingeben', 'Listing shares only works on Windows – please enter the path directly'],
    // Satz ist durch <code> in Stücke geteilt
    ['Netzwerk: oben', 'Network: enter'],
    ['(z. B.', '(e.g.'],
    [') eingeben und „Durchsuchen“ – dann erscheinen die Freigaben. Braucht der Server eine Anmeldung, vorher Benutzer und Kennwort angeben.',
      ') above and click “Browse” – the shares appear. If the server needs a sign-in, enter user and password first.'],
    ['Benutzer, z. B. NAS\\max', 'User, e.g. NAS\\max'],
    ['Kennwort', 'Password'],
    ['Kennwort (neu eingeben)', 'Password (enter again)'],
    ['Anmeldung an der Freigabe (Benutzer, Kennwort)', 'Sign-in for the share (user, password)'],
    ['Anmeldung an der Freigabe', 'Sign-in for the share'],
    ['Angemeldet als „{0}“', 'Signed in as “{0}”'],
    ['Anmeldung entfernt', 'Sign-in removed'],
    ['Bitte einen Benutzer eingeben', 'Please enter a user'],
    ['Braucht die Freigabe eine Anmeldung, Benutzer und Kennwort angeben (bei bestehenden Quellen über 🔑). Der Server meldet sich damit an, das Kennwort wird verschlüsselt mit dem Windows-Konto des Servers gespeichert und nie angezeigt. Windows erlaubt je Server nur eine Anmeldung: Alle Freigaben desselben Servers nutzen denselben Benutzer.',
      'If the share requires a sign-in, enter user and password (for existing sources via 🔑). The server signs in with them; the password is stored encrypted with the server’s Windows account and never shown. Windows allows only one sign-in per server: all shares on the same server use the same user.'],
    ['Anmeldung fehlgeschlagen: Benutzername oder Kennwort falsch', 'Sign-in failed: wrong user name or password'],
    ['Server oder Freigabe nicht gefunden', 'Server or share not found'],
    ['Zugriff verweigert', 'Access denied'],
    ['Zu dieser Freigabe besteht schon eine Verbindung mit anderem Benutzer (Windows erlaubt nur einen je Server). Bestehende Verbindung trennen oder dieselbe Anmeldung verwenden.',
      'There is already a connection to this share with a different user (Windows allows only one per server). Disconnect it or use the same sign-in.'],
    ['Gespeichertes Kennwort kann nicht entschlüsselt werden (anderes Windows-Konto?) – bitte neu eingeben', 'The stored password cannot be decrypted (different Windows account?) – please enter it again'],
    ['Anmeldung an Netzwerkfreigaben wird nur unter Windows unterstützt – die Freigabe bitte im System einbinden', 'Signing in to network shares is only supported on Windows – please mount the share in the system'],
    ['Eine Anmeldung ist nur für Netzwerkpfade (\\\\Server\\Freigabe) möglich', 'A sign-in is only possible for network paths (\\\\Server\\Share)'],
    ['Anmeldung an der Freigabe fehlgeschlagen: {0}', 'Signing in to the share failed: {0}'],
    ['Kennwort konnte nicht verschlüsselt werden: {0}', 'The password could not be encrypted: {0}'],
    ['Weiter ⏭', 'Next ⏭'],
    ['Nächster Wechsel: alle Screens jetzt weiterschalten', 'Next switch: advance all screens now'],
    ['Zum Eintrag springen, der gerade angezeigt wird', 'Jump to the entry that is currently shown'],
    ['Wird gerade angezeigt auf: {0}', 'Currently shown on: {0}'],
    ['Kein angezeigter Eintrag in der aktuellen Ansicht (Filter?)', 'No shown entry in the current view (filter?)'],
    ['Neu ermitteln', 'Refresh'],
    ['Alle verkleinerten Bilder löschen – sie werden bei Bedarf neu erzeugt', 'Delete all downscaled images – they are recreated when needed'],
    ['Vorgabe für alle Screens – pro Screen abweichend einstellbar (in der Screen-Liste oder im Menü am Screen). Verkleinert und komprimiert Bilder, bevor sie an die Screens gehen – spart Ladezeit und Datenmenge (z. B. Fotos vom Netzlaufwerk oder WLAN-Tablets). Die Fassung wird beim ersten Abruf erzeugt und zwischengespeichert, die Originaldateien bleiben unverändert. Videos, GIFs und SVGs werden nicht verändert.',
      'Default for all screens – can be changed per screen (in the screen list or in the menu on the screen). Downscales and compresses images before they go to the screens – saves loading time and data (e.g. photos from a network drive or Wi-Fi tablets). The reduced version is created on first request and cached, the original files stay unchanged. Videos, GIFs and SVGs are not changed.'],
    ['Medienquellen', 'Media sources'],
    ['Ordner, deren Bilder und Videos unter „Medien“ erscheinen: lokale Ordner, Netzlaufwerke (z. B.', 'Folders whose images and videos appear under “Media”: local folders, network drives (e.g.'],
    [') oder Netzwerkpfade (z. B.', ') or network paths (e.g.'],
    ['). Abgespielt wird direkt von dort, nichts wird kopiert.', '). Files play directly from there, nothing is copied.'],
    ['Name (optional)', 'Name (optional)'],
    [String.raw`Pfad, z. B. \\NAS\Videos oder D:\Medien`, String.raw`Path, e.g. \\NAS\Videos or D:\Media`],
    ['Einbinden', 'Add'],
    ['Prüfe', 'Checking'],
    ['Netzlaufwerke müssen für das Benutzerkonto erreichbar sein, unter dem der Server läuft. Läuft der Server als Dienst oder „als Administrator“, sind verbundene Laufwerksbuchstaben oft nicht sichtbar – dann den Netzwerkpfad (',
      'Network drives must be reachable for the user account the server runs under. If the server runs as a service or “as administrator”, mapped drive letters are often not visible – then use the network path ('],
    [') verwenden.', ').'],
    ['Zugriffsschutz', 'Access protection'],
    ['Standardmäßig ist nichts geschützt. Mit einer PIN fragt die Seite einmal danach, das Gerät bleibt danach angemeldet. Eine leere PIN bzw. „Entfernen“ hebt den Schutz wieder auf.',
      'Nothing is protected by default. With a PIN, the page asks for it once and the device then stays signed in. An empty PIN or “Remove” lifts the protection again.'],
    ['Neue PIN (4–32 Zeichen)', 'New PIN (4–32 characters)'],
    ['Zufällige 6-stellige PIN erzeugen', 'Generate a random 6-digit PIN'],
    ['Generieren', 'Generate'],
    ['PIN gut notieren! Wer sie nicht kennt, kommt nicht mehr in die Verwaltung. Notfalls in', 'Write the PIN down! Without it there is no way back into the admin. If needed, in'],
    ['den Eintrag', 'delete the entry'],
    ['unter', 'under'],
    ['löschen und den Server neu starten.', 'and restart the server.'],
    ['Bereits verbundene Screens bleiben angemeldet. Neue Geräte fragen einmal nach der PIN. Für Kiosk-Geräte geht es auch direkt über die Adresse:',
      'Screens that are already connected stay signed in. New devices ask for the PIN once. Kiosk devices can also use the address directly:'],
    ['PIN gesetzt', 'PIN set'],
    ['kein Schutz', 'no protection'],
    ['Quelle entfernen (Dateien bleiben unberührt)', 'Remove source (files stay untouched)'],
    ['Keine Medienquelle eingebunden – nur hochgeladene Dateien.', 'No media source added – uploaded files only.'],
    ['Bitte einen Pfad eingeben', 'Please enter a path'],
    ['„{0}“ eingebunden', '“{0}” added'],
    ['Medienquelle „{0}“ entfernen?\n\nDie Dateien im Ordner bleiben unberührt, Einträge in der Playlist auch.', 'Remove media source “{0}”?\n\nThe files in the folder stay untouched, and so do the playlist entries.'],
    ['Screens bekommen Bilder in Originalqualität', 'Screens get images in original quality'],
    ['Bilder werden für die Screens auf „{0}“ reduziert', 'Images are reduced to “{0}” for the screens'],
    ['Die PIN muss mindestens 4 Zeichen lang sein', 'The PIN must be at least 4 characters long'],
    ['PIN für die Verwaltung auf „{0}“ setzen?\n\nBitte notieren – ohne sie kommst du nicht mehr in die Verwaltung.', 'Set the admin PIN to “{0}”?\n\nPlease write it down – without it you can no longer get into the admin.'],
    ['PIN für {0} gespeichert: {1}', 'PIN for {0} saved: {1}'],
    ['PIN für {0} entfernen? Danach ist der Bereich ohne PIN erreichbar.', 'Remove the PIN for {0}? The area will then be accessible without a PIN.'],
    ['PIN für {0} entfernen?\n\nDanach ist der Bereich ohne PIN erreichbar.', 'Remove the PIN for {0}?\n\nThe area will then be accessible without a PIN.'],
    // Knöpfe der eigenen Dialoge
    ['Anlegen', 'Create'],
    ['Duplizieren', 'Duplicate'],
    ['Umbenennen', 'Rename'],
    ['Alle entfernen', 'Remove all'],
    ['PIN setzen', 'Set PIN'],
    ['{0} Dateien hinzufügen?\n\n{1} Audiodateien kommen in die Musikliste.', 'Add {0} files?\n\n{1} audio files go to the music list.'],
    ['Schutz für {0} aufgehoben', 'Protection for {0} removed'],
    ['{0} Bild, {1}', '{0} image, {1}'],
    ['{0} Bilder, {1}', '{0} images, {1}'],
    ['Zwischenspeicher leeren?\n\nDie verkleinerten Bilder werden gelöscht und beim nächsten Abruf neu erzeugt. Originaldateien bleiben unverändert.',
      'Clear the cache?\n\nThe downscaled images are deleted and recreated the next time they are requested. Original files stay unchanged.'],
    ['Zwischenspeicher geleert: {0} Bilder, {1} freigegeben', 'Cache cleared: {0} images, {1} freed'],
    ['⚠ Der Server-Code wurde aktualisiert, läuft aber noch in der alten Version. Bitte den Server neu starten (im Konsolenfenster', '⚠ The server code was updated, but the old version is still running. Please restart the server (in the console window'],
    [', dann', ', then'],
    ['). Bis dahin funktionieren neue Funktionen evtl. nicht.', '). Until then, new features may not work.'],

    // --- Steuerung ------------------------------------------------------------------
    ['Verteilung', 'Distribution'],
    ['Der Reihe nach', 'In order'],
    ['Zufall', 'Random'],
    ['Alle gleich', 'All the same'],
    ['Alle Screens zeigen denselben Inhalt, Videos laufen synchron', 'All screens show the same content, videos play in sync'],
    ['Bilder, Webseiten und Texte ohne eigene Anzeigedauer stehen so lange. Videos laufen immer bis zum Ende.', 'Images, web pages and texts without their own duration stay this long. Videos always play to the end.'],
    ['Automatisch wechseln (Bilder & Texte)', 'Switch automatically (images & texts)'],
    ['Nächster Wechsel', 'Next switch'],
    ['nächster in {0}', 'next in {0}'],
    ['Alle Screens', 'All screens'],
    ['Alle abspielen', 'Play all'],
    ['Alle pausieren', 'Pause all'],
    ['Alle zeigen ihr Standbild', 'All show their standby image'],
    ['Alle dunkel schalten', 'Turn all dark'],
    // Verteilung: was die Screens zeigen × Reihenfolge
    ['Verschieden', 'Different'],
    ['Was zeigen die Screens?', 'What do the screens show?'],
    ['In welcher Reihenfolge geht es durch die Playlist?', 'In which order does it go through the playlist?'],
    ['Jeder Screen zeigt einen anderen Eintrag der Playlist', 'Each screen shows a different playlist entry'],
    ['Der Reihe nach durch die Playlist', 'Through the playlist in order'],
    ['Zufällige Einträge der Playlist', 'Random playlist entries'],
    ['Auto alle', 'Auto every'],
    ['Automatisch wechseln', 'Switch automatically'],
    ['Automatisch wechseln: Bilder, Webseiten und Texte ohne eigene Anzeigedauer stehen so lange. Videos laufen immer bis zum Ende.',
      'Switch automatically: images, web pages and texts without their own display time stay this long. Videos always play to the end.'],
    ['Alle gleich, Zufall: Alle Screens zeigen denselben Inhalt, bei jedem Wechsel einen zufälligen Eintrag der Playlist (nicht zweimal hintereinander denselben).',
      'All the same, random: all screens show the same content, a random playlist entry at every switch (never the same one twice in a row).'],
    ['Alle gleich, der Reihe nach: Alle Screens zeigen denselben Inhalt und gehen gemeinsam Eintrag für Eintrag durch die Playlist.',
      'All the same, in order: all screens show the same content and go through the playlist together, entry by entry.'],
    ['Verschieden, Zufall: Jeder Screen bekommt einen zufälligen Eintrag – möglichst ohne Doppelungen und ohne Wiederholung des vorherigen Inhalts.',
      'Different, random: every screen gets a random entry – avoiding duplicates and repeats of the previous content where possible.'],
    ['Verschieden, der Reihe nach: Screen 1 zeigt Eintrag 1, Screen 2 Eintrag 2 usw. Bei jedem Wechsel rückt die Playlist um eine Position weiter.',
      'Different, in order: screen 1 shows entry 1, screen 2 entry 2 and so on. With every switch the playlist moves on by one position.'],
    ['Videos starten gemeinsam und laufen synchron. Weiter, Warteschlange und Springen im Video gelten für alle zusammen.',
      'Videos start together and play in sync. Next, queue and seeking apply to all of them together.'],
    ['Fest zugeordnete Screens bleiben unverändert.', 'Screens with a fixed entry stay unchanged.'],

    // --- Screens ---------------------------------------------------------------------
    ['Kompakt', 'Compact'],
    ['Kompakte Ansicht: eine kurze Zeile pro Screen, Details per ▾', 'Compact view: one short line per screen, details via ▾'],
    ['Alle Screens aus der Liste entfernen', 'Remove all screens from the list'],
    ['Alle löschen', 'Delete all'],
    ['Auf jedem Gerät im Browser öffnen:', 'Open in the browser on each device:'],
    ['Optional mit Namen, z. B.', 'Optionally with a name, e.g.'],
    ['. Reihenfolge per Ziehen am ⋮⋮ ändern.', '. Drag ⋮⋮ to change the order.'],
    ['Noch keine Screens verbunden.', 'No screens connected yet.'],
    ['Öffne die Screen-URL auf einem Tablet oder Beamer.', 'Open the screen URL on a tablet or projector.'],
    ['Ziehen zum Sortieren', 'Drag to reorder'],
    ['Name ändern', 'Rename'],
    ['offline · zuletzt {0}', 'offline · last seen {0}'],
    ['gerade eben', 'just now'],
    ['vor {0} Min.', ['{0} min ago', '{0} min ago']],
    ['vor {0} Std.', ['{0} h ago', '{0} h ago']],
    ['Abspielen', 'Play'],
    ['Pausieren – Inhalt bleibt stehen', 'Pause – content stays on screen'],
    ['Standbild dieses Screens zeigen', "Show this screen's standby image"],
    ['Dunkel schalten', 'Turn dark'],
    ['Am Screen über das Menü angehalten – ▶ setzt fort', 'Paused on the screen via its menu – ▶ resumes'],
    ['Ton an – klicken zum Ausschalten (gilt für Videos)', 'Sound on – click to turn off (applies to videos)'],
    ['Ton aus – klicken zum Einschalten (gilt für Videos)', 'Sound off – click to turn on (applies to videos)'],
    ['Lautstärke', 'Volume'],
    ['Musik aus – klicken, um die Musik auf diesem Screen abzuspielen', 'Music off – click to play music on this screen'],
    ['Musik am Screen stumm geschaltet – klicken zum Einschalten', 'Music muted on the screen – click to unmute'],
    ['Musik an – klicken zum Ausschalten', 'Music on – click to turn off'],
    ['Musiklautstärke auf diesem Screen (relativ zur Gesamtlautstärke)', 'Music volume on this screen (relative to the overall volume)'],
    ['Fest eingestellt – klicken zum Lösen (spielt wieder automatisch aus der Playlist)', 'Pinned – click to unpin (plays automatically from the playlist again)'],
    ['Aktuellen Eintrag auf diesem Screen fest einstellen', 'Pin the current entry on this screen'],
    ['Lösen', 'Unpin'],
    ['Fixieren', 'Pin'],
    ['erneut senden', 'resend'],
    ['Zeigt synchron denselben Inhalt wie die anderen Screens', 'Shows the same content in sync with the other screens'],
    ['Kein Inhalt', 'No content'],
    ['Klicken, um an diese Stelle zu springen', 'Click to jump to this position'],
    ['Inhalt', 'Content'],
    ['Automatisch aus der Playlist oder ein fester Eintrag', 'Automatically from the playlist or a fixed entry'],
    ['Automatisch (Playlist)', 'Automatic (playlist)'],
    ['Fest: {0}', 'Fixed: {0}'],
    ['Bildqualität', 'Image quality'],
    ['Bildqualität für diesen Screen – „Standard“ übernimmt die Einstellung aus ⚙ Einstellungen', 'Image quality for this screen – “Default” uses the setting from ⚙ Settings'],
    ['Standbild', 'Standby image'],
    ['keins', 'none'],
    ['kein Bild', 'no image'],
    ['Eigenes Bild hochladen', 'Upload own image'],
    ['Bild für den Modus „Bild“', 'Image for “Image” mode'],
    ['Standbild: Text & Optionen', 'Standby image: text & options'],
    ["Text im Bild-Modus (optional), z. B. „Gleich geht's weiter“", 'Text in image mode (optional), e.g. “Back in a moment”'],
    ['Standbild hochgeladen', 'Standby image uploaded'],
    ['Upload fehlgeschlagen', 'Upload failed'],
    ['Namen auf dem Screen anzeigen', 'Show the name on the screen'],
    ['Screen neu laden', 'Reload screen'],
    ['Screen entfernen', 'Remove screen'],
    ['Weniger anzeigen', 'Show less'],
    ['Details: Standbild, Ton, Zuordnung, Als Nächstes, Verlauf', 'Details: standby image, sound, assignment, up next, history'],
    ['Diesen Screen aus der Liste entfernen?', 'Remove this screen from the list?'],
    ['„{0}“ ist jetzt fest auf „{1}“', '“{0}” is now pinned on “{1}”'],
    ['„{0}“ spielt wieder automatisch', '“{0}” plays automatically again'],
    ['Alle {0} Screens aus der Liste entfernen?\n\nNamen, Einstellungen und Verlauf gehen verloren. Gerade verbundene Screens melden sich danach automatisch neu an.',
      'Remove all {0} screens from the list?\n\nNames, settings and history are lost. Screens that are currently connected will register again automatically.'],
    ['{0} Screens entfernt', ['{0} screen removed', '{0} screens removed']],

    // Abgleich: was zeigt der Screen wirklich?
    ['wird angezeigt', 'showing'],
    ['Video läuft', 'video playing'],
    ['pausiert', 'paused'],
    ['lädt', 'loading'],
    ['wartet', 'waiting'],
    ['Laden nicht bestätigt', 'loading not confirmed'],
    ['Autoplay blockiert – am Gerät einmal tippen', 'autoplay blocked – tap the device once'],
    ['Autoplay blockiert', 'autoplay blocked'],
    ['Video hängt', 'video stalled'],
    ['wird übertragen', 'sending'],
    ['{0} · Neuversuch {1}', '{0} · retry {1}'],
    ['{0} nicht bestätigt', '{0} not confirmed'],
    ['unbekannter Inhalt', 'unknown content'],
    ['zeigt stattdessen „{0}“', 'shows “{0}” instead'],
    ['keine Rückmeldung', 'no response'],
    ['Standbild (kein Bild gewählt → schwarz)', 'standby image (none chosen → black)'],
    ['Browser erlaubt Ton erst nach einer Berührung', 'The browser only allows sound after a touch'],
    ['Musik blockiert – am Gerät tippen', 'music blocked – tap the device'],
    ['Musik: Fehler', 'music: error'],
    ['Am Screen im Menü stumm geschaltet', 'Muted in the menu on the screen'],
    ['Musik stumm (am Screen)', 'music muted (on the screen)'],
    ['♫ Musik {0} %', '♫ music {0} %'],
    ['Ton läuft', 'sound on'],
    ['Ton blockiert – am Gerät einmal tippen', 'sound blocked – tap the device once'],
    // Fehlermeldungen der Screens
    ['Video-Fehler: {0}', 'video error: {0}'],
    ['abgebrochen', 'aborted'],
    ['Netzwerkfehler', 'network error'],
    ['Dekodierfehler', 'decoding error'],
    ['Format nicht unterstützt', 'format not supported'],
    ['Bild konnte nicht geladen werden', 'image could not be loaded'],
    ['Inhalt konnte nicht geladen werden', 'content could not be loaded'],

    // Als Nächstes, Verlauf
    ['Als Nächstes', 'Up next'],
    ['{0} eingereiht', '{0} queued'],
    ['{0} eingereiht (gemeinsam für alle Sync-Screens)', '{0} queued (shared by all sync screens)'],
    ['Einträge per ＋ in der Playlist oder per Ziehen auf den Screen einreihen', 'Queue entries with ＋ in the playlist or by dragging them onto the screen'],
    ['Diesen Screen sofort weiterschalten', 'Advance this screen now'],
    ['Danach aus der Playlist:', 'Then from the playlist:'],
    ['Nächster aus der Playlist:', 'Next from the playlist:'],
    ['Danach aus der Playlist: {0}', 'Then from the playlist: {0}'],
    ['Nächster aus der Playlist: {0}', 'Next from the playlist: {0}'],
    ['📌 {0} (fest)', '📌 {0} (pinned)'],
    ['zufällig aus der Playlist', 'random from the playlist'],
    ['(voraussichtlich)', '(expected)'],
    ['Sofort abspielen', 'Play now'],
    ['Aus der Warteschlange entfernen', 'Remove from the queue'],
    ['„{0}“ bei „{1}“ eingereiht (Position {2})', '“{0}” queued on “{1}” (position {2})'],
    ['Verlauf ({0})', 'History ({0})'],
    ['Noch nichts angezeigt.', 'Nothing shown yet.'],
    ['angezeigt', 'shown'],
    ['abgespielt', 'played'],
    ['Video hing', 'video stalled'],
    ['läuft', 'running'],
    ['bis zum Ende', 'to the end'],
    // Gründe für einen Wechsel (vom Server)
    ['Warteschlange', 'Queue'],
    ['Neuverteilung', 'Redistribution'],
    ['Manuell', 'Manual'],
    ['Videoende', 'Video ended'],
    ['Zeit abgelaufen', 'Time elapsed'],
    ['Freigabe', 'Unpinned'],
    ['Start', 'Start'],
    ['Timer', 'Timer'],
    ['Sync', 'Sync'],

    // --- Medien hinzufügen ------------------------------------------------------------
    ['Medien hinzufügen', 'Add media'],
    ['Bilder, Videos oder Musik hochladen: hierher ziehen oder', 'Upload images, videos or music: drag them here or'],
    ['auswählen', 'browse'],
    ['Erkannt wird der Inhalt, nicht der Dateiname', 'Detected by content, not by file name'],
    ['Doppelte Dateien beim Upload', 'Duplicate files on upload'],
    ['aussortieren', 'skip'],
    ['trotzdem hinzufügen', 'add anyway'],
    ['Webseite / URL hinzufügen', 'Add web page / URL'],
    ['Titel (optional)', 'Title (optional)'],
    ['Text hinzufügen', 'Add text'],
    ['Text, der auf dem Screen erscheint', 'Text shown on the screen'],
    ['Countdown auf dem Screen anzeigen', 'Show a countdown on the screen'],
    ['Ohne Anzeigedauer gilt die Auto-Zeit (bzw. bis zum nächsten Wechsel). Mit Anzeigedauer bestimmt der Text seine Zeit selbst.', 'Without a duration the auto time applies (or until the next switch). With a duration the text sets its own time.'],
    ['Medienquelle', 'Media source'],
    ['Hochgeladen', 'Uploaded'],
    ['Alle angezeigten Dateien dieses Ordners an die Playlist anhängen', 'Append all listed files of this folder to the playlist'],
    ['Alle hinzufügen', 'Add all'],
    ['Alle hinzufügen ({0})', 'Add all ({0})'],
    ['Ordner neu einlesen', 'Reload folder'],
    ['In diesem Ordner suchen…', 'Search this folder…'],
    ['Dateien in die Playlist ziehen (an die gewünschte Stelle) oder mit ＋ anhängen. Sie werden direkt aus dem Ordner abgespielt, nicht kopiert. Weitere Ordner und Netzlaufwerke einbinden unter ⚙ Einstellungen → Medienquellen.',
      'Drag files into the playlist (to the desired position) or append them with ＋. They play directly from the folder and are not copied. Add more folders and network drives under ⚙ Settings → Media sources.'],
    ['data/uploads · {0} Dateien, neueste zuerst', 'data/uploads · {0} files, newest first'],
    ['In die Musikliste ziehen', 'Drag into the music list'],
    ['in Musik', 'in music'],
    ['An die Musikliste anhängen', 'Append to the music list'],
    ['In die Playlist ziehen', 'Drag into the playlist'],
    ['An die Playlist anhängen', 'Append to the playlist'],
    ['in dieser Playlist', 'in this playlist'],
    ['in „{0}“', 'in “{0}”'],
    ['in „{0}“ +{1}', 'in “{0}” +{1}'],
    ['Ordner unter ⚙ Einstellungen prüfen.', 'Check the folder under ⚙ Settings.'],
    ['Keine Treffer.', 'No matches.'],
    ['Noch nichts hochgeladen.', 'Nothing uploaded yet.'],
    ['Keine Bilder, Videos oder Audiodateien in diesem Ordner.', 'No images, videos or audio files in this folder.'],
    ['Ordner konnte nicht gelesen werden', 'Could not read the folder'],
    ['Schon in der Playlist: {0}', 'Already in the playlist: {0}'],
    ['{0} Datei(en) hinzugefügt', '{0} file(s) added'],
    ['{0} Datei(en) hinzugefügt, {1} schon in der Playlist (übersprungen)', '{0} file(s) added, {1} already in the playlist (skipped)'],
    ['{0} Dateien hinzufügen?', 'Add {0} files?'],
    ['{0} Dateien hinzufügen?\n({1} Audiodateien in die Musikliste)', 'Add {0} files?\n({1} audio files to the music list)'],
    ['Webseite als #{0} hinzugefügt', 'Web page added as #{0}'],
    ['Text „{0}“ hinzugefügt', 'Text “{0}” added'],
    ['Nur Bilder, Videos und Audiodateien werden unterstützt', 'Only images, videos and audio files are supported'],
    ['{0} Datei(en) hochgeladen', '{0} file(s) uploaded'],
    ['{0} Datei(en) hochgeladen · {1} in die Musikliste', '{0} file(s) uploaded · {1} to the music list'],
    ['{0} hochgeladen, {1} doppelt aussortiert: {2}', '{0} uploaded, {1} duplicates skipped: {2}'],
    ['{0} und {1} weitere', '{0} and {1} more'],
    ['Standbild „{0}“', 'Standby image “{0}”'],

    // --- Musik ---------------------------------------------------------------------------
    ['{0} Titel', ['{0} track', '{0} tracks']],
    ['Vorheriger Titel (bzw. an den Anfang)', 'Previous track (or back to the start)'],
    ['Nächster Titel', 'Next track'],
    ['Zufällige Reihenfolge', 'Shuffle'],
    ['Liste wiederholen', 'Repeat list'],
    ['Lautstärke der Musik', 'Music volume'],
    ['Spielt auf', 'Plays on'],
    ['Bei Video mit Ton', 'During video with sound'],
    ['leiser weiterspielen', 'keep playing quieter'],
    ['pausieren', 'pause'],
    ['nichts ändern', 'change nothing'],
    ['Internetradio hinzufügen', 'Add internet radio'],
    ['Stream-Adresse, z. B. https://…/live.mp3', 'Stream URL, e.g. https://…/live.mp3'],
    ['Name des Senders', 'Station name'],
    ['MP3s und andere Audiodateien: unter „Medien“ per ＋ oder hierher ziehen. Hochgeladene Audiodateien landen automatisch hier.', 'MP3s and other audio files: use ＋ under “Media” or drag them here. Uploaded audio files land here automatically.'],
    ['Nichts ausgewählt', 'Nothing selected'],
    ['pausiert – Video mit Ton läuft', 'paused – video with sound playing'],
    ['🔉 leiser ({0} %) – Video mit Ton läuft', '🔉 quieter ({0} %) – video with sound playing'],
    ['Titel unten hinzufügen', 'Add tracks below'],
    ['Internetradio · live', 'Internet radio · live'],
    ['Internetradio', 'Internet radio'],
    ['Audiodatei', 'Audio file'],
    ['{0} · ▶ läuft', '{0} · ▶ playing'],
    ['{0} · ausgewählt', '{0} · selected'],
    ['Pausieren', 'Pause'],
    ['Abspielen – unten mindestens einen Screen wählen', 'Play – choose at least one screen below'],
    ['Klicken: Musik auf diesem Screen abspielen', 'Click: play music on this screen'],
    ['Klicken: Musik auf diesem Screen aus', 'Click: music off on this screen'],
    ['Jetzt abspielen', 'Play now'],
    ['Aus der Musikliste entfernen', 'Remove from the music list'],
    ['Noch keine Musik.', 'No music yet.'],
    ['Audiodateien hochladen, aus „Medien“ hierher ziehen oder ein Internetradio hinzufügen.', 'Upload audio files, drag them here from “Media” or add an internet radio station.'],
    ['Aufklappen', 'Expand'],
    ['Einklappen', 'Collapse'],
    ['{0} Titel in die Musikliste', ['{0} track added to the music list', '{0} tracks added to the music list']],
    ['{0} Titel in die Musikliste, {1} schon vorhanden', ['{0} track added to the music list, {1} already there', '{0} tracks added to the music list, {1} already there']],
    ['Schon in der Musikliste', 'Already in the music list'],
    ['„{0}“ aus der Musikliste entfernen?', 'Remove “{0}” from the music list?'],
    ['Radio „{0}“ hinzugefügt', 'Radio “{0}” added'],

    // --- Playlist ----------------------------------------------------------------------------
    ['Playlist', 'Playlist'],
    ['Playlist zum Anzeigen und Bearbeiten wählen', 'Choose the playlist to view and edit'],
    ['Neue, leere Playlist anlegen', 'Create a new, empty playlist'],
    ['Diese Playlist duplizieren', 'Duplicate this playlist'],
    ['Diese Playlist umbenennen', 'Rename this playlist'],
    ['Diese Playlist löschen', 'Delete this playlist'],
    ['Doppelte Einträge aus der Playlist entfernen (mit Vorschau)', 'Remove duplicate entries from the playlist (with preview)'],
    ['Diese Playlist auf den Screens abspielen', 'Play this playlist on the screens'],
    ['Auf Screens abspielen', 'Play on screens'],
    ['läuft auf den Screens', 'playing on the screens'],
    ['läuft gerade nicht', 'not playing right now'],
    ['Suchen (Titel, Text, URL)…', 'Search (title, text, URL)…'],
    ['Nach Typ filtern', 'Filter by type'],
    ['Alle Typen', 'All types'],
    ['Nach Status filtern', 'Filter by status'],
    ['nur aktive', 'enabled only'],
    ['nur deaktivierte', 'disabled only'],
    ['nur doppelte', 'duplicates only'],
    ['Kompakte Ansicht: eine Zeile pro Eintrag, Details per ▾', 'Compact view: one line per entry, details via ▾'],
    ['Alle angezeigten Einträge auswählen (Shift-Klick auf eine Checkbox wählt einen Bereich)', 'Select all listed entries (Shift-click a checkbox to select a range)'],
    ['Alle auswählen', 'Select all'],
    ['Ausgewählte bei einem Screen einreihen', 'Queue the selected entries on a screen'],
    ['Einreihen bei', 'Queue on'],
    ['{0} aktiv / {1}', '{0} enabled / {1}'],
    ['Gleicher Inhalt wie {0}', 'Same content as {0}'],
    ['🧹 {0} doppelte Einträge entfernen', ['🧹 Remove {0} duplicate entry', '🧹 Remove {0} duplicate entries']],
    ['{0} von {1} angezeigt ·', '{0} of {1} shown ·'],
    ['Filter zurücksetzen', 'Reset filter'],
    ['{0} ausgewählt', '{0} selected'],
    ['{0} ausgewählt (davon {1} ausgeblendet)', '{0} selected ({1} of them hidden)'],
    ['Auswählen (Shift = Bereich)', 'Select (Shift = range)'],
    ['Titel ändern', 'Change title'],
    ['Anzeigedauer in Sekunden – leer = bis zum nächsten Wechsel', 'Duration in seconds – empty = until the next switch'],
    ['Details: Screens, Text-Optionen', 'Details: screens, text options'],
    ['Die Playlist ist leer.', 'The playlist is empty.'],
    ['Füge Bilder, Videos, Webseiten oder Texte hinzu.', 'Add images, videos, web pages or texts.'],
    ['Keine Vorschau möglich', 'No preview available'],
    ['Vorschaubild wird erstellt', 'Creating preview'],
    ['· Vorschaubilder werden erstellt, noch {0}', '· Creating previews, {0} left'],
    ['Bei „{0}“ einreihen', 'Queue on “{0}”'],
    ['Bei „{0}“ einreihen (läuft gerade)', 'Queue on “{0}” (currently playing)'],
    ['Bei „{0}“ einreihen – schon {1}× eingereiht', 'Queue on “{0}” – already queued {1}×'],
    ['Bei „{0}“ einreihen (läuft gerade) – schon {1}× eingereiht', 'Queue on “{0}” (currently playing) – already queued {1}×'],
    ['„{0}“ aus der Playlist löschen?', 'Delete “{0}” from the playlist?'],
    ['{0} Einträge aus der Playlist löschen?', ['Delete {0} entry from the playlist?', 'Delete {0} entries from the playlist?']],
    ['{0} Einträge aktiviert', ['{0} entry enabled', '{0} entries enabled']],
    ['{0} Einträge deaktiviert', ['{0} entry disabled', '{0} entries disabled']],
    ['{0} Einträge gelöscht', ['{0} entry deleted', '{0} entries deleted']],
    ['Doppelte Einträge entfernen', 'Remove duplicate entries'],
    ['Pro Inhalt bleibt der oberste Eintrag erhalten. Diese Einträge werden aus der Playlist und von den Screens entfernt:', 'For each content, the topmost entry is kept. These entries are removed from the playlist and from the screens:'],
    ['gleicher Inhalt wie {0} „{1}“ – bleibt', 'same content as {0} “{1}” – kept'],
    ['{0} Einträge entfernen', ['Remove {0} entry', 'Remove {0} entries']],
    ['{0} doppelte Einträge entfernt', ['{0} duplicate entry removed', '{0} duplicate entries removed']],
    ['{0} Einträge bei „{1}“ eingereiht', ['{0} entry queued on “{1}”', '{0} entries queued on “{1}”']],
    ['„{0}“ läuft jetzt auf den Screens', '“{0}” is now playing on the screens'],
    ['Name der neuen Playlist:', 'Name of the new playlist:'],
    ['Neue Playlist', 'New playlist'],
    ['Playlist „{0}“ angelegt – sie läuft erst nach „▶ Auf Screens abspielen“', 'Playlist “{0}” created – it only plays after “▶ Play on screens”'],
    ['Name der Kopie:', 'Name of the copy:'],
    ['„{0}“ angelegt', '“{0}” created'],
    ['Neuer Name:', 'New name:'],
    ['Playlist „{0}“ mit {1} Einträgen löschen?\n\nDateien bleiben erhalten, solange eine andere Playlist sie verwendet.', 'Delete playlist “{0}” with {1} entries?\n\nFiles are kept as long as another playlist uses them.'],
    ['Playlist „{0}“ mit {1} Einträgen löschen?\n\nSie läuft gerade – danach spielen die Screens die erste andere Playlist.\n\nDateien bleiben erhalten, solange eine andere Playlist sie verwendet.',
      'Delete playlist “{0}” with {1} entries?\n\nIt is currently playing – afterwards the screens play the first other playlist.\n\nFiles are kept as long as another playlist uses them.'],
    ['„{0}“ gelöscht', '“{0}” deleted'],

    // --- Verbinden per QR-Code ------------------------------------------------------------------
    ['Verbinden', 'Connect'],
    ['Mit ScreenDeck verbinden', 'Connect to ScreenDeck'],
    ['Mit der Kamera des Smartphones oder Tablets scannen – oder die Adresse eintippen.', 'Scan with the camera of your smartphone or tablet – or type in the address.'],
    ['Als Screen öffnen', 'Open as a screen'],
    ['Zeigt die Inhalte an. Im Menü (antippen) lässt sich z. B. die Fernsteuerung starten.', 'Shows the content. The menu (tap) lets you start the remote control, for example.'],
    ['Verwaltung öffnen', 'Open the admin'],
    ['Steuert alle Screens. Ist eine PIN gesetzt, fragt die Seite einmal danach.', 'Controls all screens. If a PIN is set, the page asks for it once.'],
    ['QR-Code', 'QR code'],
    ['QR-Codes zum Scannen mit Smartphone oder Tablet', 'QR codes to scan with a smartphone or tablet'],
    ['QR-Code zum Öffnen auf einem weiteren Gerät', 'QR code to open on another device'],
    ['Gerät verbinden', 'Connect device'],
    ['Weiteres Gerät verbinden', 'Connect another device'],
    ['Mit der Kamera des Smartphones oder Tablets scannen, oder die Adresse eintippen:', 'Scan with the camera of your smartphone or tablet, or type in the address:'],

    // --- Fernsteuerung ------------------------------------------------------------------------
    ['Fernsteuerung', 'Remote control'],
    ['Andere Screens von diesem Gerät aus steuern', 'Control other screens from this device'],
    ['Fernsteuerung: Welche Screens sollen mitlaufen?', 'Remote control: which screens should follow?'],
    ['Starten', 'Start'],
    ['Übernehmen', 'Apply'],
    ['Beenden', 'Stop'],
    ['beenden', 'stop'],
    ['Vorheriger Eintrag', 'Previous entry'],
    ['Nächster Eintrag', 'Next entry'],
    ['Zoom zurücksetzen', 'Reset zoom'],
    ['Stift: auf dem Bild zeichnen', 'Pen: draw on the image'],
    ['dünn', 'thin'],
    ['mittel', 'medium'],
    ['dick', 'thick'],
    ['Letzten Strich zurücknehmen', 'Undo last stroke'],
    ['Zeichnung löschen', 'Clear drawing'],
    ['Fernsteuerung beenden', 'Stop remote control'],
    ['Bild drehen (90° im Uhrzeigersinn)', 'Rotate image (90° clockwise)'],
    ['Ton der gesteuerten Screens', 'Sound of the controlled screens'],
    ['Musik auf den gesteuerten Screens stumm/laut', 'Mute/unmute music on the controlled screens'],
    ['Musik abspielen/anhalten (alle Screens)', 'Play/pause music (all screens)'],
    ['Video-Ton auf den gesteuerten Screens an/aus', 'Video sound on the controlled screens on/off'],
    ['Vorheriger Titel', 'Previous track'],
    ['Kein Titel', 'No track'],
    ['Ton steuern von:', 'Control sound of:'],
    ['Lautstärke und Stumm gelten für den gewählten Screen. Titelwahl, Abspielen und das Verhalten bei Videos betreffen die Musik aller Screens.', 'Volume and mute apply to the selected screen. Track selection, playback and the behavior during videos affect the music on all screens.'],
    ['Musik dabei', 'Music level'],
    ['Musik bei Video mit Ton', 'Music during video with sound'],
    ['Lautstärke der Musik, solange ein Video mit Ton läuft', 'Music volume while a video with sound is playing'],
    ['gesperrt', 'blocked'],
    ['erlaubt', 'allowed'],
    ['Darf dieser Screen (z. B. ein Smartphone) andere Screens fernsteuern? Ohne Freigabe erscheint der Knopf im Screen-Menü nicht.', 'May this screen (e.g. a phone) remote-control other screens? Without permission the button does not appear in the screen menu.'],
    ['keine Screens gewählt', 'no screens selected'],
    ['Wird ferngesteuert von „{0}“.', 'Remote-controlled by “{0}”.'],
    ['Weiterschalten per Pfeil oder Wischen, Zoom wird übertragen.', 'Switch with the arrows or by swiping; zoom is mirrored.'],
    ['Keine anderen Screens vorhanden.', 'No other screens available.'],
    ['📱 steuert {0}', '📱 controls {0}'],
    ['📱 gesteuert von {0}', '📱 controlled by {0}'],
    ['Fernsteuerung: der automatische Wechsel ruht, weitergeschaltet wird am steuernden Gerät', 'Remote control: automatic switching is paused, switching happens on the controlling device'],

    // --- Screen (Anzeige-Seite) ------------------------------------------------------------
    ['ScreenDeck Screen', 'ScreenDeck Screen'],
    ['Keine Verbindung zum Server', 'No connection to the server'],
    ['Tippen für Menü', 'Tap for menu'],
    ['Tippen für Vollbild', 'Tap for full screen'],
    ['Screen-Menü', 'Screen menu'],
    ['Ausblenden', 'Hide'],
    ['Bildqualität, in der dieser Screen Bilder bekommt', 'Image quality this screen receives'],
    ['Video-Ton', 'Video sound'],
    ['Lautstärke Video-Ton', 'Video sound volume'],
    ['Lautstärke Musik', 'Music volume'],
    ['Am Screen angehalten – die Verwaltung sieht das und kann fortsetzen', 'Paused on this screen – the admin sees this and can resume'],
    ['Vollbild', 'Full screen'],
    ['Vollbild beenden', 'Exit full screen'],
    ['Anhalten', 'Pause'],
    ['Fortsetzen', 'Resume'],
    ['Aktuelles Bild/Video auf diesem Gerät speichern', 'Save the current image/video on this device'],
    ['Herunterladen', 'Download'],
    ['Neu laden', 'Reload'],
    ['Kein Inhalt zugewiesen', 'No content assigned'],
    ['Verbunden', 'Connected'],
    ['Keine Verbindung', 'No connection'],
    ['Stumm schalten', 'Mute'],
    ['Ton einschalten', 'Unmute'],
    ['Entfernt', 'Removed'],

    // --- Anmeldung ------------------------------------------------------------------------
    ['ScreenDeck – Anmeldung', 'ScreenDeck – Sign in'],
    ['ScreenDeck – {0}', 'ScreenDeck – {0}'],
    ['Bitte PIN eingeben', 'Please enter the PIN'],
    ['Anmelden', 'Sign in'],
    ['Falsche PIN', 'Wrong PIN'],
    ['Zu viele Versuche – bitte eine Minute warten', 'Too many attempts – please wait a minute'],

    // --- Fehlermeldungen des Servers --------------------------------------------------------
    ['Nicht angemeldet', 'Not signed in'],
    ['Unbekannter Bereich', 'Unknown area'],
    ['Die PIN muss 4 bis 32 Zeichen lang sein', 'The PIN must be 4 to 32 characters long'],
    ['Ungültige URL', 'Invalid URL'],
    ['Text fehlt', 'Text is missing'],
    ['Unbekannter Typ', 'Unknown type'],
    ['Medienquelle nicht gefunden', 'Media source not found'],
    ['Ungültiger Ordner', 'Invalid folder'],
    ['Ordner {0}: {1}', 'Folder {0}: {1}'],
    ['nicht gefunden', 'not found'],
    ['kein Zugriff', 'access denied'],
    ['nicht erreichbar', 'not reachable'],
    ['Pfad fehlt', 'Path is missing'],
    ['Ordner nicht gefunden oder nicht erreichbar: {0}', 'Folder not found or not reachable: {0}'],
    ['Dieser Ordner ist schon eingebunden', 'This folder has already been added'],
    ['Bitte eine Stream-Adresse mit http:// oder https:// angeben', 'Please enter a stream URL starting with http:// or https://'],
    ['Unbekannte Aktion', 'Unknown action'],
    ['Die letzte Playlist kann nicht gelöscht werden', 'The last playlist cannot be deleted'],
    ['Kein Bild', 'Not an image'],
    ['Warteschlange ist voll (max. {0})', 'The queue is full (max. {0})'],
    ['Unbekannter Modus', 'Unknown mode'],
    ['Bitte ein Bild hochladen', 'Please upload an image'],
  ];

  // Wörterbuch aufbauen: feste Texte und Muster mit Platzhaltern (längere Muster zuerst)
  const exact = new Map();
  const patterns = [];
  for (const [de, en] of EN) {
    if (/\{\d+\}/.test(de)) {
      const order = [...de.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
      const body = de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\d+\\\}/g, '(.+?)');
      patterns.push({ re: new RegExp('^' + body + '$', 's'), order, en, len: de.length });
    }
    exact.set(de, en);
  }
  patterns.sort((a, b) => b.len - a.len);

  /** Einzahl/Mehrzahl nach der ersten Zahl unter den Werten */
  function choose(en, values) {
    if (!Array.isArray(en)) return en;
    const n = values.find((v) => /^\d+$/.test(String(v).trim()));
    return Number(n) === 1 ? en[0] : en[1];
  }
  const fill = (text, values) => text.replace(/\{(\d+)\}/g, (m, i) => (values[i] !== undefined ? values[i] : m));

  function lookup(s) {
    if (exact.has(s)) return choose(exact.get(s), []);
    for (const p of patterns) {
      const m = p.re.exec(s);
      if (!m) continue;
      const values = [];
      p.order.forEach((idx, g) => (values[idx] = m[g + 1]));
      return fill(choose(p.en, values), values.map((v) => translate(v) ?? v));
    }
    return null;
  }

  // Führende Symbole (✓ ✗ ⏳ ▶ 🎵 …) und abschließende Auslassungspunkte bleiben stehen
  const LEAD = /^[^\p{L}\p{N}„“"(#'+-]+/u;
  const TRAIL = /[\s…✎⏭]+$/u;

  /** Übersetzung eines Textes oder null, wenn unbekannt */
  function translate(s) {
    if (lang === 'de' || !s || !/\p{L}/u.test(s)) return null;
    const found = lookup(s);
    if (found != null) return found;
    const lead = s.match(LEAD)?.[0] ?? '';
    const trail = s.slice(lead.length).match(TRAIL)?.[0] ?? '';
    if (!lead && !trail) return null;
    const core = s.slice(lead.length, s.length - trail.length);
    const inner = core && lookup(core);
    return inner != null ? lead + inner + trail : null;
  }

  /** Text für Meldungen im Code: t('„{0}“ gelöscht', name) */
  function t(key, ...values) {
    if (lang === 'de') return fill(key, values);
    if (exact.has(key)) return fill(choose(exact.get(key), values), values.map((v) => translate(String(v)) ?? v));
    const text = fill(key, values);
    return translate(text) ?? text;
  }

  // --- Seite übersetzen ------------------------------------------------------------------
  const ATTRS = ['title', 'placeholder', 'aria-label', 'label'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  function translateText(node) {
    const raw = node.data;
    if (!/\p{L}/u.test(raw)) return;
    const s = norm(raw);
    const r = translate(s);
    if (r == null || r === s) return;
    node.data = raw.match(/^\s*/)[0] + r + raw.match(/\s*$/)[0];
  }
  function translateAttr(el, name) {
    const v = el.getAttribute(name);
    if (!v) return;
    const r = translate(norm(v));
    if (r != null && r !== v) el.setAttribute(name, r);
  }
  const excluded = (el) => !el || SKIP.has(el.tagName) || !!el.closest('[translate="no"]');

  /** Element/Fragment samt Inhalt übersetzen (auch Vorlagen, bevor sie eingefügt werden) */
  function translateTree(root) {
    if (lang === 'de' || !root) return;
    if (root.nodeType === 3) return excluded(root.parentElement) || translateText(root);
    if (root.nodeType === 1) {
      if (root.getAttribute('translate') === 'no') return;
      if (root.tagName !== 'SCRIPT' && root.tagName !== 'STYLE') for (const a of ATTRS) if (root.hasAttribute(a)) translateAttr(root, a);
      if (SKIP.has(root.tagName)) return; // Inhalt von Textfeldern ist Eingabe, nur der Platzhalter wird übersetzt
    }
    for (const c of root.childNodes) translateTree(c);
  }

  if (lang !== 'de') {
    // Alles, was später per Skript eingefügt oder geändert wird
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') {
          for (const n of r.addedNodes) {
            if (n.nodeType === 1 && !excluded(n.parentElement)) translateTree(n);
            else if (n.nodeType === 3 && !excluded(n.parentElement)) translateText(n);
          }
        } else if (r.type === 'characterData') {
          if (!excluded(r.target.parentElement)) translateText(r.target);
        } else if (!r.target.closest('[translate="no"]')) translateAttr(r.target, r.attributeName);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

    // Rückfragen und Hinweise des Browsers
    const { alert, confirm, prompt } = window;
    window.alert = (m) => alert.call(window, t(String(m)));
    window.confirm = (m) => confirm.call(window, t(String(m)));
    window.prompt = (m, d) => prompt.call(window, t(String(m)), d == null ? d : t(String(d)));
  }

  function setLang(next) {
    if (!LANGS.includes(next) || next === lang) return;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    // ?lang= aus der Adresse entfernen, sonst gilt sie beim Neuladen weiter
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url);
  }

  // Sprachauswahl: jedes <select data-lang-select>
  document.addEventListener('change', (e) => e.target.matches?.('[data-lang-select]') && setLang(e.target.value));
  document.addEventListener('DOMContentLoaded', () => {
    translateTree(document.head.querySelector('title'));
    translateTree(document.body);
    for (const s of document.querySelectorAll('[data-lang-select]')) s.value = lang;
  });

  window.I18N = { lang, locale: lang === 'de' ? 'de-DE' : 'en-GB', t, translate, translateTree, setLang };
  window.t = t;
})();
