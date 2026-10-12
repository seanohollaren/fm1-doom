// What the sound work costs in the browser build, part by part: the emulated sound chip, the synth, the drum
// machine with its limiter, as time spent a second of sound made, with E1M1 playing: nothing chosen, a sound, a
// beat, both. Times are this machine's and this build's (WebAssembly); what carries over to the FM-1 is how the
// parts compare with each other.
//   node web/measure_sound.js [SECONDS]
const path = require('path'), B = path.join(__dirname, 'build'), SECONDS = +(process.argv[2] || 15);
globalThis.Module = {
  locateFile: f => path.join(B, f), print: () => {},
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, PRESETS = 2, K4 = 6;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(120); M._fm1_web_panel(0, 0); await sleep(120); };
    setInterval(() => M._fm1_web_audio(1024, 44100), 23);
    const measure = async name => { await sleep(2500); M._fm1_web_cost(-1); await sleep(SECONDS * 1000);
      const s = M._fm1_web_cost(3) / 49716, us = [0, 1, 2].map(i => M._fm1_web_cost(i) / s);
      console.log(`${name.padEnd(34)} chip ${us[0].toFixed(0).padStart(6)}  synth ${us[1].toFixed(0).padStart(6)}  drums ${us[2].toFixed(0).padStart(6)}  together ${(us[0] + us[1] + us[2]).toFixed(0).padStart(6)}   (microseconds a second of sound; ${s.toFixed(1)} s)`);
      return us; };
    (async () => {
      await sleep(1500); await tap(PLAY); await sleep(250); await tap(PLAY); await sleep(250); await tap(PLAY); await sleep(3000);
      const none = await measure('the game as it was');
      for (const [n, name] of [[1, 'SAW LEAD'], [2, 'ACID'], [3, 'RAVE']]) { M._fm1_web_enc(PRESETS, n === 1 ? 1 : 1); await measure(`PRESETS ${n} (${name})`); }
      M._fm1_web_enc(PRESETS, -3);
      M._fm1_web_enc(K4, 1); const beat = await measure('KNOB 4: double bass');
      M._fm1_web_enc(K4, 5); await measure('KNOB 4: rock');
      M._fm1_web_enc(K4, -5); M._fm1_web_enc(PRESETS, 3); const both = await measure('RAVE and double bass');
      const all = a => a[0] + a[1] + a[2];
      console.log(`against the game as it was: a beat ${(all(beat) / all(none)).toFixed(1)} times the sound work, RAVE and a beat ${(all(both) / all(none)).toFixed(1)} times`);
      process.exit(0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = B; globalThis.__filename = path.join(B, 'doom.js');
require('vm').runInThisContext(require('fs').readFileSync(path.join(B, 'doom.js'), 'utf8'), { filename: 'doom.js' });
