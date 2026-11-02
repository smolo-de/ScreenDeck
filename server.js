import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  distribution: 'order', // 'order' = der Reihe nach, 'random' = Zufall
  autoAdvance: false,
  interval: 30, // Sekunden
  duplicates: 'skip', // doppelte Dateien beim Upload: 'skip' = aussortieren, 'add' = trotzdem hinzufügen
};

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      screens: (saved.screens ?? []).map((s) => ({ ...s, report: null })),
      playlist: saved.playlist ?? [],
      settings: { ...DEFAULT_SETTINGS, ...saved.settings },
      nextAt: null,
    };
  } catch {
    return { screens: [], playlist: [], settings: { ...DEFAULT_SETTINGS }, nextAt: null };
  }
}

const state = loadState();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  const { nextAt, ...persisted } = state;
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

const itemById = (id) => state.playlist.find((i) => i.id === id);
const screenById = (id) => state.screens.find((s) => s.id === id);
const newId = () => crypto.randomUUID().slice(0, 8);

// ---------------------------------------------------------------------------
// Verteilung der Playlist auf die Screens
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 50;
const pinnedOf = (s) => (s.pinnedItemId && itemById(s.pinnedItemId) ? s.pinnedItemId : null);

// Screen-Modus: play = normal, pause = eingefroren, image = Standbild, dark = schwarz
const MODES = ['play', 'pause', 'image', 'dark'];
const modeOf = (s) => (MODES.includes(s.mode) ? s.mode : 'play');
const isActive = (s) => modeOf(s) === 'play';
const isHidden = (s) => modeOf(s) === 'image' || modeOf(s) === 'dark'; // Inhalt nicht sichtbar

/** Aktive Einträge ohne die fest vergebenen (sofern dann noch etwas übrig bleibt) */
function rotationItems() {
  const items = state.playlist.filter((i) => i.enabled);
  const pinnedIds = new Set(state.screens.map(pinnedOf).filter(Boolean));
  const rest = items.filter((i) => !pinnedIds.has(i.id));
  return rest.length ? rest : items;
}

function pickRandom(items, used, current) {
  const tiers = [
    (i) => !used.has(i.id) && i.id !== current, // neu und auf keinem anderen Screen
    (i) => !used.has(i.id), // auf keinem anderen Screen
    (i) => i.id !== current, // wenigstens ein Wechsel
    () => true,
  ];
  for (const ok of tiers) {
    const candidates = items.filter(ok);
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)].id;
  }
  return null;
}

/** Der Reihe nach: nächster Eintrag nach dem aktuellen, der nicht schon auf einem anderen Screen läuft */
function pickNext(items, used, current) {
  const start = items.findIndex((i) => i.id === current);
  for (let k = 1; k <= items.length; k++) {
    const candidate = items[(start + k) % items.length];
    if (!used.has(candidate.id)) return candidate.id;
  }
  return items[(start + 1) % items.length].id;
}

/** Inhalt zuweisen, an den Screen schicken und im Verlauf festhalten */
function assign(screen, itemId, reason) {
  if (itemId === screen.currentItemId) return;
  const now = Date.now();
  const history = (screen.history ??= []);
  if (history[0] && !history[0].end) history[0].end = now;
  const item = itemById(itemId);
  if (item) {
    history.unshift({ itemId, title: item.title, type: item.type, start: now, end: null, reason, status: null });
    history.length = Math.min(history.length, HISTORY_LIMIT);
  }
  screen.currentItemId = itemId;
  pushToScreen(screen);
}

/**
 * Komplette Neuverteilung (Moduswechsel, neue Screen-Reihenfolge):
 * der Reihe nach = Screen 1 zeigt Eintrag 1, Screen 2 Eintrag 2 …, sonst per Zufall.
 */
function distribute() {
  const rotation = rotationItems();
  const used = new Set(state.screens.map(pinnedOf).filter(Boolean));
  let n = 0;
  for (const s of state.screens) {
    let next = pinnedOf(s);
    if (!next && rotation.length) {
      next = state.settings.distribution === 'random'
        ? pickRandom(rotation, used, s.currentItemId)
        : rotation[n++ % rotation.length].id;
    }
    if (next) used.add(next);
    assign(s, next, pinnedOf(s) ? 'Fest' : 'Neuverteilung');
  }
}

