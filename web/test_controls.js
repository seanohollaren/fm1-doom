// Headless check of the keyboard layout in the browser build: start E1M1 through the panel model, hold each note
// key in turn and see what the player does (position and facing from Module._fm1_web_dump()).
//   node web/test_controls.js
const path = require('path');
let pose = null;
globalThis.Module = {
  locateFile: f => path.join(__dirname, 'build', f),
  print: s => {
    const m = /^player x (-?\d+) y (-?\d+) angle (\d+)/.exec(s);
    if (m) pose = { x: +m[1], y: +m[2], a: +m[3] };
    else if (/Error|error|panic/.test(s)) console.log('[game]', s);
  },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(120); M._fm1_web_panel(0, 0); await sleep(580); };
    const where = () => { pose = null; M._fm1_web_dump(); return pose; };
    // hold some note keys for a while; what changed: forward and right of where the player faced, and the turn
    // (angle in 256ths of a circle, counter-clockwise positive, 64 = north)
    const hold = async (keys, ms = 400) => {
      const a = where();
      M._fm1_web_panel(keys.reduce((m, k) => m | 1 << k, 0), 0); await sleep(ms);
      M._fm1_web_panel(0, 0); await sleep(1300);                          // until the player has slid to a stop
      const b = where(), t = a.a * Math.PI / 128, dx = b.x - a.x, dy = b.y - a.y;
      return { fwd: Math.round(dx * Math.cos(t) + dy * Math.sin(t)), right: Math.round(dx * Math.sin(t) - dy * Math.cos(t)), turn: ((b.a - a.a + 384) % 256) - 128 };
    };
    let bad = 0;
    const check = (name, got, ok) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: forward ${got.fwd} right ${got.right} turn ${got.turn}`); };
    const still = g => Math.abs(g.fwd) <= 2 && Math.abs(g.right) <= 2 && g.turn === 0;
    const off = v => Math.abs(v) <= 10;                                   // a little sideways is the room's walls
    (async () => {
      setInterval(() => M._fm1_web_audio(1024, 44100), 23);
      await sleep(1500); await tap(PLAY); await tap(PLAY); await tap(PLAY); await sleep(3000);
      if (!where()) { console.log('FAIL: no level'); process.exit(1); }
      let g;
      g = await hold([3]); check('G#3 forward', g, g.fwd > 30 && off(g.right) && g.turn === 0);
      const walked = g.fwd;
      g = await hold([2]); check('G3 back', g, g.fwd < -30 && off(g.right) && g.turn === 0);
      g = await hold([0]); check('F3 strafe left', g, g.right < -30 && off(g.fwd) && g.turn === 0);
      g = await hold([4]); check('A3 strafe right', g, g.right > 30 && off(g.fwd) && g.turn === 0);
      g = await hold([1]); check('F#3 turn left', g, g.turn > 8 && Math.abs(g.fwd) <= 2 && Math.abs(g.right) <= 2);
      g = await hold([5]); check('A#3 turn right', g, g.turn < -8 && Math.abs(g.fwd) <= 2 && Math.abs(g.right) <= 2);
      await hold([2]);                                                    // (back up: room to run)
      g = await hold([3, 25]); check('G#3 + F#5 runs', g, g.fwd > walked * 1.5);
      // keys that moved the player in the old layout, or doubled fire and use: nothing now
      for (const [k, name] of [[6, 'B3'], [7, 'C4'], [21, 'D5'], [23, 'E5']]) { g = await hold([k]); check(`${name} does nothing`, g, still(g)); }
      console.log(bad ? `FAILED (${bad})` : 'PASSED'); process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = path.join(__dirname, 'build'); globalThis.__filename = path.join(__dirname, 'build', 'doom.js');
require('vm').runInThisContext(require('fs').readFileSync(path.join(__dirname, 'build', 'doom.js'), 'utf8'), { filename: 'doom.js' });
