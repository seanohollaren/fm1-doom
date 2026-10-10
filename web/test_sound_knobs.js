// Headless check, in the browser build with E1M1's music playing, of the two sound knobs added after the filter:
// KNOB 3 (drive: distortion over everything) and PRESETS (the instrument the music is played on), and of EDIT,
// which puts all of it back.
//   node web/test_sound_knobs.js
const path = require('path');
globalThis.Module = {
  locateFile: f => path.join(__dirname, 'build', f),
  print: s => { if (/Error|error|panic/.test(s)) console.log('[game]', s); },
  onRuntimeInitialized() {
    const M = globalThis.Module, PLAY = 1 << 10, EDIT = 1 << 4, K3 = 5, PRESETS = 2;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tap = async b => { M._fm1_web_panel(0, b); await sleep(150); M._fm1_web_panel(0, 0); await sleep(350); };
    const turn = async (knob, steps) => { M._fm1_web_enc(knob, steps); await sleep(200); };
    // the sound is pulled as the page pulls it; while listening, the left channel is kept
    let heard = null;
    setInterval(() => { const p = M._fm1_web_audio(1024, 44100) >> 1; if (heard) for (let i = 0; i < 2048; i += 2) heard.push(M.HEAP16[p + i]); }, 23);
    const listen = async ms => {
      heard = []; await sleep(ms); const a = heard; heard = null;
      let peak = 0, sq = 0; for (const v of a) { peak = Math.max(peak, Math.abs(v)); sq += v * v; }
      const rms = Math.sqrt(sq / a.length);
      return { rms, peak, crest: peak / rms };
    };
    // the instruments of the music's sounding voices, gathered over a while: melodic ones (0..127) only
    const instruments = async ms => {
      const seen = new Set();
      for (let t = 0; t < ms; t += 50) { for (let i = 0, v; (v = M._fm1_web_voice_instr(i)) >= 0; i++) if (v < 128) seen.add(v); await sleep(50); }
      return [...seen].sort((a, b) => a - b);
    };
    let bad = 0;
    const check = (name, ok, more = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${more ? ': ' + more : ''}`); };
    const show = l => `rms ${l.rms.toFixed(0)}, peak ${l.peak}, peak/rms ${l.crest.toFixed(2)}`;
    const dB = (a, b) => `${(20 * Math.log10(a / b)).toFixed(1)} dB`;
    (async () => {
      await sleep(1500); await tap(PLAY); await tap(PLAY); await tap(PLAY); await sleep(3000);
      const under = M._fm1_web_underruns();

      // ---- drive
      const clean = await listen(5000);
      check('the music as it comes', clean.rms > 500 && clean.crest > 3, show(clean));
      await turn(K3, 1);
      const one = await listen(5000);
      check('KNOB 3 one click: peaks rounded off, about as loud', one.crest < clean.crest && Math.abs(20 * Math.log10(one.rms / clean.rms)) < 4, `${show(one)}, ${dB(one.rms, clean.rms)} on the clean take`);
      await turn(K3, 30);                                                   // far past the top: it stops at 16
      const full = await listen(5000);
      check('KNOB 3 all the way: squared off, and never over the top step\'s level (3549)', full.crest < 1.8 && full.peak <= 3549 && full.peak > 3000, show(full));
      check('... louder than clean, by less than 8 dB', full.rms > clean.rms && full.rms < clean.rms * 2.5, dB(full.rms, clean.rms));
      await turn(K3, -30);
      const off = await listen(5000);
      check('KNOB 3 all the way back: the music as it came', off.crest > 3 && Math.abs(20 * Math.log10(off.rms / clean.rms)) < 4, show(off));
      await turn(K3, 16);

      // ---- the music's instrument
      const written = await instruments(4000);
      check('as written, E1M1 plays on several instruments', written.length >= 2, `GENMIDI ${written.join(', ')}`);
      const pick = [19, 80, 127].find(n => !written.includes(n));           // one it does not use: church organ, unless it does
      await turn(PRESETS, pick + 1);
      await sleep(2500);                                                    // notes that were sounding have ended
      const swapped = await instruments(4000);
      check(`PRESETS ${pick + 1} clicks up: every melodic voice plays instrument ${pick}`, swapped.length === 1 && swapped[0] === pick, `GENMIDI ${swapped.join(', ')}`);
      await turn(PRESETS, 127); await turn(PRESETS, 127);                   // far past the top: it stops at the last
      await sleep(2500);
      const top = await instruments(3000);
      check('PRESETS far past the top: the last instrument, 127', top.length === 1 && top[0] === 127, `GENMIDI ${top.join(', ')}`);

      // ---- EDIT: everything back
      await tap(EDIT);
      await sleep(2500);
      const back = await instruments(4000);
      check('EDIT: the music is back on its own instruments', back.join() === written.join(), `GENMIDI ${back.join(', ')}`);
      const after = await listen(5000);
      check('... and the drive is off', after.crest > 3 && after.peak > 3549, show(after));
      await turn(PRESETS, -5); await sleep(2500);
      const below = await instruments(3000);
      check('PRESETS turned down from "as written" stays there', below.join() === written.join(), `GENMIDI ${below.join(', ')}`);
      check('no audio underruns while listening', M._fm1_web_underruns() === under, `${M._fm1_web_underruns() - under}`);
      console.log(bad ? `SOUND KNOBS IN THE GAME: FAILED (${bad})` : 'SOUND KNOBS IN THE GAME: PASSED');
      process.exit(bad ? 1 : 0);
    })();
  },
};
globalThis.require = require; globalThis.__dirname = path.join(__dirname, 'build'); globalThis.__filename = path.join(__dirname, 'build', 'doom.js');
require('vm').runInThisContext(require('fs').readFileSync(path.join(__dirname, 'build', 'doom.js'), 'utf8'), { filename: 'doom.js' });
