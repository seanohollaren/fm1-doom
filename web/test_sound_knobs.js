// Headless check, in the browser build with E1M1's music playing, of the knobs that play with the music itself:
// PRESETS (instrument), ALGORITHM (FM depth), KNOB 3 (pitch) and KNOB 4 (tempo); of ENV, which turns KNOB 3 and
// KNOB 4 into envelope and filter wobble and back; and of EDIT, which puts all of it back.
//   node web/test_sound_knobs.js
const path = require('path');
globalThis.Module = {
  locateFile: f => path.join(__dirname, 'build', f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, EDIT = 1 << 4, ENV = 1 << 2;
    const SELECT = 0, ALGORITHM = 1, PRESETS = 2, K1 = 3, K3 = 5, K4 = 6;
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
      const pick = [19, 80, 127].find(n => !written.inst.includes(n));
      await turn(PRESETS, pick + 1); await sleep(2500);
      const swapped = await voices(3000);
      check(`PRESETS ${pick + 1} clicks up: every melodic voice plays instrument ${pick}`, swapped.inst.join() === String(pick), `GENMIDI ${swapped.inst.join(', ')}`);
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

      // ---- KNOB 4: tempo
      await turn(K4, 12); await sleep(500);
      const fast = await ticksIn(4000);
      check('KNOB 4 twelve clicks up: the music plays twice as fast', Math.abs(fast / pace - 2) < 0.12, `${fast.toFixed(0)} ticks a second against ${pace.toFixed(0)}`);
      await turn(K4, -40); await sleep(800);
      const slow = await ticksIn(5000);
      check('... far past the bottom: half speed, and no slower', Math.abs(slow / pace - 0.5) < 0.05, `${slow.toFixed(0)} ticks a second`);
      await turn(K4, 12); await sleep(500);
      check('... twelve up again: as written', Math.abs((await ticksIn(4000)) / pace - 1) < 0.06);

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

      // ---- ENV: KNOB 3 and KNOB 4 become envelope and wobble
      const before = await listen(4000);
      await tap(ENV);
      await turn(K3, -6); await sleep(1500);
      const short = await listen(4000), pitchKept = await voices(2500);
      check('after ENV, KNOB 3 down six: every note is a tick (a quarter as loud at most, coming and going far more)', short.rms < before.rms * 0.25 && short.swing > before.swing + 10,
        `rms ${short.rms.toFixed(0)} against ${before.rms.toFixed(0)}; level swing ${short.swing.toFixed(1)} dB against ${before.swing.toFixed(1)} dB`);
      check('... and the pitch is not touched by it', all(pitchKept, own));
      await turn(K3, 30); await sleep(2500);
      const long = await listen(4000);
      await turn(K3, -6); await sleep(2500);
      const again = await listen(4000);
      check('KNOB 3 far past the top (six up): notes ring into each other (the level far steadier than as written)', long.swing < again.swing - 3 && long.rms > short.rms * 3,
        `level swing ${long.swing.toFixed(1)} dB against ${again.swing.toFixed(1)} dB as written; rms ${long.rms.toFixed(0)}`);
      check('KNOB 3 back to the middle: the music as written', Math.abs(20 * Math.log10(again.rms / before.rms)) < 4, `rms ${again.rms.toFixed(0)}`);
      await turn(K1, -22); await sleep(500);                                // a low-pass at 670 Hz
      const still = await listen(5000);
      await turn(K4, 7); await sleep(500);                                  // wobble at 2 Hz
      const wob = await listen(5000);
      check('with a low-pass on, KNOB 4 up seven: the filter wobbles (the top end comes and goes far more)', wob.topSwing > still.topSwing + 6,
        `top-end swing ${wob.topSwing.toFixed(1)} dB against ${still.topSwing.toFixed(1)} dB`);
      check('... and the tempo is not touched by it', Math.abs((await ticksIn(3000)) / pace - 1) < 0.06);
      await tap(ENV);
      await turn(K4, 12); await sleep(500);
      const both = await ticksIn(3000);
      check('ENV again: KNOB 4 is the tempo again (twice as fast)', Math.abs(both / pace - 2) < 0.12, `${both.toFixed(0)} ticks a second`);
      await turn(K4, -12); await sleep(500);
      const wobStill = await listen(5000);
      check('... and the wobble has gone on all the while', wobStill.topSwing > still.topSwing + 6, `top-end swing ${wobStill.topSwing.toFixed(1)} dB`);

      // ---- EDIT: everything as it was
      await turn(PRESETS, 40); await turn(K3, 5); await turn(ALGORITHM, 3);
      await tap(EDIT); await sleep(3000);
      const back = await voices(5000), after = await listen(4000), paceBack = await ticksIn(3000);
      check('EDIT: instruments, pitch and modulators as written', !back.inst.includes(39) && back.inst.length >= 2 && all(back, own) && depth(back, 0), `GENMIDI ${back.inst.join(', ')}; ${back.up.length} notes seen`);
      check('... tempo as written, filter and wobble off', Math.abs(paceBack / pace - 1) < 0.06 && Math.abs(20 * Math.log10(after.rms / before.rms)) < 4 && after.topSwing < still.topSwing + 6,
        `${paceBack.toFixed(0)} ticks a second; rms ${after.rms.toFixed(0)}; top-end swing ${after.topSwing.toFixed(1)} dB`);
      // SELECT still changes weapon, KNOB 4 no longer does: nothing to see without a second weapon, so only that neither upsets anything
      await turn(SELECT, 1); await turn(K4, 1); await turn(K4, -1);
      check('no audio underruns while listening', M._fm1_web_underruns() === under, `${M._fm1_web_underruns() - under}`);
      console.log(bad ? `SOUND KNOBS IN THE GAME: FAILED (${bad})` : 'SOUND KNOBS IN THE GAME: PASSED');
      process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = path.join(__dirname, 'build'); globalThis.__filename = path.join(__dirname, 'build', 'doom.js');
require('vm').runInThisContext(require('fs').readFileSync(path.join(__dirname, 'build', 'doom.js'), 'utf8'), { filename: 'doom.js' });
