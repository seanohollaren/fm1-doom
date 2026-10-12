// Record four bars of E1M1 from the browser build (web/build) with a drum beat and a sound chosen, always the same
// four bars of the song (bars 5 to 8), so that takes can be compared.
//   node web/record_sample.js OUT.wav BEAT SOUND
// BEAT 0 off, 1 .. 8 the drum machine's beats (KNOB 4); SOUND 0 the game's own music, 1 .. 3 the synth's sounds
// (SAW LEAD, ACID, RAVE), 4 .. 131 the game's instruments on every part (PRESETS).
const path = require('path'), fs = require('fs'), B = path.join(__dirname, 'build');
const [out, beat, sound] = [process.argv[2], ...process.argv.slice(3).map(Number)];
const BAR = 4 * 8400 / 110, FROM = 4 * BAR, TO = 8 * BAR;                  // ticks of the music (1/140 s) at 110 beats a minute
globalThis.Module = {
  locateFile: f => path.join(B, f), print: () => {},
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, PRESETS = 2, K4 = 6;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(120); M._fm1_web_panel(0, 0); await sleep(120); };
    let tape = null;
    setInterval(() => { const p = M._fm1_web_audio(1024, 44100) >> 1; if (tape) for (let i = 0; i < 2048; i += 2) tape.push(M.HEAP16[p + i]); }, 23);
    (async () => {
      await sleep(1500);                                                    // the title: the settings are made here, before the song
      if (beat) { M._fm1_web_enc(K4, beat); await sleep(200); }
      if (sound) { M._fm1_web_enc(PRESETS, sound); await sleep(200); }
      await tap(PLAY); await sleep(250); await tap(PLAY); await sleep(250); await tap(PLAY);
      for (let i = 0; M._fm1_web_awake() < 0; i++) { if (i > 300) { console.log('no level'); process.exit(1); } await sleep(50); }
      let pos = M._fm1_web_music(8, 0), guard = 0;
      while (pos > BAR && guard++ < 400) { await sleep(10); pos = M._fm1_web_music(8, 0); }      // the level's song has begun
      while (M._fm1_web_music(8, 0) < FROM) await sleep(4);
      tape = [];
      while (M._fm1_web_music(8, 0) < TO) await sleep(4);
      const a = tape; tape = null;
      const pcm = Buffer.alloc(a.length * 2); a.forEach((v, i) => pcm.writeInt16LE(v, i * 2));
      const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
      h.writeUInt16LE(1, 22); h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
      fs.writeFileSync(out, Buffer.concat([h, pcm]));
      let peak = 0, sq = 0; for (const v of a) { peak = Math.max(peak, Math.abs(v)); sq += v * v; }
      console.log(`${path.basename(out)}: ${(a.length / 44100).toFixed(1)} s, rms ${Math.sqrt(sq / a.length).toFixed(0)}, peak ${peak}, underruns ${M._fm1_web_underruns()}`);
      process.exit(0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = B; globalThis.__filename = path.join(B, 'doom.js');
require('vm').runInThisContext(fs.readFileSync(path.join(B, 'doom.js'), 'utf8'), { filename: 'doom.js' });
