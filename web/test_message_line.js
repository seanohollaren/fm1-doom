// Headless check, in the browser build, of the large message line: every message the knobs and buttons can make,
// with all 128 of the game's instrument names, fits in three lines of the game's own font at twice its size; the
// letters land where they should on the panel and nowhere else; and the message goes away again.
//   node web/test_message_line.js
const path = require('path');
globalThis.Module = {
  locateFile: f => path.join(__dirname, 'build', f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, B = n => 1 << n, PLAY = B(10), SCL = B(1), ENV = B(2), EDIT = B(4), GLO = B(5);
    const ALGORITHM = 1, PRESETS = 2, K1 = 3, K2 = 4, K3 = 5, K4 = 6;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(120); M._fm1_web_panel(0, 0); await sleep(120); };
    const turn = async (knob, steps) => { M._fm1_web_enc(knob, steps); await sleep(90); };
    // the panel as RGB, a row at a time
    const panel = () => { const p = M._fm1_web_lcd(), px = M.HEAPU8.subarray(p, p + 240 * 240 * 2), out = new Uint16Array(240 * 240);
      for (let i = 0; i < 240 * 240; i++) out[i] = px[2 * i] << 8 | px[2 * i + 1]; return out; };
    let bad = 0;
    const check = (name, ok, more = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${more ? ': ' + more : ''}`); };
    (async () => {
      setInterval(() => M._fm1_web_audio(1024, 44100), 23);
      await sleep(1500); await tap(PLAY); await sleep(300); await tap(PLAY); await sleep(300); await tap(PLAY); await sleep(3500);
      check('nothing is shown until something is turned', M._fm1_web_osd() === 0);

      // ---- every instrument name
      const lines = [0, 0, 0, 0]; let clipped = [], silent = 0;
      for (let n = 1; n <= 128; n++) {
        await turn(PRESETS, 1);
        const v = M._fm1_web_osd();
        if (!v) silent++; else { lines[Math.min(3, v & 255)]++; if (v >> 8) clipped.push(n); }
      }
      check('each of the 128 instruments is named in one to three lines, all of it fitting', !silent && !clipped.length && lines[0] === 0,
        `${lines[1]} in one line, ${lines[2]} in two, ${lines[3]} in three${clipped.length ? '; not fitting: ' + clipped.join(', ') : ''}`);

      // ---- every other message
      const said = [];
      const say = async (name, act) => { await act(); const v = M._fm1_web_osd(); said.push(`${name} ${v & 255}${v >> 8 ? ' CLIPPED' : ''}`); return v > 0 && !(v >> 8) && (v & 255) <= 3; };
      let ok = true;
      ok &= await say('instrument off', () => turn(PRESETS, -128));
      ok &= await say('low-pass', () => turn(K1, -22));
      ok &= await say('high-pass', async () => { await turn(K1, 22); await turn(K1, 40); });
      ok &= await say('filter off', async () => { await turn(K1, -40); });
      ok &= await say('resonance', () => turn(K2, 1));
      ok &= await say('depth up', () => turn(ALGORITHM, 8));
      ok &= await say('depth down', () => turn(ALGORITHM, -11));
      ok &= await say('depth at rest', () => turn(ALGORITHM, 3));
      ok &= await say('pitch', () => turn(K3, -12));
      ok &= await say('tempo', () => turn(K4, 12));
      ok &= await say('second pair', () => tap(ENV));
      ok &= await say('envelope short', () => turn(K3, -6));
      ok &= await say('envelope long', () => turn(K3, 7));
      ok &= await say('envelope at rest', () => turn(K3, -1));
      ok &= await say('wobble, filter off', () => turn(K4, 2));
      ok &= await say('wobble off', () => turn(K4, -2));
      ok &= await say('first pair', () => tap(ENV));
      ok &= await say('all back', () => tap(EDIT));
      ok &= await say('frame rate', () => tap(GLO));
      check('every other message fits too', ok, said.join(', '));

      // ---- where the letters land: the picture with a three-line message against the picture without
      await sleep(3300);
      check('three seconds on, the message is gone', M._fm1_web_osd() === 0);
      await sleep(200);
      const clean = panel();
      await turn(PRESETS, 27);                                              // "MUSIC 27 * ELECTRIC GUITAR (CLEAN)"
      await sleep(150);
      const shown = M._fm1_web_osd(), lettered = panel();
      let n = 0, x0 = 240, x1 = -1, y0 = 240, y1 = -1, red = 0, pairs = 0;
      const TOP = 70;                                                       // rows of ceiling: nothing of the game's own moves up there
      for (let y = 0; y < TOP; y++) for (let x = 0; x < 240; x++) if (clean[y * 240 + x] !== lettered[y * 240 + x]) {
        const v = lettered[y * 240 + x];
        n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        if ((v >> 11) * 2 > ((v >> 5) & 63) && (v >> 11) > (v & 31)) red++;        // more red than green or blue
      }
      // each of the font's pixels is 2 x 2 on the panel: inside the text, every even/odd pair of pixels and of rows is alike
      for (let y = 4; y < 4 + 18 * (shown & 255); y += 2) for (let x = 4; x < 236; x += 2) {
        const a = lettered[y * 240 + x]; if (a === clean[y * 240 + x] && lettered[y * 240 + x + 1] === clean[y * 240 + x + 1]) continue;
        pairs += a === lettered[y * 240 + x + 1] && a === lettered[(y + 1) * 240 + x] && a === lettered[(y + 1) * 240 + x + 1] ? 0 : 1;
      }
      check('a three-line message changes only its own part of the picture\'s top: from 4 pixels in, 4 down, three lines of 16 rows, 18 apart',
        (shown & 255) === 3 && n > 800 && x0 >= 4 && x1 < 236 && y0 >= 4 && y1 < 4 + 2 * 18 + 16, `${n} pixels changed, columns ${x0}..${x1}, rows ${y0}..${y1}`);
      check('... in the font\'s reds, every pixel of the font as a 2 x 2 block', red > n * 0.9 && pairs === 0, `${red} of ${n} red; ${pairs} blocks uneven`);
      await sleep(3300);
      const after = panel();
      let left = 0; for (let i = 0; i < TOP * 240; i++) left += after[i] !== clean[i];
      check('... and when it goes, the picture under it is as it was', M._fm1_web_osd() === 0 && left === 0, `${left} pixels differ`);
      await tap(SCL); await sleep(200);
      check('the picture shape says its name the same way', (M._fm1_web_osd() & 255) >= 1 && !(M._fm1_web_osd() >> 8));
      console.log(bad ? `MESSAGE LINE IN THE GAME: FAILED (${bad})` : 'MESSAGE LINE IN THE GAME: PASSED');
      process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = path.join(__dirname, 'build'); globalThis.__filename = path.join(__dirname, 'build', 'doom.js');
require('vm').runInThisContext(require('fs').readFileSync(path.join(__dirname, 'build', 'doom.js'), 'utf8'), { filename: 'doom.js' });