/**
 * Schaltet die angegebenen Screens unabhängig von den übrigen auf ihren nächsten Inhalt:
 * der Reihe nach = Eintrag nach dem aktuellen, sonst per Zufall. Doppelungen werden vermieden.
 */
function advanceScreens(ids, reason) {
  const rotation = rotationItems();
  const used = new Set();
  for (const s of state.screens) {
    if (pinnedOf(s)) used.add(s.pinnedItemId);
    else if (!ids.includes(s.id) && s.currentItemId && !isHidden(s)) used.add(s.currentItemId);
  }
  for (const s of state.screens) {
    if (!ids.includes(s.id)) continue;
    // Reihenfolge: Warteschlange → fest zugeordneter Inhalt → Playlist
    const queued = takeFromQueue(s);
    let next = queued ?? pinnedOf(s);
    if (!next && rotation.length) {
      next = state.settings.distribution === 'random'
        ? pickRandom(rotation, used, s.currentItemId)
        : pickNext(rotation, used, s.currentItemId);
    }
    if (next) used.add(next);
    assign(s, next, queued ? 'Warteschlange' : pinnedOf(s) ? 'Fest' : reason);
  }
}

// ---------------------------------------------------------------------------
// Warteschlange pro Screen: eingereihte Inhalte laufen, sobald der aktuelle fertig ist
// ---------------------------------------------------------------------------

const QUEUE_LIMIT = 50;

/** Screen sofort weiterschalten; bleibt der Inhalt gleich (z. B. festes Video), von vorne starten */
function advanceOrReplay(screen, reason) {
  const before = screen.currentItemId;
  advanceScreens([screen.id], reason);
  if (screen.currentItemId === before) {
    for (const ws of screenSockets.get(screen.id) ?? []) send(ws, { type: 'replay' });
  }
}

function takeFromQueue(screen) {
  while (screen.queue?.length) {
    const id = screen.queue.shift();
    if (itemById(id)) return id;
  }
  return null;
}

/** Voraussichtlich nächster Inhalt aus der Playlist (Anzeige „Als Nächstes“) */
function previewNext(screen) {
  if (pinnedOf(screen)) return { itemId: screen.pinnedItemId, kind: 'pinned' };
  const rotation = rotationItems();
  if (!rotation.length) return null;
  if (state.settings.distribution === 'random') return { itemId: null, kind: 'random' };
  const used = new Set();
  for (const s of state.screens) {
    if (pinnedOf(s)) used.add(s.pinnedItemId);
    else if (s !== screen && s.currentItemId && !isHidden(s)) used.add(s.currentItemId);
  }
  return { itemId: pickNext(rotation, used, screen.currentItemId), kind: 'order' };
}

/** Nach Änderungen an der Playlist nur Screens neu belegen, deren Inhalt nicht mehr passt */
function redistributeAfterPlaylistChange() {
  const rotation = new Set(rotationItems().map((i) => i.id));
  const invalid = state.screens
    .filter((s) => (pinnedOf(s) ? s.currentItemId !== s.pinnedItemId : !rotation.has(s.currentItemId)))
    .map((s) => s.id);
  if (invalid.length) advanceScreens(invalid, 'Playlist');
}

/** Inhalte mit eigener Laufzeit: Videos und Texte mit Anzeigedauer */
const isTimed = (item) => item?.type === 'video' || (item?.type === 'text' && item.duration > 0);

/** Läuft auf dem Screen gerade ein Video / zeitgesteuerter Text, der noch nicht zu Ende ist? */
function isRunningTimed(s) {
  const item = itemById(s.currentItemId);
  return isTimed(item) && isOnline(s.id) && s.report?.itemId === item.id && ['loading', 'playing', 'showing'].includes(s.report.state);
}

