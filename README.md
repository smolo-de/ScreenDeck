# ScreenDeck

**English** · [Deutsch](README.de.md)

Controls the content of any number of screens (tablets, projectors, smart TVs …) centrally from a web admin.
Each screen is just a browser page; nothing is installed on the devices.

## Getting started

```bash
npm install
npm start          # or: npm run dev (restarts on changes)
```

- **Admin:** `http://localhost:3000/admin`
- **Screens:** open `http://<server-ip>:3000/screen` on each device (the console and the admin show the IP). The plain server address `http://<server-ip>:3000/` also leads to the screen; the admin is only available explicitly under `/admin`.

**Connect via QR code:** `http://<server>/connect` shows a QR code with the screen address. It contains the IP address instead of the name, so it works on Android too. Opened from the admin (“▦ QR code” next to the screen addresses), it adds a second code for the admin. On a screen, “Connect device” in the menu shows the QR code right there, e.g. on the TV, so a smartphone can scan it. The server generates the codes itself, no internet needed.

**Without a port:** The server also listens on port 80, so `http://<server-ip>` or `http://screendeck.local` works without `:3000`. If port 80 is taken (e.g. by another web server), everything runs on 3000 as usual and the console says so. Turn it off with `EXTRA_PORT=0`, use another port with `EXTRA_PORT=8080`. If the Windows firewall only allows port 3000, port 80 has to be allowed there as well.

**Network name:** The server is also reachable as `http://screendeck.local`, without an IP address (mDNS). This works with Windows, macOS, iPhone/iPad and newer Android devices. Some older Android TVs do not know such names; use the IP address there. Change the name under ⚙ Settings → “Network name”; empty turns it off. With several ScreenDeck servers on the same network, choose different names.
Tip: Many routers (e.g. Fritz!Box) also make devices reachable by their name themselves, e.g. `http://<pc-name>.fritz.box`. That works on older TVs too.

Change the port: `PORT=8080 npm start` (PowerShell: `$env:PORT=8080; npm start`)
Change the data directory: `DATA_DIR=...` (default: `./data`)

## Language

The interface is available in **English** and **German**. The default is the browser language.
- **Switching:** top right in the admin (DE/EN), on a screen at the bottom of its menu (🌐, next to the image quality).
- **Storage:** The choice applies per device and is stored in the browser.
- **Kiosk devices:** add `?lang=en` or `?lang=de` to the address, e.g. `/screen?lang=en`.

The translations live in `public/i18n.js`. The pages themselves are written in German; for English the script translates all visible text.

## Adding screens

1. On the device, open `http://<server>:3000/screen`, tap it and choose “Full screen” in the menu.
2. The screen registers automatically and appears in the admin.
3. Each device gets a fixed ID (stored in the browser). After a restart the server recognizes the device again.

Optional URL parameters:

| Parameter | Meaning |
|-----------|---------|
| `?name=Hall%20Projector` | Name used on first registration (can be changed later in the admin) |
| `?id=projector1` | Fixed ID instead of the generated one, e.g. for kiosk devices whose storage is wiped |
| `?lang=en` | Interface language of this device (`de` or `en`) |

