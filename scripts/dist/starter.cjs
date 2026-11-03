// Starter für ScreenDeck.exe / screendeck (Node „Single Executable Application“):
// lädt den Server aus app/ neben dem Programm, Daten standardmäßig in data/ daneben.
// Unter Windows öffnet ein Doppelklick zusätzlich die Verwaltung im Browser.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const dir = path.dirname(process.execPath);
process.env.DATA_DIR ??= path.join(dir, 'data');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`ScreenDeck – Steuerung von Browser-Screens

  Optionen:  --no-browser   Verwaltung beim Start nicht im Browser öffnen (Windows)
  Umgebung:  PORT, EXTRA_PORT, DATA_DIR, PUBLIC_HOST, PUBLIC_PORT (siehe README)`);
  process.exit(0);
}

const app = path.join(dir, 'app', 'server.js');
if (!fs.existsSync(app)) {
  console.error(`ScreenDeck: ${app} fehlt – der Ordner „app“ muss neben dem Programm liegen.`);
  process.exit(1);
}
createRequire(app)('./server.js');

// Doppelklick unter Windows (sichtbares Konsolenfenster): Verwaltung öffnen – nicht als Hintergrunddienst
if (process.platform === 'win32' && process.stdout.isTTY && !args.includes('--no-browser')) {
  let port = Number(process.env.PORT) || 3000;
  try {
    port = Number(process.env.PORT) || JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'state.json'), 'utf8')).settings?.port || 3000;
  } catch {}
  setTimeout(() => require('node:child_process').exec(`start "" "http://localhost:${port}/admin"`), 1500);
}