/** Timer: laufende Videos/Texte mit Dauer werden nicht unterbrochen. Manuell: alle wechseln. Nur Screens im Modus „Play“. */
function advance(manual) {
  const ids = state.screens
    .filter((s) => isActive(s) && (!pinnedOf(s) || s.queue?.length) && (manual || !isRunningTimed(s)))
    .map((s) => s.id);
  advanceScreens(ids, manual ? 'Manuell' : 'Timer');
  if (timer) state.nextAt = Date.now() + intervalMs();
  changed();
}

/** Video zu Ende bzw. Anzeigedauer abgelaufen: nächster Inhalt, sonst (fest / nichts anderes da) von vorne */
function onItemEnded(screen, msg) {
  const item = itemById(screen.currentItemId);
  if (!item || msg.itemId !== item.id || !isActive(screen)) return;
  if (screen.history?.[0]?.itemId === item.id) screen.history[0].ended = true;
  const reason = item.type === 'video' ? 'Videoende' : 'Zeit abgelaufen';
  if (!pinnedOf(screen) || screen.queue?.length) advanceScreens([screen.id], reason);
  if (screen.currentItemId === item.id) {
    for (const ws of screenSockets.get(screen.id) ?? []) send(ws, { type: 'replay' });
  }
  changed();
}

let timer = null;
const intervalMs = () => Math.max(3, Number(state.settings.interval) || 30) * 1000;
function restartTimer() {
  clearInterval(timer);
  timer = null;
  state.nextAt = null;
  if (state.settings.autoAdvance) {
    timer = setInterval(() => advance(false), intervalMs());
    state.nextAt = Date.now() + intervalMs();
  }
}

// ---------------------------------------------------------------------------
// WebSocket: Screens und Admin-Oberflächen
// ---------------------------------------------------------------------------

const screenSockets = new Map(); // screenId -> Set<ws>
const adminSockets = new Set();

const isOnline = (id) => (screenSockets.get(id)?.size ?? 0) > 0;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * Schickt dem Screen seinen aktuellen Inhalt.
 * force: Screen baut den Inhalt neu auf, auch wenn er ihn schon zu zeigen glaubt.
 * retry: automatischer Neuversuch des Watchdogs (Zähler nicht zurücksetzen).
 */
function pushToScreen(screen, { force = false, retry = false } = {}) {
  if (!retry) {
    screen.sentAt = Date.now();
    screen.retries = 0;
  }
  const msg = {
    type: 'show',
    name: screen.name,
    item: itemById(screen.currentItemId) ?? null,
    audio: audioOf(screen),
    ...modeMsg(screen),
    force,
  };
  for (const ws of screenSockets.get(screen.id) ?? []) send(ws, msg);
}

const modeMsg = (screen) => ({
  mode: modeOf(screen),
  standby: screen.standby?.src ?? null,
  standbyStyle: screen.standbyStyle ?? null, // { text, font, color, position, edge }
});

const STANDBY_POSITIONS = ['top', 'center', 'bottom'];
const EDGES = ['none', 'soft', 'strong'];
const toEdge = (v) => (EDGES.includes(v) ? v : 'none');
const toFont = (v) => (typeof v === 'string' && /^[a-z0-9]{1,30}$/.test(v) ? v : 'system');

/** Modus / Standbild ändern, ohne den Inhalt neu aufzubauen */
function pushMode(screen) {
  screen.sentAt = Date.now();
  screen.retries = 0;
  for (const ws of screenSockets.get(screen.id) ?? []) send(ws, { type: 'mode', ...modeMsg(screen) });
}

function setMode(screen, mode) {
  if (!MODES.includes(mode) || mode === modeOf(screen)) return;
  screen.mode = mode;
  pushMode(screen);
}

/** Eigenes hochgeladenes Standbild löschen (Bilder aus der Playlist bleiben) */
function dropStandby(screen) {
  if (screen.standby?.file) fs.rm(path.join(UPLOAD_DIR, screen.standby.file), { force: true }, () => {});
  screen.standby = null;
}

const audioOf = (screen) => ({ enabled: !!screen.audio, volume: screen.volume ?? 80 });