**Menu on the screen:** Tapping or clicking shows a menu at the bottom with name, ID, connection and current content.
- **Buttons:** “Full screen” / “Exit full screen”, “Pause” / “Resume”, “Download” and “Reload”.
- **Settings:** image quality, language, video sound and music volume (see [Music](#music)).
- **Pausing on the screen:** The admin then shows “⏸ Client” on the pause button; ▶ resumes. Resuming works there or on the screen. If the admin paused the screen or chose Image or Dark, that cannot be undone on the screen.
- **Hiding:** “✕”, tapping again or Esc closes the menu immediately; without interaction it disappears after 10 s.
- **Zooming (touch screens):** Pinch with two fingers to enlarge (up to 5×), drag with one finger to move, double tap to zoom in at that spot or reset. Works for images, texts and videos, not for web pages.
  - While zoomed in, the screen holds images and texts. The admin then shows “⏸ Client” and can resume. Videos keep playing.
  - The zoom resets after 60 s without touch, with the next content or by double tap. The screen then continues as normal.
  - Can be turned off under ⚙ Settings (“Zoom with finger gestures”). With zoom enabled, a single tap waits briefly (0.3 s) to see whether a second one follows.
- **Remote control:** One screen (e.g. a smartphone) controls others (e.g. the TV). Choose “Remote control” in the menu, tap the screens that should follow (preselected: all connected ones), then “Start”.
  - **Permission:** only screens allowed in the admin (“Remote control: allowed” on the screen, under ▾ in the compact view) show the button in the menu. The default is “blocked”. Revoking the permission ends a running remote control immediately.
  - All screens involved show the same entry; automatic switching is paused for them. The other screens keep running as normal.
  - The controlling device shows a bar at the bottom: ‹ › steps through the enabled playlist entries; alternatively swipe horizontally or use the arrow keys. Plus “Reset zoom” and ✕ (stop).
  - **Zoom** on the controlling device (two fingers, dragging, double tap) is mirrored to the controlled screens relative to the image, so the same image point is centered even with a different aspect ratio (phone in portrait, TV in landscape).
  - **Pen** (✏ in the bar): your finger or the mouse draws on the image, and the strokes appear live on the controlled screens. Above the bar are 5 colors, 3 sizes, 🗑 to clear the whole drawing and ↶ to undo the last stroke (also Ctrl+Z). Strokes are attached to the image, so they zoom along and sit at the same spot even with a different aspect ratio. They disappear with the next content. While the pen is on, there is no zooming or swiping, and a tap sets a dot instead of opening the menu. The device remembers color and size.
  - **Rotate** (↻ in the bar, images and videos only): rotates by 90° clockwise on all controlled screens. The rotated image is fitted again and strokes rotate along. The rotation is gone with the next content.
  - **Sound** (🔊 in the bar): at the top, pick the screen whose sound you control. It can be any other screen, even one that is not following along; the first controlled screen is preselected. You can mute/unmute its music and video sound and set their volume. There are also previous track, play/pause and next track. You can also set what the music does “during video with sound” (keep playing quieter, pause, change nothing) and, when it gets quieter, the level (“Music level”, in %), just like in the admin. Track selection, this behavior and playback affect the music on all screens, since it plays in sync everywhere. If music is off on a controlled screen, unmuting turns it on there.
  - The admin shows “📱 controls …” or “📱 controlled by …” with “stop”. The history lists “Remote control”.
  - If the controlling device is disconnected for 2 minutes (e.g. screen lock), the remote control ends by itself. After a server restart it has to be started again.
- **Turning it off:** Under ⚙ Settings the menu can be turned off for all screens, e.g. for public touch screens. Tapping then only switches to full screen.

## Admin

**Screens:** List of all screens with online status, preview and title of the current content, IP and “last seen”.
- Rename directly in the list
- Change the order by dragging ⋮⋮ (relevant for “In order”)
- Assignment: *Automatic (playlist)* or *Fixed: \<entry\>*
- **📌 Pin** (next to the current content) makes the entry currently playing the fixed content of the screen; **Unpin** switches back to automatic.
- 👁 shows the name large on the device for 5 s, ↻ reloads the screen, ✕ removes an offline screen
- **☰ Compact:** one short line per screen with name, mode buttons, current content, status and playtime. Standby image, sound, assignment, “Up next” and history appear via ▾ on the far right or by clicking the preview. The browser remembers the setting.
- “Delete all” clears the screen list. Screens that are currently connected register again automatically, with default settings.

**Mode per screen** (buttons ▶ ⏸ 🖼 ⬛ on the screen, or “All screens” in the control bar):

| Mode | Behavior |
|---|---|
| ▶ Play | Normal operation |
| ⏸ Pause | Content stays on screen, videos are paused. The screen does not switch. |
| 🖼 Image | Shows the screen's standby image: an image from the playlist or an own image via “Upload own image…”. Without an image the screen is black. |
| ⬛ Dark | Black screen |

**Standby image: text & options** (expandable on the screen): additional text in image mode with font, color and position (top/center/bottom), plus soft corners for the standby image.
Text and image can be combined, or use text on black only.

In Pause, Image and Dark the actual content stays loaded in the background. After “Play” it continues where it left off.
Inactive screens are skipped when switching. Hidden content (Image/Dark) may play on other screens at the same time.

**Sound:** Per screen via the 🔊/🔇 toggle with a volume slider (default: off). Applies to videos.
Browsers only allow sound after the device has been tapped once, then for all following videos. Until then videos keep playing muted and the admin shows “🔇 sound blocked – tap the device once”.
For unattended kiosk PCs, start the browser with autoplay allowed:

```
chrome --kiosk --autoplay-policy=no-user-gesture-required http://<server>:3000/screen
msedge --kiosk http://<server>:3000/screen --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required
```

Web pages (iframe) control their own sound and are not affected by this setting.

**Playback check:** Every screen reports back what it actually shows. The admin shows per screen:
- ✓ *showing* / *video playing*: confirmed
- ⏳ *sending* / *loading*: not confirmed yet
- ✗ *error*, *video stalled*, *autoplay blocked*, *shows … instead*, *no response*

If there is no confirmation within 10 s, the server sends the content again (up to 3 times). After that it can be triggered manually via “resend”.
Videos are monitored continuously: paused videos are restarted, stalled ones are reported as errors.

**Add, Media, Music** (right column): three separate areas, each collapsible by clicking its header (▾/▸). The browser remembers the state.
- **Add:** upload via drag & drop, handling of duplicate files, web page/URL and text.
- **Media:** the content of the **media sources** or of the uploaded files (see below).
- **Music:** see [Music](#music).

**Media:**
- **Media sources** are any number of folders, added under ⚙ Settings → Media sources: local folders (`D:\Media`), network drives (`Z:\Videos`) or network paths (`\\NAS\Share\Videos`). The default is `data/media`.
  - Each source gets a name (can be renamed). When adding, the server checks that the folder is reachable.
  - Removing a source leaves its files and the playlist entries from it untouched.
  - Network drives must be reachable for the user account the server runs under. If it runs as a service or “as administrator”, mapped drive letters are often invisible; use the network path instead.
- At the top of the area you choose the source (or “⬆ Uploaded”). Images and videos in it are listed with subfolders, preview and search.
- **Drag files into the playlist:** a line shows where the entry lands. Alternatively use ＋ (append) or “Add all” for the whole folder. “✓ in Playlist” marks files that are already included.
- Files are **not copied** but played directly from the folder. Deleting an entry from the playlist keeps the original file.
- **“⬆ Uploaded”** shows the uploaded files instead (`data/uploads`), newest first, with title and preview. From there files can be dragged into the playlist (again) without uploading them again. An uploaded file is only deleted once no playlist entry and no standby image uses it any more.
- Wide screens show three columns (Screens | Playlist | Media); medium ones show the playlist below the screens and “Add”, “Media” and “Music” next to it.

**Multiple playlists:** In the playlist header you choose which playlist is shown and edited. Next to it: ＋ new, ⧉ duplicate, ✎ rename, 🗑 delete.
- **Active** is the playlist that runs on the screens (▶ in the selection, green “playing on the screens”). Another playlist can be prepared at leisure (“not playing right now”, orange frame) and activated with **“▶ Play on screens”**. The screens are then redistributed immediately.
- Fixed assignments apply to the entries of their playlist. They rest while another playlist runs and take effect again after switching back.
- The media list shows which playlists contain a file (e.g. “✓ in Playlist +1” or “in “Party””, details via tooltip). The same file can be in several playlists and is stored only once. It is only deleted when no playlist uses it any more.

**Playlist:** Images and videos (upload via drag & drop), web pages (URL) and texts (with colors).
- Reorder via drag & drop, rename entries, enable/disable, delete
- **Duplicate files:** On upload the file content is compared, not the name. Below the upload field you choose whether duplicates are *skipped* (default) or *added anyway*. Existing duplicates are marked “duplicate” in the playlist, and the tooltip names the matching entry.
  “🧹 Remove … duplicate entries” cleans them up: a dialog first shows which entries will be removed. For each content, the topmost entry is kept.
- **Search & filter** above the playlist: search by title, text or URL, filter by type, and show “enabled / disabled / duplicates only”. The bar stays at the top while scrolling.
- **☰ Compact:** one line per entry. Text options and screen buttons appear via ▾. The browser remembers the setting.
- **Multi-select:** checkbox per entry, Shift-click selects a range, “Select all” takes all listed (i.e. filtered) entries. Selected entries can be enabled, disabled, deleted or queued on a screen together.
- **Video previews** are created once by the admin, one after the other. It takes a frame after 1 second (further in if the start is dark) and stores it as a small JPG on the server. While this runs, the preview shows a loading bar. Afterwards previews load instantly.
- New entries are added at the end of the playlist. The admin scrolls there and highlights them briefly.
- **Quick buttons:** Below each entry there is one button per screen. A click adds the entry to that screen's **queue**.
  `▶ Name` = currently playing there, `⏳ Name` = queued there, `📌 Name` = pinned there.
  Alternatively drag an entry by ⋮⋮ onto a screen.
  Fixed assignment: via the “Fixed: …” selection on the screen.

**Up next (per screen, above the history):** Shows the queue and then the expected next playlist entry.
- Queued content starts as soon as the current one is finished: at the end of the video, at the next timer switch or with “⏭ Next”. A running video is not interrupted.
- If the screen currently shows nothing, queued content starts immediately.
- `▶ now` plays a queued entry immediately, `✕` removes it, “clear” empties the queue.
- Pinned screens also play their queue and then return to their fixed content.

**Distribution:**
- **In order:** Screen 1 shows entry 1, screen 2 entry 2 … On a switch every screen gets the next entry that is not already playing on another screen.
- **Random:** Every screen gets a random entry. Duplicates and repeats are avoided where possible.
- **⇉ All the same (sync):** All screens show the same content. Videos start at a common point in time, about 2 s after the switch so all screens can load. After that the screens continuously adjust their position: small deviations via slightly faster or slower playback, large ones by jumping.
  - **Shared by all:** “Next”, queue, clicking the progress bar and the end of a video apply to the whole group.
  - **Joining late:** A screen that reloads or connects later joins at the current position.
  - **Pause:** Paused screens jump back to the common position after “Play”.
  - **Exception:** Pinned screens do not take part.
  - **Clock:** The devices' clocks do not need to be correct; the screens sync with the server's time.
- **Pinned screens** stay unchanged in all modes, and their content is not shown on other screens in addition.
- **Switch automatically (auto time):** Images, web pages and texts without their own duration stay *n* seconds each, counted from when they appear. Every screen has its own timing; in sync mode the group runs together. After Pause, Image or Dark the time starts over. Switch manually with “Next switch”.
- **Videos always play to the end.** Then only that screen switches to the next entry. The auto time does not apply to videos, but “Next switch” does interrupt them.
  A pinned video (or one with nothing else to play) starts again from the beginning.

**Fonts & soft corners (texts):** Choose a font per text, e.g. Default, Georgia, Impact, Bebas Neue, Montserrat or the Halloween fonts Creepster, Nosifer and Butcherman.
Optional **soft corners** (Soft / Extra soft): the text area is rounded and fades out towards the edge so the picture does not look rectangular.
The web fonts come from Google Fonts and need internet access on the screen. Without internet a similar system font is used.

**Texts with a duration:** When adding a text (or later directly in the playlist) you can set a duration in seconds. When it has elapsed, the screen switches as after the end of a video, and the timer does not interrupt the text before that. Without a duration the auto time applies. If “Switch automatically” is off, the text stays until the next manual switch.
Optionally the screen shows a large **countdown** of the remaining time below the text. In Pause/Image/Dark the countdown stops.

**Playtime:** For screens with a video, a text with a duration or an image/text with auto time, the current position and total duration are shown with a progress bar (e.g. `1:02 / 2:05`), updated every second.
**Clicking the bar** jumps to that position in the video or sets the countdown accordingly.

**History:** Per screen, a collapsed list of the last 50 items with start time, playback status (✓/⚠/✗), duration and trigger (Start, Timer, Manual, Video ended, Fixed, Playlist …).

## Music

A separate **music list** alongside the display (“🎵 Music” area below “Media”).
- **Sources:**
  - Audio files (MP3, M4A, AAC, OGG/Opus, WAV, FLAC) from the media sources, via ＋ or by dragging them into the music list.
  - Uploaded audio files, which land in the music list automatically.
  - **Internet radio** via its stream URL.
- **Controls:** ⏮ ▶/⏸ ⏭, 🔀 shuffle, 🔁 repeat, volume; clicking the progress bar jumps. Change the order by dragging ⋮⋮; tracks can be renamed.
- **Plays on:** Click to choose which screens play the music. All chosen screens play the same position **in sync**; radio plays live. ♪ means “playing”, ⚠ “sound blocked – tap the device once”.
- **During video with sound** (on any screen): *keep playing quieter* at an adjustable % (default 20 %), *pause* (then resumes at the same position) or *change nothing*. A change applies immediately, including to the video currently playing.
  - If a video with sound is directly followed by another, the music stays quieter or paused throughout. It only gets louder again after a short delay (1.5 s).
  - Videos **without an audio track** do not count. The screens detect this on first playback; after that the music does not get quieter for that video at all.
- **In the screen list** every screen has a **🎵 button** next to the video sound (🔊): music on/off for that screen, with its own volume slider. If the music was muted on the screen, the button shows 🔇; a click unmutes it.
- **On the screen** (menu): **video sound** and **music** can be muted (🔈) and adjusted separately. The music volume is relative to the overall volume and applies only to that screen. The admin shows this (🔇 on the chip or “music muted (on the screen)”).
- As with videos, browsers only allow sound after a touch on the device (or a kiosk start with `--autoplay-policy=no-user-gesture-required`).
- Spotify is not integrated yet (planned: controlling Spotify Connect devices, requires Spotify Premium).

## Image quality (⚙ Settings)

**Image quality for screens** downscales images before sending them: *Original*, *4K* (max. 3840 px), *Full HD* (1920 px), *HD* (1280 px) or *Low* (960 px), each recompressed. This saves loading time and data, e.g. for photos from a network drive or tablets on Wi-Fi.
- The setting is the **default**. Each screen can use its own level: in the screen list (“Image quality”, under ▾ in the compact view) or directly in the menu on the screen. “Default (…)” uses the default.
- The reduced version is created on first request and stored in `data/cache`. The original files stay unchanged.
- Below it you see the size of the **cache** (count, size). **Clear** deletes all downscaled images; they are recreated when needed.
- The download in the screen menu always delivers the original.
- **Previews in the admin** (playlist, media list, standby image) are always small (320 px, a few KB) and are cached as well. Large photos therefore hardly cost any loading time in the lists, regardless of the setting above.
- Images with transparency are stored as WebP, all others as JPEG. Videos, animated GIFs and SVGs stay unchanged.
- Technology: the [sharp](https://sharp.pixelplumbing.com/) library. Run `npm install` once after an update.

## Access protection (⚙ Settings)

Under **⚙ Settings** (top right) you can set one PIN for the **admin** and one for the **screens**. By default none is set and everything is freely accessible.

- **🎲 Generate** creates a random 6-digit PIN. **Save** activates it, **Remove** lifts the protection again.
- With a PIN, the page asks for it once. The device then stays signed in (cookie) until the PIN changes.
- **Admin:** The admin that sets the PIN stays signed in. Everyone else has to enter it. “Log out” is at the top right.
- **Screens:** Screens that are already connected stay signed in. New devices ask for the PIN; kiosk devices can get it via the address: `/screen?pin=123456`. A signed-in admin may also view screen content.
- Only a hash is stored, not the PIN itself. After 5 failed attempts the IP is blocked for one minute.
- **Forgotten PIN:** stop the server, delete the entry `"admin"` or `"screen"` under `"auth"` in `data/state.json` and restart.

## Updates

Screens and admin reload automatically as soon as the code in `public/` changes or the server starts with new code. No manual reload is needed.
Changes to `server.js` only take effect after restarting the server. Until then the admin shows a yellow “restart the server” notice at the top. With `npm run dev` the server restarts on changes by itself.

## Technology

- Node.js + Express, WebSocket (`ws`) for live updates, uploads via `multer`
- State in `data/state.json`, uploaded files in `data/uploads/`
- `server.js` – server, API, distribution logic
- `public/admin.*` – admin
- `public/screen.html` – screen client (cross-fade, automatic reconnect, red dot on connection loss)
- `public/i18n.js` – languages (German/English)

## Notes

- Without a PIN the admin is freely accessible. Even with a PIN everything runs unencrypted over http, so only run it on a local network.
- Sound only plays on screens with “🔊 sound on” (see above).
- Many websites forbid embedding via iframe (`X-Frame-Options`). Those stay blank.
- To keep devices from going to standby, disable the screen lock on the device or use kiosk mode. The Wake Lock API only works over https or localhost.
