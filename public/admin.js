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
      state = msg.state;
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
  ws.onclose = () => {
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
    (a && a.matches('.meta input[type=text], .meta input[type=number], .standby-edit textarea, .standby-edit input, #interval'))
  );
}
let sliding = false; // Lautstärke-Regler wird gerade gezogen
document.addEventListener('pointerdown', (e) => (sliding = e.target.matches('input[type=range]')));
document.addEventListener('pointerup', () => {
  sliding = false;
  setTimeout(() => renderPending && !isBusy() && render(), 0);
});
function requestRender() {
  if (isBusy()) renderPending = true;
  else render();
}
document.addEventListener('focusout', () => setTimeout(() => renderPending && !isBusy() && render(), 0));

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------

const itemById = (id) => state.playlist.find((i) => i.id === id);

const fontOptions = (selected) =>
  SCREEN_FONTS.map((f) => `<option value="${f.id}" ${f.id === (selected || 'system') ? 'selected' : ''}>${esc(f.label)}</option>`).join('');
const edgeOptions = (selected) =>
  SCREEN_EDGES.map((e) => `<option value="${e.id}" ${e.id === (selected || 'none') ? 'selected' : ''}>${esc(e.label)}</option>`).join('');
const EDGE_RADIUS = { soft: '8px', strong: '16px' }; // Vorschau in der Verwaltung
const TYPE_LABEL = { image: 'Bild', video: 'Video', url: 'Webseite', text: 'Text' };

function thumb(item, extra = '') {
  if (!item) return `<div class="thumb none">leer${extra}</div>`;
  switch (item.type) {
    case 'image': return `<div class="thumb"><img src="${esc(item.src)}" loading="lazy" alt="">${extra}</div>`;
    case 'video': return `<div class="thumb"><video src="${esc(item.src)}#t=1" muted preload="metadata"></video>${extra}</div>`;
    case 'url': return `<div class="thumb icon">🌐${extra}</div>`;
    case 'text': {
      const style = `background:${esc(item.bg)};color:${esc(item.color)};font-family:${esc(fontFamily(item.font))};border-radius:${EDGE_RADIUS[item.edge] ?? '6px'}`;
      return `<div class="thumb text ${item.edge && item.edge !== 'none' ? 'soft' : ''}" style="${style}">${esc(item.text.slice(0, 40))}${extra}</div>`;
    }
  }
  return `<div class="thumb">?${extra}</div>`;
}

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() + clockOffset - ts) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return new Date(ts).toLocaleString('de-DE');
}

