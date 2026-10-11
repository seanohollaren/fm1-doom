// Headless check of the PROTOTYPE browser build's drum machine (FM6=1 web/build.sh -> web/build-fm6;
// firmware/fm1_drums.c): SEQ brings in a beat under the song and steps through the patterns, ARP through the
// kits. With a file name, also records a tour of them on E1M1 as a WAV.
//   node web/test_drums.js [OUT.wav]
const path = require('path'), fs = require('fs'), B = path.join(__dirname, 'build-fm6');
const out = process.argv[2];
// what each pattern strikes in four bars (a crash at the start, a fill at the end where it has one), from the tables
const PATTERNS = [['double bass', 94], ['gallop', 92], ['thrash', 67], ['blast', 97], ['machine gun', 158], ['rock', 55], ['four on the floor', 40], ['half time', 29]];
const FOUR_BARS = 4 * 4 * 8400 / 110;                                       // ticks of the music (1/140 s) at 110 beats a minute
const KITS = 13;                                                            // two made here, Felucca's six, five on Felucca's own chain
globalThis.Module = {
  locateFile: f => path.join(B, f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, EDIT = 1 << 4, SEQ = 1 << 9, ARP = 1 << 8, SAVE = 1 << 7, PRESETS = 2, K4 = 6;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let heard = null, speed = 1; const tape = [];
    // the sound is pulled as the page pulls it (1024 frames about every 23 ms), or `speed` times as fast to save time
    setInterval(() => { for (let n = 0; n < speed; n++) { const p = M._fm1_web_audio(1024, 44100) >> 1; if (heard) for (let i = 0; i < 2048; i += 2) heard.push(M.HEAP16[p + i]); } }, 23);
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(150); M._fm1_web_panel(0, 0); await sleep(250); };
    const turn = async (knob, steps) => { M._fm1_web_enc(knob, steps); await sleep(200); };
    const ticks = () => M._fm1_web_music(3, 0), hits = () => M._fm1_drums_hits();
    const chipDrums = () => { let n = 0; for (let i = 0, v; (v = M._fm1_web_music(0, i)) >= 0; i++) n += v >= 128; return n; };
    // hits over `bars` bars of the song, counted from a four-bar line, with the game running fast
    const count = async bars => { speed = 4;
      for (let last = ticks() % FOUR_BARS; ; ) { await sleep(10); const now = ticks() % FOUR_BARS; if (now < last) break; last = now; }
      const t0 = ticks(), h0 = hits(); let chip = 0;
      while (ticks() - t0 < bars / 4 * FOUR_BARS) { chip += chipDrums(); await sleep(10); }
      speed = 1; return { hits: hits() - h0, ticks: ticks() - t0, chip }; };
    const listen = async (ms, keep) => { heard = []; await sleep(ms); const a = heard; heard = null; if (keep) for (const v of a) tape.push(v);
      let peak = 0, sq = 0, top = 0; for (const v of a) { peak = Math.max(peak, Math.abs(v)); sq += v * v; top += Math.abs(v) >= 32767; }
      return { rms: Math.sqrt(sq / a.length), peak, top: top / a.length }; };
    let bad = 0;
    const check = (name, ok, more = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${more ? ': ' + more : ''}`); };
    (async () => {
      // at the title first: the tune there ends on a long note, under which the steps once overran the music's
      // callback queue (10 entries) and the game stopped with a memory fault a little later
      await sleep(1500);
      for (let i = 0; i < 5; i++) await tap(SEQ);                           // machine gun: a hit on every step
      const h0 = hits(); await sleep(9000); const title = hits() - h0;
      for (let i = 0; i < 5; i++) await tap(SEQ);                           // ... round to off
      check('a pattern on at the title, through the tune\'s long last note: the drums play to its end (about 5 s) and the game goes on', title > 50, `${title} hits`);
      await tap(PLAY); await tap(PLAY); await tap(PLAY); await sleep(3000);
      const own = await listen(3000, false), before = await count(4);
      check('before SEQ: the chip plays the song\'s drums, the machine nothing', before.hits === 0 && before.chip > 0, `rms ${own.rms.toFixed(0)}, peak ${own.peak}`);
      for (const [name, want] of PATTERNS) {
        await tap(SEQ);
        const c = await count(8);
        check(`SEQ: ${name}, ${want} hits in four bars of the song, the chip's drums silent`, Math.abs(c.hits - 2 * want) <= 6 && c.chip === 0, `${c.hits} in eight bars (${c.ticks} ticks)`);
      }
      await tap(SEQ);
      const song = await count(8);
      check('SEQ: the song\'s own drum part on the machine', song.hits > 40 && song.chip === 0, `${song.hits} hits in eight bars`);
      await tap(SEQ);
      const off = await count(4);
      check('SEQ past the last: off, and the chip has its drums back', off.hits === 0 && off.chip > 0);
      await tap(SEQ);                                                       // double bass again
      await turn(K4, 12); await sleep(500);
      const fast = await count(8);
      check('the tempo knob at double speed: the drums keep to the song (the same hits in eight bars)', Math.abs(fast.hits - 188) <= 6, `${fast.hits}`);
      await turn(K4, -12);
      for (let k = 1; k < KITS; k++) {
        await tap(ARP);
        const c = await count(4), l = await listen(1500, false);
        check(`ARP: kit ${k + 1} of ${KITS} plays the same pattern`, Math.abs(c.hits - 94) <= 6 && l.rms > 300, `${c.hits} hits; rms ${l.rms.toFixed(0)}, peak ${l.peak}`);
      }
      // the last five kits go through Felucca's master limiter with the music, which goes in at twice its level
      await sleep(1500);
      const slam = await listen(5000, false);
      check('a kit on the limiter (the last): the whole mix louder than twice the music alone, and no flat tops', slam.rms > own.rms * 2 && slam.top < 0.0005, `rms ${slam.rms.toFixed(0)} against ${own.rms.toFixed(0)}, peak ${slam.peak}`);
      const pushes = [0, 1, 2, 3, 4].map(() => M._fm1_drums_dip_next());    // (the M key there: how hard the music goes in; round to where it was)
      for (let i = 0; i < 9; i++) await tap(SEQ);                           // the patterns round to off
      await sleep(500);
      const rest = await listen(3000, false);
      check('... and with the drums off, the music is back at its own level', pushes.join() === '2,1,0,4,3' && rest.rms > own.rms * 0.4 && rest.rms < own.rms * 1.7, `rms ${rest.rms.toFixed(0)} against ${own.rms.toFixed(0)}`);
      await tap(SEQ);                                                       // double bass again
      await tap(ARP);                                                       // the metal kit again
      await sleep(1500);                                                    // (the fast counting above starved the sound: let it settle)
      const under = M._fm1_web_underruns();
      const loud = await listen(6000, false);
      check('the metal kit over the music: well above the music alone, and no flat tops', loud.rms > own.rms * 1.5 && loud.rms < own.rms * 6 && loud.top < 0.0005, `rms ${loud.rms.toFixed(0)} against ${own.rms.toFixed(0)}, peak ${loud.peak}`);
      const levels = [loud.rms];
      for (let i = 0; i < 4; i++) { await tap(SAVE); levels.push((await listen(2500, false)).rms); }   // 2, 1, 5, 4 of 5
      await tap(SAVE);                                                      // the middle again
      check('SAVE: five loudnesses against the music, quieter twice, then round to the loudest', levels[1] < levels[0] && levels[2] < levels[1] && levels[3] > levels[0] && levels[4] < levels[3] && levels[4] > levels[0],
        levels.map(v => v.toFixed(0)).join(', '));
      const dips = [0, 1, 2, 3, 4].map(() => M._fm1_drums_dip_next());
      check('the page\'s M key: the music dips a step less each time (4 of 5 at the start), then round to the most', dips.join() === '2,1,0,4,3', dips.map(d => d + 1).join(', '));
      check('no audio underruns while listening at the game\'s own speed', M._fm1_web_underruns() === under, `${M._fm1_web_underruns() - under}`);
      await turn(PRESETS, 3); await sleep(1500);                            // ... with Felucca's FM engine on the melody too
      const all = await count(4);
      check('with Felucca\'s FM engine on the melody as well: both play', Math.abs(all.hits - 94) <= 6 && M._fm1_fm6_voices() > 0);
      await tap(EDIT); await sleep(1500);
      const back = await count(4);
      check('EDIT: the drums stop and the game\'s own music is back', back.hits === 0 && back.chip > 0 && M._fm1_fm6_voices() === 0);
      if (out) {                                                            // a tour, in real time
        const say = [];
        const part = async (what, ms) => { say.push(`${what} ${Math.round(tape.length / 44100)} s`); await listen(ms, true); };
        await part('the game\'s own', 5000);
        await tap(SEQ); await part('double bass (metal kit)', 10000);
        await tap(SEQ); await part('gallop', 9000);
        await tap(SEQ); await part('thrash', 9000);
        await tap(SEQ); await part('blast', 8000);
        await tap(SEQ); await part('machine gun', 8000);
        await tap(SEQ); await tap(ARP); await part('rock (punch kit)', 9000);
        await tap(SEQ); await part('four on the floor (punch kit)', 8000);
        await tap(SEQ); await tap(SEQ); for (let k = 1; k < KITS; k++) await tap(ARP); await part('the song\'s own part (metal kit)', 9000);
        const pcm = Buffer.alloc(tape.length * 2); tape.forEach((v, i) => pcm.writeInt16LE(v, i * 2));
        const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
        h.writeUInt16LE(1, 22); h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
        fs.writeFileSync(out, Buffer.concat([h, pcm]));
        console.log(`  wrote ${out}: ${(tape.length / 44100).toFixed(0)} s: ${say.join(', ')}`);
      }
      console.log(bad ? `THE DRUM MACHINE IN THE GAME: FAILED (${bad})` : 'THE DRUM MACHINE IN THE GAME: PASSED');
      process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = B; globalThis.__filename = path.join(B, 'doom.js');
require('vm').runInThisContext(fs.readFileSync(path.join(B, 'doom.js'), 'utf8'), { filename: 'doom.js' });
