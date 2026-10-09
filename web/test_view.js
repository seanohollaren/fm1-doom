// Headless check of the three picture shapes (SCL button), the frame-rate line (ENV) and the link-speed line (LFO):
// starts E1M1 through the panel model, then for each shape reports which panel rows hold picture and writes a PNG.
//   node web/test_view.js OUT_DIR
const path = require('path'), fs = require('fs'), zlib = require('zlib');
const out = process.argv[2] || '.';
function png(file, w, h, rgb) {
  const crc = b => { let c, n, k, t = []; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    c = 0xFFFFFFFF; for (n = 0; n < b.length; n++) c = t[(c ^ b[n]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc(h * (w * 3 + 1)); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
globalThis.Module = {
  locateFile: f => path.join(__dirname, 'build', f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, B = n => 1 << n, PLAY = B(10), SCL = B(1), ENV = B(2), LFO = B(3);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(150); M._fm1_web_panel(0, 0); await sleep(350); };
    const shot = name => {
      const p = M._fm1_web_lcd(), px = M.HEAPU8.subarray(p, p + 240 * 240 * 2), rgb = Buffer.alloc(240 * 240 * 3), rows = [];
      for (let y = 0; y < 240; y++) { let any = 0;
        for (let x = 0; x < 240; x++) { const v = px[(y * 240 + x) * 2] << 8 | px[(y * 240 + x) * 2 + 1]; any |= v;        // panel byte order: high byte first
          rgb[(y * 240 + x) * 3] = (v >> 11) * 255 / 31; rgb[(y * 240 + x) * 3 + 1] = ((v >> 5) & 63) * 255 / 63; rgb[(y * 240 + x) * 3 + 2] = (v & 31) * 255 / 31; }
        if (any) rows.push(y); }
      png(path.join(out, name + '.png'), 240, 240, rgb);
      console.log(`${name}: picture rows ${rows[0]}..${rows[rows.length - 1]} (${rows.length} non-black rows)`);
    };
    (async () => {
      setInterval(() => M._fm1_web_audio(1024, 44100), 23);
      await sleep(1500); await tap(PLAY); await tap(PLAY); await tap(PLAY); await sleep(3500);
      shot('view0-150');
      await tap(SCL); await sleep(300); shot('view1-180-with-message');
      await tap(SCL); await sleep(300); shot('view2-full-with-message');
      await tap(SCL); await sleep(300); shot('view0-again');
      await sleep(4500); await tap(ENV); await sleep(200); shot('fps-message');
      await sleep(4500); await tap(LFO); await sleep(200); shot('link-message');
      console.log('DONE'); process.exit(0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = path.join(__dirname, 'build'); globalThis.__filename = path.join(__dirname, 'build', 'doom.js');
require('vm').runInThisContext(fs.readFileSync(path.join(__dirname, 'build', 'doom.js'), 'utf8'), { filename: 'doom.js' });
