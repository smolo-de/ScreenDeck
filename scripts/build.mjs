// Bereitstellung ohne Installation: Windows (ScreenDeck.exe) und Linux (Programm „screendeck“ + systemd-Dienst).
//
//   npm run dist                       alle Ziele
//   npm run dist -- win-x64 linux-arm64  nur diese
//
// Je Ziel entsteht dist/ScreenDeck-<ziel>/ und daneben ein Archiv (.zip bzw. .tar.gz):
//   ScreenDeck(.exe)  Node.js mit eingebautem Starter (Node „Single Executable Application“)
//   app/              Server, Oberfläche und Abhängigkeiten – sharp hat native Teile und kann nicht in die Exe
//   data/             entsteht beim ersten Start neben dem Programm (Einstellungen, Playlisten, Uploads)
// Die Node-Version der Ziele entspricht der, mit der gebaut wird (für den Starter nötig).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(DIST, '.cache');
const TEMPLATES = path.join(ROOT, 'scripts', 'dist');
const NODE_VERSION = process.version; // z. B. v24.19.0
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const WIN = process.platform === 'win32';

const TARGETS = {
  'win-x64': { os: 'win32', cpu: 'x64', node: 'win-x64' },
  'linux-x64': { os: 'linux', cpu: 'x64', node: 'linux-x64' },
  'linux-arm64': { os: 'linux', cpu: 'arm64', node: 'linux-arm64' }, // z. B. Raspberry Pi 4/5 (64 Bit)
};
// Was vom Projekt mitkommt
const APP_FILES = ['server.js', 'package.json', 'package-lock.json', 'LICENSE', 'README.md', 'README.de.md', 'public'];

// Windows: das eingebaute tar (bsdtar, kann zip und xz) – nicht das GNU-tar aus Git Bash, das „G:“ für einen Rechner hält
const TAR = WIN ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: WIN, ...opts });
const log = (msg) => console.log(`\n▸ ${msg}`);