// Abgleich: Was soll der Screen zeigen, was meldet er tatsächlich zurück?
const CONFIRM_TIMEOUT = 10000;
const STATE_TEXT = {
  showing: ['ok', '✓ wird angezeigt'],
  playing: ['ok', '✓ Video läuft'],
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

const MODE_LABEL = { play: 'Play', pause: 'Pause', image: 'Standbild', dark: 'Dunkel' };
const MODE_BUTTONS = [
  ['play', '▶', 'Abspielen'],
  ['pause', '⏸', 'Pausieren – Inhalt bleibt stehen'],
  ['image', '🖼', 'Standbild dieses Screens zeigen'],
  ['dark', '⬛', 'Dunkel schalten'],
];

function modeControls(s) {
  const mode = s.mode ?? 'play';
  const buttons = MODE_BUTTONS.map(
    ([m, icon, title]) => `<button class="${m === mode ? 'active' : ''}" data-action="mode" data-mode="${m}" title="${title}">${icon}</button>`
  ).join('');
  const images = state.playlist.filter((i) => i.type === 'image');
  const sb = s.standby;
  const options = [
    `<option value="">Standbild: keins</option>`,
    sb?.file ? `<option value="__own" selected>Standbild: ${esc(sb.title)} (eigenes)</option>` : '',
    ...images.map((i) => `<option value="${esc(i.id)}" ${sb?.itemId === i.id ? 'selected' : ''}>Standbild: ${esc(i.title)}</option>`),
    `<option value="__upload">Eigenes Bild hochladen…</option>`,
  ].join('');
  const st = s.standbyStyle ?? {};
  return `
    <div class="sub modes-row">
      <div class="segmented modes small">${buttons}</div>
      <select class="standby" data-action="standby" title="Bild für den Modus „Bild“">${options}</select>
    </div>
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
    return s.standby ? thumb({ type: 'image', src: s.standby.src }, overlay + extra) : `<div class="thumb none">${overlay || '🖼 kein Bild'}${extra}</div>`;
  }
  if (mode === 'pause') return thumb(item, extra + '<span class="tbadge">⏸</span>');
  return thumb(item, extra);
}

// Ton-Status laut Rückmeldung (nur bei laufenden Videos aussagekräftig)
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

function updateProgress(screenId) {
  const el = document.querySelector(`[data-progress="${CSS.escape(screenId)}"]`);
  const screen = state?.screens.find((s) => s.id === screenId);
  if (!el || !screen) return;
  const p = progress.get(screenId);
  const valid = p && p.itemId === screen.currentItemId && p.duration > 0;
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
        <span class="muted">${queue.length ? `${queue.length} eingereiht` : 'Einträge per ＋ in der Playlist oder per Ziehen auf den Screen einreihen'}</span>
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
  idle: ['ok', '✓', 'leer'],
  loading: ['warn', '⏳', 'lädt'],
  timeout: ['warn', '⚠', 'Laden nicht bestätigt'],
  blocked: ['err', '✗', 'Autoplay blockiert'],
  stalled: ['err', '✗', 'Video hing'],
  error: ['err', '✗', 'Fehler'],
};

const clock = (ts) => new Date(ts).toLocaleTimeString('de-DE');

function historyHtml(s) {
  const history = s.history ?? [];
  const rows = history
    .map((h) => {
      const [cls, icon, label] = HISTORY_STATUS[h.status] ?? ['off', '–', 'keine Rückmeldung'];
      const duration = h.end ? fmtTime((h.end - h.start) / 1000) : 'läuft';
      return `
        <li>
          <span class="htime">${clock(h.start)}</span>
          <span class="hstatus verify ${cls}" title="${esc(label)}">${icon}</span>
          <span class="htitle">${TYPE_ICON[h.type] ?? ''} ${esc(h.title)}</span>
          <span class="hmeta">${duration} · ${esc(h.reason ?? '')}${h.ended ? ' · bis zum Ende' : ''}</span>
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
  morphChildren(el, tpl.content);
}

// Kurzlebige Klassen, die nicht aus dem HTML kommen und beim Abgleich erhalten bleiben
const TRANSIENT_CLASSES = ['flash', 'drop-target', 'dragging'];

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
  const { settings, screens, playlist, online } = state;

  // Steuerung
  for (const b of document.querySelectorAll('#distribution button')) {
    b.classList.toggle('active', b.dataset.value === settings.distribution);
  }
  const modes = new Set(screens.map((s) => s.mode ?? 'play'));
  for (const b of document.querySelectorAll('#allModes button')) {
    b.classList.toggle('active', modes.size === 1 && modes.has(b.dataset.mode));
  }
  $('#autoAdvance').checked = settings.autoAdvance;
  if (document.activeElement !== $('#interval')) $('#interval').value = settings.interval;
  $('#modeHelp').textContent =
    settings.distribution === 'order'
      ? 'Der Reihe nach: Screen 1 zeigt Eintrag 1, Screen 2 Eintrag 2 usw. Bei jedem Wechsel rückt die Playlist um eine Position weiter. Fest zugeordnete Screens bleiben unverändert.'
      : 'Zufall: Jeder Screen bekommt einen zufälligen Eintrag – möglichst ohne Doppelungen und ohne Wiederholung des vorherigen Inhalts. Fest zugeordnete Screens bleiben unverändert.';
  updateCountdown();

  // Screens
  const onlineSet = new Set(online);
  $('#screenCount').textContent = `${online.length} / ${screens.length} online`;
  const options = (selected) =>
    `<option value="">Automatisch (Playlist)</option>` +
    playlist.map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>Fest: ${esc(i.title)}</option>`).join('');

  setHtml(
    $('#screens'),
    screens.length
      ? screens
          .map((s) => {
            const on = onlineSet.has(s.id);
            const item = itemById(s.currentItemId);
            const v = verification(s, on);
            return `
        <div class="entry ${on ? '' : 'offline'} ${(s.mode ?? 'play') !== 'play' ? 'inactive' : ''}" data-id="${esc(s.id)}">
          <span class="handle" title="Ziehen zum Sortieren">⋮⋮</span>
          ${screenThumb(s, item, `<span class="status dot ${on ? 'on' : ''}"></span>`)}
          <div class="meta">
            <input type="text" value="${esc(s.name)}" data-action="rename" title="Name ändern">
            ${modeControls(s)}
            <div class="sub">
              ${(s.mode ?? 'play') !== 'play' ? `<span class="badge mode">${MODE_LABEL[s.mode]}</span>` : ''}
              ${s.pinnedItemId ? '<span class="badge pin">fest</span>' : ''}
              <span class="now">${item ? esc(item.title) : 'Kein Inhalt'}</span>
            </div>
            ${item?.type === 'video' || (item?.type === 'text' && item.duration > 0)
              ? `<div class="vprogress" data-progress="${esc(s.id)}"><div class="bar" data-action="seek" title="Klicken, um an diese Stelle zu springen"><div></div></div><span class="ptime"></span></div>`
              : ''}
            <div class="sub">
              <span class="verify ${v.cls}">${esc(v.text)}</span>
              ${on && v.cls !== 'ok' ? '<button class="link" data-action="resend">erneut senden</button>' : ''}
            </div>
            <div class="sub audio">
              <button class="audio-toggle ${s.audio ? 'on' : ''}" data-action="audio" title="Ton für Videos auf diesem Screen">${s.audio ? '🔊 Ton an' : '🔇 Ton aus'}</button>
              ${s.audio ? `<input type="range" min="0" max="100" step="5" value="${s.volume ?? 80}" data-action="volume" title="Lautstärke"><span class="vol">${s.volume ?? 80}%</span>` : ''}
              ${audioStatus(s, on, v)}
            </div>
            <div class="sub">
              ${on ? 'online' : 'offline' + (s.lastSeen ? ' · zuletzt ' + ago(s.lastSeen) : '')}
              ${s.ip ? ' · ' + esc(s.ip) : ''}
            </div>
          </div>
          <div class="actions">
            <select class="assign" data-action="assign" title="Inhalt zuordnen">${options(s.pinnedItemId)}</select>
            ${on ? `<button class="icon" data-action="identify" title="Namen auf dem Screen anzeigen">👁</button>
                    <button class="icon" data-action="reload" title="Screen neu laden">↻</button>`
                 : `<button class="icon danger" data-action="delete-screen" title="Screen entfernen">✕</button>`}
          </div>
          ${upNextHtml(s)}
          ${historyHtml(s)}
        </div>`;
          })
          .join('')
      : `<div class="empty-list">Noch keine Screens verbunden.<br>Öffne die Screen-URL auf einem Tablet oder Beamer.</div>`
  );

  for (const s of screens) updateProgress(s.id);

  // Playlist – pro Eintrag ein Quick-Button je Screen
  // Klick reiht den Eintrag in die Warteschlange des Screens ein
  const quickButtons = (item) =>
    screens
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

  setHtml(
    $('#playlist'),
    playlist.length
      ? playlist
          .map(
            (i, n) => `
        <div class="entry ${i.enabled ? '' : 'disabled'}" data-id="${esc(i.id)}">
          <span class="handle" title="Ziehen zum Sortieren">⋮⋮</span>
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
          </div>
        </div>`
          )
          .join('')
      : `<div class="empty-list">Die Playlist ist leer.<br>Füge Bilder, Videos, Webseiten oder Texte hinzu.</div>`
  );
  showHighlight();
}

function updateCountdown() {
  const el = $('#countdown');
  if (!state?.nextAt) return (el.textContent = '');
  const s = Math.max(0, Math.ceil((state.nextAt - Date.now() - clockOffset) / 1000));
  el.textContent = `in ${s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : s + ' s'}`;
}
setInterval(updateCountdown, 500);

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
makeSortable($('#playlist'), (ids) => api('PUT', '/api/playlist/order', { ids }));

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
  if (mode) api('POST', '/api/screens/mode', { mode });
});

// Lautstärke-Anzeige beim Ziehen sofort aktualisieren (gespeichert wird beim Loslassen)
// Standbild-Text schon während des Tippens (verzögert) speichern
let sbTextTimer;
$('#screens').addEventListener('input', (e) => {
  if (e.target.dataset.action === 'volume') e.target.nextElementSibling.textContent = `${e.target.value}%`;
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
  const p = progress.get(id);
  if (!p?.duration) return;
  const r = bar.getBoundingClientRect();
  const time = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * p.duration;
  progress.set(id, { ...p, currentTime: time }); // sofort anzeigen, Screen bestätigt mit nächster Meldung
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
  if (btn.dataset.action === 'mode') api('PATCH', `/api/screens/${id}`, { mode: btn.dataset.mode });
  if (btn.dataset.action === 'queue-play') api('POST', `/api/screens/${id}/queue/${btn.dataset.index}/play`);
  if (btn.dataset.action === 'queue-remove') api('DELETE', `/api/screens/${id}/queue/${btn.dataset.index}`);
  if (btn.dataset.action === 'queue-clear') api('DELETE', `/api/screens/${id}/queue`);
  if (btn.dataset.action === 'screen-next') api('POST', `/api/screens/${id}/next`);
  if (btn.dataset.action === 'audio') {
    const screen = state.screens.find((s) => s.id === id);
    api('PATCH', `/api/screens/${id}`, { audio: !screen.audio });
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
  pendingHighlight = null;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 2500);
}

$('#urlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const item = await api('POST', '/api/playlist', { type: 'url', src: f.get('src'), title: f.get('title') });
  e.target.reset();
  toast(`Webseite als #${state.playlist.length} hinzugefügt`);
  highlightItem(item.id);
});

