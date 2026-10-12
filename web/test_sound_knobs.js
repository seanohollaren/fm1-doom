// Headless check, in the browser build with E1M1's music playing, of the knobs that play with the music itself:
// PRESETS (instrument, after the synth's three sounds: web/test_synth.js), ALGORITHM (FM depth), KNOB 3 (pitch),
// and that KNOB 4 leaves the tempo alone (it picks the drum beat: web/test_drums.js); of ENV, which turns the four
// knobs into attack, decay, sustain and release, and LFO, which turns KNOB 1 into the filter's wobble, and back;
// and of EDIT, which puts all of it back.
//   node web/test_sound_knobs.js
const path = require('path');
globalThis.Module = {
  locateFile: f => path.join(__dirname, 'build', f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, EDIT = 1 << 4, ENV = 1 << 2, LFO = 1 << 3;
    const SELECT = 0, ALGORITHM = 1, PRESETS = 2, K1 = 3, K2 = 4, K3 = 5, K4 = 6;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(150); M._fm1_web_panel(0, 0); await sleep(350); };
    const turn = async (knob, steps) => { M._fm1_web_enc(knob, steps); await sleep(200); };
    // the sound is pulled as the page pulls it; while listening, the left channel is kept
    let heard = null;
    setInterval(() => { const p = M._fm1_web_audio(1024, 44100) >> 1; if (heard) for (let i = 0; i < 2048; i += 2) heard.push(M.HEAP16[p + i]); }, 23);
    const listen = async ms => {
      heard = []; await sleep(ms); const a = heard; heard = null;
      let peak = 0, sq = 0; for (const v of a) { peak = Math.max(peak, Math.abs(v)); sq += v * v; }
      // how much a level comes and goes: RMS over 23 ms pieces, loudest tenth against quietest tenth, in dB;
      // of the sound itself (swing) and of its top end alone, taken as the difference between samples (topSwing)
      const swing = of => { const pc = []; for (let i = 0; i + 1024 <= a.length; i += 1024) { let s = 0; for (let k = i + 1; k < i + 1024; k++) s += of(k) ** 2; pc.push(Math.sqrt(s / 1023)); }
        pc.sort((x, y) => x - y); return 20 * Math.log10((pc[Math.floor(pc.length * 0.9)] + 1) / (pc[Math.floor(pc.length * 0.1)] + 1)); };
      return { rms: Math.sqrt(sq / a.length), peak, swing: swing(k => a[k]), topSwing: swing(k => a[k] - a[k - 1]) };
    };
    // what the music's sounding melodic voices are doing, gathered over a while (fm1_music_probe in i_oplmusic.c)
    // inst: the instruments; mod: each instrument's modulator level; up: for each note seen, how many semitones
    // its frequency register lies above the note as written (an instrument's own offset, plus the pitch knob)
    const hz = f => (f & 1023) * 49716 / (1 << (20 - ((f >> 10) & 7)));     // an OPL frequency register as a pitch
    const voices = async ms => {
      const inst = new Set(), mod = new Map(), up = [];
      for (let t = 0; t < ms; t += 40) {
        for (let i = 0, v; (v = M._fm1_web_music(0, i)) >= 0; i++) if (v < 128) {
          inst.add(v); mod.set(v, M._fm1_web_music(2, i));
          up.push(Math.round(69 + 12 * Math.log2(hz(M._fm1_web_music(1, i)) / 440)) - M._fm1_web_music(4, i));
        }
        await sleep(40);
      }
      return { inst: [...inst].sort((a, b) => a - b), mod, up };
    };
    const all = (v, n) => v.up.length > 20 && v.up.filter(u => u === n).length >= v.up.length * 0.97;   // (a few notes are caught mid-bend)
    // where the filter is, watched for a while: lowest and highest position, in knob steps
    const filterIn = async ms => { let lo = 1e9, hi = -1e9; for (let t = 0; t < ms; t += 25) { const a = M._fm1_web_filter_at() / 256; lo = Math.min(lo, a); hi = Math.max(hi, a); await sleep(25); } return { lo, hi }; };
    const ticksIn = async ms => { const a = M._fm1_web_music(3, 0), t = Date.now(); await sleep(ms); return (M._fm1_web_music(3, 0) - a) * 1000 / (Date.now() - t); };
    let bad = 0;
    const check = (name, ok, more = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${more ? ': ' + more : ''}`); };
    (async () => {
      await sleep(1500); await tap(PLAY); await tap(PLAY); await tap(PLAY); await sleep(3000);
      const under = M._fm1_web_underruns();

      // ---- as written
      const written = await voices(5000), clean = await listen(4000), pace = await ticksIn(4000);
      const own = written.up[0];
      check('as written, E1M1 plays on several instruments, every note at its own pitch', written.inst.length >= 2 && all(written, own),
        `GENMIDI ${written.inst.join(', ')}; ${written.up.length} notes seen, ${own} semitones from note to register; ${pace.toFixed(0)} ticks a second`);
      const level = new Map(written.mod);                                   // each instrument's modulator level as written

      // ---- PRESETS: the instrument
      const pick = [19, 80, 127].find(n => !written.inst.includes(n)), SOUNDS = 3;   // (the first clicks are the synth's sounds)
      await turn(PRESETS, SOUNDS + pick + 1); await sleep(2500);
      const swapped = await voices(3000);
      check(`PRESETS ${SOUNDS + pick + 1} clicks up: every melodic voice plays instrument ${pick}`, swapped.inst.join() === String(pick), `GENMIDI ${swapped.inst.join(', ')}`);
      await turn(PRESETS, -127); await turn(PRESETS, -127); await sleep(2500);
      const unswapped = await voices(4000);
      for (const [i, l] of unswapped.mod) if (!level.has(i)) level.set(i, l);
      check('PRESETS far past the bottom: the music\'s own instruments again', !unswapped.inst.includes(pick) && unswapped.inst.length >= 2, `GENMIDI ${unswapped.inst.join(', ')}`);

      // ---- KNOB 3: pitch
      await turn(K3, 12); await sleep(300);
      const up = await voices(4000);
      check('KNOB 3 twelve clicks up: every note an octave higher', all(up, own + 12), `${up.up.length} notes seen`);
      await turn(K3, -15); await sleep(300);
      const down = await voices(4000);
      check('... fifteen back, to three below: every note three semitones lower', all(down, own - 3), `${down.up.length} notes seen`);
      await turn(K3, -30); await sleep(300);
      check('... far past the bottom: an octave lower, and no further', all(await voices(3000), own - 12));
      await turn(K3, 12);

      // ---- KNOB 4: the drum beat (web/test_drums.js), and no longer the tempo
      const beat0 = M._fm1_drums_hits();
      await turn(K4, 1); await sleep(500);
      const withBeat = await ticksIn(4000), struck = M._fm1_drums_hits() - beat0;
      await turn(K4, -1); await sleep(1500);
      const afterOff = M._fm1_drums_hits();
      check('KNOB 4 a click up: a drum beat comes in, and the music keeps its tempo', struck > 20 && Math.abs(withBeat / pace - 1) < 0.06, `${struck} hits; ${withBeat.toFixed(0)} ticks a second against ${pace.toFixed(0)}`);

      // ---- ALGORITHM: FM depth
      const depth = (v, by) => v.mod.size > 0 && [...v.mod].every(([i, l]) => !level.has(i) || l === Math.max(0, Math.min(63, level.get(i) - by)));
      const levels = v => [...v.mod].map(([i, l]) => `${i}: ${level.get(i)} -> ${l}`).join(', ');
      await turn(ALGORITHM, 4); await sleep(2500);
      const deep = await voices(4000);
      check('ALGORITHM four clicks up: each instrument\'s modulator 8 steps (6 dB) louder, or as loud as it goes', depth(deep, 8), levels(deep));
      await turn(ALGORITHM, -30); await sleep(2500);
      const dull = await voices(4000);
      check('... far past the bottom (8 down): 16 steps quieter, or silent', depth(dull, -16), levels(dull));
      await turn(ALGORITHM, 8); await sleep(2500);
      check('... eight up again: as written', depth(await voices(3000), 0));

      // ---- ENV: the four knobs become attack, decay, sustain, release
      // (what 5, 6, 7 of the probe: the flags, attack << 4 | decay and sustain << 4 | release last written to a voice)
      const env = () => ({ held: (M._fm1_web_music(5, 0) >> 5) & 1, attack: M._fm1_web_music(6, 0) >> 4, decay: M._fm1_web_music(6, 0) & 15, sustain: M._fm1_web_music(7, 0) >> 4, release: M._fm1_web_music(7, 0) & 15 });
      const before = await listen(4000);
      await tap(ENV);
      await turn(K2, 1); await sleep(1500);
      const pluck = await listen(4000), e1 = env();
      check('after ENV, KNOB 2 one click: decay rate 8, every note a pluck (quieter, the level coming and going more)', e1.decay === 8 && pluck.rms < before.rms * 0.75,
        `rms ${pluck.rms.toFixed(0)} against ${before.rms.toFixed(0)}; level swing ${pluck.swing.toFixed(1)} dB against ${before.swing.toFixed(1)} dB`);
      await turn(K2, 30); await sleep(300);
      check('... far past the top: rate 1, the slowest', env().decay === 1);
      await turn(K2, -30); await sleep(300);
      await turn(K1, 4); await sleep(300);
      check('KNOB 1 four clicks: attack rate 3', env().attack === 3);
      await turn(K1, 30); await sleep(300);
      check('... far past the top: rate 1', env().attack === 1);
      await turn(K1, -30); await sleep(300);
      await turn(K3, 1); await sleep(300);
      const s1 = env();
      await turn(K3, 5); await sleep(1500);
      const s6 = env(), held = await listen(4000);
      check('KNOB 3: sustain from silence up through 4 units down (12 dB), the note held there', s1.sustain === 15 && s1.held === 1 && s6.sustain === 4 && s6.held === 1, `rms ${held.rms.toFixed(0)}`);
      await turn(K3, 30); await sleep(300);
      check('... far past the top: full level', env().sustain === 0);
      await turn(K3, -30); await sleep(300);
      await turn(K4, 8); await sleep(2500);
      const ring = await listen(4000);
      check('KNOB 4 all the way up: release rate 2, everything rings on (the level far steadier, and louder)', env().release === 2 && ring.swing < before.swing - 3 && ring.rms > before.rms,
        `level swing ${ring.swing.toFixed(1)} dB against ${before.swing.toFixed(1)} dB; rms ${ring.rms.toFixed(0)}`);
      await turn(K4, -30); await sleep(2500);
      const again = await listen(4000);
      check('all four back down: the music as written, its pitch and tempo untouched all the while',
        Math.abs(20 * Math.log10(again.rms / before.rms)) < 4 && all(await voices(2500), own) && Math.abs((await ticksIn(3000)) / pace - 1) < 0.06, `rms ${again.rms.toFixed(0)}`);
      await tap(ENV);
      await turn(K1, -22); await sleep(500);                                // ENV again: KNOB 1 is the filter, a low-pass at 670 Hz
      const still = await filterIn(1500);
      check('ENV again: KNOB 1 is the filter\'s sweep again, and it stays where it is put', still.lo === -22 && still.hi === -22, `at ${still.lo}`);

      // ---- LFO: KNOB 1 becomes the wobble
      await tap(LFO);
      await turn(K1, 7); await sleep(300);                                  // wobble at 2 Hz
      const wob = await filterIn(2500);
      check('after LFO, KNOB 1 up seven: the filter swings 8 knob steps each way about where it was left', Math.abs(wob.lo + 30) < 1 && Math.abs(wob.hi + 14) < 1,
        `between ${wob.lo.toFixed(1)} and ${wob.hi.toFixed(1)}`);
      await turn(K2, 3); await turn(K3, 3); await turn(K4, 3); await sleep(500);
      check('... and the other three knobs do nothing there', all(await voices(2000), own) && Math.abs((await ticksIn(3000)) / pace - 1) < 0.06);
      const quiet = M._fm1_drums_hits();
      await tap(LFO);
      await turn(K4, 1); await sleep(2500);
      check('LFO again: KNOB 4 picks the drum beat again (and did not on the wobble\'s page)', M._fm1_drums_hits() - quiet > 10 && quiet === afterOff, `${M._fm1_drums_hits() - quiet} hits`);
      await turn(K4, -1); await sleep(1500);
      const wobStill = await filterIn(2500);
      check('... and the wobble has gone on all the while', wobStill.hi - wobStill.lo > 14, `between ${wobStill.lo.toFixed(1)} and ${wobStill.hi.toFixed(1)}`);

      // ---- EDIT: everything as it was
      await turn(PRESETS, SOUNDS + 40); await turn(K3, 5); await turn(ALGORITHM, 3);
      await tap(ENV); await turn(K2, 2); await turn(K4, 6);                 // and left on the envelope's knobs
      await tap(EDIT); await sleep(3000);
      const back = await voices(5000), after = await listen(4000), paceBack = await ticksIn(3000);
      check('EDIT: instruments, pitch and modulators as written', !back.inst.includes(39) && back.inst.length >= 2 && all(back, own) && depth(back, 0), `GENMIDI ${back.inst.join(', ')}; ${back.up.length} notes seen`);
      const off = await filterIn(1000);
      check('... tempo as written, filter and wobble off', Math.abs(paceBack / pace - 1) < 0.06 && Math.abs(20 * Math.log10(after.rms / before.rms)) < 4 && off.lo === 0 && off.hi === 0,
        `${paceBack.toFixed(0)} ticks a second; rms ${after.rms.toFixed(0)}; filter at ${off.lo}`);
      const idle = M._fm1_drums_hits();
      await turn(K4, 1); await sleep(2500);
      check('... and the knobs have their first jobs again (KNOB 4: the drum beat)', M._fm1_drums_hits() - idle > 10, `${M._fm1_drums_hits() - idle} hits`);
      await turn(K4, -1); await turn(SELECT, 1);
      check('no audio underruns while listening', M._fm1_web_underruns() === under, `${M._fm1_web_underruns() - under}`);
      console.log(bad ? `SOUND KNOBS IN THE GAME: FAILED (${bad})` : 'SOUND KNOBS IN THE GAME: PASSED');
      process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = path.join(__dirname, 'build'); globalThis.__filename = path.join(__dirname, 'build', 'doom.js');
require('vm').runInThisContext(require('fs').readFileSync(path.join(__dirname, 'build', 'doom.js'), 'utf8'), { filename: 'doom.js' });
