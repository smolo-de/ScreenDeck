import { execFile } from 'node:child_process';
import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import multicastDns from 'multicast-dns';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Ports (Hauptport und Zusatz-Port) kommen aus ⚙ Einstellungen → Netzwerk, siehe nach dem Laden des Zustands
let shortPort = null; // Port, unter dem die kurze Adresse tatsächlich erreichbar ist
const withPort = (host, port) => `http://${host}${port === 80 ? '' : ':' + port}`;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Alte Verteilung „Zufall“ = jeder Screen eigenes, zufällige Reihenfolge */
function migrateSettings(settings) {
  if (settings.distribution === 'random') return { ...settings, distribution: 'order', shuffle: true };
  return settings;
}

const DEFAULT_SETTINGS = {
  distribution: 'order', // 'order' = jeder Screen zeigt etwas anderes, 'sync' = alle Screens zeigen dasselbe
  shuffle: false, // Reihenfolge der Playlist: false = der Reihe nach, true = Zufall (gilt für beide Arten)
  autoAdvance: false,
  interval: 30, // Sekunden
  imageQuality: 'original', // Bilder vor der Übertragung verkleinern: original | uhd | fhd | hd | low
  screenMenu: true, // Antippen zeigt auf den Screens ein Menü (Name, Vollbild, …)
  touchZoom: true, // Inhalte auf den Screens per Fingergeste vergrößern
  hostName: 'screendeck', // Name im Netzwerk: http://screendeck.local:<Port> (leer = aus)
  port: 3000, // Hauptport (wirkt nach einem Neustart)
  extraPort: 80, // zusätzlicher Port für Adressen ohne Portangabe (80) oder ein anderer freier; 0 = aus
  duplicates: 'skip', // doppelte Dateien beim Upload: 'skip' = aussortieren, 'add' = trotzdem hinzufügen
};

// Mehrere Playlisten: state.playlists = [{ id, name, items }], state.playlist zeigt auf die Einträge der
// aktiven Playlist (die auf den Screens läuft). Eine frühere einzelne Playlist wird zur ersten.
function loadState() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  const playlists = Array.isArray(saved.playlists) && saved.playlists.length
    ? saved.playlists
    : [{ id: 'main', name: 'Playlist', items: saved.playlist ?? [] }];
  const active = playlists.find((p) => p.id === saved.activePlaylistId) ?? playlists[0];
  return {
    screens: (saved.screens ?? []).map((s) => ({ ...s, report: null })),
    playlists,
    activePlaylistId: active.id,
    playlist: active.items,
    settings: migrateSettings({ ...DEFAULT_SETTINGS, ...saved.settings }),
    syncQueue: saved.syncQueue ?? [],
    auth: saved.auth ?? {},
    music: saved.music ?? null,
    nextAt: null,
  };
}

const state = loadState();

// Ports: Umgebungsvariable (PORT, EXTRA_PORT) vor Einstellung vor Standard.
// Der Hauptport gilt ab Start; den Zusatz-Port kann die Verwaltung im laufenden Betrieb ändern.
const validPort = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 65535 ? Number(v) : null);
const PORT = validPort(process.env.PORT) || validPort(state.settings.port) || 3000;
const EXTRA_FROM_ENV = process.env.EXTRA_PORT !== undefined;
const extraPortSetting = () => (EXTRA_FROM_ENV ? validPort(process.env.EXTRA_PORT) ?? 0 : validPort(state.settings.extraPort) ?? 80);

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  const { nextAt, playlist, ...persisted } = state; // playlist steckt schon in playlists
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

const itemById = (id) => state.playlist.find((i) => i.id === id);
/** Einträge aller Playlisten (für Dateien, die auch in einer gerade nicht aktiven Playlist stecken) */
const allItems = () => state.playlists.flatMap((p) => p.items);
const anyItemById = (id) => allItems().find((i) => i.id === id);
/** Liste der Playlist, die eine Anfrage bearbeitet (Verwaltung kann auch nicht aktive Playlisten bearbeiten) */
const targetList = (req) => state.playlists.find((p) => p.id === (req.query?.playlist ?? req.body?.playlist))?.items ?? state.playlist;
/** Playlist-Liste, in der ein Eintrag steckt */
const listOf = (item) => state.playlists.find((p) => p.items.includes(item))?.items ?? state.playlist;
const screenById = (id) => state.screens.find((s) => s.id === id);
const newId = () => crypto.randomUUID().slice(0, 8);

// ---------------------------------------------------------------------------
// Verteilung der Playlist auf die Screens
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 50;
// Fester Inhalt: per Fernsteuerung gewählt (Vorrang) oder in der Verwaltung fest zugeordnet
const pinnedOf = (s) => {
  const id = s.remote?.itemId ?? s.pinnedItemId;
  return id && itemById(id) ? id : null;
};
// Fernsteuerungen überstehen keinen Neustart (das steuernde Gerät muss sie neu starten)
for (const s of state.screens) delete s.remote;

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
  scheduleScreen(screen, { awaitShow: true });
  pushToScreen(screen);
}

// ---------------------------------------------------------------------------
// Sync-Modus: alle nicht fest zugeordneten Screens zeigen denselben Inhalt.
// Videos starten zu einem gemeinsamen Zeitpunkt (sync.start, Serverzeit) und
// die Screens gleichen ihre Position laufend daran an.
// ---------------------------------------------------------------------------

const SYNC_LEAD = 2000; // Vorlauf, damit alle Screens laden können, bevor es losgeht
let sync = { itemId: null, start: 0 };
const isSyncMode = () => state.settings.distribution === 'sync';
const isShuffle = () => !!state.settings.shuffle;
const inSync = (s) => isSyncMode() && !pinnedOf(s);
const syncGroup = () => state.screens.filter(inSync);

/** Gemeinsame Startzeit für den Screen (nur wenn er den Sync-Inhalt zeigt) */
const syncMsg = (screen) =>
  inSync(screen) && screen.currentItemId && screen.currentItemId === sync.itemId ? { start: sync.start } : null;

function pushSync(screen) {
  for (const ws of screenSockets.get(screen.id) ?? []) send(ws, { type: 'sync', sync: syncMsg(screen), serverTime: Date.now() });
}

/** Alle Screens der Gruppe starten gemeinsam mit diesem Inhalt (gleicher Inhalt = von vorne) */
function startSync(itemId, reason) {
  sync = { itemId, start: Date.now() + SYNC_LEAD };
  for (const s of syncGroup()) {
    if (modeOf(s) === 'pause') continue; // angehaltene Screens bleiben stehen, steigen bei „Play“ wieder ein
    if (s.currentItemId === itemId) {
      scheduleScreen(s); // neue Runde: volle Zeit für Bilder/Texte
      pushSync(s);
    } else assign(s, itemId, reason);
  }
}

/** Gruppe weiterschalten: gemeinsame Warteschlange → nächster Playlist-Eintrag */
function syncAdvance(reason) {
  const queued = takeFromQueue(state.syncQueue);
  const rotation = rotationItems();
  const pick = isShuffle() ? pickRandom : pickNext; // alle gleich: gemeinsam der Reihe nach oder zufällig
  const next = queued ?? (rotation.length ? pick(rotation, new Set(), sync.itemId) : null);
  startSync(next, queued ? 'Warteschlange' : reason);
}

/** Warteschlange des Screens; im Sync-Modus teilt sich die Gruppe eine gemeinsame */
const queueOf = (screen) => (inSync(screen) ? (state.syncQueue ??= []) : (screen.queue ??= []));

/**
 * Komplette Neuverteilung (Moduswechsel, neue Screen-Reihenfolge):
 * der Reihe nach = Screen 1 zeigt Eintrag 1, Screen 2 Eintrag 2 …, sonst per Zufall.
 */