$('#textForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const item = await api('POST', '/api/playlist', {
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
// Datei-Upload
// ---------------------------------------------------------------------------

function uploadFiles(files) {
  files = [...files].filter((f) => /^(image|video)\//.test(f.type));
  if (!files.length) return toast('Nur Bilder und Videos werden unterstützt');
  const data = new FormData();
  for (const f of files) data.append('files', f);

  const bar = $('#progress');
  bar.classList.add('on');
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.upload.onprogress = (e) => e.lengthComputable && (bar.firstElementChild.style.width = `${(e.loaded / e.total) * 100}%`);
  xhr.onloadend = () => {
    bar.classList.remove('on');
    bar.firstElementChild.style.width = '0';
    if (xhr.status !== 200) return toast('Upload fehlgeschlagen');
    try {
      const { added, skipped } = JSON.parse(xhr.responseText);
      if (!skipped.length) toast(`${added.length} Datei(en) hochgeladen`);
      else {
        const names = skipped.slice(0, 3).map((s) => `„${s.name}“ (= ${s.existing})`).join(', ');
        const more = skipped.length > 3 ? ` und ${skipped.length - 3} weitere` : '';
        toast(`${added.length} hochgeladen, ${skipped.length} doppelt aussortiert: ${names}${more}`, 7000);
      }
      if (added[0]) highlightItem(added[0].id);
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

$('#textForm .font-select').innerHTML = fontOptions('system');
$('#textForm .edge-select').innerHTML = edgeOptions('none');

fetch('/api/info')
  .then((r) => r.json())
  .then(({ port, addresses }) => {
    const urls = (addresses.length ? addresses : [location.hostname]).map((a) => `http://${a}:${port}/screen`);
    $('#screenUrls').innerHTML = urls.map((u) => `<code>${esc(u)}</code>`).join(' ');
  });

// Zeitabhängige Anzeigen ("zuletzt vor 3 Min.", "wird übertragen…") aktuell halten
setInterval(() => !isBusy() && render(), 5000);

connect();