/** Ton-Einstellungen ändern, ohne den laufenden Inhalt neu aufzubauen */
function pushAudio(screen) {
  for (const ws of screenSockets.get(screen.id) ?? []) send(ws, { type: 'audio', ...audioOf(screen) });
}

// ---------------------------------------------------------------------------
// Wiedergabe-Kontrolle: Screens melden, was sie wirklich anzeigen
// ---------------------------------------------------------------------------

const CONFIRM_TIMEOUT = 10000;
const MAX_RETRIES = 3;
const CONFIRMED_STATES = ['showing', 'playing', 'paused', 'idle'];

function isConfirmed(screen) {
  const r = screen.report;
  const item = itemById(screen.currentItemId);
  if (!r || r.mode !== modeOf(screen)) return false;
  if (isHidden(screen)) return true; // Inhalt ist verdeckt, Standbild/Dunkel bestätigt
  if (!CONFIRMED_STATES.includes(r.state)) return false;
  if (!item) return r.itemId === null;
  return r.itemId === item.id && r.updatedAt === item.updatedAt;
}

function handleStatus(screen, msg) {
  const report = {
    itemId: msg.itemId ?? null,
    updatedAt: msg.updatedAt ?? null,
    state: String(msg.state ?? ''),
    detail: msg.detail ? String(msg.detail).slice(0, 200) : null,
    audio: ['on', 'off', 'blocked'].includes(msg.audio) ? msg.audio : null, // nur bei Videos
    mode: MODES.includes(msg.mode) ? msg.mode : null,
  };
  screen.lastSeen = Date.now();
  const prev = screen.report;
  if (prev && Object.keys(report).every((k) => prev[k] === report[k])) return;
  screen.report = { ...report, at: Date.now() };
  // Letzten Stand der Wiedergabe im Verlauf festhalten
  const entry = screen.history?.[0];
  if (entry && !entry.end && entry.itemId === report.itemId) entry.status = report.state;
  changed();
}

/** Video-Position nur an die Verwaltungen weiterreichen (nicht speichern) */
function relayProgress(screen, msg) {
  const out = {
    type: 'progress',
    screenId: screen.id,
    itemId: msg.itemId ?? null,
    currentTime: Number(msg.currentTime) || 0,
    duration: Number(msg.duration) || 0,
  };
  for (const ws of adminSockets) send(ws, out);
}

// Nicht bestätigte Screens bekommen ihren Inhalt erneut (max. MAX_RETRIES Mal)
setInterval(() => {
  let dirty = false;
  for (const s of state.screens) {
    if (!isOnline(s.id) || isConfirmed(s)) continue;
    if (Date.now() - (s.sentAt ?? 0) < CONFIRM_TIMEOUT || (s.retries ?? 0) >= MAX_RETRIES) continue;
    s.retries = (s.retries ?? 0) + 1;
    s.sentAt = Date.now();
    console.log(`[Kontrolle] ${s.name}: nicht bestätigt (${s.report?.state ?? 'keine Meldung'}), Neuversuch ${s.retries}/${MAX_RETRIES}`);
    pushToScreen(s, { force: true, retry: true });
    dirty = true;
  }
  if (dirty) changed();
}, 3000);

function stateForAdmin() {
  return {
    ...state,
    screens: state.screens.map((s) => ({ ...s, nextAuto: previewNext(s) })),
    online: state.screens.filter((s) => isOnline(s.id)).map((s) => s.id),
    serverTime: Date.now(),
  };
}

function changed() {
  save();
  const msg = { type: 'state', state: stateForAdmin() };
  for (const ws of adminSockets) send(ws, msg);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '1mb' }));
