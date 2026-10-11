// Headless check of the PROTOTYPE browser build in which Felucca's six-operator FM engine plays the music's
// melodic notes (FM6=1 web/build.sh -> web/build-fm6; firmware/fm1_fm6.c). PRESETS 1 .. 8 are its factory
// patches. With a file name, also records what each sounds like on E1M1, one after another, as a WAV.
//   node web/test_fm6.js [OUT.wav]
const path = require('path'), fs = require('fs'), B = path.join(__dirname, 'build-fm6');
const SECONDS = 7, out = process.argv[2];
globalThis.Module = {
  locateFile: f => path.join(B, f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, EDIT = 1 << 4, PRESETS = 2, K3 = 5;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(150); M._fm1_web_panel(0, 0); await sleep(350); };
    const turn = async (knob, steps) => { M._fm1_web_enc(knob, steps); await sleep(200); };
    let heard = null; const tape = [];
    setInterval(() => { const p = M._fm1_web_audio(1024, 44100) >> 1; if (heard) for (let i = 0; i < 2048; i += 2) heard.push(M.HEAP16[p + i]); }, 23);
    const listen = async (ms, keep) => { heard = []; let most = 0, chip = new Set();
      for (let t = 0; t < ms; t += 40) { most = Math.max(most, M._fm1_fm6_voices()); for (let i = 0, v; (v = M._fm1_web_music(0, i)) >= 0; i++) chip.add(v < 128 ? 'melodic' : 'drums'); await sleep(40); }
      const a = heard; heard = null; if (keep) for (const v of a) tape.push(v);
      let peak = 0, sq = 0, clipped = 0; for (const v of a) { peak = Math.max(peak, Math.abs(v)); sq += v * v; clipped += Math.abs(v) >= 32767; }
      return { rms: Math.sqrt(sq / a.length), peak, clipped, most, chip: [...chip].sort().join('+') || 'nothing' }; };
    let bad = 0;
    const check = (name, ok, more = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${more ? ': ' + more : ''}`); };
    (async () => {
      await sleep(1500); await tap(PLAY); await tap(PLAY); await tap(PLAY); await sleep(3000);
      const under = M._fm1_web_underruns();
      const own = await listen(SECONDS * 1000, true);
      check('the music as the game has it: the chip plays the melody, the engine nothing', own.most === 0 && own.chip.includes('melodic'), `rms ${own.rms.toFixed(0)}, peak ${own.peak}; chip: ${own.chip}`);
      for (let n = 1; n <= 8; n++) {
        await turn(PRESETS, 1); await sleep(1200);
        const l = await listen(SECONDS * 1000, true);
        check(`PRESETS ${n}: the engine plays the melody (up to six voices), the chip only drums`, l.most >= 2 && l.most <= 6 && !l.chip.includes('melodic') && l.rms > 150 && !l.clipped,
          `rms ${l.rms.toFixed(0)}, peak ${l.peak}, ${l.most} voices at most; chip: ${l.chip}`);
      }
      await turn(PRESETS, 1); await sleep(2500);
      const ninth = await listen(3000, false);
      check('PRESETS 9: the game\'s first instrument, on the chip again; the engine falls silent', ninth.chip.includes('melodic') && M._fm1_fm6_voices() === 0, `chip: ${ninth.chip}`);
      await turn(PRESETS, -6); await turn(K3, 12); await sleep(1500);       // patch 3, an octave up
      const up = await listen(2500, false);
      await tap(EDIT); await sleep(2500);
      const back = await listen(3000, false);
      check('the pitch knob still works on it, and EDIT brings the game\'s own music back', up.most >= 1 && back.most === 0 && back.chip.includes('melodic'), `chip: ${back.chip}`);
      check('no audio underruns', M._fm1_web_underruns() === under, `${M._fm1_web_underruns() - under}`);
      if (out) {
        const pcm = Buffer.alloc(tape.length * 2); tape.forEach((v, i) => pcm.writeInt16LE(v, i * 2));
        const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
        h.writeUInt16LE(1, 22); h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
        fs.writeFileSync(out, Buffer.concat([h, pcm]));
        console.log(`  wrote ${out}: ${(tape.length / 44100).toFixed(0)} s, the game's own music then the eight patches, about ${SECONDS} s each`);
      }
      console.log(bad ? `FELUCCA'S ENGINE IN THE GAME: FAILED (${bad})` : "FELUCCA'S ENGINE IN THE GAME: PASSED");
      process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = B; globalThis.__filename = path.join(B, 'doom.js');
require('vm').runInThisContext(fs.readFileSync(path.join(B, 'doom.js'), 'utf8'), { filename: 'doom.js' });
