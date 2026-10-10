#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Capture the picture the drawn FM-1 shows on the site: the firmware's browser build (web/build, made by
// web/build.sh with E1M1 from the shareware DOOM1.WAD embedded) is started headless, a new game is begun through
// the panel as a player would, and the panel's 240x240 picture is taken two seconds after the level appears.
//
//   node site/capture_screen.js [OUT.png]      (default: site/frontend/src/assets/e1m1-start.png)
//
// That picture is the one piece of id Software's artwork in the repository: a screenshot, as any page about a
// Doom port shows, not game data.
const path = require('path'), fs = require('fs'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'), BUILD = path.join(ROOT, 'web', 'build');
const OUT = process.argv[2] || path.join(ROOT, 'site', 'frontend', 'src', 'assets', 'e1m1-start.png');
const N = 240, AFTER_MS = 2000;

function png(file, rgb) {
  const table = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = b => { let c = 0xFFFFFFFF; for (let n = 0; n < b.length; n++) c = table[(c ^ b[n]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc(N * (N * 3 + 1)); for (let y = 0; y < N; y++) rgb.copy(raw, y * (N * 3 + 1) + 1, y * N * 3, (y + 1) * N * 3);
  const hd = Buffer.alloc(13); hd.writeUInt32BE(N, 0); hd.writeUInt32BE(N, 4); hd[8] = 8; hd[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

globalThis.Module = {
  locateFile: f => path.join(BUILD, f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(150); M._fm1_web_panel(0, 0); await sleep(350); };
    (async () => {
      setInterval(() => M._fm1_web_audio(1024, 44100), 23);                // the sound is pulled as on the page, so the game runs as there
      await sleep(1500); await tap(PLAY); await tap(PLAY); await tap(PLAY);    // title -> menu, New Game, skill
      for (let i = 0; M._fm1_web_awake() < 0; i++) { if (i > 100) { console.log('no level after 10 s'); process.exit(1); } await sleep(100); }
      await sleep(AFTER_MS);                                                // the melt into the level is over
      const p = M._fm1_web_lcd(), lcd = M.HEAPU8.subarray(p, p + N * N * 2);
      const rgb = Buffer.alloc(N * N * 3), colours = new Set();
      for (let i = 0; i < N * N; i++) {
        const v = lcd[i * 2] << 8 | lcd[i * 2 + 1];                         // the panel's byte order: high byte first, RGB565
        colours.add(v);
        rgb.set([Math.round((v >> 11) * 255 / 31), Math.round(((v >> 5) & 63) * 255 / 63), Math.round((v & 31) * 255 / 31)], i * 3);
      }
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      png(OUT, rgb);
      console.log(`${path.relative(ROOT, OUT)}: ${N}x${N}, ${colours.size} colours, ${fs.statSync(OUT).size} B`);
      process.exit(0);
    })();
  },
};
// doom.js picks up a global \`Module\` only when it runs as a classic script
globalThis.require = require; globalThis.__dirname = BUILD; globalThis.__filename = path.join(BUILD, 'doom.js');
require('vm').runInThisContext(fs.readFileSync(path.join(BUILD, 'doom.js'), 'utf8'), { filename: 'doom.js' });