/** Node-Programm für das Ziel: vom Rechner selbst (gleiches System) oder von nodejs.org (mit Prüfsumme) */
async function nodeBinary(t) {
  const exe = t.os === 'win32' ? 'node.exe' : 'node';
  if (process.platform === t.os && process.arch === t.cpu) return process.execPath;
  const file = path.join(CACHE, `node-${NODE_VERSION}-${t.node}${t.os === 'win32' ? '.exe' : ''}`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(CACHE, { recursive: true });
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const archive = t.os === 'win32' ? `win-x64/node.exe` : `node-${NODE_VERSION}-${t.node}.tar.xz`;
  log(`Lade Node.js ${NODE_VERSION} für ${t.node} …`);
  const res = await fetch(`${base}/${archive}`);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${base}/${archive} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const expected = sums.split('\n').find((l) => l.trim().endsWith(' ' + archive))?.split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (expected !== actual) throw new Error(`Prüfsumme stimmt nicht für ${archive}`);
  if (t.os === 'win32') fs.writeFileSync(file, buf);
  else {
    // bin/node aus dem Archiv holen (tar kann xz auf Windows 10+, Linux und macOS)
    const tmp = path.join(CACHE, `x-${t.node}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const tarball = path.join(tmp, 'node.tar.xz');
    fs.writeFileSync(tarball, buf);
    run(TAR, ['-xJf', 'node.tar.xz', `node-${NODE_VERSION}-${t.node}/bin/${exe}`], { cwd: tmp, shell: false });
    fs.renameSync(path.join(tmp, `node-${NODE_VERSION}-${t.node}`, 'bin', exe), file);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return file;
}

/** Starter-Blob (für alle Ziele gleich): startet app/server.js neben dem Programm */
function seaBlob() {
  const blob = path.join(CACHE, 'starter.blob');
  fs.mkdirSync(CACHE, { recursive: true });
  const config = path.join(CACHE, 'sea-config.json');
  fs.writeFileSync(config, JSON.stringify({ main: path.join(TEMPLATES, 'starter.cjs'), output: blob, disableExperimentalSEAWarning: true }));
  run(process.execPath, ['--experimental-sea-config', config], { shell: false });
  return blob;
}

function copyApp(dest, t) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of APP_FILES) fs.cpSync(path.join(ROOT, f), path.join(dest, f), { recursive: true });
  // nur Laufzeit-Abhängigkeiten, passend zum Zielsystem (sharp bringt je System eigene Bibliotheken mit)
  const args = ['ci', '--omit=dev', '--no-audit', '--no-fund', `--os=${t.os}`, `--cpu=${t.cpu}`];
  if (t.os === 'linux') args.push('--libc=glibc');
  run('npm', args, { cwd: dest });
}

/**
 * .tar.gz mit Unix-Rechten schreiben (755 für Programm und Skripte, sonst 644) – unabhängig davon, auf welchem
 * System gebaut wird. Unter Windows gepackt hätte tar sonst keine Ausführungsrechte.
 * Format ustar, lange Pfade per PAX-Eintrag.
 */
async function writeTarGz(baseDir, name, archive, isExec) {
  const zlib = await import('node:zlib');
  const { pipeline } = await import('node:stream/promises');
  const { Readable } = await import('node:stream');
  const mtime = Math.floor(Date.now() / 1000);
  const header = (entryName, size, mode, type = '0') => {
    const h = Buffer.alloc(512);
    const put = (str, off, len) => h.write(str, off, len, 'utf8');
    const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0'; // Zahl als Oktal, mit Null abgeschlossen
    put(entryName, 0, 100);
    put(oct(mode, 8), 100, 8);
    put(oct(0, 8), 108, 8);
    put(oct(0, 8), 116, 8);
    put(oct(size, 12), 124, 12);
    put(oct(mtime, 12), 136, 12);
    put('        ', 148, 8); // Prüfsumme: erst Leerzeichen
    put(type, 156, 1);
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    let sum = 0;
    for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return h;
  };
  const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);
  // langer Pfad: PAX-Erweiterung („path=…“) vor dem eigentlichen Eintrag
  function* entryHeader(rel, size, mode, type) {
    if (Buffer.byteLength(rel) < 100) return yield header(rel, size, mode, type);
    let rec = ` path=${rel}\n`;
    let len = Buffer.byteLength(rec) + 2;
    while (String(len).length + Buffer.byteLength(rec) !== len) len = String(len).length + Buffer.byteLength(rec);
    const pax = Buffer.from(`${len}${rec}`);
    yield header('PaxHeader', pax.length, 0o644, 'x');
    yield pax;
    yield pad(pax.length);
    yield header(rel.slice(-99), size, mode, type);
  }
  async function* entries(dir, rel) {
    yield* entryHeader(rel + '/', 0, 0o755, '5');
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, d.name);
      const r = `${rel}/${d.name}`;
      if (d.isDirectory()) yield* entries(abs, r);
      else if (d.isFile()) {
        const size = fs.statSync(abs).size;
        yield* entryHeader(r, size, isExec(r) ? 0o755 : 0o644, '0');
        for await (const chunk of fs.createReadStream(abs)) yield chunk;
        yield pad(size);
      }
    }
  }
  async function* all() {
    yield* entries(path.join(baseDir, name), name);
    yield Buffer.alloc(1024); // Ende des Archivs
  }
  await pipeline(Readable.from(all()), zlib.createGzip({ level: 6 }), fs.createWriteStream(archive));
}

/** Text mit Unix- bzw. Windows-Zeilenenden schreiben */
function writeText(file, text, crlf) {
  fs.writeFileSync(file, crlf ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
}

async function build(id) {
  const t = TARGETS[id];
  const name = `ScreenDeck-${id}`;
  const out = path.join(DIST, name);
  log(`${name}`);
  fs.rmSync(out, { recursive: true, force: true });
  copyApp(path.join(out, 'app'), t);

  // Programm: Node + Starter
  const program = path.join(out, t.os === 'win32' ? 'ScreenDeck.exe' : 'screendeck');
  fs.copyFileSync(await nodeBinary(t), program);
  run('npx', ['--yes', 'postject', program, 'NODE_SEA_BLOB', seaBlobPath, '--sentinel-fuse', SEA_FUSE], { cwd: ROOT });
  if (t.os !== 'win32') fs.chmodSync(program, 0o755);

  // Begleitdateien
  const dir = path.join(TEMPLATES, t.os === 'win32' ? 'windows' : 'linux');
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replaceAll('{{VERSION}}', pkg.version).replaceAll('{{TARGET}}', id);
    writeText(path.join(out, f), text, t.os === 'win32');
    if (f.endsWith('.sh')) fs.chmodSync(path.join(out, f), 0o755);
  }

  // Archiv
  const archive = path.join(DIST, `${name}${t.os === 'win32' ? '.zip' : '.tar.gz'}`);
  fs.rmSync(archive, { force: true });
  if (t.os === 'win32') {
    if (WIN) run(TAR, ['-a', '-cf', path.basename(archive), name], { cwd: DIST, shell: false }); // bsdtar (Windows 10+) kann zip
    else run('zip', ['-qr', archive, name], { cwd: DIST, shell: false });
  } else {
    // Programm, Skripte und native Bibliotheken ausführbar
    const exec = (rel) => /\/(screendeck|[^/]+\.sh)$/.test(rel) || /\.node$/.test(rel);
    await writeTarGz(DIST, name, archive, exec);
  }
  const mb = (fs.statSync(archive).size / 1e6).toFixed(1);
  console.log(`  ✓ ${path.relative(ROOT, archive)} (${mb} MB)`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
for (const id of wanted) if (!TARGETS[id]) throw new Error(`Unbekanntes Ziel „${id}“ – möglich: ${Object.keys(TARGETS).join(', ')}`);
log(`Starter für Node.js ${NODE_VERSION}`);
const seaBlobPath = seaBlob();
for (const id of wanted) await build(id);
console.log('\nFertig. Archive liegen in dist/.');
