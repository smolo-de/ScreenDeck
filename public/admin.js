const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let state = null;
let clockOffset = 0; // Serverzeit - lokale Zeit
let renderPending = false;
let dragging = false;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) location.reload(); // nicht (mehr) angemeldet: zur PIN-Abfrage
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(data.error || `Fehler ${res.status}`);
    throw new Error(data.error);
  }
  return data;
}

let toastTimer;
function toast(text, ms = 2500) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

// ---------------------------------------------------------------------------
// Live-Verbindung
// ---------------------------------------------------------------------------

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?role=admin`);
  ws.onopen = () => {
    $('#conn').classList.add('on');
    $('#connText').textContent = 'Live verbunden';
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'state') {
      // Der Server schickt nur die geänderten Teile (screens, playlists, music, rest)
      const { screens, playlists, music, rest } = msg.parts;
      state = { ...(msg.full ? {} : state), ...rest, ...(screens && { screens }), ...(playlists && { playlists }), ...(music && { music }) };
      state.playlist = state.playlists.find((p) => p.id === state.activePlaylistId)?.items ?? [];
      clockOffset = state.serverTime - Date.now();
      requestRender();
    } else if (msg.type === 'version') {
      // Neuer Code auf dem Server: Verwaltung neu laden (aber nicht mitten in einer Eingabe)
      if (msg.version !== window.PAGE_VERSION && !window.PAGE_VERSION.startsWith('{{')) {
        if (isBusy()) toast('Neue Version verfügbar – Seite bitte neu laden');
        else location.reload();
      }
    } else if (msg.type === 'progress') {
      progress.set(msg.screenId, msg);
      updateProgress(msg.screenId);
    }
  };
  ws.onclose = async (e) => {
    // Anmeldung fehlt oder PIN wurde geändert: nur neu laden, wenn das Cookie wirklich nicht mehr gilt
    if (e.code === 4001) {
      const res = await fetch('/api/info').catch(() => null);
      if (res?.status === 401) return location.reload();
    }
    $('#conn').classList.remove('on');
    $('#connText').textContent = 'Getrennt – verbinde neu…';
    setTimeout(connect, 2000);
  };
}

// Nicht neu zeichnen, während getippt oder gezogen wird
function isBusy() {
  const a = document.activeElement;
  return (
    dragging ||
    sliding ||
    (a && a.matches('.meta input[type=text], .meta input[type=number], .standby-edit textarea, .standby-edit input, #interval, .ms-name'))
  );
}
let sliding = false; // Lautstärke-Regler wird gerade gezogen
document.addEventListener('pointerdown', (e) => (sliding = e.target.matches('input[type=range]')));
document.addEventListener('pointerup', () => {
  sliding = false;
  setTimeout(() => renderPending && !isBusy() && render(), 0);
});
// Mehrere Meldungen kurz hintereinander: nur einmal pro Bild neu zeichnen
let renderFrame = 0;
function requestRender() {
  if (isBusy()) return (renderPending = true);
  renderFrame ||= requestAnimationFrame(() => {
    renderFrame = 0;
    isBusy() ? (renderPending = true) : render();
  });
}
document.addEventListener('focusout', () => setTimeout(() => renderPending && !isBusy() && render(), 0));

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------

const itemById = (id) =>
  state.playlist.find((i) => i.id === id) ?? (state.playlists ?? []).flatMap((p) => p.items ?? []).find((i) => i.id === id);

// Angezeigte Playlist (wird bearbeitet) – kann von der aktiven (läuft auf den Screens) abweichen
let viewPlaylistId = (() => {
  try {
    return localStorage.getItem('screendeck-playlist') || null;
  } catch {
    return null;
  }
})();
const viewPlaylist = () =>
  state.playlists?.find((p) => p.id === viewPlaylistId) ?? state.playlists?.find((p) => p.id === state.activePlaylistId);
const viewItems = () => viewPlaylist()?.items ?? state.playlist;
const isViewActive = () => !state.playlists || viewPlaylist()?.id === state.activePlaylistId;
const viewParam = () => viewPlaylist()?.id; // Ziel-Playlist für Hinzufügen/Sortieren

const fontOptions = (selected) =>
  SCREEN_FONTS.map((f) => `<option value="${f.id}" ${f.id === (selected || 'system') ? 'selected' : ''}>${esc(f.label)}</option>`).join('');
const edgeOptions = (selected) =>
  SCREEN_EDGES.map((e) => `<option value="${e.id}" ${e.id === (selected || 'none') ? 'selected' : ''}>${esc(e.label)}</option>`).join('');
const EDGE_RADIUS = { soft: '8px', strong: '16px' }; // Vorschau in der Verwaltung
const TYPE_LABEL = { image: 'Bild', video: 'Video', url: 'Webseite', text: 'Text' };

// Bilder in der Liste als kleine Vorschau (320 px, vom Server erzeugt und zwischengespeichert) statt im Original
const canThumb = (src) => !/\.(gif|svg)(\?|$)/i.test(decodeURIComponent(src ?? ''));
const thumbSrc = (item) => item.thumbSrc ?? (item.id && canThumb(item.src) ? `/img/${item.id}/thumb?v=${item.updatedAt}` : item.src);

function thumb(item, extra = '') {
  if (!item) return `<div class="thumb none">leer${extra}</div>`;
  switch (item.type) {
    case 'image': return `<div class="thumb"><img src="${esc(thumbSrc(item))}" loading="lazy" decoding="async" alt="">${extra}</div>`;
    case 'video': {
      if (item.thumb) return `<div class="thumb"><img src="${esc(item.thumb)}" loading="lazy" alt="">${extra}</div>`;
      if (!item.id || thumbFailed.has(item.id)) return `<div class="thumb icon" title="Keine Vorschau möglich">🎬${extra}</div>`;
      queueThumb(item.id);
      const active = thumbActive === item.id;
      return `<div class="thumb loading ${active ? 'active' : ''}" title="Vorschaubild wird erstellt"><span class="tl">${active ? '🎬 lädt…' : '🎬 wartet…'}</span><div class="tbar"><div></div></div>${extra}</div>`;
    }
    case 'url': return `<div class="thumb icon">🌐${extra}</div>`;
    case 'text': {
      const style = `background:${esc(item.bg)};color:${esc(item.color)};font-family:${esc(fontFamily(item.font))};border-radius:${EDGE_RADIUS[item.edge] ?? '6px'}`;
      return `<div class="thumb text ${item.edge && item.edge !== 'none' ? 'soft' : ''}" style="${style}">${esc(item.text.slice(0, 40))}${extra}</div>`;
    }
  }
  return `<div class="thumb">?${extra}</div>`;
}

// ---------------------------------------------------------------------------
// Video-Vorschaubilder: einzeln nacheinander erzeugen (Standbild als JPG) und
// auf dem Server speichern – danach lädt die Vorschau nur noch ein kleines Bild
// ---------------------------------------------------------------------------

const thumbQueue = [];
const thumbFailed = new Set(); // in dieser Sitzung nicht erzeugbar (z. B. Codec nicht unterstützt)
let thumbActive = null;

function queueThumb(id) {
  if (id === thumbActive || thumbQueue.includes(id)) return;
  thumbQueue.push(id);
  setTimeout(pumpThumbs, 0);
}

async function pumpThumbs() {
  if (thumbActive || !thumbQueue.length) return;
  const id = thumbQueue.shift();
  const item = itemById(id);
  if (!item || item.type !== 'video' || item.thumb) return pumpThumbs();
  thumbActive = id;
  requestRender();
  try {
    const blob = await captureThumb(item.src);
    const res = await fetch(`/api/playlist/${id}/thumb`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (!res.ok) throw new Error(`Upload ${res.status}`);
    item.thumb = (await res.json()).thumb; // sofort anzeigen, ohne auf den nächsten Stand zu warten
  } catch (e) {
    console.warn('Vorschaubild', item.title, e.message);
    thumbFailed.add(id);
  }
  thumbActive = null;
  requestRender();
  pumpThumbs();
}

function captureThumb(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    const timer = setTimeout(() => fail('Zeitüberschreitung'), 90000);
    const cleanup = () => {
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load(); // Download abbrechen
    };
    const fail = (msg) => {
      cleanup();
      reject(new Error(msg));
    };
    v.onerror = () => fail('Video nicht lesbar');
    v.onloadedmetadata = () => (v.currentTime = Math.min(1, (v.duration || 2) / 2));
    let retried = false;
    v.onseeked = () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = Math.round(320 * (v.videoHeight / v.videoWidth || 9 / 16));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      // Fast schwarzes Bild (z. B. Einblendung am Anfang): einmal weiter hinten versuchen
      if (!retried && v.duration > 3 && brightness(ctx, c) < 12) {
        retried = true;
        v.currentTime = v.duration * 0.3;
        return;
      }
      cleanup();
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Kein Bild'))), 'image/jpeg', 0.8);
    };
    v.src = src;
  });
}

/** Mittlere Helligkeit 0–255 (Stichprobe jedes 16. Pixels) */
function brightness(ctx, c) {
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 64) {
    sum += d[i] + d[i + 1] + d[i + 2];
    n += 3;
  }
  return n ? sum / n : 0;
}

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() + clockOffset - ts) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return new Date(ts).toLocaleString(I18N.locale);
}

// Abgleich: Was soll der Screen zeigen, was meldet er tatsächlich zurück?
const CONFIRM_TIMEOUT = 10000;
const STATE_TEXT = {
  showing: ['ok', '✓ wird angezeigt'],
  playing: ['ok', '✓ Video läuft'],
  paused: ['ok', '✓ pausiert'],
  idle: ['ok', '✓ leer'],
  loading: ['warn', '⏳ lädt…'],
  timeout: ['warn', '⚠ Laden nicht bestätigt'],
  blocked: ['err', '✗ Autoplay blockiert – am Gerät einmal tippen'],
  stalled: ['err', '✗ Video hängt'],
  error: ['err', '✗ Fehler'],
};

function verification(s, online) {
  if (!online) return { cls: 'off', text: 'offline' };
  const item = itemById(s.currentItemId);
  const r = s.report;
  const pending = Date.now() + clockOffset - (s.sentAt ?? 0) < CONFIRM_TIMEOUT;
  const retry = s.retries ? ` · Neuversuch ${s.retries}/3` : '';
  const mode = s.mode ?? 'play';
  const matches = r && r.itemId === (item?.id ?? null) && (!item || r.updatedAt === item.updatedAt);
  const hidden = mode === 'image' || mode === 'dark'; // Inhalt verdeckt, nur der Modus zählt

  if (!r || r.mode !== mode || (!hidden && !matches)) {
    if (pending) return { cls: 'warn', text: '⏳ wird übertragen…' + retry };
    if (r && r.mode !== mode) return { cls: 'err', text: `✗ ${MODE_LABEL[mode]} nicht bestätigt` + retry };
    const actual = r?.itemId ? itemById(r.itemId)?.title ?? 'unbekannter Inhalt' : null;
    return { cls: 'err', text: (actual ? `✗ zeigt stattdessen „${actual}“` : '✗ keine Rückmeldung') + retry };
  }
  if (hidden) return { cls: 'ok', text: mode === 'dark' ? '✓ dunkel' : s.standby ? '✓ Standbild' : '✓ Standbild (kein Bild gewählt → schwarz)' };
  const [cls, text] = STATE_TEXT[r.state] ?? ['warn', r.state];
  const detail = r.detail && r.state === 'error' ? `: ${r.detail}` : '';
  if (mode === 'pause' && cls === 'ok') return { cls, text: '✓ pausiert' };
  return { cls, text: text + detail + (cls === 'ok' ? '' : retry) };
}

const QUALITY_LABEL = { original: 'Original', uhd: '4K', fhd: 'Full HD', hd: 'HD', low: 'Niedrig' };
const MODE_LABEL = { play: 'Play', pause: 'Pause', image: 'Standbild', dark: 'Dunkel' };
const MODE_BUTTONS = [
  ['play', '▶', 'Abspielen'],
  ['pause', '⏸', 'Pausieren – Inhalt bleibt stehen'],
  ['image', '🖼', 'Standbild dieses Screens zeigen'],
  ['dark', '⬛', 'Dunkel schalten'],
];

// Geklickter Modus wird sofort angezeigt, bis der Server ihn bestätigt (höchstens 3 s)
const pendingMode = new Map(); // screenId -> { mode, until }
function setPendingMode(ids, mode) {
  for (const id of ids) pendingMode.set(id, { mode, until: Date.now() + 3000 });
  render();
}
function shownMode(s) {
  const p = pendingMode.get(s.id);
  if (p && (p.mode === (s.mode ?? 'play') || Date.now() > p.until)) pendingMode.delete(s.id);
  return pendingMode.get(s.id)?.mode ?? s.mode ?? 'play';
}

/** Modus-Buttons ▶ ⏸ 🖼 ⬛ */
function modeButtons(s) {
  const mode = shownMode(s);
  // Am Screen selbst angehalten: Pause-Button zeigt „⏸ Client“, ▶ setzt fort
  const clientPause = mode === 'pause' && s.modeBy === 'screen' && !pendingMode.has(s.id);
  const buttons = MODE_BUTTONS.map(([m, icon, title]) => {
    const client = clientPause && m === 'pause';
    return `<button class="${m === mode ? 'active' : ''} ${client ? 'client' : ''}" data-action="mode" data-mode="${m}" title="${client ? 'Am Screen über das Menü angehalten – ▶ setzt fort' : title}">${client ? '⏸ Client' : icon}</button>`;
  }).join('');
  return `<div class="segmented modes small">${buttons}</div>`;
}

/** Auswahl des Standbilds (Modus „Bild“) */
function standbySelect(s) {
  const images = state.playlist.filter((i) => i.type === 'image');
  const sb = s.standby;
  const options = [
    `<option value="">keins</option>`,
    sb?.file ? `<option value="__own" selected>${esc(sb.title)} (eigenes)</option>` : '',
    ...images.map((i) => `<option value="${esc(i.id)}" ${sb?.itemId === i.id ? 'selected' : ''}>${esc(i.title)}</option>`),
    `<option value="__upload">Eigenes Bild hochladen…</option>`,
  ].join('');
  return `<select class="standby" data-action="standby" title="Bild für den Modus „Bild“">${options}</select>`;
}

/** Standbild: Text & Optionen (aufklappbar) */
function standbyEdit(s) {
  const st = s.standbyStyle ?? {};
  return `
    <details class="standby-edit" data-standby="${esc(s.id)}" ${openStandby.has(s.id) ? 'open' : ''}>
      <summary>Standbild: Text &amp; Optionen${st.text?.trim() ? ' ✎' : ''}</summary>
      <div class="standby-form">
        <textarea rows="2" data-action="sb-text" placeholder="Text im Bild-Modus (optional), z. B. „Gleich geht's weiter“">${esc(st.text ?? '')}</textarea>
        <div class="row">
          <label>Schrift <select class="mini" data-action="sb-font">${fontOptions(st.font)}</select></label>
          <label>Farbe <input type="color" data-action="sb-color" value="${esc(st.color ?? '#ffffff')}"></label>
          <label>Position <select class="mini" data-action="sb-position">
            ${['top', 'center', 'bottom'].map((p) => `<option value="${p}" ${p === (st.position ?? 'center') ? 'selected' : ''}>${{ top: 'Oben', center: 'Mitte', bottom: 'Unten' }[p]}</option>`).join('')}
          </select></label>
          <label>Bild-Ecken <select class="mini" data-action="sb-edge">${edgeOptions(st.edge)}</select></label>
        </div>
      </div>
    </details>`;
}
const openStandby = new Set();

/** Vorschau so, wie der Screen gerade aussieht */
function screenThumb(s, item, extra) {
  const mode = s.mode ?? 'play';
  if (mode === 'dark') return `<div class="thumb none">⬛ dunkel${extra}</div>`;
  if (mode === 'image') {
    const st = s.standbyStyle;
    const overlay = st?.text?.trim()
      ? `<span class="tover" style="color:${esc(st.color)};font-family:${esc(fontFamily(st.font))}">${esc(st.text.slice(0, 30))}</span>`
      : '';
    const sb = s.standby;
    const sbThumb = sb?.itemId ? `/img/${sb.itemId}/thumb` : sb?.file ? `/api/media/thumb?source=uploads&path=${encodeURIComponent(sb.file)}` : sb?.src;
    return sb ? thumb({ type: 'image', src: sb.src, thumbSrc: sbThumb }, overlay + extra) : `<div class="thumb none">${overlay || '🖼 kein Bild'}${extra}</div>`;
  }
  if (mode === 'pause') return thumb(item, extra + '<span class="tbadge">⏸</span>');
  return thumb(item, extra);
}

/** Fernsteuerung: steuernder bzw. gesteuerter Screen, mit „beenden“ */
function remoteBadge(s) {
  const r = s.remote;
  if (!r) return '';
  const name = (id) => state.screens.find((x) => x.id === id)?.name ?? '?';
  const text = r.role === 'controller' ? `📱 steuert ${r.targets.map(name).join(', ') || '–'}` : `📱 gesteuert von ${name(r.by)}`;
  return `<span class="badge remote" title="Fernsteuerung: der automatische Wechsel ruht, weitergeschaltet wird am steuernden Gerät">${esc(text)}</span>
    <button class="link" data-action="remote-stop">beenden</button>`;
}

// Ton-Status laut Rückmeldung (nur bei laufenden Videos aussagekräftig)
/** Musik auf diesem Screen (laut Rückmeldung) */
function musicStatus(s, online) {
  if (!online || !s.music || !state.music?.playing) return '';
  const st = s.musicReport?.state;
  if (st === 'blocked') return '<span class="verify err" title="Browser erlaubt Ton erst nach einer Berührung">♫ Musik blockiert – am Gerät tippen</span>';
  if (st === 'error') return '<span class="verify err">♫ Musik: Fehler</span>';
  if (s.musicMuted) return '<span class="verify" title="Am Screen im Menü stumm geschaltet">🔇 Musik stumm (am Screen)</span>';
  const own = (s.musicVolume ?? 100) < 100 ? ` ${s.musicVolume} %` : ''; // am Screen leiser gestellt
  return st === 'playing' ? `<span class="verify ok">♫ Musik${own}</span>` : '';
}

function audioStatus(s, online, v) {
  if (!online || v.cls !== 'ok' || !s.report?.audio || !s.audio) return '';
  if (s.report.audio === 'on') return '<span class="verify ok">♪ Ton läuft</span>';
  if (s.report.audio === 'blocked') return '<span class="verify err">🔇 Ton blockiert – am Gerät einmal tippen</span>';
  return '';
}

// ---------------------------------------------------------------------------
// Video-Fortschritt (kommt jede Sekunde direkt vom Screen, ohne kompletten Neuaufbau)
// ---------------------------------------------------------------------------

const progress = new Map(); // screenId -> { itemId, currentTime, duration }

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Position und Gesamtdauer: Videos/Texte mit Dauer melden sie selbst,
 * bei Bildern/Texten ohne Dauer ergibt sie sich aus dem automatischen Wechsel.
 */
function progressOf(screen) {
  if (screen.dueAt) {
    if ((screen.mode ?? 'play') !== 'play') return null;
    const duration = state.intervalMs / 1000;
    const remaining = (screen.dueAt - Date.now() - clockOffset) / 1000;
    return { currentTime: Math.max(0, Math.min(duration, duration - remaining)), duration };
  }
  const p = progress.get(screen.id);
  return p && p.itemId === screen.currentItemId && p.duration > 0 ? p : null;
}

function updateProgress(screenId) {
  const el = document.querySelector(`[data-progress="${CSS.escape(screenId)}"]`);
  const screen = state?.screens.find((s) => s.id === screenId);
  if (!el || !screen) return;
  const p = progressOf(screen);
  const valid = !!p;
  // Zeile bleibt immer stehen (Platzhalter bis zur ersten Meldung), damit nichts verrutscht
  el.querySelector('.ptime').textContent = valid ? `${fmtTime(p.currentTime)} / ${fmtTime(p.duration)}` : '–:–– / –:––';
  el.querySelector('.bar > div').style.width = valid ? `${Math.min(100, (p.currentTime / p.duration) * 100)}%` : '0%';
}

// ---------------------------------------------------------------------------
// „Als Nächstes“: Warteschlange + voraussichtlicher nächster Playlist-Eintrag
// ---------------------------------------------------------------------------

async function enqueue(screenId, itemId) {
  const screen = state.screens.find((s) => s.id === screenId);
  const item = itemById(itemId);
  const { position } = await api('POST', `/api/screens/${screenId}/queue`, { itemId });
  toast(`„${item?.title}“ bei „${screen?.name}“ eingereiht (Position ${position})`);
}

function upNextHtml(s) {
  const queue = (s.queue ?? []).map((id) => itemById(id)).filter(Boolean);
  const rows = queue
    .map(
      (i, n) => `
      <li>
        <span class="qpos">${n + 1}.</span>
        <span class="htitle">${TYPE_ICON[i.type] ?? ''} ${esc(i.title)}</span>
        <span class="qactions">
          <button class="link" data-action="queue-play" data-index="${n}" title="Sofort abspielen">▶ jetzt</button>
          <button class="icon danger" data-action="queue-remove" data-index="${n}" title="Aus der Warteschlange entfernen">✕</button>
        </span>
      </li>`
    )
    .join('');

  const auto = s.nextAuto;
  const autoItem = auto?.itemId ? itemById(auto.itemId) : null;
  const autoText =
    auto?.kind === 'pinned' ? `📌 ${esc(autoItem?.title)} (fest)`
    : auto?.kind === 'random' ? '🎲 zufällig aus der Playlist'
    : autoItem ? `${TYPE_ICON[autoItem.type] ?? ''} ${esc(autoItem.title)} <span class="muted">(voraussichtlich)</span>`
    : '<span class="muted">nichts</span>';

  return `
    <div class="upnext">
      <div class="upnext-head">
        <strong>Als Nächstes</strong>
        <span class="muted">${queue.length ? `${queue.length} eingereiht${s.inSync ? ' (gemeinsam für alle Sync-Screens)' : ''}` : 'Einträge per ＋ in der Playlist oder per Ziehen auf den Screen einreihen'}</span>
        <span class="spacer"></span>
        ${queue.length ? '<button class="link" data-action="queue-clear">leeren</button>' : ''}
        <button class="small" data-action="screen-next" title="Diesen Screen sofort weiterschalten">⏭ Weiter</button>
      </div>
      ${rows ? `<ol>${rows}</ol>` : ''}
      <div class="upnext-auto">${queue.length ? 'Danach' : 'Nächster'} aus der Playlist: ${autoText}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Verlauf pro Screen (standardmäßig eingeklappt)