app.get('/', (req, res) => res.redirect('/admin'));
// Seiten mit eingebauter Versionskennung ausliefern. Ändert sich der Code, merken das
// offene Screens/Verwaltungen und laden sich selbst neu (siehe sendVersion).
const PAGE_FILES = {
  admin: ['admin.html', 'admin.js', 'admin.css', 'fonts.js'],
  screen: ['screen.html', 'fonts.js'],
};
function pageVersion(page) {
  return PAGE_FILES[page]
    .map((f) => Math.round(fs.statSync(path.join(__dirname, 'public', f)).mtimeMs).toString(36))
    .join('.');
}
function sendPage(page) {
  return (req, res) => {
    const html = fs.readFileSync(path.join(__dirname, 'public', page + '.html'), 'utf8');
    res.set('Cache-Control', 'no-cache').type('html').send(html.replaceAll('{{VERSION}}', pageVersion(page)));
  };
}
app.get('/admin', sendPage('admin'));
app.get('/screen', sendPage('screen'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, newId() + newId() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
});

app.get('/api/state', (req, res) => res.json(stateForAdmin()));

app.get('/api/info', (req, res) => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  res.json({ port: PORT, addresses });
});

// --- Playlist ---------------------------------------------------------------

const toDuration = (v) => Math.max(0, Math.min(86400, Math.round(Number(v) || 0)));

