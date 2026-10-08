// Headless run of the browser build under Node: start a game through the panel model, optionally move the player,
// and log monster wake-ups and health.   node web/test_node.js [warpX warpY]
const path = require('path');
const [wx, wy] = process.argv.slice(2).map(Number);
globalThis.Module = {
  locateFile: f => path.join(__dirname, 'build', f),
  print: s => { if (/Error|error|panic|FM1/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10;
    const tap = (t, notes, buttons) => { setTimeout(() => M._fm1_web_panel(notes, buttons), t); setTimeout(() => M._fm1_web_panel(0, 0), t + 120); };
    tap(1500, 0, PLAY); tap(2200, 0, PLAY); tap(2900, 0, PLAY);          // menu, NEW GAME, skill
    if (!isNaN(wx)) setTimeout(() => console.log('warp', M._fm1_web_warp(wx, wy)), 5000);
    // consume audio as the page does (1024 frames about every 23 ms), so the mixer really runs; track the peak
    let peak = 0;
    setInterval(() => { const p = M._fm1_web_audio(1024, 44100) >> 1; for (let i = 0; i < 2048; i += 16) peak = Math.max(peak, Math.abs(M.HEAP16[p + i])); }, 23);
    let n = 0;
    setTimeout(() => { const t = setInterval(() => {
      const v = M._fm1_web_awake();
      console.log(`t=${n} awake=${Math.floor(v / 1000)} health=${v % 1000} frames=${M._fm1_web_frames()} audioPeak=${peak} underruns=${M._fm1_web_underruns()}`); peak = 0;
      if (n % 2 == 0) tap(0, 1 << 24, 0);                                 // F5: fire
      if (++n >= 14) { clearInterval(t); console.log('DONE'); process.exit(0); }
    }, 1000); }, 5500);
  },
};
// doom.js picks up a global `Module` only when it runs as a classic script
globalThis.require = require; globalThis.__dirname = path.join(__dirname, 'build'); globalThis.__filename = path.join(__dirname, 'build', 'doom.js');
require('vm').runInThisContext(require('fs').readFileSync(path.join(__dirname, 'build', 'doom.js'), 'utf8'), { filename: 'doom.js' });