// ---------------------------------------------------------------------------

const openHistory = new Set();
const TYPE_ICON = { image: '🖼', video: '🎬', url: '🌐', text: '🔤' };
const HISTORY_STATUS = {
  showing: ['ok', '✓', 'angezeigt'],
  playing: ['ok', '✓', 'abgespielt'],
  paused: ['ok', '✓', 'pausiert'],
  idle: ['ok', '✓', 'leer'],
  loading: ['warn', '⏳', 'lädt'],
  timeout: ['warn', '⚠', 'Laden nicht bestätigt'],
  blocked: ['err', '✗', 'Autoplay blockiert'],
  stalled: ['err', '✗', 'Video hing'],
  error: ['err', '✗', 'Fehler'],
};

const clock = (ts) => new Date(ts).toLocaleTimeString(I18N.locale);

function historyHtml(s) {
  const history = s.history ?? [];
  const rows = history
    .map((h) => {
      const [cls, icon, label] = HISTORY_STATUS[h.status] ?? ['off', '–', 'keine Rückmeldung'];
      const duration = h.end ? fmtTime((h.end - h.start) / 1000) : t('läuft');
      return `
        <li>
          <span class="htime">${clock(h.start)}</span>
          <span class="hstatus verify ${cls}" title="${esc(label)}">${icon}</span>
          <span class="htitle">${TYPE_ICON[h.type] ?? ''} ${esc(h.title)}</span>
          <span class="hmeta">${duration} · ${esc(t(h.reason ?? ''))}${h.ended ? ' · ' + t('bis zum Ende') : ''}</span>
        </li>`;
    })
    .join('');
  return `
    <details class="history" data-history="${esc(s.id)}" ${openHistory.has(s.id) ? 'open' : ''}>
      <summary>Verlauf (${history.length})</summary>
      ${rows ? `<ol>${rows}</ol>` : '<p class="help">Noch nichts angezeigt.</p>'}
    </details>`;
}

// Auf-/Zuklappen merken, damit es beim nächsten Neuaufbau erhalten bleibt
document.addEventListener(
  'toggle',
  (e) => {
    const id = e.target.dataset?.history;
    if (id) e.target.open ? openHistory.add(id) : openHistory.delete(id);
    const sid = e.target.dataset?.standby;
    if (sid) e.target.open ? openStandby.add(sid) : openStandby.delete(sid);
  },
  true
);

