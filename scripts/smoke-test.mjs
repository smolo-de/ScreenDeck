// Rauchtest: startet ScreenDeck mit leerem Datenordner und prüft Seiten, API, Upload und Vorschaubild (sharp).
//
//   node scripts/smoke-test.mjs                         Server aus dem Projekt (node server.js)
//   node scripts/smoke-test.mjs dist/ScreenDeck-win-x64/ScreenDeck.exe   fertiges Programm
//   node scripts/smoke-test.mjs --url http://localhost:3000             schon laufender Server (z. B. Docker)
//
// Ohne Abhängigkeiten außer Node selbst – läuft auch gegen die gepackten Programme.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const program = urlArg ? null : args[0];
const port = Number(process.env.SMOKE_PORT) || 3990;
const base = urlArg?.replace(/\/$/, '') ?? `http://127.0.0.1:${port}`;

let child = null;
let output = '';
let dataDir = null;
let failed = false;

function check(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log(`  ✓ ${msg}`);
}

/** einfarbiges PNG (ohne sharp erzeugt), groß genug, dass das Vorschaubild verkleinert werden muss */
function png(w, h) {
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 Bit, RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([40, 120, 200], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function waitForServer() {
  const limit = Number(process.env.SMOKE_TIMEOUT) || 30; // Sekunden (emuliert deutlich langsamer)
  const until = Date.now() + limit * 1000;
  while (Date.now() < until) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Server beendet (Code ${child.exitCode})`);
    try {
      if ((await fetch(`${base}/connect.json`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server antwortet nicht innerhalb von ${limit} s`);
}

async function run() {
  if (!urlArg) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screendeck-smoke-'));
    const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), EXTRA_PORT: '0' };
    const [cmd, cmdArgs] = program ? [path.resolve(program), ['--no-browser']] : [process.execPath, [path.join(ROOT, 'server.js')]];
    console.log(`▸ starte ${path.relative(ROOT, cmd) || cmd} (Daten: ${dataDir})`);
    child = spawn(cmd, cmdArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
  }
  await waitForServer();
  console.log(`▸ prüfe ${base}`);

  const connect = await (await fetch(`${base}/connect.json`)).json();
  check(connect && typeof connect === 'object', '/connect.json liefert JSON');

  for (const page of ['/admin', '/screen', '/connect']) {
    const res = await fetch(base + page, { redirect: 'manual' });
    check(res.status === 200 && (await res.text()).includes('<html'), `${page} liefert die Seite`);
  }
  for (const file of ['/admin.js', '/i18n.js']) check((await fetch(base + file)).ok, `${file} wird ausgeliefert`);

  const state = await (await fetch(`${base}/api/state`)).json();
  check(Array.isArray(state.screens) && Array.isArray(state.playlists), '/api/state liefert den Zustand');
  const info = await (await fetch(`${base}/api/info`)).json();
  check(urlArg ? Number.isInteger(info.port) : info.port === port, `/api/info meldet Port ${info.port}`);

  const form = new FormData();
  form.append('files', new Blob([png(800, 450)], { type: 'image/png' }), 'rauchtest.png');
  const up = await (await fetch(`${base}/api/upload`, { method: 'POST', body: form })).json();
  const item = up.added?.[0];
  check(item?.id && item.type === 'image', 'Bild-Upload landet in der Playlist');

  const thumb = await fetch(`${base}/img/${item.id}/thumb`);
  const buf = Buffer.from(await thumb.arrayBuffer());
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  check(thumb.ok && jpeg, `Vorschaubild über sharp erzeugt (JPEG, ${buf.length} Bytes)`);

  console.log('\n✓ Rauchtest bestanden');
}

try {
  await run();
} catch (e) {
  failed = true;
  console.error(`\n✗ Rauchtest fehlgeschlagen: ${e.message}`);
  if (output) console.error(`\n--- Ausgabe des Servers ---\n${output}`);
} finally {
  child?.kill();
  if (dataDir) {
    await new Promise((r) => setTimeout(r, 500)); // Windows: Dateien erst nach dem Beenden freigegeben
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}
process.exit(failed ? 1 : 0);
