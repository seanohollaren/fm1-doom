// Headless check of the filter in the browser build under Node: start a level, listen to the game's own sound with the
// filter off, swept left (low-pass), off again, swept right (high-pass), and compare how much top and bottom there is.
//   node web/test_filter.js
const path = require('path');
globalThis.Module = {
  locateFile: f => path.join(__dirname, 'build', f),
  print: () => {},
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, EDIT = 1 << 4, K1 = 3, K2 = 4;
    const tap = (t, notes, buttons) => { setTimeout(() => M._fm1_web_panel(notes, buttons), t); setTimeout(() => M._fm1_web_panel(0, 0), t + 120); };
    tap(1500, 0, PLAY); tap(2200, 0, PLAY); tap(2900, 0, PLAY);          // menu, NEW GAME, skill: the level and its music
    // listen as the page does; per phase: total energy, "top" (energy of the sample-to-sample differences),
    // "bottom" (energy of a 64-sample running mean)
    let acc = null;
    setInterval(() => {
      const p = M._fm1_web_audio(1024, 44100) >> 1;
      if (!acc) return;
      for (let i = 0; i < 1024; i++) {
        const s = M.HEAP16[p + 2 * i];
        acc.total += s * s; acc.top += (s - acc.prev) ** 2; acc.prev = s;
        acc.sum += s - acc.ring[acc.at]; acc.ring[acc.at] = s; acc.at = (acc.at + 1) & 63;
        acc.bottom += (acc.sum / 64) ** 2; acc.n++;
      }
    }, 23);
    const phases = [];
    const listen = (name, ms) => new Promise((done) => {
      acc = { total: 0, top: 0, bottom: 0, prev: 0, sum: 0, ring: new Float64Array(64), at: 0, n: 0 };
      setTimeout(() => { const a = acc; acc = null; phases.push({ name, n: a.n, level: Math.sqrt(a.total / a.n), top: a.top / a.total, bottom: a.bottom / a.total }); done(); }, ms);
    });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await wait(6000);
      const under0 = M._fm1_web_underruns();          // (some at start-up, before the level's sound begins: not counted)
      await listen('off', 5000);
      M._fm1_web_enc(K1, -30); await wait(400); await listen('low-pass at 185 Hz', 5000);
      tap(0, 0, EDIT); await wait(400); await listen('off again (EDIT)', 5000);
      M._fm1_web_enc(K1, 30); await wait(400); await listen('high-pass at 2460 Hz', 5000);
      M._fm1_web_enc(K1, -60); await wait(400); await listen('knob spun back through the centre: it stops at off', 3000);
      for (const p of phases) console.log(`  ${p.name.padEnd(52)} level ${p.level.toFixed(0).padStart(5)}  top ${p.top.toFixed(4)}  bottom ${p.bottom.toFixed(4)}  (${p.n} samples)`);
      const [off, lp, off2, hp, stop] = phases;
      const checks = [
        ['the game is making sound', off.level > 100 && off2.level > 100],
        ['low-pass: the top of the sound is cut to under a tenth', lp.top < off.top / 10 && lp.top < off2.top / 10],
        ['high-pass: the bottom of the sound is cut to under a tenth', hp.bottom < off.bottom / 10 && hp.bottom < off2.bottom / 10],
        ['off again sounds like off (top and bottom within a factor of two of the first listen)',
          off2.top > off.top / 2 && off2.top < off.top * 2 && off2.bottom > off.bottom / 2 && off2.bottom < off.bottom * 2],
        ['spun from the right back across the centre, the knob stops at off', stop.bottom > hp.bottom * 5],
        [`no audio underruns while listening (${M._fm1_web_underruns() - under0})`, M._fm1_web_underruns() - under0 === 0],
      ];
      let bad = 0;
      for (const [name, ok] of checks) { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`); bad += !ok; }
      console.log(bad ? 'FILTER IN THE GAME: FAILED' : 'FILTER IN THE GAME: PASSED');
      process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = path.join(__dirname, 'build'); globalThis.__filename = path.join(__dirname, 'build', 'doom.js');
require('vm').runInThisContext(require('fs').readFileSync(path.join(__dirname, 'build', 'doom.js'), 'utf8'), { filename: 'doom.js' });