// Nur ändern, was sich wirklich geändert hat: Bestehende Elemente (Vorschau-Videos, Bilder,
// Fortschrittsbalken) bleiben erhalten, statt bei jedem Update neu geladen zu werden.
const lastHtml = new Map();
function setHtml(el, html) {
  if (lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  I18N.translateTree(tpl.content); // vorher übersetzen, sonst wird jeder übersetzte Text beim Abgleich ersetzt
  morphChildren(el, tpl.content);
}

/**
 * Lange Listen (Screens, Playlist, Musik): ein HTML-Schnipsel pro Eintrag (Schlüssel = data-id).
 * Nur Einträge, deren HTML sich geändert hat, werden neu eingelesen und abgeglichen – auch bei
 * hunderten Einträgen kostet ein Update nur so viel, wie sich tatsächlich geändert hat.
 */
const listCache = new Map(); // Liste -> Map(Schlüssel -> { html, node })
function setList(el, htmls, emptyHtml) {
  if (!htmls.length) {
    listCache.delete(el);
    return setHtml(el, emptyHtml);
  }
  lastHtml.delete(el); // falls die Liste vorher leer war (setHtml)
  const cache = listCache.get(el) ?? new Map();
  const next = new Map();
  let prev = null;
  for (const html of htmls) {
    const key = html.match(/data-id="([^"]*)"/)?.[1] ?? html;
    let entry = cache.get(key);
    if (!entry || entry.html !== html || entry.node.parentNode !== el) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html.trim();
      I18N.translateTree(tpl.content);
      const fresh = tpl.content.firstElementChild;
      const reuse = entry && entry.node.parentNode === el && sameNode(entry.node, fresh);
      if (reuse) morphNode(entry.node, fresh);
      entry = { html, node: reuse ? entry.node : fresh };
    }
    next.set(key, entry);
    const want = prev ? prev.nextSibling : el.firstChild;
    if (entry.node !== want) el.insertBefore(entry.node, want);
    prev = entry.node;
  }
  while (prev.nextSibling) prev.nextSibling.remove();
  listCache.set(el, next);
}

// Kurzlebige Klassen, die nicht aus dem HTML kommen und beim Abgleich erhalten bleiben
const TRANSIENT_CLASSES = ['flash', 'drop-target', 'dragging', 'drop-above', 'drop-below'];

const nodeKey = (n) => (n.nodeType === 1 ? n.getAttribute('data-id') : null);
const sameNode = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && nodeKey(a) === nodeKey(b);

function morphChildren(from, to) {
  const keyed = new Map();
  for (const c of from.children) if (nodeKey(c)) keyed.set(nodeKey(c), c);
  let cur = from.firstChild;
  for (const next of [...to.childNodes]) {
    const key = nodeKey(next);
    const match = key ? keyed.get(key) : cur;
    if (match && sameNode(match, next)) {
      if (key) keyed.delete(key);
      if (match === cur) cur = cur.nextSibling;
      else from.insertBefore(match, cur);
      morphNode(match, next);
    } else {
      from.insertBefore(next, cur);
    }
  }
  while (cur) {
    const n = cur.nextSibling;
    cur.remove();
    cur = n;
  }
}

function morphNode(a, b) {
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of b.attributes) {
    let v = value;
    if (name === 'class') v = [value, ...TRANSIENT_CLASSES.filter((c) => a.classList.contains(c))].join(' ').trim();
    if (a.getAttribute(name) !== v) a.setAttribute(name, v);
  }
  if (TRANSIENT_CLASSES.some((c) => a.classList.contains(c)) && !b.hasAttribute('class')) a.removeAttribute('class');
  const focused = a === document.activeElement;
  if (a.tagName === 'TEXTAREA') {
    if (!focused && a.value !== b.textContent) a.value = b.textContent;
    return;
  }
  morphChildren(a, b);
  // Formularwerte: Attribute allein ändern den angezeigten Wert nicht mehr
  if (focused) return;
  if (a.tagName === 'INPUT') {
    if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
    else if (a.value !== (b.getAttribute('value') ?? '')) a.value = b.getAttribute('value') ?? '';
  } else if (a.tagName === 'SELECT') {
    const value = b.querySelector('option[selected]')?.value ?? a.options[0]?.value ?? '';
    if (a.value !== value) a.value = value;
  }
}

function render() {
  renderPending = false;
  if (!state) return;
  const { settings, screens, online } = state;
  const playlist = viewItems(); // angezeigte Playlist
  const activeItems = state.playlist; // läuft auf den Screens
  renderPlaylistHead();
  renderMusic();
  $('#restartBanner').hidden = !state.serverOutdated;
  renderSecurity();
  $('#deleteAllScreens').hidden = !screens.length;

  // Steuerung
  for (const b of document.querySelectorAll('#distribution button')) {
    b.classList.toggle('active', b.dataset.value === settings.distribution);
  }
  const modes = new Set(screens.map(shownMode));
  for (const b of document.querySelectorAll('#allModes button')) {
    b.classList.toggle('active', modes.size === 1 && modes.has(b.dataset.mode));
  }
  $('#autoAdvance').checked = settings.autoAdvance;
  if (document.activeElement !== $('#interval')) $('#interval').value = settings.interval;
  $('#modeHelp').textContent = {
    order: 'Der Reihe nach: Screen 1 zeigt Eintrag 1, Screen 2 Eintrag 2 usw. Bei jedem Wechsel rückt die Playlist um eine Position weiter. Fest zugeordnete Screens bleiben unverändert.',
    random: 'Zufall: Jeder Screen bekommt einen zufälligen Eintrag – möglichst ohne Doppelungen und ohne Wiederholung des vorherigen Inhalts. Fest zugeordnete Screens bleiben unverändert.',
    sync: 'Alle gleich: Alle Screens zeigen denselben Inhalt der Playlist, Videos starten gemeinsam und laufen synchron. Weiter, Warteschlange und Springen im Video gelten für alle zusammen. Fest zugeordnete Screens bleiben unverändert.',
  }[settings.distribution];
  updateCountdown();

  // Screens
  const onlineSet = new Set(online);
  $('#screenCount').textContent = `${online.length} / ${screens.length} online`;
  const options = (selected) =>
    `<option value="">Automatisch (Playlist)</option>` +
    activeItems.map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>Fest: ${esc(i.title)}</option>`).join('');
  const qualityOptions = (s) =>
    `<option value="" ${s.imageQuality ? '' : 'selected'}>Standard (${QUALITY_LABEL[state.settings.imageQuality ?? 'original']})</option>` +
    Object.entries(QUALITY_LABEL).map(([id, label]) => `<option value="${id}" ${s.imageQuality === id ? 'selected' : ''}>${label}</option>`).join('');

  setList(
    $('#screens'),
    screens
          .map((s) => {
            const on = onlineSet.has(s.id);
            const item = itemById(s.currentItemId);
            const v = verification(s, on);
            return `
        <div class="entry ${on ? '' : 'offline'} ${(s.mode ?? 'play') !== 'play' ? 'inactive' : ''} ${expandedScreens.has(s.id) ? 'expanded' : ''}" data-id="${esc(s.id)}">
          <span class="handle" title="Ziehen zum Sortieren">⋮⋮</span>
          ${screenThumb(s, item, `<span class="status dot ${on ? 'on' : ''}"></span>`)}
          <div class="meta">
            <div class="sc-head">
              <input type="text" class="sc-name" value="${esc(s.name)}" data-action="rename" title="Name ändern">
              <span class="sub conn-line">
                ${on ? '<span class="conn-on">● online</span>' : `<span>offline${s.lastSeen ? ' · zuletzt ' + ago(s.lastSeen) : ''}</span>`}
                ${s.ip ? '<span>· ' + esc(s.ip) + '</span>' : ''}
              </span>
            </div>
            <div class="sc-controls">
              ${modeButtons(s)}
              <div class="sc-audio">
                <button class="audio-toggle ${s.audio ? 'on' : ''}" data-action="audio" title="${s.audio ? 'Ton an – klicken zum Ausschalten' : 'Ton aus – klicken zum Einschalten'} (gilt für Videos)">${s.audio ? '🔊' : '🔇'}</button>
                ${s.audio ? `<input type="range" min="0" max="100" step="5" value="${s.volume ?? 80}" data-action="volume" title="Lautstärke"><span class="vol">${s.volume ?? 80}%</span>` : ''}
              </div>
              <div class="sc-audio sc-music">
                <button class="audio-toggle music-toggle ${s.music ? 'on' : ''} ${s.music && s.musicMuted ? 'muted' : ''}" data-action="music" title="${!s.music ? 'Musik aus – klicken, um die Musik auf diesem Screen abzuspielen' : s.musicMuted ? 'Musik am Screen stumm geschaltet – klicken zum Einschalten' : 'Musik an – klicken zum Ausschalten'}">${s.music && s.musicMuted ? '🔇' : '🎵'}</button>
                ${s.music ? `<input type="range" min="0" max="100" step="5" value="${s.musicVolume ?? 100}" data-action="music-volume" title="Musiklautstärke auf diesem Screen (relativ zur Gesamtlautstärke)"><span class="vol">${s.musicVolume ?? 100}%</span>` : ''}
              </div>
              ${s.pinnedItemId || item
                ? `<button class="pin-toggle ${s.pinnedItemId ? 'on' : ''}" data-action="${s.pinnedItemId ? 'unpin' : 'pin-current'}" title="${s.pinnedItemId ? 'Fest eingestellt – klicken zum Lösen (spielt wieder automatisch aus der Playlist)' : 'Aktuellen Eintrag auf diesem Screen fest einstellen'}">📌<span class="pin-label">${s.pinnedItemId ? 'Lösen' : 'Fixieren'}</span></button>`
                : ''}
              <div class="sub verify-line">
                <span class="verify ${v.cls}">${esc(v.text)}</span>
                ${on && v.cls !== 'ok' ? '<button class="link" data-action="resend">erneut senden</button>' : ''}
                ${audioStatus(s, on, v)}
                ${musicStatus(s, on)}
              </div>
            </div>
            <div class="sub now-line">
              ${(s.mode ?? 'play') !== 'play' && s.modeBy !== 'screen' ? `<span class="badge mode">${MODE_LABEL[s.mode]}</span>` : ''}
              ${s.pinnedItemId ? '<span class="badge pin">fest</span>' : ''}
              ${s.inSync ? '<span class="badge sync" title="Zeigt synchron denselben Inhalt wie die anderen Screens">⇉ Sync</span>' : ''}
              ${remoteBadge(s)}
              <span class="now">${item ? esc(item.title) : 'Kein Inhalt'}</span>
            </div>
            ${item?.type === 'video' || (item?.type === 'text' && item.duration > 0) || s.dueAt
              ? `<div class="vprogress" data-progress="${esc(s.id)}"><div class="bar" data-action="seek" title="Klicken, um an diese Stelle zu springen"><div></div></div><span class="ptime"></span></div>`
              : ''}
            <div class="sc-settings">
              <label class="sc-field"><span>Inhalt</span><select class="assign" data-action="assign" title="Automatisch aus der Playlist oder ein fester Eintrag">${options(s.pinnedItemId)}</select></label>
              <label class="sc-field" title="Bildqualität für diesen Screen – „Standard“ übernimmt die Einstellung aus ⚙ Einstellungen"><span>Bildqualität</span><select data-action="quality">${qualityOptions(s)}</select></label>
              <label class="sc-field"><span>Standbild</span>${standbySelect(s)}</label>
              <label class="sc-field" title="Darf dieser Screen (z. B. ein Smartphone) andere Screens fernsteuern? Ohne Freigabe erscheint der Knopf im Screen-Menü nicht."><span>Fernsteuerung</span><select data-action="remote-allow">
                <option value="" ${s.remoteAllowed ? '' : 'selected'}>gesperrt</option>
                <option value="1" ${s.remoteAllowed ? 'selected' : ''}>erlaubt</option>
              </select></label>
            </div>
            ${standbyEdit(s)}
          </div>
          <div class="actions">
            ${on ? `<button class="icon" data-action="identify" title="Namen auf dem Screen anzeigen">👁</button>
                    <button class="icon" data-action="reload" title="Screen neu laden">↻</button>`
                 : `<button class="icon danger" data-action="delete-screen" title="Screen entfernen">✕</button>`}
            <button class="expand ${expandedScreens.has(s.id) ? 'open' : ''}" data-action="expand-screen" title="${expandedScreens.has(s.id) ? 'Weniger anzeigen' : 'Details: Standbild, Ton, Zuordnung, Als Nächstes, Verlauf'}">${expandedScreens.has(s.id) ? '▴' : '▾'}</button>
          </div>
          ${upNextHtml(s)}
          ${historyHtml(s)}
        </div>`;
          })
,
    `<div class="empty-list">Noch keine Screens verbunden.<br>Öffne die Screen-URL auf einem Tablet oder Beamer.</div>`
  );

  for (const s of screens) updateProgress(s.id);

  // Playlist – pro Eintrag ein Quick-Button je Screen
  // Klick reiht den Eintrag in die Warteschlange des Screens ein
  const quickButtons = (item) =>
    !isViewActive() ? '' : screens
      .map((s) => {
        const pinned = s.pinnedItemId === item.id;
        const showing = s.currentItemId === item.id;
        const queued = (s.queue ?? []).filter((id) => id === item.id).length;
        const cls = [showing ? 'showing' : queued ? 'queued' : '', onlineSet.has(s.id) ? '' : 'off'].join(' ');
        const icon = showing ? '▶' : queued ? `⏳${queued > 1 ? queued : ''}` : pinned ? '📌' : '＋';
        const title = `Bei „${s.name}“ einreihen${showing ? ' (läuft gerade)' : ''}${queued ? ` – schon ${queued}× eingereiht` : ''}`;
        return `<button class="qbtn ${cls}" data-action="quick" data-screen="${esc(s.id)}" title="${esc(title)}">${icon} ${esc(s.name)}</button>`;
      })
      .join('');

  $('#itemCount').textContent = `${playlist.filter((i) => i.enabled).length} aktiv / ${playlist.length}`;
  $('#duplicates').value = settings.duplicates ?? 'skip';

  // Doppelte Dateien (gleicher Inhalt) markieren
  const byHash = new Map();
  for (const i of playlist) if (i.hash) byHash.set(i.hash, [...(byHash.get(i.hash) ?? []), i]);
  const dupBadge = (item) => {
    const others = (byHash.get(item.hash) ?? []).filter((o) => o !== item);
    if (!others.length) return '';
    const where = others.map((o) => `#${playlist.indexOf(o) + 1} „${o.title}“`).join(', ');
    return `<span class="badge dup" title="${esc('Gleicher Inhalt wie ' + where)}">doppelt</span>`;
  };
  const dupCount = duplicatesToRemove().length;
  $('#dedupe').hidden = !dupCount;
  $('#dedupe').textContent = `🧹 ${dupCount} doppelte Einträge entfernen`;

  // Suche & Filter: ausgefilterte Einträge bleiben im DOM (nur verborgen), damit Sortieren die Gesamtreihenfolge behält
  const query = filter.search.trim().toLowerCase();
  const visible = (i) =>
    (!filter.type || i.type === filter.type) &&
    (filter.status !== 'enabled' || i.enabled) &&
    (filter.status !== 'disabled' || !i.enabled) &&
    (filter.status !== 'dup' || (byHash.get(i.hash)?.length ?? 0) > 1) &&
    (!query || [i.title, i.text, i.src].some((v) => v?.toLowerCase().includes(query)));
  const shown = playlist.filter(visible);
  const filtered = shown.length !== playlist.length;
  $('#plFilterInfo').innerHTML = filtered
    ? `${shown.length} von ${playlist.length} angezeigt · <button class="link" id="plReset">Filter zurücksetzen</button>`
    : '';

  // Auswahl
  for (const id of selected) if (!playlist.some((i) => i.id === id)) selected.delete(id);
  const hiddenSelected = [...selected].filter((id) => !visible(itemById(id))).length;
  $('#plSelCount').textContent = selected.size
    ? `${selected.size} ausgewählt${hiddenSelected ? ` (davon ${hiddenSelected} ausgeblendet)` : ''}`
    : 'Alle auswählen';
  const allShownSelected = shown.length > 0 && shown.every((i) => selected.has(i.id));
  $('#plSelectAll').checked = allShownSelected;
  $('#plSelectAll').indeterminate = !allShownSelected && shown.some((i) => selected.has(i.id));
  for (const b of document.querySelectorAll('#plBulk [data-bulk]')) b.disabled = !selected.size;
  $('#plBulkQueue').disabled = !selected.size || !isViewActive();
  setHtml(
    $('#plBulkQueue'),
    `<option value="">Einreihen bei …</option>` + screens.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')
  );
  $('#playlist').classList.toggle('compact', compact);
  $('#screens').classList.toggle('compact', compactScreens);
  $('#scCompact').classList.toggle('active', compactScreens);
  $('#plCompact').classList.toggle('active', compact);

  setList(
    $('#playlist'),
    playlist
          .map(
            (i, n) => `
        <div class="entry ${i.enabled ? '' : 'disabled'} ${selected.has(i.id) ? 'selected' : ''} ${expanded.has(i.id) ? 'expanded' : ''}" data-id="${esc(i.id)}" ${visible(i) ? '' : 'hidden'}>
          <span class="lead"><input type="checkbox" class="sel" data-action="select" ${selected.has(i.id) ? 'checked' : ''} title="Auswählen (Shift = Bereich)"><span class="handle" title="Ziehen zum Sortieren">⋮⋮</span></span>
          ${thumb(i)}
          <div class="meta">
            <input type="text" value="${esc(i.title)}" data-action="retitle" title="Titel ändern">
            <div class="sub">
              <span>#${n + 1}</span>
              <span class="badge">${TYPE_LABEL[i.type] ?? i.type}</span>
              ${dupBadge(i)}
              ${i.type === 'url' ? `<a class="now" href="${esc(i.src)}" target="_blank" rel="noopener">${esc(i.src)}</a>` : ''}
            </div>
            ${i.type === 'text' ? `
            <div class="sub text-opts">
              <label title="Anzeigedauer in Sekunden – leer = bis zum nächsten Wechsel">⏱ <input type="number" class="dur" min="0" max="86400" placeholder="–" value="${i.duration || ''}" data-action="duration"> Sek.</label>
              <label class="${i.duration > 0 ? '' : 'muted'}"><input type="checkbox" data-action="countdown" ${i.showCountdown ? 'checked' : ''} ${i.duration > 0 ? '' : 'disabled'}> Countdown</label>
            </div>
            <div class="sub text-opts">
              <label>Schrift <select class="mini" data-action="font">${fontOptions(i.font)}</select></label>
              <label>Ecken <select class="mini" data-action="edge">${edgeOptions(i.edge)}</select></label>
            </div>` : ''}
            <div class="quick">${quickButtons(i)}</div>
          </div>
          <div class="actions">
            <label class="switch" title="${i.enabled ? 'Aktiv' : 'Deaktiviert'}"><input type="checkbox" data-action="toggle" ${i.enabled ? 'checked' : ''}><span></span></label>
            <button class="icon danger" data-action="delete-item" title="Löschen">✕</button>
            <button class="expand ${expanded.has(i.id) ? 'open' : ''}" data-action="expand" title="${expanded.has(i.id) ? 'Weniger anzeigen' : 'Details: Screens, Text-Optionen'}">${expanded.has(i.id) ? '▴' : '▾'}</button>
          </div>
        </div>`
          )
,
    `<div class="empty-list">Die Playlist ist leer.<br>Füge Bilder, Videos, Webseiten oder Texte hinzu.</div>`
  );
  const pendingThumbs = thumbQueue.length + (thumbActive ? 1 : 0);
  $('#thumbStatus').textContent = pendingThumbs ? `· Vorschaubilder werden erstellt, noch ${pendingThumbs}` : '';
  showHighlight();
}

