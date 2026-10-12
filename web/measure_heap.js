// How much of the game's heap E1M1 leaves free in the browser build (whose heap, rp2040-doom src/fm1/fm1_web_ram.c,
// is kept a little under what the FM-1's linker leaves): the least seen while a scripted player runs about and shoots.
//   node web/measure_heap.js [SECONDS] [BUILD_DIR]
const path = require('path'), B = path.join(__dirname, process.argv[3] || 'build'), SECONDS = +(process.argv[2] || 60);
globalThis.Module = {
  locateFile: f => path.join(B, f), print: () => {},
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(120); M._fm1_web_panel(0, 0); await sleep(120); };
    setInterval(() => M._fm1_web_audio(1024, 44100), 23);
    (async () => {
      await sleep(1500);
      const title = M._fm1_web_heap_free();
      await tap(PLAY); await sleep(250); await tap(PLAY); await sleep(250); await tap(PLAY); await sleep(3000);
      let least = M._fm1_web_heap_free(); const start = least;
      // keys: 1 turn left, 3 forward, 5 turn right, 24 fire, 26 use (fm1_controls.c)
      const moves = [[3, 24], [5, 24], [3], [1, 3], [3, 26], [5], [3, 24], [1, 24], [3, 5, 24], [26]];
      for (let t = 0, i = 0; t < SECONDS * 1000; t += 400, i++) {
        const keys = moves[(i * 7 + (i >> 3)) % moves.length].reduce((m, k) => m | (1 << k), 0);
        M._fm1_web_panel(keys, 0); await sleep(400);
        least = Math.min(least, M._fm1_web_heap_free());
      }
      M._fm1_web_panel(0, 0);
      console.log(`heap free: at the title ${title}, at the start of E1M1 ${start}, the least in ${SECONDS} s of play ${least} (this build's heap: rp2040-doom src/fm1/fm1_web_ram.c)`);
      process.exit(0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = B; globalThis.__filename = path.join(B, 'doom.js');
require('vm').runInThisContext(require('fs').readFileSync(path.join(B, 'doom.js'), 'utf8'), { filename: 'doom.js' });
