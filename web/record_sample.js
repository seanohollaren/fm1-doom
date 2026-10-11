// Record four bars of E1M1 from the PROTOTYPE browser build (web/build-fm6) with one set of the prototype's
// settings, always the same four bars of the song (bars 5 to 8), so that takes can be compared.
//   node web/record_sample.js OUT.wav PATTERN KIT LEVEL DIP PATCH
// PATTERN 0 off, 1 .. 8 the machine's patterns, 9 the song's own drum part; KIT 0 .. 12 (8 .. 12 are on Felucca's
// limiter); LEVEL 1 .. 5 (3 is the kit's own); DIP 1 .. 5 (4 is the kit's own, 1 none; on a limiter kit it is how
// hard the music goes in: x0.7, x1, x1.4, x2, x2.8); PATCH 0 the game's own music, 1 .. 8 Felucca's FM patches.
const path = require('path'), fs = require('fs'), B = path.join(__dirname, 'build-fm6');
const [out, pattern, kit, level, dip, patch] = [process.argv[2], ...process.argv.slice(3).map(Number)];
const BAR = 4 * 8400 / 110, FROM = 4 * BAR, TO = 8 * BAR;                  // ticks of the music (1/140 s) at 110 beats a minute
globalThis.Module = {
  locateFile: f => path.join(B, f), print: () => {},
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, SEQ = 1 << 9, ARP = 1 << 8, SAVE = 1 << 7, PRESETS = 2;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(120); M._fm1_web_panel(0, 0); await sleep(120); };
    let tape = null;
    setInterval(() => { const p = M._fm1_web_audio(1024, 44100) >> 1; if (tape) for (let i = 0; i < 2048; i += 2) tape.push(M.HEAP16[p + i]); }, 23);
    (async () => {
      await sleep(1500);                                                    // the title: the settings are made here, before the song
      for (let i = 0; i < pattern; i++) await tap(SEQ);
      for (let i = 0; i < kit; i++) await tap(ARP);
      for (let i = 0; i < (3 - level + 5) % 5; i++) await tap(SAVE);        // each press a step quieter, from 3
      for (let i = 0; i < (4 - dip + 5) % 5; i++) M._fm1_drums_dip_next();  // each a step less, from 4
      if (patch) { M._fm1_web_enc(PRESETS, patch); await sleep(200); }
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