function distribute() {
  const rotation = rotationItems();
  if (isSyncMode()) {
    // Mit dem Inhalt weitermachen, den der erste Screen der Gruppe gerade zeigt
    const current = syncGroup().map((s) => s.currentItemId).find((id) => rotation.some((i) => i.id === id));
    if (rotation.length) startSync(current ?? rotation[0].id, 'Sync');
  }
  const used = new Set(state.screens.map(pinnedOf).filter(Boolean));
  let n = 0;
  for (const s of state.screens) {
    if (inSync(s)) continue;
    let next = pinnedOf(s);
    if (!next && rotation.length) {
      next = isShuffle()
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
  if (isSyncMode()) {
    const group = ids.map(screenById).filter((s) => s && inSync(s));
    if (group.length) {
      // Neue / abweichende Screens steigen in den laufenden Sync-Inhalt ein, sonst schaltet die ganze Gruppe weiter
      const syncValid = rotation.some((i) => i.id === sync.itemId);
      const joining = syncValid && !state.syncQueue?.length && group.every((s) => s.currentItemId !== sync.itemId);
      if (joining) for (const s of group) assign(s, sync.itemId, 'Sync');
      else syncAdvance(reason);
    }
    ids = ids.filter((id) => !group.some((s) => s.id === id));
  }
  const used = new Set();
  for (const s of state.screens) {
    if (pinnedOf(s)) used.add(s.pinnedItemId);
    else if (!ids.includes(s.id) && s.currentItemId && !isHidden(s)) used.add(s.currentItemId);
  }
  for (const s of state.screens) {
    if (!ids.includes(s.id)) continue;
    // Reihenfolge: Warteschlange → fest zugeordneter Inhalt → Playlist
    const queued = s.remote ? null : takeFromQueue(s.queue);
    let next = queued ?? pinnedOf(s);
    if (!next && rotation.length) {
      next = isShuffle()
        ? pickRandom(rotation, used, s.currentItemId)
        : pickNext(rotation, used, s.currentItemId);
    }
    if (next) used.add(next);
    assign(s, next, queued ? 'Warteschlange' : pinnedOf(s) ? 'Fest' : reason);
  }
}

// ---------------------------------------------------------------------------
// Fernsteuerung: Ein Screen (z. B. Smartphone) steuert andere (z. B. Fernseher). Die Gruppe zeigt
// denselben Eintrag, der automatische Wechsel ruht; weitergeschaltet wird am steuernden Gerät.
// Dessen Zoom wird an die gesteuerten Screens weitergereicht (siehe WebSocket „remoteZoom“).
// ---------------------------------------------------------------------------

const REMOTE_GRACE = 120000; // so lange darf das steuernde Gerät weg sein (z. B. Bildschirmsperre)
const remoteTargets = (ctrl) => (ctrl.remote?.targets ?? []).map(screenById).filter(Boolean);
const remoteGroup = (ctrl) => [ctrl, ...remoteTargets(ctrl)];

/** Fernsteuerungs-Angaben für einen Screen (Rolle und beteiligte Screens; key = Schlüssel fürs Hochladen) */
function remoteMsg(screen) {
  const r = screen.remote;
  if (r?.role === 'controller') return { role: 'controller', targets: remoteTargets(screen).map((t) => t.name), key: r.key };
  if (r?.role === 'target') return { role: 'target', by: screenById(r.by)?.name ?? '' };
  return null;
}

/** Ganze Gruppe auf einen Eintrag schalten */
function remoteShow(ctrl, itemId) {
  for (const s of remoteGroup(ctrl)) {
    s.remote.itemId = itemId;
    if (s.currentItemId !== itemId) assign(s, itemId, 'Fernsteuerung');
  }
}

/** Screen aus einer Fernsteuerung lösen (als Ziel) bzw. seine eigene Steuerung beenden */
function leaveRemote(screen) {
  const r = screen.remote;
  if (!r) return;
  if (r.role === 'controller') return stopRemote(screen);
  const ctrl = screenById(r.by);
  if (ctrl?.remote) {
    ctrl.remote.targets = ctrl.remote.targets.filter((id) => id !== screen.id);
    pushToScreen(ctrl); // Leiste am steuernden Gerät aktualisieren
  }
  delete screen.remote;
  scheduleScreen(screen); // läuft ab jetzt wieder normal weiter
  pushToScreen(screen);
}

function startRemote(ctrl, targetIds) {
  leaveRemote(ctrl);
  const targets = [...new Set(Array.isArray(targetIds) ? targetIds : [])]
    .map(screenById)
    .filter((t) => t && t !== ctrl);
  for (const t of targets) leaveRemote(t);
  const itemId = pinnedOf(ctrl) ?? ctrl.currentItemId ?? state.playlist.find((i) => i.enabled)?.id ?? null;
  // key: Schlüssel, mit dem nur dieses Gerät während der Fernsteuerung Dateien hochladen darf
  ctrl.remote = { role: 'controller', targets: targets.map((t) => t.id), itemId, key: crypto.randomBytes(16).toString('hex') };
  for (const t of targets) t.remote = { role: 'target', by: ctrl.id, itemId };
  for (const g of remoteGroup(ctrl)) if (modeOf(g) !== 'play') setMode(g, 'play'); // gesteuerte Inhalte sichtbar machen
  remoteShow(ctrl, itemId);
  for (const g of remoteGroup(ctrl)) pushToScreen(g); // Rolle bekannt geben
  pushRemoteSound(ctrl);
}

/**
 * Screen, dessen Ton die Fernbedienung steuert: frei wählbar (auch einer, der nicht mitläuft),
 * sonst der erste gesteuerte Screen
 */
const soundTarget = (ctrl) => {
  const s = screenById(ctrl.remote?.soundId);
  return s && s !== ctrl ? s : remoteTargets(ctrl)[0] ?? null;
};

/** Ton des gewählten Screens für die Fernbedienung, dazu die Auswahl aller anderen Screens */
function remoteSoundMsg(ctrl) {
  const t = soundTarget(ctrl);
  const m = music();
  return {
    type: 'remoteSound',
    screenId: t?.id ?? null,
    screens: state.screens
      .filter((x) => x !== ctrl)
      .map((x) => ({ id: x.id, name: x.name, online: isOnline(x.id) }))
      .sort((a, b) => b.online - a.online),
    music: {
      muted: !t?.music || !!t.musicMuted,
      volume: t?.musicVolume ?? 100,
      playing: m.playing,
      title: musicItem(m.currentId)?.title ?? '',
      tracks: m.items.length,
      behavior: m.videoBehavior, // bei Video mit Ton: duck | pause | none (gilt für alle Screens)
      duckLevel: m.duckLevel,
    },
    video: { enabled: !!t?.audio, volume: t?.volume ?? 80 },
  };
}
/** Fernbedienungen über geänderten Ton informieren (Screen ist steuerndes Gerät oder dessen Ton-Ziel) */
function pushRemoteSound(screen) {
  for (const c of state.screens) {
    if (c.remote?.role !== 'controller' || (c !== screen && soundTarget(c) !== screen)) continue;
    for (const ws of screenSockets.get(c.id) ?? []) send(ws, remoteSoundMsg(c));
  }
}

/** Fernbedienung: Musik und Video-Ton des gewählten Screens, Musiktitel weiterschalten */
function remoteSound(ctrl, msg) {
  if (msg.screenId !== undefined) {
    const s = screenById(msg.screenId);
    if (s && s !== ctrl) ctrl.remote.soundId = s.id;
  }
  const mu = msg.music ?? {};
  const vi = msg.video ?? {};
  const videoChange = typeof vi.enabled === 'boolean' || vi.volume !== undefined;
  for (const t of [soundTarget(ctrl)].filter(Boolean)) {
    if (mu.muted === false) t.music = true; // Lautschalten spielt die Musik auch dort, wo sie aus war
    if (mu.volume !== undefined || typeof mu.muted === 'boolean') setMusicVolume(t, mu);
    if (typeof vi.enabled === 'boolean') t.audio = vi.enabled;
    if (vi.volume !== undefined) t.volume = Math.max(0, Math.min(100, Math.round(Number(vi.volume) || 0)));
    if (videoChange) pushAudio(t);
  }
  if (videoChange) updateVideoSound(true);
  const m = music();
  // Musik bei Video mit Ton: Verhalten und Stufe (wie in der Verwaltung, gilt für alle Screens)
  const d = msg.duck ?? {};
  if (d.level !== undefined) m.duckLevel = Math.max(0, Math.min(100, Math.round(Number(d.level) || 0)));
  if (['duck', 'pause', 'none'].includes(d.behavior) && d.behavior !== m.videoBehavior) {
    m.videoBehavior = d.behavior;
    applyVideoBehavior();
  }
  if (d.level !== undefined || d.behavior) pushMusic();
  if (msg.track === 'next') musicStep(1);
  else if (msg.track === 'prev') musicBack();
  else if (msg.track === 'play' && !m.playing) musicPlay(m.currentId, m.position);
  else if (msg.track === 'pause' && m.playing) musicPause();
  pushRemoteSound(ctrl);
}

function stopRemote(ctrl) {
  const group = remoteGroup(ctrl);
  for (const g of group) {
    delete g.remote;
    scheduleScreen(g); // aktueller Inhalt bleibt, danach geht es normal weiter
    pushToScreen(g);
  }
}

/** Vorschaubild eines Eintrags (wie in der Verwaltung): Bilder verkleinert, Videos mit Standbild, sonst keins */
function thumbOf(item) {
  if (item.type === 'image') return /\.(gif|svg)(\?|$)/i.test(decodeURIComponent(item.src ?? '')) ? item.src : `/img/${item.id}/thumb?v=${item.updatedAt}`;
  if (item.type === 'video') return item.thumb ?? null;
  return null;
}
/** Aktive Playlist für die Fernbedienung (nur eingeschaltete Einträge, in Playlist-Reihenfolge) */
function remotePlaylistMsg() {
  return {
    type: 'remotePlaylist',
    name: state.playlists.find((p) => p.id === state.activePlaylistId)?.name ?? '',
    activeId: state.activePlaylistId,
    playlists: state.playlists.map((p) => ({ id: p.id, name: p.name, count: p.items.length })), // zum Wechseln
    items: state.playlist
      .filter((i) => i.enabled)
      .map((i) => ({ id: i.id, title: i.title, type: i.type, thumb: thumbOf(i), ...(i.type === 'text' && { bg: i.bg, color: i.color, text: String(i.text ?? '').slice(0, 80) }) })),
  };
}
/** Playlist an alle steuernden Geräte schicken (nach Änderungen an der aktiven Playlist) */
function pushRemotePlaylist() {
  const ctrls = state.screens.filter((c) => c.remote?.role === 'controller');
  if (!ctrls.length) return;
  const msg = remotePlaylistMsg();
  for (const c of ctrls) for (const ws of screenSockets.get(c.id) ?? []) send(ws, msg);
}

/**
 * Fernbedienung: andere Playlist auf den Screens abspielen bzw. eine neue (leere) anlegen und abspielen –
 * Uploads vom Smartphone landen dann direkt darin. Die Gruppe zeigt den ersten Eintrag (bzw. nichts).
 */
function remotePlaylistSwitch(ctrl, msg) {
  let p;
  if (msg.action === 'newPlaylist') {
    p = { id: newId(), name: String(msg.name ?? '').trim().slice(0, 60) || 'Neue Playlist', items: [] };
    state.playlists.push(p);
  } else p = state.playlists.find((x) => x.id === msg.id);
  if (!p) return;
  if (p.id !== state.activePlaylistId) activatePlaylist(p);
  remoteShow(ctrl, state.playlist.find((i) => i.enabled)?.id ?? null);
  pushRemotePlaylist();
}

/**
 * Fernbedienung: Einträge aus der aktiven Playlist löschen (wie in der Verwaltung: hochgeladene Dateien nur,
 * wenn sie nirgends mehr verwendet werden; Dateien aus Medienordnern bleiben). Läuft gerade einer davon,
 * zeigt die Gruppe den nächsten verbleibenden Eintrag.
 */
function remoteDelete(ctrl, ids) {
  const gone = new Set((Array.isArray(ids) ? ids : []).slice(0, 1000).map(String));
  const items = state.playlist.filter((i) => gone.has(i.id));
  if (!items.length) return;
  const shown = ctrl.remote.itemId;
  let next = null;
  if (gone.has(shown)) {
    // nächster nicht gelöschter, eingeschalteter Eintrag nach dem gezeigten (sonst davor)
    const list = state.playlist;
    const at = list.findIndex((i) => i.id === shown);
    const keep = (i) => i.enabled && !gone.has(i.id);
    next = list.slice(at + 1).find(keep) ?? list.slice(0, at).reverse().find(keep) ?? null;
  }
  for (const item of items) removeItem(item, state.playlist);
  if (gone.has(shown)) remoteShow(ctrl, next?.id ?? null);
  redistributeAfterPlaylistChange();
  pushRemotePlaylist();
  changed();
}

/** Am steuernden Gerät vor/zurück durch die aktiven Einträge der Playlist */
function remoteStep(ctrl, dir) {
  const items = state.playlist.filter((i) => i.enabled);
  if (!items.length) return;
  const idx = items.findIndex((i) => i.id === ctrl.currentItemId);
  const next = idx < 0 ? items[0] : items[(idx + dir + items.length) % items.length];
  remoteShow(ctrl, next.id);
}

function handleRemoteMessage(screen, msg, ws) {
  if (msg.type === 'remoteList') {
    // Auswahl am steuernden Gerät: alle anderen Screens, verbundene zuerst
    const screens = state.screens
      .filter((x) => x.id !== screen.id)
      .map((x) => ({ id: x.id, name: x.name, online: isOnline(x.id), selected: screen.remote?.targets?.includes(x.id) ?? false }))
      .sort((a, b) => b.online - a.online);
    return send(ws, { type: 'remoteList', screens });
  }
  if (msg.type === 'remoteZoom') {
    if (screen.remote?.role !== 'controller') return;
    const num = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
    const out = { type: 'zoom', itemId: String(msg.itemId ?? ''), s: num(msg.s, 1, 10), u: num(msg.u, -1, 2), v: num(msg.v, -1, 2) };
    for (const t of remoteTargets(screen)) for (const tws of screenSockets.get(t.id) ?? []) send(tws, out);
    return;
  }
  if (msg.type === 'remoteDraw') {
    // Stift: Striche (Punkte bezogen auf das Bild, 0–1) an die gesteuerten Screens weiterreichen
    if (screen.remote?.role !== 'controller') return;
    const id = String(msg.id ?? '').slice(0, 20);
    const pts = (Array.isArray(msg.pts) ? msg.pts.slice(0, 4000) : []).map((n) => Math.round(Math.min(2, Math.max(-1, Number(n) || 0)) * 10000) / 10000);
    const out = { type: 'draw', op: msg.op, id, itemId: String(msg.itemId ?? '') };
    if (msg.op === 'start') {
      out.color = /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : '#ef4444';
      out.size = Math.min(60, Math.max(1, Number(msg.size) || 8));
      out.pts = pts;
    } else if (msg.op === 'append') out.pts = pts;
    else if (msg.op !== 'undo' && msg.op !== 'clear') return;
    for (const t of remoteTargets(screen)) for (const tws of screenSockets.get(t.id) ?? []) send(tws, out);
    return;
  }
  if (msg.type === 'remotePlaylist') {
    if (screen.remote?.role !== 'controller') return;
    return send(ws, remotePlaylistMsg());
  }
  if (msg.type === 'remoteRotate') {
    // Drehung in Vierteldrehungen (im Uhrzeigersinn) an die gesteuerten Screens weiterreichen
    if (screen.remote?.role !== 'controller') return;
    const out = { type: 'rotate', itemId: String(msg.itemId ?? ''), r: ((Math.round(Number(msg.r)) || 0) % 4 + 4) % 4 };
    for (const t of remoteTargets(screen)) for (const tws of screenSockets.get(t.id) ?? []) send(tws, out);
    return;
  }
  if (msg.type === 'remoteSound') {
    if (screen.remote?.role !== 'controller') return;
    remoteSound(screen, msg);
    return changed();
  }
  // type 'remote': start | stop | next | prev
  if (msg.action === 'start' && !screen.remoteAllowed) return pushToScreen(screen); // nicht freigeschaltet
  if (msg.action === 'start') startRemote(screen, msg.targets);
  else if (msg.action === 'stop') leaveRemote(screen);
  else if (screen.remote?.role === 'controller' && (msg.action === 'next' || msg.action === 'prev')) remoteStep(screen, msg.action === 'next' ? 1 : -1);
  else if (screen.remote?.role === 'controller' && msg.action === 'show' && itemById(msg.itemId)) remoteShow(screen, msg.itemId); // aus der Playlist gewählt
  else if (screen.remote?.role === 'controller' && (msg.action === 'playlist' || msg.action === 'newPlaylist')) remotePlaylistSwitch(screen, msg);
  else if (screen.remote?.role === 'controller' && msg.action === 'delete') remoteDelete(screen, msg.itemIds);
  changed();
}

// ---------------------------------------------------------------------------
// Warteschlange pro Screen: eingereihte Inhalte laufen, sobald der aktuelle fertig ist
// ---------------------------------------------------------------------------

const QUEUE_LIMIT = 50;

/** Screen sofort weiterschalten; bleibt der Inhalt gleich (z. B. festes Video), von vorne starten */
function advanceOrReplay(screen, reason) {
  const before = screen.currentItemId;
  advanceScreens([screen.id], reason);
  if (screen.currentItemId === before && !inSync(screen)) {
    for (const ws of screenSockets.get(screen.id) ?? []) send(ws, { type: 'replay' });
  }
}

function takeFromQueue(queue) {
  while (queue?.length) {
    const id = queue.shift();
    if (itemById(id)) return id;
  }
  return null;
}

/** Voraussichtlich nächster Inhalt aus der Playlist (Anzeige „Als Nächstes“) */
function previewNext(screen) {
  if (pinnedOf(screen)) return { itemId: screen.pinnedItemId, kind: 'pinned' };
  const rotation = rotationItems();
  if (!rotation.length) return null;
  if (isShuffle()) return { itemId: null, kind: 'random' };
  if (isSyncMode()) return { itemId: pickNext(rotation, new Set(), sync.itemId), kind: 'sync' };
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
    .filter((s) =>
      pinnedOf(s) ? s.currentItemId !== s.pinnedItemId
      : inSync(s) && modeOf(s) === 'pause' ? !rotation.has(s.currentItemId) // angehalten: nur ersetzen, wenn der Inhalt weg ist
      : inSync(s) ? !rotation.has(sync.itemId) || s.currentItemId !== sync.itemId
      : !rotation.has(s.currentItemId)
    )
    .map((s) => s.id);
  if (invalid.length) advanceScreens(invalid, 'Playlist');
}

/** Inhalte mit eigener Laufzeit: Videos und Texte mit Anzeigedauer */
const isTimed = (item) => item?.type === 'video' || (item?.type === 'text' && item.duration > 0);

/** „Nächster Wechsel“: alle Screens im Modus „Play“ sofort weiterschalten (auch laufende Videos) */
function advance() {
  const ids = state.screens.filter((s) => isActive(s) && (!pinnedOf(s) || s.queue?.length)).map((s) => s.id);
  advanceScreens(ids, 'Manuell');
  changed();
}

/** Video zu Ende bzw. Anzeigedauer abgelaufen: nächster Inhalt, sonst (fest / nichts anderes da) von vorne */
function onItemEnded(screen, msg) {
  const item = itemById(screen.currentItemId);
  if (!item || msg.itemId !== item.id || !isActive(screen)) return;
  if (screen.history?.[0]?.itemId === item.id) screen.history[0].ended = true;
  const reason = item.type === 'video' ? 'Videoende' : 'Zeit abgelaufen';
  if (inSync(screen)) {
    // Der erste Screen, der fertig ist, schaltet die ganze Gruppe weiter (spätere Meldungen derselben Runde ignorieren)
    if (item.id === sync.itemId && Date.now() > sync.start + 3000) syncAdvance(reason);
    changed();
    return;
  }
  if (!pinnedOf(screen) || screen.queue?.length) advanceScreens([screen.id], reason);
  if (screen.currentItemId === item.id) {
    for (const ws of screenSockets.get(screen.id) ?? []) send(ws, { type: 'replay' });
  }
  changed();
}

// ---------------------------------------------------------------------------
// Automatisch wechseln: jeder Screen hat seinen eigenen Takt. Bilder, Webseiten
// und Texte ohne Anzeigedauer stehen ab ihrem Erscheinen genau „interval“ Sekunden.
// Videos und Texte mit Dauer bestimmen ihr Ende selbst (Videos laufen immer bis zum Ende).
// ---------------------------------------------------------------------------

const intervalMs = () => Math.max(3, Number(state.settings.interval) || 30) * 1000;

/** Fälligkeit des Screens neu setzen (ab jetzt), sofern sein Inhalt keine eigene Laufzeit hat */
/**
 * awaitShow: neuer Inhalt – die Zeit startet erst, wenn der Screen meldet, dass er sichtbar ist
 * (große Bilder / Netzlaufwerk brauchen zum Laden). Bis dahin gilt eine Rückfallzeit (z. B. Screen offline).
 */
function scheduleScreen(s, { awaitShow = false } = {}) {
  const item = itemById(s.currentItemId);
  const auto = state.settings.autoAdvance && item && !isTimed(item);
  s.awaitShow = auto && awaitShow && isOnline(s.id) ? item.id : null;
  s.dueAt = auto ? Date.now() + intervalMs() + (s.awaitShow ? CONFIRM_TIMEOUT : 0) : null;
  pushDue(s);
}

/** Screen meldet: Inhalt ist sichtbar (oder lädt nicht) – jetzt läuft die Auto-Zeit */
function startDueOnShow(screen, report) {
  if (!screen.awaitShow || report.itemId !== screen.awaitShow) return;
  if (!['showing', 'timeout', 'error', 'paused'].includes(report.state)) return;
  screen.awaitShow = null;
  if (screen.dueAt) {
    screen.dueAt = Date.now() + intervalMs();
    pushDue(screen);
  }
}

/** Restzeit der Auto-Zeit an den Screen (Anzeige der Spielzeit im Screen-Menü) */
function pushDue(s) {
  for (const ws of screenSockets.get(s.id) ?? []) send(ws, { type: 'due', dueAt: s.dueAt ?? null, duration: intervalMs(), serverTime: Date.now() });
}

/** Nach Änderung von „Automatisch wechseln“ / Intervall: alle Screens neu takten */
function restartTimer() {
  for (const s of state.screens) scheduleScreen(s);
}

// Fällige Screens weiterschalten (gemeinsam, damit eine Sync-Gruppe nur einmal wechselt)
setInterval(() => {
  const now = Date.now();
  const due = state.screens.filter((s) => s.dueAt && s.dueAt <= now && isActive(s) && (!pinnedOf(s) || queueOf(s).length));
  if (!due.length) return;
  advanceScreens(due.map((s) => s.id), 'Timer');
  for (const s of due) if (s.dueAt <= now) scheduleScreen(s); // gleicher Inhalt (nur ein Eintrag): neue Runde
  changed();
}, 500);

/** Nächster automatischer Wechsel (für die Anzeige in der Verwaltung) */
function nextDue() {
  const times = state.screens.filter((s) => s.dueAt && isActive(s)).map((s) => s.dueAt);
  return times.length ? Math.min(...times) : null;
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
    item: forScreen(itemById(screen.currentItemId), screen),
    quality: qualityMsg(screen),
    audio: audioOf(screen),
    ...modeMsg(screen),
    sync: syncMsg(screen),
    serverTime: Date.now(),
    menu: state.settings.screenMenu !== false,
    touchZoom: state.settings.touchZoom !== false,
    remote: remoteMsg(screen),
    remoteAllowed: !!screen.remoteAllowed,
    preload: preloadFor(screen),
    force,
  };
  for (const ws of screenSockets.get(screen.id) ?? []) send(ws, msg);
}

// ---------------------------------------------------------------------------
// Bildqualität: Bilder vor der Übertragung verkleinern und neu komprimieren.
// Die verkleinerte Fassung wird beim ersten Abruf erzeugt und in data/cache gespeichert;
// Originaldateien bleiben unverändert. Videos, animierte GIFs und SVGs bleiben, wie sie sind.
// ---------------------------------------------------------------------------

const IMAGE_QUALITY = {
  original: null,
  uhd: { size: 3840, quality: 85, label: '4K' },
  fhd: { size: 1920, quality: 82, label: 'Full HD' },
  hd: { size: 1280, quality: 75, label: 'HD' },
  low: { size: 960, quality: 60, label: 'Niedrig' },
};
const CACHE_DIR = path.join(DATA_DIR, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const QUALITY_LABEL = { original: 'Original', uhd: '4K', fhd: 'Full HD', hd: 'HD', low: 'Niedrig' };
const defaultQuality = () => (state.settings.imageQuality in IMAGE_QUALITY ? state.settings.imageQuality : 'original');
/** Stufe für einen Screen: eigene Einstellung, sonst die Vorgabe vom Server */
const qualityOf = (screen) => (screen?.imageQuality in IMAGE_QUALITY ? screen.imageQuality : defaultQuality());

/** Qualitätsangaben für das Screen-Menü (Anzeige + Auswahl) */
const qualityMsg = (screen) => ({
  value: screen.imageQuality in IMAGE_QUALITY ? screen.imageQuality : '',
  effective: qualityOf(screen),
  defaultLabel: QUALITY_LABEL[defaultQuality()],
  options: Object.entries(QUALITY_LABEL).map(([id, label]) => ({ id, label })),
});

/** Eigene Stufe eines Screens setzen ('' = Vorgabe vom Server) und Bilder neu schicken */
function setScreenQuality(screen, value) {
  const next = value in IMAGE_QUALITY ? value : undefined;
  if (next === screen.imageQuality) return;
  if (next) screen.imageQuality = next;
  else delete screen.imageQuality;
  refreshImages(screen);
}
function refreshImages(screen) {
  if (itemById(screen.currentItemId)?.type === 'image') pushToScreen(screen, { force: true });
  else pushToScreen(screen); // Menü am Screen zeigt die neue Stufe
  if (screen.standby?.itemId) pushMode(screen);
}
const imagePath = (item) => (item.file ? path.join(UPLOAD_DIR, item.file) : item.mediaFile ?? null);
const reducible = (item) => item?.type === 'image' && imagePath(item) && !/\.(gif|svg)$/i.test(imagePath(item));

/** Eintrag so, wie ihn ein Screen bekommt: Bild ggf. in reduzierter Qualität, Original für den Download */
function forScreen(item, screen) {
  if (!item) return null;
  const q = qualityOf(screen);
  if (!IMAGE_QUALITY[q] || !reducible(item)) return item;
  return { ...item, src: `/img/${item.id}/${q}?v=${item.updatedAt}`, originalSrc: item.src };
}

// Vorschaubilder für die Listen der Verwaltung (Playlist, Medien, Standbild) – nicht als Stufe für Screens wählbar
const PRESETS = { ...IMAGE_QUALITY, thumb: { size: 320, quality: 70 } };
const thumbable = (file) => !!file && mediaTypeOf(file) === 'image' && !/\.(gif|svg)$/i.test(file);

const rendering = new Map(); // Cache-Datei -> laufende Umwandlung (gleichzeitige Abrufe teilen sie)
const reducedImage = (item, preset) => reducedFile(imagePath(item), preset);
async function reducedFile(src, preset) {
  const st = await fs.promises.stat(src);
  const key = crypto.createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}|${preset}`).digest('hex').slice(0, 20);
  const { size, quality } = PRESETS[preset];
  const meta = await sharp(src).metadata();
  const alpha = !!meta.hasAlpha; // Transparenz erhalten (WebP), sonst JPEG
  const out = path.join(CACHE_DIR, `${key}.${alpha ? 'webp' : 'jpg'}`);
  if (fs.existsSync(out)) return out;
  if (!rendering.has(out)) {
    const job = sharp(src)
      .rotate() // Ausrichtung aus den Kamera-Daten übernehmen
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
    const tmp = out + '.tmp';
    rendering.set(
      out,
      (alpha ? job.webp({ quality }) : job.jpeg({ quality, mozjpeg: true }))
        .toFile(tmp)
        .then(() => fs.promises.rename(tmp, out))
        .finally(() => rendering.delete(out))
    );
  }
  await rendering.get(out);
  return out;
}


/** Bild, das voraussichtlich als Nächstes kommt (Warteschlange, sonst Playlist) – der Screen lädt es vorab */
function preloadFor(screen) {
  const queued = queueOf(screen).map(itemById).find(Boolean);
  const next = queued ?? itemById(previewNext(screen)?.itemId);
  return next?.type === 'image' && next.id !== screen.currentItemId ? [forScreen(next, screen).src] : [];
}

const modeMsg = (screen) => ({
  mode: modeOf(screen),
  modeBy: screen.modeBy ?? null, // 'screen' = am Screen selbst angehalten
  standby: screen.standby?.itemId ? forScreen(itemById(screen.standby.itemId) ?? anyItemById(screen.standby.itemId), screen)?.src ?? screen.standby.src : screen.standby?.src ?? null,
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

/** Modus setzen; by = 'screen', wenn am Screen selbst angehalten (sonst Verwaltung) */
function setMode(screen, mode, by = null) {
  if (!MODES.includes(mode) || (mode === modeOf(screen) && by === (screen.modeBy ?? null))) return;
  screen.modeBy = mode === 'play' ? null : by;
  screen.mode = mode;
  if (mode === 'play') scheduleScreen(screen); // nach Pause/Bild/Dunkel volle Zeit
  pushMode(screen);
  // Sync-Gruppe: nach einer Pause wieder in den gemeinsamen Inhalt an der aktuellen Stelle einsteigen
  if (mode === 'play' && inSync(screen) && sync.itemId && itemById(sync.itemId)) {
    if (screen.currentItemId !== sync.itemId) assign(screen, sync.itemId, 'Sync');
    else pushSync(screen);
  }
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
  pushRemoteSound(screen);
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
  // Hat das Video überhaupt eine Tonspur? Merken, damit die Musik beim nächsten Mal gar nicht erst leiser wird
  const shown = report.itemId && anyItemById(report.itemId);
  if (shown?.type === 'video' && typeof msg.hasAudio === 'boolean' && shown.hasAudio !== msg.hasAudio) {
    shown.hasAudio = msg.hasAudio;
    updateVideoSound(true); // kein Ton: Musik gleich wieder normal
    changed();
  }
  if (report.audio) screen.lastAudio = report.audio;
  const prev = screen.report;
  if (prev && Object.keys(report).every((k) => prev[k] === report[k])) return;
  screen.report = { ...report, at: Date.now() };
  startDueOnShow(screen, report);
  updateVideoSound();
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
    // Im Sync-Modus zeigt jeder Screen der Gruppe die gemeinsame Warteschlange
    screens: state.screens.map((s) => ({ ...s, queue: inSync(s) ? state.syncQueue ?? [] : s.queue, inSync: inSync(s), nextAuto: previewNext(s) })),
    online: state.screens.filter((s) => isOnline(s.id)).map((s) => s.id),
    serverTime: Date.now(),
    serverOutdated: serverOutdated(),
    nextAt: nextDue(),
    intervalMs: intervalMs(),
    playlists: state.playlists.map((p) => ({
      id: p.id,
      name: p.name,
      items: p.items,
      count: p.items.length,
      keys: p.items.map((i) => (i.file ? 'upload:' + i.file : i.mediaFile ? 'media:' + i.mediaFile : null)).filter(Boolean),
    })),
    auth: undefined, // PIN-Prüfwerte und Schlüssel nie an die Oberfläche
    settings: { ...state.settings, mediaSources: sourcesForAdmin(), pairKey: undefined }, // Kennwörter und Kopplungs-Schlüssel auch nicht
    security: { admin: !!state.auth.admin, screen: !!state.auth.screen },
    music: { ...state.music, position: musicPosition(), videoSound },
  };
}

// Zustand für die Verwaltungen in Teilen: nur geänderte Teile werden verschickt (Playlisten sind groß,
// ändern sich aber selten). Die aktive Playlist (state.playlist) steckt schon in „playlists“.
const lastParts = {};
let broadcastTimer = null;
function adminParts() {
  const { screens, playlists, music, playlist, ...rest } = stateForAdmin();
  return { screens, playlists, music, rest };
}
const partsMsg = (parts, full) => `{"type":"state","full":${full},"parts":{${Object.entries(parts).map(([k, json]) => `"${k}":${json}`).join(',')}}}`;

/** Aktuellen Stand an eine neu verbundene Verwaltung (komplett) */
function sendFullState(ws) {
  const parts = Object.fromEntries(Object.entries(adminParts()).map(([k, v]) => [k, JSON.stringify(v)]));
  if (ws.readyState === ws.OPEN) ws.send(partsMsg(parts, true));
}

let lastRemotePlaylist = '';
function broadcastState() {
  broadcastTimer = null;
  if (!adminSockets.size) {
    // keine Verwaltung offen: Fernbedienungen trotzdem über Änderungen der Playlist informieren
    const json = JSON.stringify(remotePlaylistMsg());
    if (json !== lastRemotePlaylist) pushRemotePlaylist();
    lastRemotePlaylist = json;
    return;
  }
  const changedParts = {};
  for (const [k, v] of Object.entries(adminParts())) {
    const json = JSON.stringify(v);
    if (k === 'rest' || json !== lastParts[k]) changedParts[k] = json; // „rest“ ist klein und enthält die Serverzeit
    lastParts[k] = json;
  }
  if (changedParts.playlists) pushRemotePlaylist(); // Fernbedienungen zeigen die aktive Playlist
  const msg = partsMsg(changedParts, false);
  for (const ws of adminSockets) if (ws.readyState === ws.OPEN) ws.send(msg);
}

// Viele Änderungen kurz hintereinander (z. B. Rückmeldungen mehrerer Screens) ergeben eine Meldung
function changed() {
  save();
  broadcastTimer ??= setTimeout(broadcastState, 80);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '1mb' }));
// Startseite = Screen (Parameter wie ?name= oder ?lang= bleiben erhalten); die Verwaltung gibt es nur unter /admin
app.get('/', (req, res) => res.redirect('/screen' + req.originalUrl.slice(1)));

// ---------------------------------------------------------------------------
// Zugriffsschutz: optionale PIN für die Verwaltung und für Screens (Standard: keine).
// Gespeichert wird nur ein Prüfwert (scrypt). Nach der Anmeldung hält ein Cookie
// das Gerät angemeldet; ändert sich die PIN, werden alte Cookies ungültig.
// ---------------------------------------------------------------------------

const ROLES = ['admin', 'screen'];
const COOKIE = { admin: 'sd_admin', screen: 'sd_screen' };
const COOKIE_MAX_AGE = 10 * 365 * 24 * 3600 * 1000; // Screens sollen dauerhaft angemeldet bleiben
if (!state.auth.secret) {
  state.auth.secret = crypto.randomBytes(32).toString('hex');
  save();
}

const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const tokenFor = (role) =>
  state.auth[role] && crypto.createHmac('sha256', state.auth.secret).update(`${role}:${state.auth[role].hash}`).digest('hex');

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Darf die Anfrage diese Rolle nutzen? Ohne gesetzte PIN immer. Angemeldete Verwaltung darf auch Screen-Inhalte sehen. */
function authorized(req, role) {
  if (!state.auth[role]) return true;
  if (safeEqual(parseCookies(req)[COOKIE[role]], tokenFor(role))) return true;
  return role === 'screen' && !!state.auth.admin && authorized(req, 'admin');
}

function checkPin(role, pin) {
  const a = state.auth[role];
  return !!a && safeEqual(hashPin(pin, a.salt), a.hash);
}

const setAuthCookie = (res, role) =>
  res.cookie(COOKIE[role], tokenFor(role), { maxAge: COOKIE_MAX_AGE, sameSite: 'lax', httpOnly: role === 'admin', path: '/' });

// Gegen Durchprobieren: nach 5 Fehlversuchen ist die IP eine Minute gesperrt
const failedLogins = new Map(); // ip -> { count, until }
function loginBlocked(ip) {
  const f = failedLogins.get(ip);
  return f && f.until > Date.now();
}
function loginFailed(ip) {
  const f = failedLogins.get(ip) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) {
    f.until = Date.now() + 60_000;
    f.count = 0;
  }
  failedLogins.set(ip, f);
}

const LOGIN_TITLE = { admin: 'Verwaltung', screen: 'Screen' };
const safeNext = (v) => (typeof v === 'string' && /^\/[^/\\]/.test(v) ? v : null); // nur Pfade auf diesem Server

app.get('/login', (req, res) => {
  const role = ROLES.includes(req.query.role) ? req.query.role : 'admin';
  const next = safeNext(req.query.next) ?? (role === 'admin' ? '/admin' : '/screen');
  const html = fs.readFileSync(path.join(__dirname, 'public', 'login.html'), 'utf8');
  res
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(
      html
        .replaceAll('{{ROLE}}', role)
        .replaceAll('{{TITLE}}', LOGIN_TITLE[role])
        .replaceAll('{{NEXT}}', next.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]))
        .replaceAll('{{ERROR}}', req.query.error === 'pin' ? 'Falsche PIN' : req.query.error === 'blocked' ? 'Zu viele Versuche – bitte eine Minute warten' : '')
    );
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const role = ROLES.includes(req.body?.role) ? req.body.role : 'admin';
  const next = safeNext(req.body?.next) ?? (role === 'admin' ? '/admin' : '/screen');
  const ip = req.socket.remoteAddress;
  const back = (error) => res.redirect(`/login?role=${role}&next=${encodeURIComponent(next)}&error=${error}`);
  if (loginBlocked(ip)) return back('blocked');
  if (!state.auth[role]) return res.redirect(next);
  if (!checkPin(role, req.body?.pin ?? '')) {
    loginFailed(ip);
    return back('pin');
  }
  failedLogins.delete(ip);
  setAuthCookie(res, role);
  res.redirect(next);
});

app.post('/logout', (req, res) => {
  res.clearCookie(COOKIE.admin, { path: '/' });
  res.redirect('/login?role=admin');
});

const toLogin = (req, res, role) => res.redirect(`/login?role=${role}&next=${encodeURIComponent(req.originalUrl)}`);

// Rohdateien der Seiten nicht am Schutz vorbei ausliefern
app.get(['/admin.html', '/screen.html', '/login.html'], (req, res) => res.redirect(req.path.replace('.html', '')));

app.get('/admin', (req, res, next) => (authorized(req, 'admin') ? next() : toLogin(req, res, 'admin')));
app.get('/screen', (req, res, next) => {
  // Kiosk-Geräte: PIN einmalig per Adresse übergeben (/screen?pin=…), danach gilt das Cookie
  const pin = req.query.pin;
  if (pin !== undefined && state.auth.screen) {
    const qs = new URLSearchParams(req.query);
    qs.delete('pin');
    const clean = '/screen' + (qs.size ? '?' + qs : '');
    if (loginBlocked(req.socket.remoteAddress)) return toLogin({ originalUrl: clean }, res, 'screen');
    if (!checkPin('screen', pin)) {
      loginFailed(req.socket.remoteAddress);
      return res.redirect(`/login?role=screen&next=${encodeURIComponent(clean)}&error=pin`);
    }
    setAuthCookie(res, 'screen');
    return res.redirect(clean);
  }
  if (validPair(req.query.pair) && state.auth.screen && !authorized(req, 'screen')) setAuthCookie(res, 'screen'); // Kopplung ersetzt die Screen-PIN
  authorized(req, 'screen') || validPair(req.query.pair) ? next() : toLogin(req, res, 'screen');
});
// Bilder in reduzierter Qualität für die Screens (siehe Bildqualität)
app.get('/img/:id/:preset', async (req, res) => {
  if (!authorized(req, 'screen') && !authorized(req, 'admin')) return res.status(401).end();
  const item = anyItemById(req.params.id);
  if (item?.type !== 'image' || !imagePath(item) || !PRESETS[req.params.preset]) return res.status(404).end();
  if (!reducible(item)) return res.sendFile(imagePath(item), (err) => err && !res.headersSent && res.status(404).end()); // GIF/SVG: Original
  try {
    res.sendFile(await reducedImage(item, req.params.preset), { maxAge: '7d' });
  } catch (e) {
    console.error('[Bildqualität]', item.title, e.message);
    res.sendFile(imagePath(item), (err) => err && !res.headersSent && res.status(404).end()); // im Zweifel das Original
  }
});

app.get('/mediafile/:id/:name', (req, res) => {
  if (!authorized(req, 'screen') && !authorized(req, 'admin')) return res.status(401).end();
  const item = anyItemById(req.params.id);
  const entry = item ?? musicItem(req.params.id);
  if (!entry?.mediaFile) return res.status(404).end();
  res.sendFile(entry.mediaFile, (err) => err && !res.headersSent && res.status(404).end());
});
app.use('/uploads', (req, res, next) => (authorized(req, 'screen') || authorized(req, 'admin') ? next() : res.status(401).end()));
app.use('/api', (req, res, next) => (authorized(req, 'admin') ? next() : res.status(401).json({ error: 'Nicht angemeldet' })));

// Zwischenspeicher der verkleinerten Bilder: Größe anzeigen und leeren
async function cacheStats() {
  const names = (await fs.promises.readdir(CACHE_DIR).catch(() => [])).filter((n) => !n.endsWith('.tmp'));
  const sizes = await Promise.all(names.map((n) => fs.promises.stat(path.join(CACHE_DIR, n)).then((st) => st.size, () => 0)));
  return { files: names.length, bytes: sizes.reduce((a, b) => a + b, 0), path: CACHE_DIR };
}
app.get('/api/cache', async (req, res) => res.json(await cacheStats()));
app.delete('/api/cache', async (req, res) => {
  const before = await cacheStats();
  const busy = new Set([...rendering.keys()].map((f) => path.basename(f) + '.tmp')); // laufende Umwandlungen nicht stören
  for (const n of await fs.promises.readdir(CACHE_DIR).catch(() => [])) {
    if (!busy.has(n)) await fs.promises.rm(path.join(CACHE_DIR, n), { force: true }).catch(() => {});
  }
  res.json({ removed: before.files, freed: before.bytes, ...(await cacheStats()) });
});

// PIN setzen / entfernen (leer = kein Schutz)
app.put('/api/security', (req, res) => {
  const { role, pin } = req.body ?? {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unbekannter Bereich' });
  const value = String(pin ?? '').trim();
  if (value && (value.length < 4 || value.length > 32)) return res.status(400).json({ error: 'Die PIN muss 4 bis 32 Zeichen lang sein' });
  if (value) {
    const salt = crypto.randomBytes(16).toString('hex');
    state.auth[role] = { salt, hash: hashPin(value, salt) };
  } else {
    delete state.auth[role];
  }
  if (role === 'admin') {
    // Diese Verwaltung bleibt angemeldet (neues Cookie), andere müssen die neue PIN eingeben:
    // alle Verbindungen trennen, wer ein gültiges Cookie hat, verbindet sich einfach neu
    if (value) {
      setAuthCookie(res, 'admin');
      setTimeout(() => adminSockets.forEach((ws) => ws.close(4001)), 1000);
    }
  } else if (value) {
    // Bereits verbundene Screens bleiben angemeldet (bekommen das neue Cookie direkt)
    for (const set of screenSockets.values()) {
      for (const ws of set) send(ws, { type: 'auth', cookie: COOKIE.screen, token: tokenFor('screen'), maxAge: COOKIE_MAX_AGE / 1000 });
    }
  }
  changed();
  res.json({ ok: true });
});
// Seiten mit eingebauter Versionskennung ausliefern. Ändert sich der Code, merken das
// offene Screens/Verwaltungen und laden sich selbst neu (siehe sendVersion).
const PAGE_FILES = {
  admin: ['admin.html', 'admin.js', 'admin.css', 'fonts.js', 'i18n.js'],
  screen: ['screen.html', 'fonts.js', 'i18n.js'],
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
  fileFilter: (req, file, cb) => cb(null, /^(image|video|audio)\//.test(file.mimetype)),
});

app.get('/api/state', (req, res) => res.json(stateForAdmin()));

// ---------------------------------------------------------------------------
// Name im Netzwerk (mDNS): Der Server antwortet auf „<name>.local“ mit seiner IP-Adresse,
// damit Geräte ihn als http://screendeck.local:3000 erreichen statt über die IP.
// Funktioniert mit Windows, macOS, iOS, Linux und neueren Android-Versionen.
// ---------------------------------------------------------------------------

const toHostName = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40);
const hostName = () => toHostName(state.settings.hostName);

/** IPv4-Adresse(n), unter denen der Absender den Server erreicht (gleiches Teilnetz bevorzugt) */
function addressesFor(remote) {
  const own = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal);
  const num = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
  const same = own.filter((a) => remote && (num(a.address) & num(a.netmask)) === (num(remote) & num(a.netmask)));
  return (same.length ? same : own).map((a) => a.address);
}

function startMdns() {
  let mdns;
  try {
    mdns = multicastDns(); // teilt sich den Port 5353 mit anderen mDNS-Diensten des Systems
  } catch (e) {
    return console.warn('[mDNS] nicht verfügbar:', e.message);
  }
  mdns.on('error', (e) => console.warn('[mDNS]', e.message));
  mdns.on('query', (query, rinfo) => {
    const name = hostName();
    if (!name) return;
    const fqdn = name + '.local';
    const questions = query.questions.filter((q) => q.name.toLowerCase() === fqdn && (q.type === 'A' || q.type === 'ANY'));
    if (!questions.length) return;
    const answers = addressesFor(rinfo.address).map((ip) => ({ name: fqdn, type: 'A', ttl: 120, flush: true, data: ip }));
    if (!answers.length) return;
    // Einfache Resolver fragen von einem beliebigen Port und erwarten die Antwort direkt (Unicast)
    if (rinfo.port !== 5353) mdns.respond({ id: query.id, questions, answers }, { port: rinfo.port, host: rinfo.address });
    else mdns.respond({ answers });
  });
}
startMdns();

// ---------------------------------------------------------------------------
// Verbinden per QR-Code (Seite /connect, Menü am Screen): Adresse mit IP statt Namen,
// damit sie auch auf Geräten ohne .local-Unterstützung (Android) funktioniert.
// ---------------------------------------------------------------------------

// Smartphone als Fernbedienung koppeln: Der QR-Code enthält einen Schlüssel. Wer ihn scannt, darf
// fernsteuern (ohne Freischaltung in der Verwaltung) und startet sofort mit allen verbundenen Screens.
// Nur die Verwaltung bekommt den Code; „Neuen Code erzeugen“ macht alte ungültig.
const newPairKey = () => crypto.randomBytes(9).toString('base64url');
if (!state.settings.pairKey) {
  state.settings.pairKey = newPairKey();
  save();
}
const validPair = (key) => typeof key === 'string' && safeEqual(key, state.settings.pairKey);

function connectUrls(req) {
  const ip = addressesFor(String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''))[0] ?? req.hostname;
  const base = withPort(ip, shortPort ?? PORT);
  return {
    screen: base + '/',
    admin: base + '/admin',
    // nur für die (angemeldete) Verwaltung
    ...(authorized(req, 'admin') && { remote: `${base}/screen?pair=${state.settings.pairKey}&name=Smartphone` }),
  };
}
app.get('/connect', (req, res) => res.sendFile(path.join(__dirname, 'public', 'connect.html')));
app.get('/connect.json', (req, res) => res.set('Cache-Control', 'no-store').json(connectUrls(req)));
app.get('/qr.svg', async (req, res) => {
  const url = connectUrls(req)[['admin', 'remote'].includes(req.query.for) ? req.query.for : 'screen'];
  if (!url) return res.status(401).end(); // Kopplungs-Code nur für die Verwaltung
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
});

app.post('/api/pair-key', (req, res) => {
  state.settings.pairKey = newPairKey();
  changed();
  res.json({ ok: true });
});

app.get('/api/info', (req, res) => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  res.json({
    port: PORT,
    shortPort,
    addresses,
    hostName: hostName(),
    // Netzwerk-Einstellungen: was eingestellt ist, was läuft und ob eine Umgebungsvariable es festlegt
    ports: {
      port: validPort(state.settings.port) || 3000,
      portFromEnv: !!process.env.PORT,
      restartNeeded: !process.env.PORT && (validPort(state.settings.port) || 3000) !== PORT,
      extraPort: extraPortSetting(),
      extraFromEnv: EXTRA_FROM_ENV,
      extra: extraStatus,
    },
  });
});

// --- Playlist ---------------------------------------------------------------

const toDuration = (v) => Math.max(0, Math.min(86400, Math.round(Number(v) || 0)));

app.post('/api/playlist', (req, res) => {
  const { type, src, title, text, bg, color, duration, showCountdown, font, edge } = req.body ?? {};
  if (type === 'media') return addMedia(req, res);
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
  targetList(req).push(item);
  redistributeAfterPlaylistChange();
  changed();
  res.json(item);
});

// ---------------------------------------------------------------------------
// Medienordner: Bilder/Videos aus einem Ordner auf dem Server, ohne Kopie
// (abgespielt wird direkt aus dem Ordner, Löschen aus der Playlist lässt die Datei unberührt)
// ---------------------------------------------------------------------------

const MEDIA_TYPES = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg'],
  video: ['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.ogv'],
  audio: ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac'],
};
const mediaTypeOf = (name) => {
  const ext = path.extname(name).toLowerCase();
  return Object.keys(MEDIA_TYPES).find((t) => MEDIA_TYPES[t].includes(ext)) ?? null;
};
const DEFAULT_MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(DEFAULT_MEDIA_DIR, { recursive: true });
// Medienquellen: beliebig viele Ordner – lokal, Netzlaufwerk (Z:\…) oder Netzwerkpfad (\\Server\Freigabe\…).
// Frühere Einzel-Einstellung „mediaDir“ wird einmalig übernommen.
if (!Array.isArray(state.settings.mediaSources)) {
  const dir = state.settings.mediaDir ? path.resolve(state.settings.mediaDir) : DEFAULT_MEDIA_DIR;
  state.settings.mediaSources = [{ id: 'media', name: path.basename(dir) || dir, path: dir }];
  delete state.settings.mediaDir;
  save();
}
const mediaSource = (id) => state.settings.mediaSources.find((m) => m.id === id) ?? null;

// ---------------------------------------------------------------------------
// Anmeldung für Netzwerkfreigaben (\\Server\Freigabe, nur Windows): Der Server meldet sich per
// „net use“ an der Freigabe an, bevor er sie liest. Das Kennwort wird mit dem Windows-Konto des
// Servers verschlüsselt gespeichert (DPAPI) und nie an die Oberfläche geschickt.
// ---------------------------------------------------------------------------

const isUnc = (p) => /^\\\\[^\\]+\\[^\\]+/.test(p);
/** \\Server\Freigabe aus einem Pfad darunter */
const shareRoot = (p) => p.match(/^\\\\[^\\]+\\[^\\]+/)?.[0] ?? null;

/** PowerShell mit Eingabe über stdin (Kennwörter nicht in der Befehlszeile) */
function powershell(script, input) {
  return new Promise((resolve, reject) => {
    const ps = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())
    );
    ps.stdin.end(input);
  });
}
const encryptSecret = (plain) => powershell('$p = [Console]::In.ReadToEnd(); ConvertTo-SecureString $p -AsPlainText -Force | ConvertFrom-SecureString', plain);
const decryptSecret = (secret) =>
  powershell('$s = [Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))', secret);

/** An der Freigabe anmelden (falls für die Quelle eine Anmeldung hinterlegt ist); Fehlertext oder null */
async function connectShare(source) {
  if (!source?.auth?.user || !isUnc(source.path)) return null;
  if (process.platform !== 'win32') return 'Anmeldung an Netzwerkfreigaben wird nur unter Windows unterstützt – die Freigabe bitte im System einbinden';
  try {
    const password = source.auth.secret ? await decryptSecret(source.auth.secret) : '';
    await new Promise((resolve, reject) =>
      execFile('net', ['use', shareRoot(source.path), password, '/user:' + source.auth.user, '/persistent:no'], { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) =>
        err ? reject(new Error((stderr || stdout || err.message).trim())) : resolve()
      )
    );
    return null;
  } catch (e) {
    if (/ConvertTo-SecureString|Schlüssel|key/i.test(e.message)) return 'Gespeichertes Kennwort kann nicht entschlüsselt werden (anderes Windows-Konto?) – bitte neu eingeben';
    return netError(e.message);
  }
}

/** Verständliche Meldung zu einem Fehler von „net use“ / „net view“ */
function netError(msg) {
  // „Systemfehler 86 aufgetreten.“ / „System error 86 has occurred.“
  const code = Number(msg.match(/(?:Systemfehler|System error)\s+(\d+)/i)?.[1]);
  if (code === 1219) return 'Zu dieser Freigabe besteht schon eine Verbindung mit anderem Benutzer (Windows erlaubt nur einen je Server). Bestehende Verbindung trennen oder dieselbe Anmeldung verwenden.';
  if (code === 86 || code === 1326) return 'Anmeldung fehlgeschlagen: Benutzername oder Kennwort falsch';
  if (code === 53 || code === 67 || code === 51 || code === 1707) return 'Server oder Freigabe nicht gefunden';
  if (code === 5) return 'Zugriff verweigert';
  return 'Anmeldung an der Freigabe fehlgeschlagen: ' + msg.split('\n')[0];
}

/** net-Befehl ausführen (Ausgabe in UTF-8, damit Umlaute in Freigabenamen stimmen) */
function runNet(args) {
  return new Promise((resolve, reject) =>
    execFile('cmd.exe', ['/d', '/c', 'chcp 65001 >nul & net ' + args], { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || stdout || err.message).trim())) : resolve(stdout)
    )
  );
}

/** Anmelden per „net use“ – direkt ohne Shell, damit Kennwörter mit Sonderzeichen unverändert ankommen */
function netUse(target, user, password) {
  return new Promise((resolve, reject) =>
    execFile('net', ['use', target, password, '/user:' + user, '/persistent:no'], { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || stdout || err.message).trim())) : resolve()
    )
  );
}

/** Freigaben eines Servers (nur Laufwerks-Freigaben, keine Drucker/IPC), per „net view“ */
async function listShares(server) {
  // ohne Anführungszeichen: Node maskiert sie für cmd.exe falsch; der Name ist geprüft (Buchstaben, Ziffern, . -)
  if (!/^[\w.-]+$/.test(server)) throw new Error('Ungültiger Servername');
  const out = await runNet(`view \\\\${server}`);
  const lines = out.split(/\r?\n/);
  const dash = lines.findIndex((l) => /^-{10,}/.test(l));
  // Spalte „Typ“/„Type“ aus der Überschrift, damit Freigabenamen mit Leerzeichen erhalten bleiben
  const header = lines.slice(0, dash).reverse().find((l) => /\bTyp(e)?\b/.test(l)) ?? '';
  const col = header.search(/\bTyp(e)?\b/);
  const shares = [];
  for (const line of lines.slice(dash + 1)) {
    if (!line.trim() || col < 1 || line.length <= col) continue;
    const name = line.slice(0, col).trim();
    const type = line.slice(col).trim().split(/\s+/)[0];
    if (name && /^(Platte|Disk)$/i.test(type)) shares.push(name);
  }
  return shares.sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
}

/** Medienquellen für die Oberfläche: ohne verschlüsseltes Kennwort, nur ob eine Anmeldung hinterlegt ist */
const sourcesForAdmin = () => state.settings.mediaSources.map(({ auth, ...m }) => ({ ...m, ...(auth?.user && { auth: { user: auth.user } }) }));

// Nach dem Start an allen Freigaben mit Anmeldung anmelden (Fehler zeigt die Medienliste beim Öffnen)
setTimeout(() => {
  for (const m of state.settings.mediaSources) if (m.auth?.user) connectShare(m).then((err) => err && console.warn(`Medienquelle „${m.name}“: ${err}`));
}, 500);

/** Relativen Pfad (mit /) sicher innerhalb der Quelle auflösen, sonst null */
function resolveMedia(source, rel) {
  if (!source) return null;
  const root = path.resolve(source.path);
  const abs = path.resolve(root, String(rel ?? '').replace(/^[/\\]+/, ''));
  return abs === root || abs.startsWith(root.endsWith(path.sep) ? root : root + path.sep) ? abs : null;
}
const relMedia = (source, abs) => path.relative(path.resolve(source.path), abs).split(path.sep).join('/');

/** Ist der Pfad ein erreichbarer Ordner? (asynchron, Netzlaufwerke können dauern) */
const isDir = (dir) => fs.promises.stat(dir).then((st) => st.isDirectory(), () => false);

app.get('/api/media', async (req, res) => {
  if (req.query.source === 'uploads') return res.json(await listUploads());
  const source = mediaSource(req.query.source);
  if (!source) return res.status(404).json({ error: 'Medienquelle nicht gefunden' });
  const dir = resolveMedia(source, req.query.dir);
  if (!dir) return res.status(400).json({ error: 'Ungültiger Ordner' });
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(async (e) => {
      // Netzwerkfreigabe mit Anmeldung: Verbindung (neu) herstellen und noch einmal versuchen
      if (!source.auth?.user) throw e;
      const err = await connectShare(source);
      if (err) throw Object.assign(new Error(err), { code: 'AUTH' });
      return fs.promises.readdir(dir, { withFileTypes: true });
    });
  } catch (e) {
    if (e.code === 'AUTH') return res.status(404).json({ error: e.message });
    const reason = e.code === 'ENOENT' ? 'nicht gefunden' : e.code === 'EACCES' || e.code === 'EPERM' ? 'kein Zugriff' : 'nicht erreichbar';
    return res.status(404).json({ error: `Ordner ${reason}: ${dir}` });
  }
  const folders = [];
  const candidates = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('$')) continue; // versteckte / System-Ordner
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) folders.push({ name: e.name, path: relMedia(source, abs) });
    else if (e.isFile() && mediaTypeOf(e.name) && candidates.length < 2000) candidates.push({ name: e.name, abs });
  }
  // Dateigrößen parallel holen (auf Netzlaufwerken deutlich schneller als nacheinander)
  const files = await Promise.all(
    candidates.map(async ({ name, abs }) => {
      const st = await fs.promises.stat(abs).catch(() => null);
      return { name, path: relMedia(source, abs), key: 'media:' + abs, type: mediaTypeOf(name), size: st?.size ?? 0, mtime: Math.round(st?.mtimeMs ?? 0) };
    })
  );
  const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true });
  res.json({ source: source.id, name: source.name, root: source.path, dir: relMedia(source, dir), folders: folders.sort(byName), files: files.sort(byName) });
});

/** Hochgeladene Dateien (data/uploads) mit ihrem Titel aus der Playlist statt des zufälligen Dateinamens */
async function listUploads() {
  const names = await fs.promises.readdir(UPLOAD_DIR).catch(() => []);
  const files = [];
  for (const name of names) {
    const type = mediaTypeOf(name);
    if (!type || name.startsWith('thumb-')) continue; // Vorschaubilder nicht auflisten
    const st = await fs.promises.stat(path.join(UPLOAD_DIR, name)).catch(() => null);
    if (!st?.isFile()) continue;
    const item = state.playlist.find((i) => i.file === name) ?? allItems().find((i) => i.file === name) ?? music().items.find((i) => i.file === name);
    const standby = state.screens.find((s) => s.standby?.file === name);
    files.push({
      name: item?.title ?? (standby ? `Standbild ${standby.standby.title ?? ''}`.trim() : name),
      path: name,
      key: 'upload:' + name,
      type,
      size: st.size,
      preview: item?.thumb ?? (type === 'image' ? `/api/media/thumb?source=uploads&path=${encodeURIComponent(name)}&v=${Math.round(st.mtimeMs)}` : null),
      usage: standby ? `Standbild „${standby.name}“` : null,
      mtime: st.mtimeMs,
    });
  }
  files.sort((a, b) => b.mtime - a.mtime); // neueste zuerst
  return { source: 'uploads', root: UPLOAD_DIR, dir: '', folders: [], files };
}

// ---------------------------------------------------------------------------
// Ordner-Browser zum Einbinden einer Medienquelle: ohne Pfad die Laufwerke, bei \\Server dessen
// Freigaben, sonst die Unterordner. POST, weil optional Benutzer und Kennwort mitkommen.
// ---------------------------------------------------------------------------

const serverOnly = (p) => p.match(/^\\\\([\w.-]+)\\?$/)?.[1] ?? null; // „\\sugo“ → „sugo“
/** Übergeordneter Ordner: \\Server\Freigabe → \\Server → Laufwerke */
function parentOf(p) {
  if (!p || serverOnly(p)) return '';
  const root = shareRoot(p);
  if (root && path.resolve(p) === path.resolve(root)) return root.split('\\').slice(0, 3).join('\\');
  const up = path.dirname(p);
  return up === p ? '' : up;
}

app.post('/api/browse', async (req, res) => {
  const raw = String(req.body?.path ?? '').trim().replace(/\//g, process.platform === 'win32' ? '\\' : '/');
  const user = String(req.body?.user ?? '').trim();
  const win = process.platform === 'win32';
  try {
    // Laufwerke (Windows) bzw. Wurzel
    if (!raw) {
      if (!win) return res.json({ path: '/', parent: null, entries: await subfolders('/') });
      const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const found = await Promise.all(letters.map((l) => isDir(l + ':\\').then((ok) => (ok ? { name: l + ':', path: l + ':\\', kind: 'drive' } : null))));
      return res.json({ path: '', parent: null, entries: found.filter(Boolean) });
    }
    // Server: Freigaben auflisten (vorher anmelden, falls Benutzer angegeben)
    const server = serverOnly(raw);
    if (server) {
      if (!win) return res.status(400).json({ error: 'Freigaben auflisten geht nur unter Windows – den Pfad bitte direkt eingeben' });
      if (user) await netUse(`\\\\${server}\\IPC$`, user, String(req.body?.password ?? ''));
      const shares = await listShares(server);
      return res.json({ path: `\\\\${server}`, parent: '', entries: shares.map((name) => ({ name, path: `\\\\${server}\\${name}`, kind: 'share' })) });
    }
    // Ordner: bei Netzwerkpfad mit Benutzer erst an der Freigabe anmelden
    const dir = path.resolve(raw);
    if (user && isUnc(dir) && win) await netUse(shareRoot(dir), user, String(req.body?.password ?? ''));
    res.json({ path: dir, parent: parentOf(dir), entries: await subfolders(dir) });
  } catch (e) {
    const msg = /Systemfehler|System error/i.test(e.message) ? netError(e.message) : e.code === 'ENOENT' ? 'Ordner nicht gefunden' : e.code === 'EACCES' || e.code === 'EPERM' ? 'Kein Zugriff – ggf. Benutzer und Kennwort angeben' : 'Nicht erreichbar: ' + e.message.split('\n')[0];
    res.status(400).json({ error: msg });
  }
});

/** Sichtbare Unterordner (ohne versteckte und System-Ordner) */
async function subfolders(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$') && !/^(System Volume Information|\$RECYCLE\.BIN)$/i.test(e.name))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name), kind: 'folder' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
}

// Medienquellen verwalten
app.post('/api/media-sources', async (req, res) => {
  const raw = String(req.body?.path ?? '').trim();
  if (!raw) return res.status(400).json({ error: 'Pfad fehlt' });
  const dir = path.resolve(raw);
  if (state.settings.mediaSources.some((m) => path.resolve(m.path) === dir)) return res.status(400).json({ error: 'Dieser Ordner ist schon eingebunden' });
  const source = { id: newId(), name: String(req.body?.name ?? '').trim().slice(0, 60) || path.basename(dir) || dir, path: dir };
  // Optional Benutzer und Kennwort für eine Netzwerkfreigabe: erst anmelden, dann prüfen
  const user = String(req.body?.user ?? '').trim();
  if (user) {
    if (!isUnc(dir)) return res.status(400).json({ error: 'Eine Anmeldung ist nur für Netzwerkpfade (\\\\Server\\Freigabe) möglich' });
    const err = await setSourceAuth(source, user, String(req.body?.password ?? ''));
    if (err) return res.status(400).json({ error: err });
  }
  if (!(await isDir(dir))) return res.status(400).json({ error: `Ordner nicht gefunden oder nicht erreichbar: ${raw}` });
  state.settings.mediaSources.push(source);
  changed();
  res.json(sourcesForAdmin().find((m) => m.id === source.id));
});

/** Anmeldung setzen (Kennwort verschlüsselt) und testen; Fehlertext oder null */
async function setSourceAuth(source, user, password) {
  if (process.platform !== 'win32') return 'Anmeldung an Netzwerkfreigaben wird nur unter Windows unterstützt – die Freigabe bitte im System einbinden';
  const auth = { user: user.slice(0, 120) };
  try {
    if (password) auth.secret = await encryptSecret(password);
  } catch (e) {
    return 'Kennwort konnte nicht verschlüsselt werden: ' + e.message;
  }
  const err = await connectShare({ ...source, auth });
  if (err) return err;
  source.auth = auth;
  return null;
}

app.patch('/api/media-sources/:id', async (req, res) => {
  const source = mediaSource(req.params.id);
  if (!source) return res.status(404).json({ error: 'Nicht gefunden' });
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (name) source.name = name;
  // Anmeldung: user (+ password) setzen, user: '' entfernt sie
  if (typeof req.body?.user === 'string') {
    const user = req.body.user.trim();
    if (!user) delete source.auth;
    else {
      if (!isUnc(source.path)) return res.status(400).json({ error: 'Eine Anmeldung ist nur für Netzwerkpfade (\\\\Server\\Freigabe) möglich' });
      const err = await setSourceAuth(source, user, String(req.body.password ?? ''));
      if (err) return res.status(400).json({ error: err });
    }
  }
  changed();
  res.json(sourcesForAdmin().find((m) => m.id === source.id));
});

// Entfernt nur die Quelle; Playlist-Einträge daraus bleiben (sie kennen ihren vollständigen Pfad)
app.delete('/api/media-sources/:id', (req, res) => {
  state.settings.mediaSources = state.settings.mediaSources.filter((m) => m.id !== req.params.id);
  changed();
  res.json({ ok: true });
});

// Datei aus einer Medienquelle (Vorschau in der Verwaltung)
app.get('/api/media/file', (req, res) => {
  const abs = resolveMedia(mediaSource(req.query.source), req.query.path);
  if (!abs || !mediaTypeOf(abs)) return res.status(400).end();
  res.sendFile(abs, (err) => err && !res.headersSent && res.status(404).end());
});

// Kleines Vorschaubild einer Datei aus einer Medienquelle oder den Uploads (Medienliste, eigenes Standbild)
app.get('/api/media/thumb', async (req, res) => {
  const abs =
    req.query.source === 'uploads'
      ? path.join(UPLOAD_DIR, path.basename(String(req.query.path ?? '')))
      : resolveMedia(mediaSource(req.query.source), req.query.path);
  if (!abs || !mediaTypeOf(abs)) return res.status(400).end();
  try {
    if (!thumbable(abs)) throw new Error('kein verkleinerbares Bild');
    res.sendFile(await reducedFile(abs, 'thumb'), { maxAge: '1h' });
  } catch {
    res.sendFile(abs, (err) => err && !res.headersSent && res.status(404).end()); // GIF/SVG oder Fehler: Original
  }
});

// Dateien aus dem Medienordner in die Playlist (optional an Position)
async function addMedia(req, res) {
  const paths = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path];
  const skipDuplicates = state.settings.duplicates !== 'add';
  const added = [];
  const skipped = [];
  if (req.body.source === 'uploads') {
    for (const name of paths) {
      const file = path.basename(String(name ?? '')); // nur Dateien direkt in data/uploads
      const type = mediaTypeOf(file);
      if (!type || type === 'audio' || file.startsWith('thumb-') || !fs.existsSync(path.join(UPLOAD_DIR, file))) continue;
      const existing = targetList(req).find((i) => i.file === file) ?? added.find((i) => i.file === file);
      if (existing && skipDuplicates) {
        skipped.push({ name: existing.title, existing: existing.title });
        continue;
      }
      added.push({
        id: newId(),
        type,
        src: '/uploads/' + file,
        file,
        hash: existing?.hash,
        title: existing?.title ?? file.replace(/\.[^.]+$/, ''),
        enabled: true,
        updatedAt: Date.now(),
      });
    }
    return insertAdded(req, res, added, skipped);
  }
  const source = mediaSource(req.body.source);
  for (const rel of paths) {
    const abs = resolveMedia(source, rel);
    const type = abs && mediaTypeOf(abs);
    if (type === 'audio') continue; // Audiodateien gehören in die Musikliste
    const st = type && (await fs.promises.stat(abs).catch(() => null));
    if (!st?.isFile()) continue;
    const name = path.basename(abs);
    const existing = targetList(req).find((i) => i.mediaFile === abs) ?? added.find((i) => i.mediaFile === abs);
    if (existing && skipDuplicates) {
      skipped.push({ name, existing: existing.title });
      continue;
    }
    const id = newId();
    added.push({
      id,
      type,
      src: `/mediafile/${id}/${encodeURIComponent(name)}`,
      mediaFile: abs,
      title: name.replace(/\.[^.]+$/, ''),
      enabled: true,
      updatedAt: Date.now(),
    });
  }
  insertAdded(req, res, added, skipped);
}

function insertAdded(req, res, added, skipped) {
  const list = targetList(req);
  const pos = Number.isInteger(req.body.position) ? Math.max(0, Math.min(list.length, req.body.position)) : list.length;
  list.splice(pos, 0, ...added);
  if (added.length) {
    redistributeAfterPlaylistChange();
    changed();
    backfillHashes(); // Prüfsummen im Hintergrund (für die Erkennung doppelter Inhalte)
  }
  res.json({ added, skipped });
}

// Inhalts-Prüfsumme zur Erkennung doppelter Dateien (unabhängig vom Dateinamen)
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// Ältere Einträge ohne Prüfsumme einmalig nachberechnen
let hashing = null;
async function backfillHashes() {
  if (hashing) return hashing.then(backfillHashes); // läuft schon: danach erneut prüfen
  hashing = (async () => {
    let count = 0;
    for (const item of allItems()) {
      const file = item.file ? path.join(UPLOAD_DIR, item.file) : item.mediaFile;
      if (!file || item.hash) continue;
      try {
        item.hash = await hashFile(file);
        count++;
      } catch {}
    }
    if (count) changed();
  })();
  try {
    await hashing;
  } finally {
    hashing = null;
  }
}

app.post('/api/upload', upload.array('files'), async (req, res) => {
  const result = await ingestUploads(req.files, targetList(req), (req.query.duplicates ?? state.settings.duplicates) !== 'add');
  res.json(result);
});

// Fernbedienung (z. B. Smartphone): Fotos, Videos und Musik aus der Galerie in die aktive Playlist bzw.
// Musikliste. Erlaubt nur dem steuernden Gerät mit seinem Schlüssel; das erste neue Bild/Video läuft sofort.
app.post('/remote/upload', (req, res, next) => {
  const ctrl = screenById(String(req.query.screen ?? ''));
  if (ctrl?.remote?.role !== 'controller' || !safeEqual(String(req.query.key ?? ''), ctrl.remote.key ?? '')) return res.status(403).json({ error: 'Nur während der Fernsteuerung' });
  req.ctrl = ctrl;
  next();
}, upload.array('files'), async (req, res) => {
  const result = await ingestUploads(req.files, state.playlist, state.settings.duplicates !== 'add');
  const first = result.added[0] ?? state.playlist.find((i) => i.title === result.skipped[0]?.existing);
  if (first && req.ctrl.remote) remoteShow(req.ctrl, first.id);
  changed();
  res.json({ added: result.added.length, skipped: result.skipped.length, music: result.musicAdded.length, shown: first?.title ?? null });
});

/** Hochgeladene Dateien übernehmen: Audio → Musikliste, Bilder/Videos → list (doppelte ggf. aussortiert) */
async function ingestUploads(files, list, skipDuplicates) {
  const added = [];
  const skipped = [];
  const musicAdded = [];
  for (const f of files ?? []) {
    // multer liefert den Dateinamen als latin1 – für Umlaute nach UTF-8 umwandeln
    const original = Buffer.from(f.originalname, 'latin1').toString('utf8');
    const hash = await hashFile(f.path);
    if (f.mimetype.startsWith('audio/')) {
      // Audiodatei → Musikliste
      const known = music().items.find((i) => i.hash === hash && i.file);
      if (known && skipDuplicates) {
        fs.rm(f.path, { force: true }, () => {});
        skipped.push({ name: original, existing: known.title });
        continue;
      }
      if (known) fs.rm(f.path, { force: true }, () => {});
      const item = musicFileItem({ file: known?.file ?? f.filename, title: original.replace(/\.[^.]+$/, ''), hash });
      insertMusic([item]);
      if (!music().currentId) music().currentId = item.id;
      musicAdded.push(item);
      continue;
    }
    // Doppelt = gleicher Inhalt wie ein Playlist-Eintrag oder eine Datei aus demselben Upload
    const existing = list.find((i) => i.hash === hash) ?? added.find((i) => i.hash === hash);
    if (existing && skipDuplicates) {
      fs.rm(f.path, { force: true }, () => {});
      skipped.push({ name: original, existing: existing.title });
      continue;
    }
    // Gleiche Datei liegt schon hochgeladen vor (z. B. in einer anderen Playlist): diese mitbenutzen statt doppelt speichern
    const stored = (allItems().find((i) => i.hash === hash && i.file) ?? added.find((i) => i.hash === hash))?.file;
    if (stored) fs.rm(f.path, { force: true }, () => {});
    const file = stored ?? f.filename;
    added.push({
      id: newId(),
      type: f.mimetype.startsWith('video/') ? 'video' : 'image',
      src: '/uploads/' + file,
      file,
      hash,
      title: original.replace(/\.[^.]+$/, ''),
      enabled: true,
      updatedAt: Date.now(),
    });
  }
  list.push(...added);
  if (added.length && list === state.playlist) redistributeAfterPlaylistChange();
  if (added.length || musicAdded.length) changed();
  return { added, skipped, musicAdded };
}

app.put('/api/playlist/order', (req, res) => {
  const ids = req.body?.ids ?? [];
  const pos = new Map(ids.map((id, i) => [id, i]));
  targetList(req).sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  redistributeAfterPlaylistChange();
  changed();
  res.json({ ok: true });
});

app.patch('/api/playlist/:id', (req, res) => {
  const item = anyItemById(req.params.id);
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

// ---------------------------------------------------------------------------
// Musik: eigene Abspielliste parallel zur Anzeige – Audiodateien (MP3 …) und Internetradio.
// Läuft synchron auf allen Screens mit „Musik an“ (gemeinsame Startzeit wie im Sync-Modus).
// Läuft irgendwo ein Video mit Ton, wird die Musik je nach Einstellung leiser oder pausiert.
// ---------------------------------------------------------------------------

const MUSIC_LEAD = 1500; // Vorlauf, damit alle Screens den Titel laden können
state.music = {
  items: [],
  currentId: null,
  playing: false,
  startedAt: 0, // Serverzeit, zu der der aktuelle Titel bei 0:00 war (bzw. sein wird)
  position: 0, // Position bei Pause (Sekunden)
  volume: 70,
  videoBehavior: 'duck', // duck = leiser weiterspielen, pause = pausieren, none = nichts ändern
  duckLevel: 20, // Lautstärke in % während eines Videos mit Ton
  shuffle: false,
  repeat: true,
  ...(state.music ?? {}),
  autoPaused: false,
};
// Nach einem Neustart den aktuellen Titel von vorn beginnen
if (state.music.playing) state.music.startedAt = Date.now() + 3000;

const music = () => state.music;
const musicItem = (id) => music().items.find((i) => i.id === id);
const musicPosition = () => (music().playing ? Math.max(0, (Date.now() - music().startedAt) / 1000) : music().position);

/**
 * Spielt dieser Screen ein Video mit Ton – oder gleich, weil es gerade lädt?
 * Beim Wechsel zählt schon der neue Inhalt: folgt ein Video mit Ton, bleibt die Musik leiser bzw. pausiert,
 * statt kurz aufzuspielen. Videos ohne Tonspur (laut früherer Meldung) zählen nicht.
 */
function screenVideoSound(s) {
  if (!isOnline(s.id) || modeOf(s) !== 'play' || !s.audio) return false;
  const item = anyItemById(s.currentItemId);
  if (item?.type !== 'video' || item.hasAudio === false) return false;
  const r = s.report;
  if (r?.itemId === item.id && r.audio) return r.audio === 'on' && r.state !== 'error';
  if (r?.itemId === item.id && ['error', 'timeout'].includes(r.state)) return false;
  return s.lastAudio !== 'blocked'; // lädt noch: Ton erwartet (außer der Browser blockiert ihn ohnehin)
}
const videoSoundActive = () => state.screens.some(screenVideoSound);
let videoSound = false;
let videoSoundEnd = null; // Verzögerung, bevor die Musik nach einem Video wieder lauter wird

/** Musikzustand für einen Screen */
function musicMsg(screen) {
  const m = music();
  const track = musicItem(m.currentId);
  return {
    type: 'music',
    enabled: !!screen.music,
    playing: m.playing,
    track: track ? { id: track.id, kind: track.kind, src: track.src, title: track.title } : null,
    startedAt: m.startedAt,
    volume: m.volume,
    duck: m.videoBehavior === 'duck' && videoSound ? m.duckLevel : null,
    ...musicVolumeOf(screen),
    serverTime: Date.now(),
  };
}
/** Eigene Musiklautstärke des Screens (am Screen-Menü einstellbar), relativ zur Gesamtlautstärke */
const musicVolumeOf = (screen) => ({ screenVolume: screen.musicVolume ?? 100, muted: !!screen.musicMuted });
function setMusicVolume(screen, { volume, muted }) {
  if (volume !== undefined) screen.musicVolume = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
  if (typeof muted === 'boolean') screen.musicMuted = muted;
  pushMusic([screen]);
}

function pushMusic(screens = state.screens) {
  for (const s of screens) for (const ws of screenSockets.get(s.id) ?? []) send(ws, musicMsg(s));
  for (const c of state.screens) if (c.remote?.role === 'controller') pushRemoteSound(c); // Titel/Lautstärke an der Fernbedienung
}

function musicPlay(id, position = 0) {
  const m = music();
  const track = musicItem(id) ?? musicItem(m.currentId) ?? m.items[0];
  if (!track) return;
  m.currentId = track.id;
  m.position = position;
  m.startedAt = Date.now() - position * 1000 + (track.kind === 'radio' || position > 0 ? 0 : MUSIC_LEAD);
  m.playing = true;
  m.autoPaused = false;
  pushMusic();
}
function musicPause() {
  const m = music();
  m.position = musicPosition();
  m.playing = false;
  m.autoPaused = false;
  pushMusic();
}
function musicStep(dir) {
  const m = music();
  if (!m.items.length) return;
  let next;
  if (m.shuffle && m.items.length > 1) {
    const others = m.items.filter((i) => i.id !== m.currentId);
    next = others[Math.floor(Math.random() * others.length)];
  } else {
    const idx = m.items.findIndex((i) => i.id === m.currentId);
    const n = idx + dir;
    if (n >= m.items.length && !m.repeat) {
      // Ende der Liste ohne Wiederholen: anhalten
      m.playing = false;
      m.position = 0;
      return pushMusic();
    }
    next = m.items[(n + m.items.length) % m.items.length];
  }
  musicPlay(next.id, 0);
}
/** Zurück: wie üblich erst an den Anfang des Titels, dann zum vorherigen */
function musicBack() {
  if (musicPosition() > 5) musicPlay(music().currentId, 0);
  else musicStep(-1);
}

/**
 * Video mit Ton beginnt/endet: Musik pausieren bzw. fortsetzen oder leiser stellen.
 * Leiser/Pause sofort, wieder lauter erst nach kurzer Wartezeit – so überbrückt die Musik
 * auch Lücken beim Wechsel zwischen zwei Videos mit Ton.
 */
function updateVideoSound(settled = false) {
  const now = videoSoundActive();
  if (!now && videoSound && !settled) {
    videoSoundEnd ??= setTimeout(() => {
      videoSoundEnd = null;
      updateVideoSound(true);
    }, 1500);
    return;
  }
  clearTimeout(videoSoundEnd);
  videoSoundEnd = null;
  if (now === videoSound) return;
  videoSound = now;
  applyVideoBehavior();
  pushMusic();
  changed();
}

/** Gewähltes Verhalten auf den aktuellen Zustand anwenden (auch direkt nach dem Umstellen) */
function applyVideoBehavior() {
  const m = music();
  const pause = videoSound && m.videoBehavior === 'pause';
  if (pause && m.playing) {
    m.position = musicPosition();
    m.playing = false;
    m.autoPaused = true;
  } else if (!pause && m.autoPaused) {
    m.autoPaused = false;
    m.playing = true;
    m.startedAt = Date.now() - m.position * 1000;
  }
}

/** Meldungen der Screens zur Musik */
function handleMusicMessage(screen, msg) {
  const m = music();
  if (msg.type === 'musicStatus') {
    screen.musicReport = { state: String(msg.state ?? ''), at: Date.now() };
    const track = musicItem(msg.trackId);
    const d = Math.round(Number(msg.duration));
    if (track && track.kind === 'file' && d > 0 && track.duration !== d) track.duration = d;
    changed();
  } else if (msg.type === 'musicEnded') {
    // Der erste Screen, der fertig ist, schaltet weiter (spätere Meldungen derselben Runde ignorieren)
    if (m.playing && msg.trackId === m.currentId && msg.startedAt === m.startedAt) {
      musicStep(1);
      changed();
    }
  }
}

/** Neuer Musikeintrag aus einer Datei (hochgeladen oder aus einer Medienquelle) */
function musicFileItem({ file, mediaFile, title, hash }) {
  const id = newId();
  return file
    ? { id, kind: 'file', src: '/uploads/' + file, file, hash, title }
    : { id, kind: 'file', src: `/mediafile/${id}/${encodeURIComponent(path.basename(mediaFile))}`, mediaFile, title };
}

function insertMusic(items, position) {
  const list = music().items;
  const pos = Number.isInteger(position) ? Math.max(0, Math.min(list.length, position)) : list.length;
  list.splice(pos, 0, ...items);
}

app.post('/api/music/items', async (req, res) => {
  const { kind, url, title, source, paths, position } = req.body ?? {};
  const added = [];
  const skipped = [];
  if (kind === 'radio') {
    if (!/^https?:\/\//i.test(url ?? '')) return res.status(400).json({ error: 'Bitte eine Stream-Adresse mit http:// oder https:// angeben' });
    added.push({ id: newId(), kind: 'radio', src: url.trim(), title: String(title ?? '').trim().slice(0, 80) || url.trim() });
  } else {
    const skipDuplicates = state.settings.duplicates !== 'add';
    const mediaSrc = mediaSource(source);
    for (const rel of Array.isArray(paths) ? paths : []) {
      let entry;
      if (source === 'uploads') {
        const file = path.basename(String(rel ?? ''));
        if (mediaTypeOf(file) !== 'audio' || !fs.existsSync(path.join(UPLOAD_DIR, file))) continue;
        const known = music().items.find((i) => i.file === file);
        entry = { file, title: known?.title ?? file.replace(/\.[^.]+$/, ''), hash: known?.hash };
      } else {
        const abs = resolveMedia(mediaSrc, rel);
        if (!abs || mediaTypeOf(abs) !== 'audio' || !(await fs.promises.stat(abs).catch(() => null))?.isFile()) continue;
        entry = { mediaFile: abs, title: path.basename(abs).replace(/\.[^.]+$/, '') };
      }
      const existing = music().items.find((i) => (entry.file ? i.file === entry.file : i.mediaFile === entry.mediaFile));
      if (existing && skipDuplicates) {
        skipped.push({ name: entry.title });
        continue;
      }
      added.push(musicFileItem(entry));
    }
  }
  insertMusic(added, position);
  if (added.length && !music().currentId) music().currentId = added[0].id;
  changed();
  res.json({ added, skipped });
});

app.patch('/api/music/items/:id', (req, res) => {
  const item = musicItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
  if (typeof req.body?.title === 'string' && req.body.title.trim()) item.title = req.body.title.trim().slice(0, 120);
  if (item.id === music().currentId) pushMusic();
  changed();
  res.json(item);
});

app.delete('/api/music/items/:id', (req, res) => {
  const m = music();
  const item = musicItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
  if (item.id === m.currentId) {
    if (m.playing && m.items.length > 1) musicStep(1);
    if (m.currentId === item.id) {
      m.playing = false;
      m.currentId = null;
    }
  }
  m.items = m.items.filter((i) => i !== item);
  if (item.file && !uploadInUse(item.file)) fs.rm(path.join(UPLOAD_DIR, item.file), { force: true }, () => {});
  pushMusic();
  changed();
  res.json({ ok: true });
});

app.put('/api/music/order', (req, res) => {
  const pos = new Map((req.body?.ids ?? []).map((id, i) => [id, i]));
  music().items.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  changed();
  res.json({ ok: true });
});

// Steuerung: play (optional id), pause, next, prev, seek
app.post('/api/music/:action', (req, res) => {
  const m = music();
  const { action } = req.params;
  if (action === 'play') {
    if (req.body?.id) musicPlay(req.body.id, 0);
    else musicPlay(m.currentId, m.playing ? 0 : m.position); // Fortsetzen an der Pausenstelle
  } else if (action === 'pause') musicPause();
  else if (action === 'next') musicStep(1);
  else if (action === 'prev') musicBack();
  else if (action === 'seek') {
    const t = Math.max(0, Number(req.body?.time) || 0);
    if (m.playing) {
      m.startedAt = Date.now() - t * 1000;
      pushMusic();
    } else m.position = t;
  } else return res.status(404).json({ error: 'Unbekannte Aktion' });
  changed();
  res.json({ ok: true });
});

// Einstellungen: Lautstärke, Verhalten bei Video mit Ton, Zufall, Wiederholen
app.patch('/api/music', (req, res) => {
  const m = music();
  const b = req.body ?? {};
  if (b.volume !== undefined) m.volume = Math.max(0, Math.min(100, Math.round(Number(b.volume) || 0)));
  if (b.duckLevel !== undefined) m.duckLevel = Math.max(0, Math.min(100, Math.round(Number(b.duckLevel) || 0)));
  if (['duck', 'pause', 'none'].includes(b.videoBehavior) && b.videoBehavior !== m.videoBehavior) {
    // gilt sofort, auch für das gerade laufende Video
    m.videoBehavior = b.videoBehavior;
    applyVideoBehavior();
  }
  if (typeof b.shuffle === 'boolean') m.shuffle = b.shuffle;
  if (typeof b.repeat === 'boolean') m.repeat = b.repeat;
  pushMusic();
  changed();
  res.json({ ok: true });
});

// --- Mehrere Playlisten ------------------------------------------------------

const playlistById = (id) => state.playlists.find((p) => p.id === id);
const toName = (v, fallback) => String(v ?? '').trim().slice(0, 60) || fallback;

/** Playlist aktivieren: läuft ab sofort auf den Screens (feste Zuordnungen anderer Playlisten ruhen) */
function activatePlaylist(p) {
  state.activePlaylistId = p.id;
  state.playlist = p.items;
  distribute();
  restartTimer();
}

app.post('/api/playlists', (req, res) => {
  const source = playlistById(req.body?.copyFrom);
  const items = (source?.items ?? []).map((i) => {
    // Kopie mit neuen IDs; Vorschaubild mitkopieren, damit es nicht neu erzeugt werden muss
    const copy = { ...i, id: newId(), updatedAt: Date.now() };
    if (i.thumbFile) {
      copy.thumbFile = `thumb-${copy.id}.jpg`;
      try {
        fs.copyFileSync(path.join(UPLOAD_DIR, i.thumbFile), path.join(UPLOAD_DIR, copy.thumbFile));
        copy.thumb = `/uploads/${copy.thumbFile}?v=${Date.now().toString(36)}`;
      } catch {
        delete copy.thumbFile;
        delete copy.thumb;
      }
    }
    if (i.mediaFile) copy.src = `/mediafile/${copy.id}/${encodeURIComponent(path.basename(i.mediaFile))}`;
    return copy;
  });
  const p = { id: newId(), name: toName(req.body?.name, source ? `${source.name} (Kopie)` : 'Neue Playlist'), items };
  state.playlists.push(p);
  if (req.body?.activate) activatePlaylist(p);
  changed();
  res.json({ id: p.id, name: p.name });
});

app.patch('/api/playlists/:id', (req, res) => {
  const p = playlistById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Nicht gefunden' });
  p.name = toName(req.body?.name, p.name);
  changed();
  res.json({ id: p.id, name: p.name });
});

app.post('/api/playlists/:id/activate', (req, res) => {
  const p = playlistById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Nicht gefunden' });
  if (p.id !== state.activePlaylistId) activatePlaylist(p);
  changed();
  res.json({ ok: true });
});

app.delete('/api/playlists/:id', (req, res) => {
  const p = playlistById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Nicht gefunden' });
  if (state.playlists.length < 2) return res.status(400).json({ error: 'Die letzte Playlist kann nicht gelöscht werden' });
  state.playlists = state.playlists.filter((x) => x !== p);
  for (const item of [...p.items]) removeItem(item, p.items); // Dateien nur löschen, wenn nirgends mehr verwendet
  if (p.id === state.activePlaylistId) activatePlaylist(state.playlists[0]);
  changed();
  res.json({ ok: true });
});

/** Wird die hochgeladene Datei noch von einem Playlist-Eintrag oder als Standbild verwendet? */
const uploadInUse = (file) =>
  allItems().some((i) => i.file === file) || music().items.some((i) => i.file === file) || state.screens.some((s) => s.standby?.file === file);

/** Eintrag entfernen, inkl. fester Zuordnungen, Warteschlangen, Standbilder und Datei (sofern nicht mehr verwendet) */
function removeItem(item, list = state.playlist) {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1); // im Array entfernen (state.playlist bleibt die Liste der aktiven Playlist)
  for (const s of state.screens) {
    if (s.pinnedItemId === item.id) s.pinnedItemId = null;
    if (s.queue) s.queue = s.queue.filter((id) => id !== item.id);
    if (state.syncQueue) state.syncQueue = state.syncQueue.filter((id) => id !== item.id);
    if (s.standby?.itemId === item.id) {
      s.standby = null;
      pushMode(s);
    }
  }
  if (item.file && !uploadInUse(item.file)) fs.rm(path.join(UPLOAD_DIR, item.file), { force: true }, () => {});
  if (item.thumbFile) fs.rm(path.join(UPLOAD_DIR, item.thumbFile), { force: true }, () => {});
}

// Vorschaubild für ein Video: erzeugt die Verwaltung im Browser (Standbild als JPG) und lädt es hier hoch
app.post('/api/playlist/:id/thumb', express.raw({ type: 'image/jpeg', limit: '2mb' }), (req, res) => {
  const item = anyItemById(req.params.id);
  if (!item || item.type !== 'video') return res.status(404).json({ error: 'Nicht gefunden' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Kein Bild' });
  item.thumbFile = `thumb-${item.id}.jpg`;
  fs.writeFileSync(path.join(UPLOAD_DIR, item.thumbFile), req.body);
  item.thumb = `/uploads/${item.thumbFile}?v=${Date.now().toString(36)}`; // updatedAt bleibt: Screens nicht neu laden
  changed();
  res.json({ thumb: item.thumb });
});

app.delete('/api/playlist/:id', (req, res) => {
  const item = anyItemById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
  removeItem(item, listOf(item));
  redistributeAfterPlaylistChange();
  changed();
  res.json({ ok: true });
});

// Sammelaktionen für mehrere Einträge auf einmal (nur eine Neuverteilung)
app.post('/api/playlist/bulk', (req, res) => {
  const { ids, action } = req.body ?? {};
  const items = (Array.isArray(ids) ? ids : []).map(anyItemById).filter(Boolean);
  if (!['enable', 'disable', 'delete'].includes(action)) return res.status(400).json({ error: 'Unbekannte Aktion' });
  for (const item of items) {
    if (action === 'delete') removeItem(item, listOf(item));
    else {
      item.enabled = action === 'enable';
      item.updatedAt = Date.now();
    }
  }
  redistributeAfterPlaylistChange();
  changed();
  res.json({ count: items.length });
});

// --- Screens ----------------------------------------------------------------

app.put('/api/screens/order', (req, res) => {
  const ids = req.body?.ids ?? [];
  const pos = new Map(ids.map((id, i) => [id, i]));
  state.screens.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  if (!isSyncMode() && !isShuffle()) distribute();
  changed();
  res.json({ ok: true });
});

app.patch('/api/screens/:id', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Nicht gefunden' });
  const { name, pinnedItemId, audio, volume, mode, standbyItemId } = req.body ?? {};
  if (req.body?.imageQuality !== undefined) setScreenQuality(screen, req.body.imageQuality);
  if (typeof req.body?.music === 'boolean') {
    screen.music = req.body.music;
    pushMusic([screen]);
  }
  if (typeof req.body?.remoteAllowed === 'boolean') {
    // Ohne Freigabe zeigt der Screen keinen Fernsteuerungs-Knopf; eine laufende Steuerung endet
    screen.remoteAllowed = req.body.remoteAllowed;
    if (!screen.remoteAllowed && screen.remote?.role === 'controller') stopRemote(screen);
    else pushToScreen(screen);
  }
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
    updateVideoSound(true);
  }
  if (req.body?.musicVolume !== undefined || typeof req.body?.musicMuted === 'boolean') {
    setMusicVolume(screen, { volume: req.body.musicVolume, muted: req.body.musicMuted });
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
  // Ein Eintrag (itemId) oder mehrere auf einmal (itemIds)
  const items = (req.body?.itemIds ?? [req.body?.itemId]).map(itemById).filter(Boolean);
  if (!screen || !items.length) return res.status(404).json({ error: 'Nicht gefunden' });
  const queue = queueOf(screen);
  if (queue.length + items.length > QUEUE_LIMIT) return res.status(400).json({ error: `Warteschlange ist voll (max. ${QUEUE_LIMIT})` });
  queue.push(...items.map((i) => i.id));
  const position = queue.length;
  // Zeigt der Screen gerade nichts, sofort starten
  if (!screen.currentItemId && isActive(screen)) advanceScreens([screen.id], 'Warteschlange');
  changed();
  res.json({ position });
});

app.delete('/api/screens/:id/queue', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Nicht gefunden' });
  queueOf(screen).length = 0;
  changed();
  res.json({ ok: true });
});

app.delete('/api/screens/:id/queue/:index', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Nicht gefunden' });
  queueOf(screen).splice(Number(req.params.index), 1);
  changed();
  res.json({ ok: true });
});

// Eingereihten Eintrag sofort abspielen
app.post('/api/screens/:id/queue/:index/play', (req, res) => {
  const screen = screenById(req.params.id);
  const [id] = screen ? queueOf(screen).splice(Number(req.params.index), 1) : [];
  if (!id) return res.status(404).json({ error: 'Nicht gefunden' });
  queueOf(screen).unshift(id);
  advanceOrReplay(screen, 'Warteschlange');
  changed();
  res.json({ ok: true });
});

// Diesen Screen sofort weiterschalten (Warteschlange zuerst)
app.post('/api/screens/:id/remote/stop', (req, res) => {
  const screen = screenById(req.params.id);
  if (!screen?.remote) return res.status(404).json({ error: 'Nicht gefunden' });
  leaveRemote(screen);
  changed();
  res.json({ ok: true });
});

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
  if (screen.dueAt) {
    // Bild/Text ohne eigene Dauer: Restzeit des automatischen Wechsels anpassen (Sync-Gruppe gemeinsam)
    const dueAt = Date.now() + Math.max(0, intervalMs() - time * 1000);
    for (const s of inSync(screen) ? syncGroup() : [screen]) {
      if (!s.dueAt) continue;
      s.dueAt = dueAt;
      pushDue(s);
    }
    changed();
    return res.json({ ok: true });
  }
  if (syncMsg(screen)) {
    // Sync-Gruppe springt gemeinsam an die Stelle
    sync.start = Date.now() - time * 1000;
    for (const s of syncGroup()) pushSync(s);
    return res.json({ ok: true });
  }
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

// Alle Screens aus der Liste entfernen. Verbundene Screens melden sich danach automatisch neu an.
app.delete('/api/screens', (req, res) => {
  const count = state.screens.length;
  for (const s of state.screens) dropStandby(s);
  state.screens = [];
  state.syncQueue = [];
  for (const set of screenSockets.values()) for (const ws of set) ws.close(4000, 'Screen entfernt');
  changed();
  res.json({ count });
});

app.delete('/api/screens/:id', (req, res) => {
  const removed = screenById(req.params.id);
  if (removed) {
    leaveRemote(removed);
    dropStandby(removed);
  }
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

app.patch('/api/settings', async (req, res) => {
  const { autoAdvance, interval } = req.body ?? {};
  const s = state.settings;
  // Verteilung: alle gleich bzw. jeder eigenes (distribution) und Reihenfolge (shuffle); 'random' = alte Angabe
  const before = s.distribution + s.shuffle;
  if (['order', 'random', 'sync'].includes(req.body?.distribution)) Object.assign(s, migrateSettings({ ...s, distribution: req.body.distribution }));
  if (typeof req.body?.shuffle === 'boolean') s.shuffle = req.body.shuffle;
  const redistribute = s.distribution + s.shuffle !== before;
  if (typeof autoAdvance === 'boolean') s.autoAdvance = autoAdvance;
  if (interval !== undefined) s.interval = Math.max(3, Math.min(86400, Number(interval) || 30));
  if (req.body?.duplicates === 'skip' || req.body?.duplicates === 'add') s.duplicates = req.body.duplicates;
  if (req.body?.imageQuality in IMAGE_QUALITY && req.body.imageQuality !== s.imageQuality) {
    s.imageQuality = req.body.imageQuality;
    for (const scr of state.screens) refreshImages(scr); // auch Menüanzeige „Standard (…)“
  }
  if (typeof req.body?.hostName === 'string') s.hostName = toHostName(req.body.hostName);
  // Hauptport: gilt nach einem Neustart. Zusatz-Port: sofort neu starten und Ergebnis zurückmelden
  if (req.body?.port !== undefined) {
    const p = validPort(req.body.port);
    if (!p || p < 1) return res.status(400).json({ error: 'Ungültiger Port (1–65535)' });
    s.port = p;
  }
  if (req.body?.extraPort !== undefined) {
    const p = validPort(req.body.extraPort);
    if (p === null) return res.status(400).json({ error: 'Ungültiger Port (0–65535, 0 = aus)' });
    s.extraPort = p;
    if (!EXTRA_FROM_ENV) await listenExtra();
  }
  if (typeof req.body?.screenMenu === 'boolean' || typeof req.body?.touchZoom === 'boolean') {
    if (typeof req.body.screenMenu === 'boolean') s.screenMenu = req.body.screenMenu;
    if (typeof req.body.touchZoom === 'boolean') s.touchZoom = req.body.touchZoom;
    for (const set of screenSockets.values()) for (const ws of set) send(ws, { type: 'menu', enabled: s.screenMenu !== false, touchZoom: s.touchZoom !== false });
  }
  if (redistribute) distribute();
  if (autoAdvance !== undefined || interval !== undefined) restartTimer();
  changed();
  res.json(s);
});

app.post('/api/next', (req, res) => {
  advance();
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

  // Ohne gültige Anmeldung sofort trennen (4001 = Seite lädt neu und landet bei der PIN-Abfrage)
  if (!authorized(req, params.get('role') === 'screen' ? 'screen' : 'admin')) return ws.close(4001, 'PIN erforderlich');

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
    if (validPair(params.get('pair'))) {
      screen.remoteAllowed = true;
      if (!screen.remote) {
        const targets = state.screens.filter((x) => x !== screen && isOnline(x.id) && x.remote?.role !== 'controller').map((x) => x.id);
        setTimeout(() => {
          const s = screenById(id);
          if (s && !s.remote) {
            startRemote(s, targets);
            changed();
          }
        }, 300); // erst nach der ersten Anzeige, damit die Leiste sicher erscheint
      }
    }
    screen.ip = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    screen.userAgent = req.headers['user-agent'];
    screen.lastSeen = Date.now();

    if (!screenSockets.has(id)) screenSockets.set(id, new Set());
    screenSockets.get(id).add(ws);
    ws.page = 'screen';
    sendVersion(ws);
    pushToScreen(screen);
    pushDue(screen);
    pushMusic([screen]);
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
      else if (msg.type === 'musicStatus' || msg.type === 'musicEnded') handleMusicMessage(s, msg);
      else if (msg.type === 'remote' || msg.type === 'remoteList' || msg.type === 'remoteZoom' || msg.type === 'remoteDraw' || msg.type === 'remoteRotate' || msg.type === 'remoteSound' || msg.type === 'remotePlaylist') handleRemoteMessage(s, msg, ws);
      else if (msg.type === 'audio') {
        // Menü am Screen: Video-Ton an/aus und Lautstärke (wie in der Verwaltung)
        if (typeof msg.enabled === 'boolean') s.audio = msg.enabled;
        if (msg.volume !== undefined) s.volume = Math.max(0, Math.min(100, Math.round(Number(msg.volume) || 0)));
        pushAudio(s);
        updateVideoSound(true); // bewusst umgeschaltet: ohne Wartezeit
        changed();
      } else if (msg.type === 'musicVolume') {
        setMusicVolume(s, msg);
        changed();
      }
      else if (msg.type === 'quality') {
        setScreenQuality(s, msg.value);
        changed();
      } else if (msg.type === 'mode') {
        // Menü am Screen: nur selbst anhalten bzw. das eigene Anhalten wieder aufheben,
        // nicht über Pause/Bild/Dunkel aus der Verwaltung hinweg
        if (msg.mode === 'pause' && modeOf(s) === 'play') setMode(s, 'pause', 'screen');
        else if (msg.mode === 'play' && s.modeBy === 'screen') setMode(s, 'play');
        else return pushMode(s);
        changed();
      }
    });

    ws.on('close', () => {
      screenSockets.get(id)?.delete(ws);
      const s = screenById(id);
      if (s) {
        s.lastSeen = Date.now();
        if (!isOnline(id)) {
          s.report = null;
          s.musicReport = null;
          if (s.remote?.role === 'controller') {
            setTimeout(() => {
              const c = screenById(id);
              if (c?.remote?.role === 'controller' && !isOnline(id)) {
                stopRemote(c);
                changed();
              }
            }, REMOTE_GRACE);
          }
        }
      }
      updateVideoSound();
      changed();
    });
  } else {
    adminSockets.add(ws);
    ws.page = 'admin';
    sendVersion(ws);
    sendFullState(ws);
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

// server.js selbst wird erst mit einem Neustart aktiv: Änderungen danach in der Verwaltung melden
const SERVER_FILE = fileURLToPath(import.meta.url);
const SERVER_MTIME = fs.statSync(SERVER_FILE).mtimeMs;
function serverOutdated() {
  try {
    return fs.statSync(SERVER_FILE).mtimeMs > SERVER_MTIME;
  } catch {
    return false;
  }
}
let serverWatchTimer = null;
fs.watch(SERVER_FILE, () => {
  clearTimeout(serverWatchTimer);
  serverWatchTimer = setTimeout(() => serverOutdated() && changed(), 1000);
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
if (isSyncMode()) distribute(); // gemeinsame Startzeit gibt es nach einem Neustart nicht mehr

/**
 * Zusatz-Port (Standard 80) mit derselben App, damit Adressen ohne bzw. mit anderem Port funktionieren.
 * WebSocket-Verbindungen gehen an den Hauptserver. Belegt oder ohne Berechtigung: nur der Hauptport.
 */
let extraServer = null;
let extraStatus = null; // { port, ok: true } | { port, error: 'EADDRINUSE' | 'EACCES' | … } | null (aus)
async function listenExtra() {
  if (extraServer) {
    const old = extraServer;
    extraServer = null;
    await new Promise((resolve) => {
      old.close(() => resolve());
      old.closeAllConnections?.();
    });
  }
  const port = extraPortSetting();
  extraStatus = null;
  if (port && port !== PORT) {
    const extra = http.createServer(app);
    extra.on('upgrade', (req, socket, head) => server.emit('upgrade', req, socket, head));
    extraStatus = await new Promise((resolve) => {
      extra.once('error', (e) => resolve({ port, error: e.code }));
      extra.listen(port, () => resolve({ port, ok: true }));
    });
    if (extraStatus.ok) extraServer = extra;
  }
  shortPort = extraStatus?.ok ? port : PORT;
  return extraStatus;
}

server.listen(PORT, async () => {
  const extra = await listenExtra();
  const EXTRA_PORT = extra?.port;
  // Startmeldung in der Sprache des Systems
  const de = Intl.DateTimeFormat().resolvedOptions().locale.startsWith('de');
  const ports = extra?.ok ? `${PORT} + ${EXTRA_PORT}` : PORT;
  console.log(de ? `ScreenDeck läuft auf Port ${ports}` : `ScreenDeck is running on port ${ports}`);
  const line = (label, url) => console.log(`  ${(label + ':').padEnd(13)}${url}`);
  line(de ? 'Verwaltung' : 'Admin', `http://localhost:${PORT}/admin`);
  if (hostName()) line(de ? 'Im Netzwerk' : 'Network', withPort(hostName() + '.local', shortPort));
  for (const a of Object.values(os.networkInterfaces()).flat()) {
    if (a && a.family === 'IPv4' && !a.internal) line('Screens', withPort(a.address, shortPort));
  }
  if (extra?.error) {
    const why = extra.error === 'EADDRINUSE' ? (de ? 'schon belegt' : 'already in use') : de ? 'keine Berechtigung' : 'no permission';
    console.log(de ? `  (Port ${EXTRA_PORT} ${why} – Adressen daher mit :${PORT})` : `  (port ${EXTRA_PORT} ${why} – addresses therefore use :${PORT})`);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    saveNow();
    process.exit(0);
  });
}
