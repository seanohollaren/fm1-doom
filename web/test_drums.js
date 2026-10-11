// Headless check of the PROTOTYPE browser build's drum machine (FM6=1 web/build.sh -> web/build-fm6;
// firmware/fm1_drums.c): SEQ brings in a beat under the song and steps through the patterns, ARP through the
// kits. With a file name, also records them on E1M1, one after another, as a WAV.
//   node web/test_drums.js [OUT.wav]
const path = require('path'), fs = require('fs'), B = path.join(__dirname, 'build-fm6');
const out = process.argv[2];
globalThis.Module = {
  locateFile: f => path.join(B, f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, EDIT = 1 << 4, SEQ = 1 << 9, ARP = 1 << 8, PRESETS = 2, K4 = 6;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(150); M._fm1_web_panel(0, 0); await sleep(350); };
    const turn = async (knob, steps) => { M._fm1_web_enc(knob, steps); await sleep(200); };
    let heard = null; const tape = [];
    setInterval(() => { const p = M._fm1_web_audio(1024, 44100) >> 1; if (heard) for (let i = 0; i < 2048; i += 2) heard.push(M.HEAP16[p + i]); }, 23);
    // a while of the game: drum hits and the chip's own drum voices seen, against the music's ticks; and the sound
    const listen = async (ms, keep) => { heard = []; const h0 = M._fm1_drums_hits(), t0 = M._fm1_web_music(3, 0); let chipDrums = 0;
      for (let t = 0; t < ms; t += 40) { for (let i = 0, v; (v = M._fm1_web_music(0, i)) >= 0; i++) chipDrums += v >= 128; await sleep(40); }
      const a = heard; heard = null; if (keep) for (const v of a) tape.push(v);
      let peak = 0, sq = 0, clipped = 0; for (const v of a) { peak = Math.max(peak, Math.abs(v)); sq += v * v; clipped += Math.abs(v) >= 32767; }
      const ticks = M._fm1_web_music(3, 0) - t0, hits = M._fm1_drums_hits() - h0;
      return { rms: Math.sqrt(sq / a.length), peak, clipped: clipped / a.length, hits, ticks, perBar: hits / ticks * 16 * 2100 / 110, chipDrums }; };
    let bad = 0;
    const check = (name, ok, more = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${more ? ': ' + more : ''}`); };
    const show = l => `${l.hits} hits in ${l.ticks} ticks of the music = ${l.perBar.toFixed(1)} a bar; rms ${l.rms.toFixed(0)}, peak ${l.peak}`;
    (async () => {
      await sleep(1500); await tap(PLAY); await tap(PLAY); await tap(PLAY); await sleep(3000);
      const under = M._fm1_web_underruns();
      const own = await listen(6000, true);
      check('before SEQ: the chip plays the song\'s drums, the machine nothing', own.hits === 0 && own.chipDrums > 0, `rms ${own.rms.toFixed(0)}, peak ${own.peak}`);
      await tap(SEQ);
      const song = await listen(9000, true);
      check('SEQ once: the song\'s own drum part on the machine, the chip\'s drums silent', song.hits > 10 && song.chipDrums === 0, show(song));
      const want = [13, 10, 7], names = ['a rock beat', 'four on the floor', 'half time'], pats = [];
      for (let p = 0; p < 3; p++) {
        await tap(SEQ);
        const l = await listen(9000, true); pats.push(l);
        check(`SEQ again: ${names[p]}, ${want[p]} hits a bar of the song at 110 beats a minute`, Math.abs(l.perBar - want[p]) < 0.7 && l.chipDrums === 0 && l.clipped < 0.001, show(l));
      }
      await turn(K4, 12); await sleep(600);
      const fast = await listen(5000, false);
      check('the tempo knob at double speed: the drums double with the song (still 7 hits a bar)', Math.abs(fast.perBar - 7) < 0.7 && fast.hits > pats[2].hits * 0.8, show(fast));
      await turn(K4, -12); await tap(SEQ); await sleep(300);
      const offAgain = await listen(3000, false);
      check('SEQ past the last pattern: off, and the chip has its drums back', offAgain.hits === 0 && offAgain.chipDrums > 0);
      await tap(SEQ); await tap(SEQ); await tap(SEQ);                       // four on the floor
      for (let k = 1; k <= 5; k++) {
        await tap(ARP);
        const l = await listen(k === 1 || k === 3 ? 7000 : 2500, k === 1 || k === 3);
        check(`ARP: kit ${k} of 5 plays the same pattern`, Math.abs(l.perBar - 10) < 1.2 && l.rms > 300, show(l));
      }
      await tap(ARP);                                                       // Felucca's own kit again
      await turn(PRESETS, 3); await sleep(1500);                            // ... with its FM engine on the melody too
      const all = await listen(9000, true);
      check('with Felucca\'s FM engine on the melody as well: both play', all.hits > 10 && M._fm1_fm6_voices() > 0, show(all));
      await tap(EDIT); await sleep(2500);
      const back = await listen(3000, false);
      check('EDIT: the drums stop and the game\'s own music is back', back.hits === 0 && back.chipDrums > 0 && M._fm1_fm6_voices() === 0);
      check('no audio underruns', M._fm1_web_underruns() === under, `${M._fm1_web_underruns() - under}`);
      if (out) {
        const pcm = Buffer.alloc(tape.length * 2); tape.forEach((v, i) => pcm.writeInt16LE(v, i * 2));
        const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
        h.writeUInt16LE(1, 22); h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
        fs.writeFileSync(out, Buffer.concat([h, pcm]));
        console.log(`  wrote ${out}: ${(tape.length / 44100).toFixed(0)} s`);
      }
      console.log(bad ? `THE DRUM MACHINE IN THE GAME: FAILED (${bad})` : 'THE DRUM MACHINE IN THE GAME: PASSED');
      process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = B; globalThis.__filename = path.join(B, 'doom.js');
require('vm').runInThisContext(fs.readFileSync(path.join(B, 'doom.js'), 'utf8'), { filename: 'doom.js' });
