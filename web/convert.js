// SPDX-License-Identifier: GPL-3.0-only
// FM-1 Doom: from a Doom WAD the user picked to something installable, all in the browser.
//   cutWad (wadcut.js)  ->  whd_gen (rp2040-doom's converter, compiled to WebAssembly: web/build_whdgen.sh)
//   ->  buildInstall (datapack.js)

import { sha256hex } from "./vendor/felucca/fm1pkg.js";
import { cutWad } from "./wadcut.js";
import { buildInstall } from "./datapack.js";

// The one input whose result has run on a real FM-1: the shareware DOOM1.WAD, version 1.9 (4,196,020 bytes).
export const SHAREWARE_19_SHA256 = "1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771";
// ... and the game data it must turn into (data/e1m1_6h.whx); the page and web/test_data.js check this.
export const SHAREWARE_19_DATA_SHA256 = "7450083ed98ef7d0f9679c03f7ef4f60002a48b6d3d4f6b909236aff83862d85";

export class ConvertError extends Error {}

// why the converter stopped, for a person (the raw line goes to the Details log)
export function explain(lines) {
  const text = lines.join("\n");
  if (/Expected MUS track/.test(text)) return "its music is stored as MIDI, which the converter can't read (Freedoom's WADs are like this)";
  if (/Assertion failed|super tiny|[Nn]on standard|Out of range|too big|too many|too tall|too long|Duplicate texture|Unable to locate|Missing|missing/.test(text))
    return "its level is built in a way the FM-1's compact data format can't hold";
  return "the converter stopped";
}

// factory: the function web/build/whdgen/whd_gen.js defines (WhdGen). One fresh instance per run.
// The input's file name goes into the output's header, so it is fixed: the same WAD always gives the same bytes.
export async function runWhdGen(factory, wad, opts = {}) {
  const lines = [];
  const m = await factory({ print: (s) => lines.push(s), printErr: (s) => lines.push(s), ...opts });
  m.FS.writeFile("/E1M1_6H.WAD", wad);
  let code = -1, thrown = null;
  try { code = m.callMain(["/E1M1_6H.WAD", "/out.whx"]); } catch (e) { thrown = e; }
  let whx = null;
  if (code === 0 && !thrown) { try { whx = m.FS.readFile("/out.whx"); } catch (_) { /* no output */ } }
  if (!whx) {
    const tail = lines.filter((l) => l.trim()).slice(-3);
    if (thrown) tail.push(String(thrown && thrown.message || thrown));
    const e = new ConvertError("This WAD can't be used: " + explain(tail) + ".");
    e.detail = tail.join(" | ");
    throw e;
  }
  return { whx: Uint8Array.from(whx), lines };
}

// wad: the bytes of the file the user picked. base, fw: the firmware-only package and its numbers.
// -> { pkg, data2, meta, info: { known, wadSha, dataSha, whxLen, capacity, cut } }
export async function prepare(wad, base, fw, factory, opts = {}) {
  const wadSha = await sha256hex(wad);
  const known = wadSha === SHAREWARE_19_SHA256;
  const cut = cutWad(wad);
  const { whx } = await runWhdGen(factory, cut.wad, opts);
  const dataSha = await sha256hex(whx);
  if (known && dataSha !== SHAREWARE_19_DATA_SHA256)
    throw new ConvertError("The converter gave a different result for the shareware WAD than the tested one. Nothing was prepared; please report this.");
  const built = buildInstall(base, fw, whx);
  const capacity = fw.app_slot - (fw.desc_at + 64) + (0xE0000 - 0x93000);
  return { ...built, info: { known, wadSha, dataSha, whxLen: whx.length, capacity, cut: cut.info } };
}

// already converted data (a .whx file hosted next to the page, for data that may be hosted)
export async function prepareData(whx, base, fw) {
  const built = buildInstall(base, fw, whx);
  const capacity = fw.app_slot - (fw.desc_at + 64) + (0xE0000 - 0x93000);
  return { ...built, info: { known: false, bundled: true, dataSha: await sha256hex(whx), whxLen: whx.length, capacity } };
}