// ---------------------------------------------------------------------------
// Musik: Abspielliste, Steuerung, Screens, Verhalten bei Video mit Ton
// ---------------------------------------------------------------------------

const MUSIC_MIME = 'application/x-screendeck-music';
const musicKeys = () =>
  new Set((state?.music?.items ?? []).map((i) => (i.file ? 'upload:' + i.file : i.mediaFile ? 'media:' + i.mediaFile : null)).filter(Boolean));

function musicPos() {
  const m = state.music;
  return m.playing ? Math.max(0, (Date.now() + clockOffset - m.startedAt) / 1000) : m.position;
}

function renderMusic() {
  const m = state?.music;
  if (!m) return;
  const cur = m.items.find((i) => i.id === m.currentId);
  $('#musicCount').textContent = m.items.length ? `${m.items.length} Titel` : '';
  $('#muIcon').textContent = cur?.kind === 'radio' ? '📻' : '🎵';
  $('#muTitle').textContent = cur ? cur.title : 'Nichts ausgewählt';
  const note = m.autoPaused
    ? '⏸ pausiert – Video mit Ton läuft'
    : m.playing && m.videoSound && m.videoBehavior === 'duck'
      ? `🔉 leiser (${m.duckLevel} %) – Video mit Ton läuft`
      : '';
  $('#muSub').textContent = note || (!cur ? 'Titel unten hinzufügen' : cur.kind === 'radio' ? 'Internetradio · live' : 'Audiodatei');
  $('#muSub').classList.toggle('warn', !!note);
  const listening = state.screens.filter((s) => s.music);
  $('#muPlay').textContent = m.playing ? '⏸' : '▶';
  $('#muPlay').title = m.playing ? 'Pausieren' : listening.length ? 'Abspielen' : 'Abspielen – unten mindestens einen Screen wählen';
  $('#muPlay').disabled = !m.items.length;
  $('#muShuffle').classList.toggle('on', !!m.shuffle);
  $('#muRepeat').classList.toggle('on', !!m.repeat);
  if (!sliding) $('#muVolume').value = m.volume;
  $('#muVolLabel').textContent = `${m.volume}%`;
  $('#muVideo').value = m.videoBehavior;
  if (document.activeElement !== $('#muDuck')) $('#muDuck').value = m.duckLevel;
  $('#muDuck').closest('.mu-duck').hidden = m.videoBehavior !== 'duck';

  const online = new Set(state.online);
  setHtml(
    $('#muScreens'),
    state.screens.length
      ? state.screens
          .map((s) => {
            const st = s.musicReport?.state;
            const flag = !s.music ? '' : s.musicMuted ? '🔇 ' : st === 'blocked' ? '<span class="st-err">⚠</span> ' : st === 'error' ? '<span class="st-err">✗</span> ' : st === 'playing' ? '♪ ' : '';
            const tip = !s.music ? 'Klicken: Musik auf diesem Screen abspielen' : st === 'blocked' ? 'Ton blockiert – am Gerät einmal tippen' : 'Klicken: Musik auf diesem Screen aus';
            return `<button class="mu-chip ${s.music ? 'on' : ''} ${online.has(s.id) ? '' : 'off'}" data-screen="${esc(s.id)}" title="${tip}">${flag}${esc(s.name)}</button>`;
          })
          .join('')
      : '<span class="help small">Noch keine Screens verbunden.</span>'
  );

  setList(
    $('#musicList'),
    m.items
          .map(
            (i) => `
        <div class="entry mu-entry ${i.id === m.currentId ? 'current' : ''}" data-id="${esc(i.id)}">
          <span class="handle" title="Ziehen zum Sortieren">⋮⋮</span>
          <span class="mu-type">${i.kind === 'radio' ? '📻' : '🎵'}</span>
          <div class="meta">
            <input type="text" value="${esc(i.title)}" data-action="mu-rename" title="Titel ändern">
            <div class="sub">${i.kind === 'radio' ? 'Internetradio' : i.duration ? fmtTime(i.duration) : 'Audiodatei'}${i.id === m.currentId ? (m.playing ? ' · ▶ läuft' : ' · ausgewählt') : ''}</div>
          </div>
          <div class="actions">
            <button class="icon" data-action="mu-play" title="Jetzt abspielen">▶</button>
            <button class="icon danger" data-action="mu-delete" title="Aus der Musikliste entfernen">✕</button>
          </div>
        </div>`
          )
,
    '<div class="empty-list">Noch keine Musik.<br>Audiodateien hochladen, aus „Medien“ hierher ziehen oder ein Internetradio hinzufügen.</div>'
  );
  updateMusicProgress();
}

function updateMusicProgress() {
  const m = state?.music;
  if (!m) return;
  const cur = m.items.find((i) => i.id === m.currentId);
  const box = $('#muProgress');
  if (!cur || cur.kind === 'radio') {
    box.querySelector('.bar > div').style.width = cur && m.playing ? '100%' : '0%';
    $('#muTime').textContent = cur ? (m.playing ? 'live' : '–') : '';
    box.classList.toggle('live', !!cur);
    return;
  }
  const t = musicPos();
  const d = cur.duration || 0;
  $('#muTime').textContent = `${fmtTime(t)} / ${d ? fmtTime(d) : '–:––'}`;
  box.querySelector('.bar > div').style.width = d ? `${Math.min(100, (t / d) * 100)}%` : '0%';
}
setInterval(() => state?.music && updateMusicProgress(), 500);