app.post('/api/playlist', (req, res) => {
  const { type, src, title, text, bg, color, duration, showCountdown, font, edge } = req.body ?? {};
  let item;
  if (type === 'url') {
    if (!/^https?:\/\//i.test(src ?? '')) return res.status(400).json({ error: 'Ungültige URL' });
    item = { type, src, title: title || src };
  } else if (type === 'text') {
    if (!text?.trim()) return res.status(400).json({ error: 'Text fehlt' });
    item = {
      type,
      text,
      bg: bg || '#000000',
      color: color || '#ffffff',
      title: title || text.trim().split('\n')[0].slice(0, 60),
      duration: toDuration(duration), // Sekunden, 0 = bis zum nächsten Wechsel
      showCountdown: !!showCountdown,
      font: toFont(font),
      edge: toEdge(edge),
    };
  } else {
    return res.status(400).json({ error: 'Unbekannter Typ' });
  }
  Object.assign(item, { id: newId(), enabled: true, updatedAt: Date.now() });
  state.playlist.push(item);
  redistributeAfterPlaylistChange();
  changed();
  res.json(item);
});

// Inhalts-Prüfsumme zur Erkennung doppelter Dateien (unabhängig vom Dateinamen)
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// Ältere Einträge ohne Prüfsumme einmalig nachberechnen
async function backfillHashes() {
  let count = 0;
  for (const item of state.playlist) {
    if (!item.file || item.hash) continue;
    try {
      item.hash = await hashFile(path.join(UPLOAD_DIR, item.file));
      count++;
    } catch {}
  }
  if (count) changed();
}

app.post('/api/upload', upload.array('files'), async (req, res) => {
  const skipDuplicates = (req.query.duplicates ?? state.settings.duplicates) !== 'add';
  const added = [];
  const skipped = [];
  for (const f of req.files ?? []) {
    // multer liefert den Dateinamen als latin1 – für Umlaute nach UTF-8 umwandeln
    const original = Buffer.from(f.originalname, 'latin1').toString('utf8');
    const hash = await hashFile(f.path);
    // Doppelt = gleicher Inhalt wie ein Playlist-Eintrag oder eine Datei aus demselben Upload
    const existing = state.playlist.find((i) => i.hash === hash) ?? added.find((i) => i.hash === hash);
    if (existing && skipDuplicates) {
      fs.rm(f.path, { force: true }, () => {});
      skipped.push({ name: original, existing: existing.title });
      continue;
    }
    added.push({
      id: newId(),
      type: f.mimetype.startsWith('video/') ? 'video' : 'image',
      src: '/uploads/' + f.filename,
      file: f.filename,
      hash,
      title: original.replace(/\.[^.]+$/, ''),
      enabled: true,
      updatedAt: Date.now(),
    });
  }
  state.playlist.push(...added);
  if (added.length) {
    redistributeAfterPlaylistChange();
    changed();
  }
  res.json({ added, skipped });
});

app.put('/api/playlist/order', (req, res) => {
  const ids = req.body?.ids ?? [];
  const pos = new Map(ids.map((id, i) => [id, i]));
  state.playlist.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  redistributeAfterPlaylistChange();
  changed();
  res.json({ ok: true });
});

app.patch('/api/playlist/:id', (req, res) => {
  const item = itemById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
  const { title, enabled, text, bg, color, duration, showCountdown, font, edge } = req.body ?? {};
  if (typeof title === 'string') item.title = title;
  if (typeof enabled === 'boolean') item.enabled = enabled;
  if (item.type === 'text') {
    if (typeof text === 'string') item.text = text;
    if (typeof bg === 'string') item.bg = bg;
    if (typeof color === 'string') item.color = color;
    if (duration !== undefined) item.duration = toDuration(duration);
    if (typeof showCountdown === 'boolean') item.showCountdown = showCountdown;
    if (font !== undefined) item.font = toFont(font);
    if (edge !== undefined) item.edge = toEdge(edge);
  }
  item.updatedAt = Date.now();
  if (typeof enabled === 'boolean') redistributeAfterPlaylistChange();
  for (const s of state.screens) if (s.currentItemId === item.id) pushToScreen(s);
  changed();
  res.json(item);
});

app.delete('/api/playlist/:id', (req, res) => {
  const item = itemById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
  state.playlist = state.playlist.filter((i) => i !== item);
  for (const s of state.screens) {
    if (s.pinnedItemId === item.id) s.pinnedItemId = null;
    if (s.queue) s.queue = s.queue.filter((id) => id !== item.id);
    if (s.standby?.itemId === item.id) {
      s.standby = null;
      pushMode(s);
    }
  }
  if (item.file) fs.rm(path.join(UPLOAD_DIR, item.file), { force: true }, () => {});
  redistributeAfterPlaylistChange();
  changed();
  res.json({ ok: true });
});

// --- Screens ----------------------------------------------------------------

app.put('/api/screens/order', (req, res) => {
  const ids = req.body?.ids ?? [];
  const pos = new Map(ids.map((id, i) => [id, i]));
  state.screens.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  if (state.settings.distribution === 'order') distribute();
  changed();
  res.json({ ok: true });
});

app.patch('/api/screens/:id', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Nicht gefunden' });
  const { name, pinnedItemId, audio, volume, mode, standbyItemId } = req.body ?? {};
  const { standbyStyle } = req.body ?? {};
  if (standbyStyle && typeof standbyStyle === 'object') {
    const prev = screen.standbyStyle ?? {};
    const next = { ...prev, ...standbyStyle };
    screen.standbyStyle = {
      text: String(next.text ?? '').slice(0, 2000),
      font: toFont(next.font),
      color: /^#[0-9a-f]{6}$/i.test(next.color ?? '') ? next.color : '#ffffff',
      position: STANDBY_POSITIONS.includes(next.position) ? next.position : 'center',
      edge: toEdge(next.edge),
    };
    pushMode(screen);
  }
  if (standbyItemId !== undefined) {
    // Standbild aus der Playlist wählen (null = kein Bild)
    const item = itemById(standbyItemId);
    if (standbyItemId && item?.type !== 'image') return res.status(400).json({ error: 'Kein Bild' });
    dropStandby(screen);
    if (item) screen.standby = { src: item.src, title: item.title, itemId: item.id };
    pushMode(screen);
  }
  if (mode !== undefined) setMode(screen, mode);
  if (typeof name === 'string' && name.trim()) {
    screen.name = name.trim();
    pushToScreen(screen);
  }
  if (typeof audio === 'boolean' || volume !== undefined) {
    if (typeof audio === 'boolean') screen.audio = audio;
    if (volume !== undefined) screen.volume = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    pushAudio(screen);
  }
  if (pinnedItemId !== undefined) {
    screen.pinnedItemId = pinnedItemId && itemById(pinnedItemId) ? pinnedItemId : null;
    // Dieser Screen und die Screens, die den jetzt fest vergebenen Inhalt bisher zusätzlich zeigen
    const duplicates = state.screens
      .filter((s) => s !== screen && !s.pinnedItemId && s.currentItemId === screen.pinnedItemId)
      .map((s) => s.id);
    advanceScreens([screen.id, ...duplicates], 'Freigabe');
  }
  changed();
  res.json(screen);
});

