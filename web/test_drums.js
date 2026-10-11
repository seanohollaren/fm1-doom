// Headless check, in the browser build that has what the firmware has (web/build.sh), of the
// drum machine under the music (firmware/fm1_drums.c): KNOB 4 brings a beat in, off at the bottom; the hits keep
// to the song; the chip's own percussion is silent meanwhile; the limiter lifts the whole mix and never clips.
//   node web/test_drums.js
const path = require('path'), fs = require('fs'), B = path.join(__dirname, 'build');
// what each beat strikes in four bars (a crash at the start, a fill at the end where it has one), from the tables
const PATTERNS = [['double bass', 94], ['gallop', 92], ['thrash', 67], ['blast', 97], ['machine gun', 158], ['rock', 55], ['four on the floor', 40], ['half time', 29]];
const FOUR_BARS = 4 * 4 * 8400 / 110;                                       // ticks of the music (1/140 s) at 110 beats a minute
globalThis.Module = {
  locateFile: f => path.join(B, f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, EDIT = 1 << 4, SAVE = 1 << 7, PRESETS = 2, K4 = 6;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let heard = null, speed = 1;
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
    const listen = async ms => { heard = []; await sleep(ms); const a = heard; heard = null;
      let peak = 0, sq = 0, top = 0; for (const v of a) { peak = Math.max(peak, Math.abs(v)); sq += v * v; top += Math.abs(v) >= 32767; }
      return { rms: Math.sqrt(sq / a.length), peak, top: top / a.length }; };
    const panel = () => { const p = M._fm1_web_lcd(); return Buffer.from(M.HEAPU8.subarray(p, p + 240 * 240 * 2)); };
    let bad = 0;
    const check = (name, ok, more = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${more ? ': ' + more : ''}`); };
    (async () => {
      // at the title first: the tune there ends on a long note, under which the steps once overran the music's
      // callback queue (10 entries) and the game stopped with a memory fault a little later
      await sleep(1500);
      await turn(K4, 5);                                                    // machine gun: a hit on every step
      const h0 = hits(); await sleep(9000); const title = hits() - h0;
      await turn(K4, -5);
      check('a beat on at the title, through the tune\'s long last note: the drums play to its end (about 5 s) and the game goes on', title > 50, `${title} hits`);
      await tap(PLAY); await tap(PLAY); await tap(PLAY); await sleep(3000);
      const own = await listen(3000), before = await count(4);
      check('KNOB 4 at the bottom: the chip plays the song\'s drums, the machine nothing', before.hits === 0 && before.chip > 0, `rms ${own.rms.toFixed(0)}, peak ${own.peak}`);
      for (const [name, want] of PATTERNS) {
        await turn(K4, 1);
        const said = M._fm1_web_osd(), c = await count(8);
        check(`KNOB 4, a click up: ${name}, ${want} hits in four bars of the song, the chip's drums silent, its name on the screen`,
          Math.abs(c.hits - 2 * want) <= 6 && c.chip === 0 && (said & 255) >= 1 && !(said >> 8), `${c.hits} in eight bars (${c.ticks} ticks)`);
      }
      await turn(K4, 5);
      const top = await count(4);
      check('KNOB 4 past the top stays on the last beat', Math.abs(top.hits - 29) <= 4, `${top.hits} hits in four bars`);
      await turn(K4, -7);                                                   // double bass
      await sleep(1500);                                                    // (the fast counting above starved the sound: let it settle)
      const under = M._fm1_web_underruns();
      const loud = await listen(6000);
      check('double bass over the music: the whole mix through the limiter, louder than twice the music alone, and no flat tops', loud.rms > own.rms * 2 && loud.rms < own.rms * 7 && loud.top < 0.0005,
        `rms ${loud.rms.toFixed(0)} against ${own.rms.toFixed(0)}, peak ${loud.peak}`);
      check('no audio underruns while listening at the game\'s own speed', M._fm1_web_underruns() === under, `${M._fm1_web_underruns() - under}`);
      await turn(PRESETS, 3); await sleep(1500);                            // ... with RAVE on the melody too
      const all = await count(4);
      check('with the synth on the melody as well: both play', Math.abs(all.hits - 94) <= 6 && M._fm1_fm6_voices() > 0, `${all.hits} hits, ${M._fm1_fm6_voices()} lines sounding`);
      const dark = panel(); await tap(SAVE); await sleep(600); const lit = panel();
      let changed = 0; for (let y = 0; y < 12; y++) for (let x = 2 * 216; x < 480; x++) changed += dark[y * 480 + x] !== lit[y * 480 + x];
      await tap(SAVE);
      check('SAVE puts the engine\'s frames-a-second count in the picture\'s top right corner', changed > 20, `${changed} bytes of that corner changed`);
      await tap(EDIT); await sleep(1500);
      const back = await count(4), rest = await listen(3000);
      check('EDIT: the drums stop, the game\'s own music is back and at its own level', back.hits === 0 && back.chip > 0 && M._fm1_fm6_voices() === 0 && rest.rms > own.rms * 0.4 && rest.rms < own.rms * 1.7,
        `rms ${rest.rms.toFixed(0)} against ${own.rms.toFixed(0)}`);
      console.log(bad ? `THE DRUM MACHINE IN THE GAME: FAILED (${bad})` : 'THE DRUM MACHINE IN THE GAME: PASSED');
      process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = B; globalThis.__filename = path.join(B, 'doom.js');
require('vm').runInThisContext(fs.readFileSync(path.join(B, 'doom.js'), 'utf8'), { filename: 'doom.js' });