async function addMusicFiles(paths, position) {
  if (!paths.length) return;
  const { added, skipped } = await api('POST', '/api/music/items', { source: mbSource, paths, position });
  toast(added.length ? `${added.length} Titel in die Musikliste${skipped.length ? `, ${skipped.length} schon vorhanden` : ''}` : 'Schon in der Musikliste', 4000);
  if (mbSource === 'uploads') loadMedia();
}

$('#muPlay').addEventListener('click', () => api('POST', `/api/music/${state.music.playing ? 'pause' : 'play'}`));
$('#muPrev').addEventListener('click', () => api('POST', '/api/music/prev'));
$('#muNext').addEventListener('click', () => api('POST', '/api/music/next'));
$('#muShuffle').addEventListener('click', () => api('PATCH', '/api/music', { shuffle: !state.music.shuffle }));
$('#muRepeat').addEventListener('click', () => api('PATCH', '/api/music', { repeat: !state.music.repeat }));
$('#muVolume').addEventListener('input', (e) => ($('#muVolLabel').textContent = `${e.target.value}%`));
$('#muVolume').addEventListener('change', (e) => api('PATCH', '/api/music', { volume: Number(e.target.value) }));
$('#muVideo').addEventListener('change', (e) => api('PATCH', '/api/music', { videoBehavior: e.target.value }));
$('#muDuck').addEventListener('change', (e) => api('PATCH', '/api/music', { duckLevel: Number(e.target.value) }));
$('#muBar').addEventListener('click', (e) => {
  const cur = state.music.items.find((i) => i.id === state.music.currentId);
  if (!cur?.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  api('POST', '/api/music/seek', { time: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * cur.duration });
});
$('#muScreens').addEventListener('click', (e) => {
  const id = e.target.closest('[data-screen]')?.dataset.screen;
  const s = state.screens.find((x) => x.id === id);
  if (s) api('PATCH', `/api/screens/${id}`, { music: !s.music });
});
$('#musicList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.entry').dataset.id;
  const item = state.music.items.find((i) => i.id === id);
  if (btn.dataset.action === 'mu-play') api('POST', '/api/music/play', { id });
  if (btn.dataset.action === 'mu-delete' && confirm(`„${item?.title}“ aus der Musikliste entfernen?`)) api('DELETE', `/api/music/items/${id}`);
});
$('#musicList').addEventListener('change', (e) => {
  if (e.target.dataset.action === 'mu-rename') api('PATCH', `/api/music/items/${e.target.closest('.entry').dataset.id}`, { title: e.target.value });
});
$('#muRadioForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { added } = await api('POST', '/api/music/items', { kind: 'radio', url: f.get('url'), title: f.get('title') });
  e.target.reset();
  toast(`Radio „${added[0]?.title}“ hinzugefügt`);
});
makeSortable($('#musicList'), (ids) => api('PUT', '/api/music/order', { ids }));

// Audiodateien aus „Medien hinzufügen“ in die Musikliste ziehen
let musicDrop = null; // { id, after }
function clearMusicDrop() {
  for (const r of $('#musicList').querySelectorAll('.drop-above, .drop-below')) r.classList.remove('drop-above', 'drop-below');
  $('#musicCard').classList.remove('media-over');
  musicDrop = null;
}
$('#musicCard').addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes(MUSIC_MIME)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  let target = null;
  let after = true;
  for (const r of $('#musicList').querySelectorAll(':scope > .entry')) {
    const b = r.getBoundingClientRect();
    target = r;
    if (e.clientY < b.top + b.height / 2) {
      after = false;
      break;
    }
  }
  if (target?.dataset.id !== musicDrop?.id || after !== musicDrop?.after) {
    clearMusicDrop();
    target?.classList.add(after ? 'drop-below' : 'drop-above');
    musicDrop = target ? { id: target.dataset.id, after } : null;
  }
  $('#musicCard').classList.add('media-over');
});
$('#musicCard').addEventListener('dragleave', (e) => {
  if (!$('#musicCard').contains(e.relatedTarget)) clearMusicDrop();
});
$('#musicCard').addEventListener('drop', (e) => {
  if (!e.dataTransfer.types.includes(MUSIC_MIME)) return;
  e.preventDefault();
  const { paths } = JSON.parse(e.dataTransfer.getData(MUSIC_MIME) || '{}');
  const idx = musicDrop ? state.music.items.findIndex((i) => i.id === musicDrop.id) : -1;
  const position = idx < 0 ? state.music.items.length : idx + (musicDrop.after ? 1 : 0);
  clearMusicDrop();
  dragging = false;
  addMusicFiles(paths ?? [], position);
});

// ---------------------------------------------------------------------------
// Mehrere Playlisten: anzeigen/bearbeiten (Auswahl) und aktivieren (läuft auf den Screens)
// ---------------------------------------------------------------------------

function renderPlaylistHead() {
  const view = viewPlaylist();
  if (!view) return;
  setHtml(
    $('#plSelect'),
    state.playlists
      .map((p) => `<option value="${esc(p.id)}">${p.id === state.activePlaylistId ? '▶ ' : ''}${esc(p.name)} (${p.count})</option>`)
      .join('')
  );
  if (document.activeElement !== $('#plSelect')) $('#plSelect').value = view.id;
  const live = view.id === state.activePlaylistId;
  $('#plLive').className = 'badge ' + (live ? 'live' : 'idle');
  $('#plLive').textContent = live ? '▶ läuft auf den Screens' : 'läuft gerade nicht';
  $('#plActivate').hidden = live;
  $('#plDelete').disabled = state.playlists.length < 2;
  $('#playlistCard').classList.toggle('not-live', !live);
}

function selectPlaylist(id) {
  viewPlaylistId = id;
  try {
    localStorage.setItem('screendeck-playlist', id);
  } catch {}
  selected.clear();
  expanded.clear();
  render();
  renderMedia();
}

$('#plSelect').addEventListener('change', (e) => selectPlaylist(e.target.value));
$('#plActivate').addEventListener('click', async () => {
  const view = viewPlaylist();
  await api('POST', `/api/playlists/${view.id}/activate`);
  toast(`„${view.name}“ läuft jetzt auf den Screens`);
});
$('#plNew').addEventListener('click', async () => {
  const name = prompt('Name der neuen Playlist:', 'Neue Playlist');
  if (name === null) return;
  const p = await api('POST', '/api/playlists', { name });
  selectPlaylist(p.id);
  toast(`Playlist „${p.name}“ angelegt – sie läuft erst nach „▶ Auf Screens abspielen“`, 5000);
});
$('#plCopy').addEventListener('click', async () => {
  const view = viewPlaylist();
  const name = prompt('Name der Kopie:', `${view.name} (Kopie)`);
  if (name === null) return;
  const p = await api('POST', '/api/playlists', { name, copyFrom: view.id });
  selectPlaylist(p.id);
  toast(`„${p.name}“ angelegt`);
});
$('#plRename').addEventListener('click', async () => {
  const view = viewPlaylist();
  const name = prompt('Neuer Name:', view.name);
  if (name?.trim()) await api('PATCH', `/api/playlists/${view.id}`, { name });
});
$('#plDelete').addEventListener('click', async () => {
  const view = viewPlaylist();
  const live = view.id === state.activePlaylistId;
  if (!confirm(`Playlist „${view.name}“ mit ${view.count} Einträgen löschen?${live ? '\n\nSie läuft gerade – danach spielen die Screens die erste andere Playlist.' : ''}\n\nDateien bleiben erhalten, solange eine andere Playlist sie verwendet.`)) return;
  await api('DELETE', `/api/playlists/${view.id}`);
  viewPlaylistId = null;
  toast(`„${view.name}“ gelöscht`);
});

// ---------------------------------------------------------------------------
// Playlist: Suche, Filter, kompakte Ansicht, Mehrfachauswahl
// ---------------------------------------------------------------------------

const filter = { search: '', type: '', status: '' };
const selected = new Set();
const expanded = new Set(); // in der kompakten Ansicht aufgeklappte Einträge
let lastSelected = null; // für Shift-Klick-Bereiche
let compact = false;
try {
  compact = localStorage.getItem('screendeck-compact') === '1';
} catch {}

$('#plSearch').addEventListener('input', (e) => {
  filter.search = e.target.value;
  render();
});
$('#plType').addEventListener('change', (e) => {
  filter.type = e.target.value;
  render();
});
$('#plStatus').addEventListener('change', (e) => {
  filter.status = e.target.value;
  render();
});
function resetFilter() {
  Object.assign(filter, { search: '', type: '', status: '' });
  $('#plSearch').value = $('#plType').value = $('#plStatus').value = '';
  render();
}
$('#plFilterInfo').addEventListener('click', (e) => e.target.id === 'plReset' && resetFilter());

// Kompakte Ansicht der Screens: eine kurze Zeile pro Screen, Details per ▾
const expandedScreens = new Set();
let compactScreens = false;
try {
  compactScreens = localStorage.getItem('screendeck-compact-screens') === '1';
} catch {}
$('#scCompact').addEventListener('click', () => {
  compactScreens = !compactScreens;
  try {
    localStorage.setItem('screendeck-compact-screens', compactScreens ? '1' : '0');
  } catch {}
  render();
});

$('#plCompact').addEventListener('click', () => {
  compact = !compact;
  try {
    localStorage.setItem('screendeck-compact', compact ? '1' : '0');
  } catch {}
  render();
});

const shownIds = () => [...document.querySelectorAll('#playlist > .entry:not([hidden])')].map((r) => r.dataset.id);

$('#plSelectAll').addEventListener('change', (e) => {
  for (const id of shownIds()) e.target.checked ? selected.add(id) : selected.delete(id);
  render();
});

async function bulk(action) {
  const ids = [...selected];
  if (!ids.length) return;
  if (action === 'delete' && !confirm(`${ids.length} Einträge aus der Playlist löschen?`)) return;
  const { count } = await api('POST', '/api/playlist/bulk', { ids, action });
  if (action === 'delete') selected.clear();
  toast(`${count} Einträge ${{ enable: 'aktiviert', disable: 'deaktiviert', delete: 'gelöscht' }[action]}`);
}
$('#plBulk').addEventListener('click', (e) => {
  const action = e.target.closest('[data-bulk]')?.dataset.bulk;
  if (action) bulk(action);
});
// Doppelte entfernen: pro Inhalt bleibt der oberste Eintrag der Playlist, alle weiteren werden entfernt
function duplicatesToRemove() {
  const first = new Map();
  const remove = [];
  for (const i of viewItems()) {
    if (!i.hash) continue;
    if (first.has(i.hash)) remove.push({ item: i, keep: first.get(i.hash) });
    else first.set(i.hash, i);
  }
  return remove;
}

$('#dedupe').addEventListener('click', () => {
  const remove = duplicatesToRemove();
  if (!remove.length) return;
  const pos = (i) => `#${viewItems().indexOf(i) + 1}`;
  $('#dedupeInfo').textContent =
    'Pro Inhalt bleibt der oberste Eintrag erhalten. Diese Einträge werden aus der Playlist und von den Screens entfernt:';
  $('#dedupeList').innerHTML = remove
    .map(
      ({ item, keep }) => `
      <li>
        ${thumb(item)}
        <div><strong>${pos(item)} ${esc(item.title)}</strong>${item.enabled ? '' : ' <span class="muted">(deaktiviert)</span>'}<br>
        <span class="muted">gleicher Inhalt wie ${pos(keep)} „${esc(keep.title)}“ – bleibt</span></div>
      </li>`
    )
    .join('');
  $('#dedupeOk').textContent = `${remove.length} Einträge entfernen`;
  $('#dedupeDialog').returnValue = ''; // Esc lässt den alten Wert sonst stehen
  $('#dedupeDialog').showModal();
});

$('#dedupeDialog').addEventListener('close', async (e) => {
  if (e.target.returnValue !== 'ok') return;
  const ids = duplicatesToRemove().map((r) => r.item.id); // aktuell berechnen, falls sich inzwischen etwas geändert hat
  const { count } = await api('POST', '/api/playlist/bulk', { ids, action: 'delete' });
  toast(`${count} doppelte Einträge entfernt`);
});