// --- Warteschlange ------------------------------------------------------------

app.post('/api/screens/:id/queue', (req, res) => {
  const screen = screenById(req.params.id);
  const item = itemById(req.body?.itemId);
  if (!screen || !item) return res.status(404).json({ error: 'Nicht gefunden' });
  screen.queue ??= [];
  if (screen.queue.length >= QUEUE_LIMIT) return res.status(400).json({ error: 'Warteschlange ist voll' });
  screen.queue.push(item.id);
  const position = screen.queue.length;
  // Zeigt der Screen gerade nichts, sofort starten
  if (!screen.currentItemId && isActive(screen)) advanceScreens([screen.id], 'Warteschlange');
  changed();
  res.json({ position });
});

app.delete('/api/screens/:id/queue', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Nicht gefunden' });
  screen.queue = [];
  changed();
  res.json({ ok: true });
});

app.delete('/api/screens/:id/queue/:index', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Nicht gefunden' });
  screen.queue?.splice(Number(req.params.index), 1);
  changed();
  res.json({ ok: true });
});

// Eingereihten Eintrag sofort abspielen
app.post('/api/screens/:id/queue/:index/play', (req, res) => {
  const screen = screenById(req.params.id);
  const [id] = screen?.queue?.splice(Number(req.params.index), 1) ?? [];
  if (!id) return res.status(404).json({ error: 'Nicht gefunden' });
  screen.queue.unshift(id);
  advanceOrReplay(screen, 'Warteschlange');
  changed();
  res.json({ ok: true });
});

// Diesen Screen sofort weiterschalten (Warteschlange zuerst)
app.post('/api/screens/:id/next', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Nicht gefunden' });
  advanceOrReplay(screen, 'Manuell');
  changed();
  res.json({ ok: true });
});

// Position im laufenden Video bzw. im Text-Countdown setzen (Sekunden)
app.post('/api/screens/:id/seek', (req, res) => {
  const screen = screenById(req.params.id);
  const time = Number(req.body?.time);
  if (!screen || !screen.currentItemId || !Number.isFinite(time)) return res.status(400).json({ error: 'Ungültig' });
  for (const ws of screenSockets.get(screen.id) ?? []) send(ws, { type: 'seek', itemId: screen.currentItemId, time });
  res.json({ ok: true });
});

// Alle Screens auf einmal: Play / Pause / Bild / Dunkel
app.post('/api/screens/mode', (req, res) => {
  const mode = req.body?.mode;
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'Unbekannter Modus' });
  for (const s of state.screens) setMode(s, mode);
  changed();
  res.json({ ok: true });
});

// Eigenes Standbild für einen Screen hochladen
app.post('/api/screens/:id/standby', upload.single('file'), (req, res) => {
  const screen = screenById(req.params.id);
  const f = req.file;
  if (!screen || !f || !f.mimetype.startsWith('image/')) {
    if (f) fs.rm(f.path, { force: true }, () => {});
    return res.status(400).json({ error: screen ? 'Bitte ein Bild hochladen' : 'Nicht gefunden' });
  }
  dropStandby(screen);
  const title = Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/\.[^.]+$/, '');
  screen.standby = { src: '/uploads/' + f.filename, file: f.filename, title };
  pushMode(screen);
  changed();
  res.json(screen.standby);
});

app.delete('/api/screens/:id', (req, res) => {
  const removed = screenById(req.params.id);
  if (removed) dropStandby(removed);
  state.screens = state.screens.filter((s) => s.id !== req.params.id);
  for (const ws of screenSockets.get(req.params.id) ?? []) send(ws, { type: 'removed' });
  changed();
  res.json({ ok: true });
});

app.post('/api/screens/:id/identify', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Nicht gefunden' });
  for (const ws of screenSockets.get(screen.id) ?? []) send(ws, { type: 'identify', name: screen.name });
  res.json({ ok: true });
});