$('#plBulkQueue').addEventListener('change', async (e) => {
  const screenId = e.target.value;
  e.target.value = '';
  if (!screenId) return;
  // In Playlist-Reihenfolge einreihen
  const itemIds = viewItems().filter((i) => selected.has(i.id)).map((i) => i.id);
  const screen = state.screens.find((s) => s.id === screenId);
  await api('POST', `/api/screens/${screenId}/queue`, { itemIds });
  toast(`${itemIds.length} Einträge bei „${screen?.name}“ eingereiht`);
});

function updateCountdown() {
  const el = $('#countdown');
  if (!state?.nextAt) return (el.textContent = '');
  const s = Math.max(0, Math.ceil((state.nextAt - Date.now() - clockOffset) / 1000));
  el.textContent = `nächster in ${s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : s + ' s'}`;
}
setInterval(() => {
  updateCountdown();
  // Restzeit von Bildern/Texten ohne eigene Dauer läuft ohne Meldung vom Screen
  for (const s of state?.screens ?? []) if (s.dueAt) updateProgress(s.id);
}, 500);

// ---------------------------------------------------------------------------
// Sortieren per Drag & Drop (nur am Griff ⋮⋮)
// ---------------------------------------------------------------------------

function makeSortable(list, onOrder) {
  let dragEl = null;
  list.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.entry');
    if (row) row.draggable = !!e.target.closest('.handle');
  });
  list.addEventListener('dragstart', (e) => {
    dragEl = e.target.closest('.entry');
    if (!dragEl) return;
    dragging = true;
    dragEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', dragEl.dataset.id);
    if (list.id === 'playlist') draggedItemId = dragEl.dataset.id;
  });
  list.addEventListener('dragover', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const row = e.target.closest('.entry');
    if (!row || row === dragEl) return;
    const r = row.getBoundingClientRect();
    list.insertBefore(dragEl, e.clientY > r.top + r.height / 2 ? row.nextSibling : row);
  });
  list.addEventListener('dragend', async () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl.draggable = false;
    dragEl = null;
    dragging = false;
    draggedItemId = null;
    lastHtml.delete(list); // DOM wurde verändert, beim nächsten Render neu aufbauen
    const ids = [...list.querySelectorAll(':scope > .entry')].map((r) => r.dataset.id);
    await onOrder(ids);
  });
}

makeSortable($('#screens'), (ids) => api('PUT', '/api/screens/order', { ids }));
makeSortable($('#playlist'), (ids) => api('PUT', '/api/playlist/order', { ids, playlist: viewParam() }));

// Playlist-Eintrag auf einen Screen ziehen = dort einreihen
let draggedItemId = null;
const screensList = $('#screens');
const clearDropTarget = () => screensList.querySelector('.drop-target')?.classList.remove('drop-target');
screensList.addEventListener('dragover', (e) => {
  if (!draggedItemId) return;
  const row = e.target.closest('.entry');
  if (!row) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  if (!row.classList.contains('drop-target')) {
    clearDropTarget();
    row.classList.add('drop-target');
  }
});
screensList.addEventListener('dragleave', (e) => {
  if (!screensList.contains(e.relatedTarget)) clearDropTarget();
});
screensList.addEventListener('drop', (e) => {
  const row = e.target.closest('.entry');
  if (!draggedItemId || !row) return;
  e.preventDefault();
  clearDropTarget();
  enqueue(row.dataset.id, draggedItemId);
});

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

$('#screens').addEventListener('change', (e) => {
  const id = e.target.closest('.entry')?.dataset.id;
  const action = e.target.dataset.action;
  if (action === 'rename') api('PATCH', `/api/screens/${id}`, { name: e.target.value });
  if (action === 'assign') api('PATCH', `/api/screens/${id}`, { pinnedItemId: e.target.value || null });
  if (action === 'volume') api('PATCH', `/api/screens/${id}`, { volume: Number(e.target.value) });
  if (action === 'music-volume') api('PATCH', `/api/screens/${id}`, { musicVolume: Number(e.target.value), musicMuted: Number(e.target.value) === 0 });
  if (action === 'quality') api('PATCH', `/api/screens/${id}`, { imageQuality: e.target.value });
  if (action === 'remote-allow') api('PATCH', `/api/screens/${id}`, { remoteAllowed: !!e.target.value });
  // Standbild-Text und -Optionen
  const sbField = { 'sb-text': 'text', 'sb-font': 'font', 'sb-color': 'color', 'sb-position': 'position', 'sb-edge': 'edge' }[action];
  if (sbField) api('PATCH', `/api/screens/${id}`, { standbyStyle: { [sbField]: e.target.value } });
  if (action === 'standby') {
    const value = e.target.value;
    if (value === '__upload') {
      standbyTarget = id;
      lastHtml.delete($('#screens')); // Auswahl beim nächsten Render zurücksetzen
      $('#standbyInput').click();
    } else if (value !== '__own') {
      api('PATCH', `/api/screens/${id}`, { standbyItemId: value || null });
    }
  }
});

// Eigenes Standbild hochladen
let standbyTarget = null;
$('#standbyInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !standbyTarget) return render();
  const data = new FormData();
  data.append('file', file);
  const res = await fetch(`/api/screens/${standbyTarget}/standby`, { method: 'POST', body: data });
  toast(res.ok ? 'Standbild hochgeladen' : 'Upload fehlgeschlagen');
  if (!res.ok) render();
});

$('#allModes').addEventListener('click', (e) => {
  const mode = e.target.closest('button')?.dataset.mode;
  if (!mode) return;
  setPendingMode(state.screens.map((s) => s.id), mode);
  api('POST', '/api/screens/mode', { mode });
});

// Lautstärke-Anzeige beim Ziehen sofort aktualisieren (gespeichert wird beim Loslassen)
// Standbild-Text schon während des Tippens (verzögert) speichern
let sbTextTimer;
$('#screens').addEventListener('input', (e) => {
  if (['volume', 'music-volume'].includes(e.target.dataset.action)) e.target.nextElementSibling.textContent = `${e.target.value}%`;
  if (e.target.dataset.action === 'sb-text') {
    const id = e.target.closest('.entry').dataset.id;
    const text = e.target.value;
    clearTimeout(sbTextTimer);
    sbTextTimer = setTimeout(() => api('PATCH', `/api/screens/${id}`, { standbyStyle: { text } }), 600);
  }
});

// Klick auf den Fortschrittsbalken: an diese Stelle springen
$('#screens').addEventListener('click', (e) => {
  const bar = e.target.closest('.bar[data-action="seek"]');
  if (!bar) return;
  const id = bar.closest('.entry').dataset.id;
  const screen = state.screens.find((s) => s.id === id);
  const p = screen && progressOf(screen);
  if (!p) return;
  const r = bar.getBoundingClientRect();
  const time = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * p.duration;
  if (screen.dueAt) screen.dueAt = Date.now() + clockOffset + (p.duration - time) * 1000; // Restzeit des automatischen Wechsels
  else progress.set(id, { ...p, currentTime: time }); // sofort anzeigen, Screen bestätigt mit nächster Meldung
  updateProgress(id);
  api('POST', `/api/screens/${id}/seek`, { time });
});

$('#screens').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.entry').dataset.id;
  if (btn.dataset.action === 'identify') api('POST', `/api/screens/${id}/identify`);
  if (btn.dataset.action === 'reload') api('POST', `/api/screens/${id}/reload`);
  if (btn.dataset.action === 'resend') api('POST', `/api/screens/${id}/resend`);
  if (btn.dataset.action === 'mode') {
    setPendingMode([id], btn.dataset.mode);
    api('PATCH', `/api/screens/${id}`, { mode: btn.dataset.mode }).catch(() => pendingMode.delete(id));
  }
  if (btn.dataset.action === 'queue-play') api('POST', `/api/screens/${id}/queue/${btn.dataset.index}/play`);
  if (btn.dataset.action === 'queue-remove') api('DELETE', `/api/screens/${id}/queue/${btn.dataset.index}`);
  if (btn.dataset.action === 'queue-clear') api('DELETE', `/api/screens/${id}/queue`);
  if (btn.dataset.action === 'screen-next') api('POST', `/api/screens/${id}/next`);
  if (btn.dataset.action === 'remote-stop') api('POST', `/api/screens/${id}/remote/stop`);
  if (btn.dataset.action === 'pin-current' || btn.dataset.action === 'unpin') {
    const screen = state.screens.find((s) => s.id === id);
    const pin = btn.dataset.action === 'pin-current' ? screen.currentItemId : null;
    api('PATCH', `/api/screens/${id}`, { pinnedItemId: pin }).then(() =>
      toast(pin ? `„${itemById(pin)?.title}“ ist jetzt fest auf „${screen.name}“` : `„${screen.name}“ spielt wieder automatisch`)
    );
  }
  if (btn.dataset.action === 'expand-screen') {
    expandedScreens.has(id) ? expandedScreens.delete(id) : expandedScreens.add(id);
    render();
  }
  if (btn.dataset.action === 'audio') {
    const screen = state.screens.find((s) => s.id === id);
    api('PATCH', `/api/screens/${id}`, { audio: !screen.audio });
  }
  if (btn.dataset.action === 'music') {
    // Am Screen stumm geschaltet: erst wieder einschalten, sonst Musik auf diesem Screen an/aus
    const screen = state.screens.find((s) => s.id === id);
    const zero = (screen.musicVolume ?? 100) === 0;
    api('PATCH', `/api/screens/${id}`, screen.music && screen.musicMuted ? { musicMuted: false, ...(zero && { musicVolume: 50 }) } : { music: !screen.music });
  }
  if (btn.dataset.action === 'delete-screen' && confirm('Diesen Screen aus der Liste entfernen?')) api('DELETE', `/api/screens/${id}`);
});

$('#playlist').addEventListener('change', (e) => {
  const id = e.target.closest('.entry')?.dataset.id;
  const action = e.target.dataset.action;
  if (action === 'retitle') api('PATCH', `/api/playlist/${id}`, { title: e.target.value });
  if (action === 'toggle') api('PATCH', `/api/playlist/${id}`, { enabled: e.target.checked });
  if (action === 'duration') api('PATCH', `/api/playlist/${id}`, { duration: Number(e.target.value) || 0 });
  if (action === 'countdown') api('PATCH', `/api/playlist/${id}`, { showCountdown: e.target.checked });
  if (action === 'font') api('PATCH', `/api/playlist/${id}`, { font: e.target.value });
  if (action === 'edge') api('PATCH', `/api/playlist/${id}`, { edge: e.target.value });
});

$('#playlist').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.entry').dataset.id;
  const item = itemById(id);

  if (btn.dataset.action === 'delete-item' && confirm(`„${item?.title}“ aus der Playlist löschen?`)) {
    api('DELETE', `/api/playlist/${id}`);
  }
  if (btn.dataset.action === 'quick') enqueue(btn.dataset.screen, id);
  if (btn.dataset.action === 'expand') {
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    render();
  }
});

// Kompaktansicht: Klick auf das Vorschaubild klappt den Eintrag auf bzw. zu
for (const [list, set] of [['#playlist', expanded], ['#screens', expandedScreens]]) {
  $(list).addEventListener('click', (e) => {
    if (!$(list).classList.contains('compact') || !e.target.closest('.thumb')) return;
    const id = e.target.closest('.entry').dataset.id;
    set.has(id) ? set.delete(id) : set.add(id);
    render();
  });
}

// Auswahl-Checkbox: Shift-Klick wählt alle angezeigten Einträge dazwischen mit aus
$('#playlist').addEventListener('click', (e) => {
  if (!e.target.matches('input.sel')) return;
  const id = e.target.closest('.entry').dataset.id;
  const on = e.target.checked;
  const ids = shownIds();
  const range = e.shiftKey && lastSelected && ids.includes(lastSelected)
    ? ids.slice(Math.min(ids.indexOf(lastSelected), ids.indexOf(id)), Math.max(ids.indexOf(lastSelected), ids.indexOf(id)) + 1)
    : [id];
  for (const r of range) on ? selected.add(r) : selected.delete(r);
  lastSelected = id;
  render();
});

// Enter in Namensfeldern = speichern
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.meta input[type=text]')) e.target.blur();
});

$('#distribution').addEventListener('click', (e) => {
  const value = e.target.closest('button')?.dataset.value;
  if (value) api('PATCH', '/api/settings', { distribution: value });
});
$('#autoAdvance').addEventListener('change', (e) => api('PATCH', '/api/settings', { autoAdvance: e.target.checked }));
$('#interval').addEventListener('change', (e) => api('PATCH', '/api/settings', { interval: Number(e.target.value) }));
$('#next').addEventListener('click', () => api('POST', '/api/next'));
$('#duplicates').addEventListener('change', (e) => api('PATCH', '/api/settings', { duplicates: e.target.value }));

// ---------------------------------------------------------------------------
// Medienordner: Dateien auflisten und per Drag & Drop an eine Stelle der Playlist ziehen
// ---------------------------------------------------------------------------

const MEDIA_MIME = 'application/x-screendeck-media';
let mbDir = '';
let mbData = null; // { root, dir, folders, files } bzw. { error }
// Gewählte Quelle: ID einer Medienquelle oder 'uploads' (hochgeladene Dateien); merkt sich der Browser
let mbSource = (() => {
  try {
    return localStorage.getItem('screendeck-media-source') || '';
  } catch {
    return '';
  }
})();
const mediaSources = () => state?.settings.mediaSources ?? [];
/** Gewählte Quelle gültig halten (z. B. nach dem Entfernen einer Quelle) */
function ensureSource() {
  if (!state) return; // Quellen noch unbekannt
  if (mbSource === 'uploads' || mediaSources().some((m) => m.id === mbSource)) return;
  mbSource = mediaSources()[0]?.id ?? 'uploads';
}

const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');

async function loadMedia(dir = mbDir) {
  try {
    ensureSource();
    mbData = await api('GET', `/api/media?source=${encodeURIComponent(mbSource)}&dir=${encodeURIComponent(dir)}`);
    mbDir = mbData.dir;
  } catch (e) {
    mbData = { error: e.message || 'Ordner konnte nicht gelesen werden', folders: [], files: [] };
  }
  renderMedia();
}

function renderMedia() {
  if (!mbData) return;
  const rootName = mbData.name ?? mediaSources().find((m) => m.id === mbSource)?.name ?? 'Medien';
  const parts = mbDir ? mbDir.split('/') : [];
  setHtml(
    $('#mbSource'),
    mediaSources().map((m) => `<option value="${esc(m.id)}" ${m.id === mbSource ? 'selected' : ''}>📁 ${esc(m.name)}</option>`).join('') +
      `<option value="uploads" ${mbSource === 'uploads' ? 'selected' : ''}>⬆ Hochgeladen</option>`
  );
  setHtml(
    $('#mbPath'),
    mbSource === 'uploads'
      ? `<span class="muted" title="${esc(mbData.root ?? '')}">data/uploads · ${mbData.files.length} Dateien, neueste zuerst</span>`
      : `<button class="link" data-dir="" title="${esc(mbData.root ?? '')}">📁 ${esc(rootName)}</button>` +
      parts.map((p, i) => ` <span class="muted">›</span> <button class="link" data-dir="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`).join('')
  );
  const q = $('#mbSearch').value.trim().toLowerCase();
  const match = (f) => !q || f.name.toLowerCase().includes(q);
  const inPlaylist = playlistKeys();
  const folders = mbData.folders.filter(match);
  const files = mbData.files.filter(match);
  const rows = [];
  if (mbDir) rows.push(`<div class="mb-row folder" data-dir="${esc(parts.slice(0, -1).join('/'))}"><span class="mb-thumb">⬑</span><span class="mb-name">zurück</span></div>`);
  for (const f of folders) {
    rows.push(`<div class="mb-row folder" data-dir="${esc(f.path)}"><span class="mb-thumb">📁</span><span class="mb-name">${esc(f.name)}</span><span class="mb-meta">›</span></div>`);
  }
  const inMusic = musicKeys();
  for (const f of files) {
    if (f.type === 'audio') {
      const inList = inMusic.has(f.key);
      rows.push(`
      <div class="mb-row file audio ${inList ? 'added' : ''}" draggable="true" data-path="${esc(f.path)}" data-type="audio" title="In die Musikliste ziehen">
        <span class="mb-thumb">🎵</span>
        <span class="mb-name">${esc(f.name)}</span>
        <span class="mb-meta">${inList ? '✓ in Musik' : fmtSize(f.size)}</span>
        <button class="icon mb-add" data-add="${esc(f.path)}" data-type="audio" title="An die Musikliste anhängen">＋</button>
      </div>`);
      continue;
    }
    const added = inPlaylist.has(f.key);
    const src = mbSource === 'uploads' ? f.preview : f.type === 'image' ? `/api/media/thumb?source=${encodeURIComponent(mbSource)}&path=${encodeURIComponent(f.path)}&v=${f.size}-${f.mtime}` : null;
    const preview = src ? `<img src="${esc(src)}" loading="lazy" decoding="async" alt="">` : '🎬';
    rows.push(`
      <div class="mb-row file ${added ? 'added' : ''}" draggable="true" data-path="${esc(f.path)}" title="In die Playlist ziehen">
        <span class="mb-thumb">${preview}</span>
        <span class="mb-name">${esc(f.name)}</span>
        ${(() => {
          const others = otherPlaylists(f.key);
          const where = [added ? t('in dieser Playlist') : null, ...others.map((n) => t('in „{0}“', n))].filter(Boolean).join(', ');
          const label = added ? `✓ in Playlist${others.length ? ` +${others.length}` : ''}` : others.length ? `in „${others[0]}“${others.length > 1 ? ` +${others.length - 1}` : ''}` : f.usage ? f.usage : fmtSize(f.size);
          return `<span class="mb-meta ${!added && others.length ? 'elsewhere' : ''}" title="${esc(where || fmtSize(f.size))}">${esc(label)}</span>`;
        })()}
        <button class="icon mb-add" data-add="${esc(f.path)}" title="An die Playlist anhängen">＋</button>
      </div>`);
  }
  const empty = mbData.error
    ? `<div class="empty-list">${esc(mbData.error)}<br>Ordner unter ⚙ Einstellungen prüfen.</div>`
    : !rows.length || (rows.length === 1 && mbDir)
      ? `<div class="empty-list">${q ? 'Keine Treffer.' : mbSource === 'uploads' ? 'Noch nichts hochgeladen.' : 'Keine Bilder, Videos oder Audiodateien in diesem Ordner.'}</div>`
      : '';
  setHtml($('#mbList'), rows.join('') + empty);
  const addable = files.filter((f) => (f.type === 'audio' ? !inMusic.has(f.key) : !inPlaylist.has(f.key))).length;
  $('#mbAddAll').disabled = !addable;
  $('#mbAddAll').textContent = addable ? `Alle hinzufügen (${addable})` : 'Alle hinzufügen';
}

/** Schlüssel der Dateien, die schon in der Playlist sind (wie in der Medienliste) */
const playlistKeys = () => new Set(viewPlaylist()?.keys ?? []);
/** Namen der übrigen Playlisten, in denen die Datei steckt */
const otherPlaylists = (key) => (state?.playlists ?? []).filter((p) => p.id !== viewPlaylist()?.id && p.keys.includes(key)).map((p) => p.name);

async function addMediaItems(paths, position, source = mbSource) {
  if (!paths.length) return;
  const { added, skipped } = await api('POST', '/api/playlist', { type: 'media', source, paths, position, playlist: viewParam() });
  if (source === 'uploads') loadMedia(); // Titel/Markierungen aktualisieren
  if (!added.length && skipped.length) toast(`Schon in der Playlist: ${skipped.map((s) => `„${s.name}“`).join(', ')}`, 5000);
  else toast(`${added.length} Datei(en) hinzugefügt${skipped.length ? `, ${skipped.length} schon in der Playlist (übersprungen)` : ''}`, 4000);
  if (added[0]) highlightItem(added[0].id);
}

$('#mbList').addEventListener('click', (e) => {
  const add = e.target.closest('.mb-add');
  if (add) return add.dataset.type === 'audio' ? addMusicFiles([add.dataset.add]) : addMediaItems([add.dataset.add]);
  const folder = e.target.closest('.mb-row.folder');
  if (folder) {
    $('#mbSearch').value = '';
    loadMedia(folder.dataset.dir);
  }
});
$('#mbPath').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dir]');
  if (btn) {
    $('#mbSearch').value = '';
    loadMedia(btn.dataset.dir);
  }
});
$('#mbSearch').addEventListener('input', renderMedia);
$('#mbSource').addEventListener('change', (e) => {
  mbSource = e.target.value;
  try {
    localStorage.setItem('screendeck-media-source', mbSource);
  } catch {}
  $('#mbSearch').value = '';
  loadMedia('');
});
$('#mbRefresh').addEventListener('click', () => loadMedia());
$('#mbAddAll').addEventListener('click', () => {
  const q = $('#mbSearch').value.trim().toLowerCase();
  const inPlaylist = playlistKeys();
  const inMusic = musicKeys();
  const shown = mbData.files.filter((f) => !q || f.name.toLowerCase().includes(q));
  const paths = shown.filter((f) => f.type !== 'audio' && !inPlaylist.has(f.key)).map((f) => f.path);
  const audio = shown.filter((f) => f.type === 'audio' && !inMusic.has(f.key)).map((f) => f.path);
  if (paths.length + audio.length > 20 && !confirm(`${paths.length + audio.length} Dateien hinzufügen?${audio.length ? `\n(${audio.length} Audiodateien in die Musikliste)` : ''}`)) return;
  if (paths.length) addMediaItems(paths);
  if (audio.length) addMusicFiles(audio);
});

// Ziehen aus dem Medienordner …
$('#mbList').addEventListener('dragstart', (e) => {
  const row = e.target.closest('.mb-row.file');
  if (!row) return;
  e.dataTransfer.setData(row.dataset.type === 'audio' ? MUSIC_MIME : MEDIA_MIME, JSON.stringify({ source: mbSource, paths: [row.dataset.path] }));
  e.dataTransfer.setData('text/plain', row.dataset.path);
  e.dataTransfer.effectAllowed = 'copy';
  row.classList.add('dragging');
  dragging = true; // währenddessen nicht neu zeichnen
});
$('#mbList').addEventListener('dragend', (e) => {
  e.target.closest('.mb-row')?.classList.remove('dragging');
  dragging = false;
  clearPlaylistDrop();
});

// … in die Playlist: Linie zeigt, wo der Eintrag landet
let playlistDrop = null; // { id, after }
function clearPlaylistDrop() {
  for (const r of $('#playlist').querySelectorAll('.drop-above, .drop-below')) r.classList.remove('drop-above', 'drop-below');
  $('#playlistCard').classList.remove('media-over');
  playlistDrop = null;
}
$('#playlistCard').addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes(MEDIA_MIME)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  let target = null;
  let after = true;
  for (const r of $('#playlist').querySelectorAll(':scope > .entry:not([hidden])')) {
    const b = r.getBoundingClientRect();
    target = r;
    if (e.clientY < b.top + b.height / 2) {
      after = false;
      break;
    }
  }
  if (target?.dataset.id !== playlistDrop?.id || after !== playlistDrop?.after) {
    clearPlaylistDrop();
    target?.classList.add(after ? 'drop-below' : 'drop-above');
    playlistDrop = target ? { id: target.dataset.id, after } : null;
  }
  $('#playlistCard').classList.add('media-over');
});
$('#playlistCard').addEventListener('dragleave', (e) => {
  if (!$('#playlistCard').contains(e.relatedTarget)) clearPlaylistDrop();
});
$('#playlistCard').addEventListener('drop', (e) => {
  if (!e.dataTransfer.types.includes(MEDIA_MIME)) return;
  e.preventDefault();
  const { source, paths } = JSON.parse(e.dataTransfer.getData(MEDIA_MIME) || '{}');
  const idx = playlistDrop ? viewItems().findIndex((i) => i.id === playlistDrop.id) : -1;
  const position = idx < 0 ? viewItems().length : idx + (playlistDrop.after ? 1 : 0);
  clearPlaylistDrop();
  dragging = false;
  addMediaItems(paths ?? [], position, source);
});

// Neu hinzugefügte Einträge stehen am Ende der Playlist: dorthin scrollen und kurz hervorheben
let pendingHighlight = null;
function highlightItem(id) {
  pendingHighlight = id;
  showHighlight();
}
function showHighlight() {
  if (!pendingHighlight) return;
  const row = document.querySelector(`#playlist .entry[data-id="${CSS.escape(pendingHighlight)}"]`);
  if (!row) return; // kommt mit dem nächsten Render
  if (row.hidden) return resetFilter(); // neuer Eintrag ist ausgefiltert: Filter aufheben, dann erneut
  pendingHighlight = null;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 2500);
}

$('#urlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const item = await api('POST', '/api/playlist', { type: 'url', src: f.get('src'), title: f.get('title'), playlist: viewParam() });
  e.target.reset();
  toast(`Webseite als #${viewItems().length} hinzugefügt`);
  highlightItem(item.id);
});