app.post('/api/screens/:id/resend', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Nicht gefunden' });
  pushToScreen(screen, { force: true });
  changed();
  res.json({ ok: true });
});

app.post('/api/screens/:id/reload', (req, res) => {
  for (const ws of screenSockets.get(req.params.id) ?? []) send(ws, { type: 'reload' });
  res.json({ ok: true });
});

// --- Steuerung --------------------------------------------------------------

app.patch('/api/settings', (req, res) => {
  const { distribution, autoAdvance, interval } = req.body ?? {};
  const s = state.settings;
  let redistribute = false;
  if (distribution === 'order' || distribution === 'random') {
    redistribute = distribution !== s.distribution;
    s.distribution = distribution;
  }
  if (typeof autoAdvance === 'boolean') s.autoAdvance = autoAdvance;
  if (interval !== undefined) s.interval = Math.max(3, Math.min(86400, Number(interval) || 30));
  if (req.body?.duplicates === 'skip' || req.body?.duplicates === 'add') s.duplicates = req.body.duplicates;
  if (redistribute) distribute();
  restartTimer();
  changed();
  res.json(s);
});

app.post('/api/next', (req, res) => {
  if (timer) restartTimer(); // Countdown nach manuellem Weiterschalten neu starten
  advance(true);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ---------------------------------------------------------------------------
// Server starten
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  if (params.get('role') === 'screen') {
    const id = (params.get('id') ?? '').trim().slice(0, 64);
    if (!id) return ws.close();

    let screen = screenById(id);
    if (!screen) {
      screen = {
        id,
        name: params.get('name')?.trim() || `Screen ${state.screens.length + 1}`,
        pinnedItemId: null,
        currentItemId: null,
        history: [],
      };
      state.screens.push(screen);
      advanceScreens([id], 'Start');
    }
    screen.ip = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    screen.userAgent = req.headers['user-agent'];
    screen.lastSeen = Date.now();

    if (!screenSockets.has(id)) screenSockets.set(id, new Set());
    screenSockets.get(id).add(ws);
    ws.page = 'screen';
    sendVersion(ws);
    pushToScreen(screen);
    changed();

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      const s = screenById(id);
      if (!s) return;
      if (msg.type === 'status') handleStatus(s, msg);
      else if (msg.type === 'progress') relayProgress(s, msg);
      else if (msg.type === 'ended') onItemEnded(s, msg);
    });

    ws.on('close', () => {
      screenSockets.get(id)?.delete(ws);
      const s = screenById(id);
      if (s) {
        s.lastSeen = Date.now();
        if (!isOnline(id)) s.report = null;
      }
      changed();
    });
  } else {
    adminSockets.add(ws);
    ws.page = 'admin';
    sendVersion(ws);
    send(ws, { type: 'state', state: stateForAdmin() });
    ws.on('close', () => adminSockets.delete(ws));
  }
});

// Aktuelle Code-Version an Screen/Verwaltung; weicht sie von der geladenen Seite ab, lädt diese neu
function sendVersion(ws) {
  try {
    send(ws, { type: 'version', version: pageVersion(ws.page) });
  } catch {}
}

// Geänderte Dateien in public/ (z. B. nach einem Update) sofort an alle melden
let versionTimer = null;
fs.watch(path.join(__dirname, 'public'), () => {
  clearTimeout(versionTimer);
  versionTimer = setTimeout(() => wss.clients.forEach(sendVersion), 1000);
});

// Tote Verbindungen (z. B. Tablet im Standby) erkennen
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) ws.terminate();
    else {
      ws.isAlive = false;
      ws.ping();
    }
  }
}, 15000);

restartTimer();
backfillHashes();

server.listen(PORT, () => {
  console.log(`ScreenDeck läuft auf Port ${PORT}`);
  console.log(`  Verwaltung: http://localhost:${PORT}/admin`);
  for (const a of Object.values(os.networkInterfaces()).flat()) {
    if (a && a.family === 'IPv4' && !a.internal) console.log(`  Screens:    http://${a.address}:${PORT}/screen`);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    saveNow();
    process.exit(0);
  });
}