$('#textForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const item = await api('POST', '/api/playlist', {
    playlist: viewParam(),
    type: 'text',
    text: f.get('text'),
    bg: f.get('bg'),
    color: f.get('color'),
    duration: Number(f.get('duration')) || 0,
    showCountdown: f.get('showCountdown') === 'on',
    font: f.get('font'),
    edge: f.get('edge'),
  });
  e.target.querySelector('textarea').value = '';
  toast(`Text „${item.title}“ hinzugefügt`);
  highlightItem(item.id);
});

// ---------------------------------------------------------------------------
// Einstellungen: PIN für Verwaltung und Screens
// ---------------------------------------------------------------------------

function toggleSettings(open) {
  $('#settingsCard').hidden = !open;
  if (open) loadCacheInfo();
  $('#settingsBtn').classList.toggle('active', open);
  if (open) $('#settingsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// Zwischenspeicher der verkleinerten Bilder
const fmtBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' Byte');
async function loadCacheInfo() {
  const c = await api('GET', '/api/cache').catch(() => null);
  if (!c) return;
  $('#cacheInfo').textContent = c.files ? `${c.files} ${c.files === 1 ? 'Bild' : 'Bilder'}, ${fmtBytes(c.bytes)}` : 'leer';
  $('#cacheInfo').title = c.path;
  $('#cacheClear').disabled = !c.files;
}
$('#cacheRefresh').addEventListener('click', loadCacheInfo);
$('#cacheClear').addEventListener('click', async () => {
  if (!confirm('Zwischenspeicher leeren?\n\nDie verkleinerten Bilder werden gelöscht und beim nächsten Abruf neu erzeugt. Originaldateien bleiben unverändert.')) return;
  const r = await api('DELETE', '/api/cache');
  toast(`Zwischenspeicher geleert: ${r.removed} Bilder, ${fmtBytes(r.freed)} freigegeben`);
  loadCacheInfo();
});

$('#settingsBtn').addEventListener('click', () => toggleSettings($('#settingsCard').hidden));
$('#settingsClose').addEventListener('click', () => toggleSettings(false));

function renderSecurity() {
  const sec = state.security ?? {};
  for (const box of document.querySelectorAll('.sec')) {
    const on = !!sec[box.dataset.role];
    box.querySelector('.sec-state').textContent = on ? '🔒 PIN gesetzt' : 'kein Schutz';
    box.querySelector('.sec-state').classList.toggle('on', on);
    box.querySelector('.clear').disabled = !on;
  }
  $('#logoutForm').hidden = !sec.admin;
  $('#screenMenu').checked = state.settings.screenMenu !== false;
  $('#touchZoom').checked = state.settings.touchZoom !== false;
  if (document.activeElement !== $('#hostName')) $('#hostName').value = state.settings.hostName ?? '';
  if (screenPort) $('#hostNameSuffix').textContent = `.local${portSuffix()}`;
  showScreenUrls();
  $('#imageQuality').value = state.settings.imageQuality ?? 'original';
  renderSources();
  // Gewählte Quelle wurde entfernt (auch von einer anderen Verwaltung): auf eine vorhandene wechseln
  const before = mbSource;
  ensureSource();
  // Erstes Laden erst, wenn die Quellen bekannt sind; danach nur bei Wechsel der Quelle
  if (!mbData || mbSource !== before || (mbSource !== 'uploads' && !mbData.error && mbData.source !== mbSource)) loadMedia('');
  else renderMedia();
}

// Medienquellen in den Einstellungen
function renderSources() {
  setHtml(
    $('#msList'),
    mediaSources()
      .map(
        (m) => `
      <div class="ms-row" data-id="${esc(m.id)}">
        <span class="ms-icon">${/^\\\\|^\/\//.test(m.path) ? '🖧' : '📁'}</span>
        <input type="text" class="ms-name" value="${esc(m.name)}" data-action="ms-rename" title="Name ändern">
        <code class="ms-path" title="${esc(m.path)}">${esc(m.path)}</code>
        <button class="icon danger" data-action="ms-remove" title="Quelle entfernen (Dateien bleiben unberührt)">✕</button>
      </div>`
      )
      .join('') || '<p class="help small">Keine Medienquelle eingebunden – nur hochgeladene Dateien.</p>'
  );
}
async function addSource() {
  const path = $('#msPath').value.trim();
  if (!path) return toast('Bitte einen Pfad eingeben');
  $('#msAdd').disabled = true;
  $('#msAdd').textContent = 'Prüfe…'; // Netzlaufwerke können etwas dauern
  const source = await api('POST', '/api/media-sources', { name: $('#msName').value.trim(), path }).catch(() => null);
  $('#msAdd').disabled = false;
  $('#msAdd').textContent = 'Einbinden';
  if (!source) return;
  $('#msName').value = $('#msPath').value = '';
  toast(`„${source.name}“ eingebunden`);
  mbSource = source.id;
  try {
    localStorage.setItem('screendeck-media-source', mbSource);
  } catch {}
  loadMedia('');
}
$('#msAdd').addEventListener('click', addSource);
$('#msPath').addEventListener('keydown', (e) => e.key === 'Enter' && addSource());
$('#msList').addEventListener('change', (e) => {
  if (e.target.dataset.action === 'ms-rename') api('PATCH', `/api/media-sources/${e.target.closest('.ms-row').dataset.id}`, { name: e.target.value });
});
$('#msList').addEventListener('click', (e) => {
  if (e.target.dataset.action !== 'ms-remove') return;
  const row = e.target.closest('.ms-row');
  const name = row.querySelector('.ms-name').value;
  if (confirm(`Medienquelle „${name}“ entfernen?\n\nDie Dateien im Ordner bleiben unberührt, Einträge in der Playlist auch.`)) {
    api('DELETE', `/api/media-sources/${row.dataset.id}`);
  }
});
$('#screenMenu').addEventListener('change', (e) => api('PATCH', '/api/settings', { screenMenu: e.target.checked }));
$('#touchZoom').addEventListener('change', (e) => api('PATCH', '/api/settings', { touchZoom: e.target.checked }));
$('#hostName').addEventListener('change', (e) => api('PATCH', '/api/settings', { hostName: e.target.value }));
$('#imageQuality').addEventListener('change', (e) => {
  api('PATCH', '/api/settings', { imageQuality: e.target.value });
  toast(e.target.value === 'original' ? 'Screens bekommen Bilder in Originalqualität' : `Bilder werden für die Screens auf „${e.target.selectedOptions[0].text.split(' –')[0]}“ reduziert`);
});

const SEC_LABEL = { admin: 'Verwaltung', screen: 'Screens' };
$('#settingsCard').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  const box = e.target.closest('.sec');
  if (!btn || !box) return;
  const role = box.dataset.role;
  const input = box.querySelector('.pin');
  if (btn.classList.contains('gen')) {
    // Zufällige 6-stellige PIN (getRandomValues funktioniert auch ohne https)
    input.value = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    input.focus();
  }
  if (btn.classList.contains('save')) {
    const pin = input.value.trim();
    if (pin.length < 4) return toast('Die PIN muss mindestens 4 Zeichen lang sein');
    if (role === 'admin' && !confirm(`PIN für die Verwaltung auf „${pin}“ setzen?\n\nBitte notieren – ohne sie kommst du nicht mehr in die Verwaltung.`)) return;
    await api('PUT', '/api/security', { role, pin });
    input.value = '';
    toast(`PIN für ${SEC_LABEL[role]} gespeichert: ${pin}`, 8000);
  }
  if (btn.classList.contains('clear') && confirm(`PIN für ${SEC_LABEL[role]} entfernen? Danach ist der Bereich ohne PIN erreichbar.`)) {
    await api('PUT', '/api/security', { role, pin: '' });
    toast(`Schutz für ${SEC_LABEL[role]} aufgehoben`);
  }
});

$('#deleteAllScreens').addEventListener('click', async () => {
  const n = state.screens.length;
  if (!confirm(`Alle ${n} Screens aus der Liste entfernen?\n\nNamen, Einstellungen und Verlauf gehen verloren. Gerade verbundene Screens melden sich danach automatisch neu an.`)) return;
  const { count } = await api('DELETE', '/api/screens');
  toast(`${count} Screens entfernt`);
});

// ---------------------------------------------------------------------------
// Datei-Upload
// ---------------------------------------------------------------------------

function uploadFiles(files) {
  files = [...files].filter((f) => /^(image|video|audio)\//.test(f.type));
  if (!files.length) return toast('Nur Bilder, Videos und Audiodateien werden unterstützt');
  const data = new FormData();
  for (const f of files) data.append('files', f);

  const bar = $('#progress');
  bar.classList.add('on');
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/upload?playlist=${encodeURIComponent(viewParam() ?? '')}`);
  xhr.upload.onprogress = (e) => e.lengthComputable && (bar.firstElementChild.style.width = `${(e.loaded / e.total) * 100}%`);
  xhr.onloadend = () => {
    bar.classList.remove('on');
    bar.firstElementChild.style.width = '0';
    if (xhr.status !== 200) return toast('Upload fehlgeschlagen');
    try {
      const { added, skipped, musicAdded = [] } = JSON.parse(xhr.responseText);
      const musicNote = musicAdded.length ? ` · ${musicAdded.length} in die Musikliste` : '';
      if (!skipped.length) toast(`${added.length + musicAdded.length} Datei(en) hochgeladen${musicNote}`);
      else {
        const names = skipped.slice(0, 3).map((s) => `„${s.name}“ (= ${s.existing})`).join(', ');
        const more = skipped.length > 3 ? ` und ${skipped.length - 3} weitere` : '';
        toast(`${added.length} hochgeladen, ${skipped.length} doppelt aussortiert: ${names}${more}`, 7000);
      }
      if (added[0]) highlightItem(added[0].id);
      if (mbSource === 'uploads') loadMedia();
    } catch {}
  };
  xhr.send(data);
}

$('#fileInput').addEventListener('change', (e) => {
  uploadFiles(e.target.files);
  e.target.value = '';
});

const dz = $('#dropzone');
dz.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  dz.classList.add('over');
});
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('over');
  uploadFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Einklappbare Bereiche (Hinzufügen, Medien, Musik): Klick auf die Kopfzeile, den Zustand merkt sich der Browser
for (const card of document.querySelectorAll('.card.collapsible')) {
  const key = 'screendeck-collapsed-' + card.dataset.collapse;
  const head = card.querySelector('.card-head');
  const btn = document.createElement('button');
  btn.className = 'icon collapse-btn';
  btn.textContent = '▾'; // zugeklappt per CSS gedreht
  head.appendChild(btn);
  const apply = (collapsed) => {
    card.classList.toggle('collapsed', collapsed);
    btn.title = collapsed ? 'Aufklappen' : 'Einklappen';
    btn.setAttribute('aria-expanded', String(!collapsed));
  };
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(key) === '1';
  } catch {}
  apply(collapsed);
  head.addEventListener('click', (e) => {
    if (e.target.closest('button:not(.collapse-btn), input, select, a')) return;
    collapsed = !collapsed;
    apply(collapsed);
    try {
      localStorage.setItem(key, collapsed ? '1' : '0');
    } catch {}
  });
}

$('#textForm .font-select').innerHTML = fontOptions('system');
$('#textForm .edge-select').innerHTML = edgeOptions('none');

// Adressen für die Screens: Name im Netzwerk und IP-Adressen. Die Startseite führt zum Screen,
// läuft der Server auch auf Port 80, geht es ganz ohne Portangabe.
let screenPort = null;
let screenAddresses = [];
const portSuffix = () => (screenPort === 80 ? '' : `:${screenPort}`);
function showScreenUrls() {
  if (!screenPort) return;
  const name = state?.settings.hostName;
  const urls = [
    ...(name ? [`http://${name}.local${portSuffix()}`] : []),
    ...(screenAddresses.length ? screenAddresses : [location.hostname]).map((a) => `http://${a}${portSuffix()}`),
  ];
  setHtml($('#screenUrls'), urls.map((u) => `<code>${esc(u)}</code>`).join(' '));
}
fetch('/api/info')
  .then((r) => r.json())
  .then(({ port, shortPort, addresses }) => {
    screenPort = shortPort ?? port;
    screenAddresses = addresses;
    $('#hostNameSuffix').textContent = `.local${portSuffix()}`;
    showScreenUrls();
  });

// Zeitabhängige Anzeigen ("zuletzt vor 3 Min.", "wird übertragen…") aktuell halten
setInterval(() => !isBusy() && render(), 5000);

connect();
