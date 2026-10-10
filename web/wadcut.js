// SPDX-License-Identifier: GPL-3.0-only
// FM-1 Doom: cut a Doom IWAD down to what the FM-1 build plays, one level (E1M1), before the data converter
// (whd_gen) packs it. Runs in the browser, on a file the user picks, and in node (web/test_data.js).
//
// What stays: the level, the wall textures / flats / sprites / sound effects that level uses, the status bar,
// fonts, menu art, the title picture, the title and level music. What goes: every other level, demos, the
// intermission and help screens, multiplayer-only weapons, PC-speaker sounds. Sound effects are stored at half
// their sample rate. For the shareware DOOM1.WAD v1.9 the result is byte-for-byte the file tools/cut_wad.py
// writes (`cut_wad.py SRC DST 6 --half-sfx`), which is the data tested on a real FM-1.

// (helper names are unlike the page's and Felucca's: the installer inlines all the scripts into one scope)
const rdU16 = (b, o) => b[o] | (b[o + 1] << 8);
const rdS16 = (b, o) => (rdU16(b, o) << 16) >> 16;
const rdU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function wadName(b, o) {
  let s = "";
  for (let i = 0; i < 8 && b[o + i]; i++) s += String.fromCharCode(b[o + i]);
  return s.toUpperCase();
}
function putU32(a, v) { a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }
function putU16(a, v) { a.push(v & 255, (v >>> 8) & 255); }
function putName(a, s) { for (let i = 0; i < 8; i++) a.push(i < s.length ? s.charCodeAt(i) & 255 : 0); }

export class WadError extends Error {}

export function readWad(bytes) {
  if (bytes.length < 12) throw new WadError("This file is too short to be a WAD.");
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic === "PWAD") throw new WadError("This is an add-on (a PWAD), not the main game file.");
  if (magic !== "IWAD") throw new WadError("This is not a Doom WAD file.");
  const n = rdU32(bytes, 4), dir = rdU32(bytes, 8);
  if (n > 65536 || dir + 16 * n > bytes.length) throw new WadError("The WAD's directory is damaged.");
  const lumps = [];
  for (let i = 0; i < n; i++) {
    const o = rdU32(bytes, dir + 16 * i), s = rdU32(bytes, dir + 16 * i + 4);
    if (s && o + s > bytes.length) throw new WadError("The WAD is cut short (a lump runs past the end of the file).");
    lumps.push({ name: wadName(bytes, dir + 16 * i + 8), data: bytes.subarray(o, o + s) });
  }
  return lumps;
}

export function writeWad(lumps) {
  let size = 12;
  for (const l of lumps) size += l.data.length + 16;
  const out = new Uint8Array(size), dir = [];
  let at = 12;
  for (const l of lumps) {
    putU32(dir, at); putU32(dir, l.data.length); putName(dir, l.name);
    out.set(l.data, at); at += l.data.length;
  }
  out.set([0x49, 0x57, 0x41, 0x44], 0);                     // "IWAD"
  const h = []; putU32(h, lumps.length); putU32(h, at);
  out.set(h, 4); out.set(dir, at);
  return out;
}

const ANIM_T = [["SLADRIP1", "SLADRIP2", "SLADRIP3"], ["BLODGR1", "BLODGR2", "BLODGR3", "BLODGR4"], ["GSTFONT1", "GSTFONT2", "GSTFONT3"],
  ["FIRELAV3", "FIRELAVA"], ["FIREMAG1", "FIREMAG2", "FIREMAG3"], ["FIREBLU1", "FIREBLU2"], ["ROCKRED1", "ROCKRED2", "ROCKRED3"]];
const ANIM_F = [["NUKAGE1", "NUKAGE2", "NUKAGE3"], ["FWATER1", "FWATER2", "FWATER3", "FWATER4"], ["SWATER1", "SWATER2", "SWATER3", "SWATER4"],
  ["LAVA1", "LAVA2", "LAVA3", "LAVA4"], ["BLOOD1", "BLOOD2", "BLOOD3"]];
// placed object type -> the sprite it is drawn with (the types E1M1 places; firmware NOTES.md 2026-10-08 checked each)
const THING_SPRITE = { 3004: "POSS", 9: "SPOS", 3001: "TROO", 2035: "BAR1", 2001: "SHOT", 2012: "MEDI", 2011: "STIM", 2014: "BON1", 2015: "BON2",
  2018: "ARM1", 2019: "ARM2", 2007: "CLIP", 2008: "SHEL", 2048: "AMMO", 2049: "SBOX", 2046: "BROK", 2028: "COLU", 48: "ELEC", 35: "CBRA",
  24: "POL5", 2003: "LAUN", 2002: "MGUN" };
// object types that need no sprite of their own: player starts, deathmatch start, teleport landing; corpses drawn with PLAY frames
const THING_PLAIN = new Set([1, 2, 3, 4, 11, 14, 10, 12, 15]);
const ALWAYS = ["PUNG", "PISG", "PISF", "SHTG", "SHTF", "PUFF", "BLUD", "TFOG", "IFOG", "BAL1", "BEXP", "MISL", "CHGG", "CHGF"];
const MULTIPLAYER_ONLY = new Set(["LAUN", "MGUN", "CHGG", "CHGF", "MISL"]);   // E1M1 has these weapons in multiplayer only
const SFX = new Set(("PISTOL SHOTGN SGCOCK PUNCH BAREXP FIRSHT FIRXPL PSTART PSTOP DOROPN DORCLS STNMOV SWTCHN SWTCHX PLPAIN PLDETH OOF NOWAY " +
  "ITEMUP WPNUP SLOP TELEPT POSIT1 POSIT2 POSIT3 BGSIT1 BGSIT2 POPAIN PODTH1 PODTH2 PODTH3 BGDTH1 BGDTH2 POSACT BGACT CLAW TINK").split(" "));
const DROP = ["CREDIT", "HELP1", "HELP2", "WIMAP0", "VICTORY", "PFUB", "END", "WIA", "WIURH", "WISPLAT", "DMXGUS", "WI"];
const MAP_LUMPS = ["THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SEGS", "SSECTORS", "NODES", "SECTORS", "REJECT", "BLOCKMAP"];
const isMap = (nm) => /^E\dM\d$/.test(nm);

function halfRate(data) {                                    // a DMX sound at half its sample rate (each pair of samples averaged)
  const rate = rdU16(data, 2), count = rdU32(data, 4);
  const body = data.subarray(8 + 16, 8 + count - 16);        // DMX pads 16 bytes each side
  const n = body.length >> 1, out = [];
  putU16(out, 3); putU16(out, rate >> 1); putU32(out, n + 32);
  const first = n ? (body[0] + body[1] + 1) >> 1 : 0, last = n ? (body[2 * n - 2] + body[2 * n - 1] + 1) >> 1 : 0;
  if (n) for (let i = 0; i < 16; i++) out.push(first);
  for (let i = 0; i < n; i++) out.push((body[2 * i] + body[2 * i + 1] + 1) >> 1);
  if (n) for (let i = 0; i < 16; i++) out.push(last);
  return Uint8Array.from(out);
}

// cutWad(bytes) -> { wad, info }.  Throws WadError with a message for the user when the file cannot be used.
export function cutWad(bytes) {
  const L = readWad(bytes);
  const names = L.map((l) => l.name);
  const lump = (nm) => { const i = names.indexOf(nm); if (i < 0) throw new WadError(`This WAD has no ${nm} lump.`); return L[i].data; };
  if (names.includes("FREEDOOM"))
    throw new WadError("This is Freedoom. Its levels and artwork are too large for the FM-1's memory in this build.");
  const m = names.indexOf("E1M1");
  if (m < 0) {
    if (names.includes("MAP01")) throw new WadError("This is a Doom II-style WAD (its levels are MAP01, MAP02, …). This build plays the first level of Doom, E1M1.");
    throw new WadError("This WAD has no level E1M1.");
  }
  const ml = {};
  for (let i = 0; i < 10; i++) {
    if (m + 1 + i >= L.length || L[m + 1 + i].name !== MAP_LUMPS[i]) throw new WadError("Level E1M1 in this WAD is not laid out as a Doom level.");
    ml[MAP_LUMPS[i]] = L[m + 1 + i].data;
  }
  // what the level uses
  const tex = new Set(["SKY1"]), fl = new Set(), types = new Set();
  const sd = ml.SIDEDEFS;
  for (let i = 0; i + 30 <= sd.length; i += 30) for (const k of [4, 12, 20]) { const t = wadName(sd, i + k); if (t !== "-") tex.add(t); }
  const sec = ml.SECTORS;
  for (let i = 0; i + 26 <= sec.length; i += 26) for (const k of [4, 12]) fl.add(wadName(sec, i + k));
  const th = ml.THINGS;
  for (let i = 0; i + 10 <= th.length; i += 10) types.add(rdS16(th, i + 6));
  // wall textures: every definition in TEXTURE1 (and TEXTURE2, which the full game has), by name
  const pn = lump("PNAMES"), pnames = [];
  for (let i = 0, c = rdU32(pn, 0); i < c; i++) pnames.push(wadName(pn, 4 + 8 * i));
  const defs = [];
  for (const tl of ["TEXTURE1", "TEXTURE2"]) {
    if (!names.includes(tl)) continue;
    const t1 = lump(tl), nt = rdU32(t1, 0);
    for (let i = 0; i < nt; i++) {
      const o = rdU32(t1, 4 + 4 * i), pc = rdS16(t1, o + 20), ps = [];
      if (pc < 0 || o + 22 + 10 * pc > t1.length) throw new WadError("The WAD's texture list is damaged.");
      for (let j = 0; j < pc; j++) {
        const p = pnames[rdS16(t1, o + 22 + 10 * j + 4)];
        if (p === undefined) throw new WadError("The WAD's texture list names a patch that does not exist.");
        ps.push(p);
      }
      defs.push({ name: wadName(t1, o), raw: t1.subarray(o, o + 22 + 10 * pc), patches: ps });
    }
  }
  const tn = new Set(defs.map((d) => d.name));
  for (const t of [...tex]) for (const [a, b] of [["SW1", "SW2"], ["SW2", "SW1"]]) if (t.startsWith(a) && tn.has(b + t.slice(3))) tex.add(b + t.slice(3));
  for (const g of ANIM_T) if (g.some((t) => tex.has(t))) for (const t of g) if (tn.has(t)) tex.add(t);
  for (const g of ANIM_F) if (g.some((f) => fl.has(f))) for (const f of g) fl.add(f);
  fl.add("F_SKY1");
  const missing = [...tex].filter((t) => !tn.has(t));
  if (missing.length) throw new WadError(`Level E1M1 uses wall textures this WAD does not define (${missing.slice(0, 4).join(", ")}).`);
  const usedp = new Set();
  for (const d of defs) if (tex.has(d.name)) for (const p of d.patches) usedp.add(p);
  const need = new Set(ALWAYS), unknown = [];
  for (const t of types) {
    if (THING_SPRITE[t]) need.add(THING_SPRITE[t]);
    else if (!THING_PLAIN.has(t)) unknown.push(t);
  }
  const newp = pnames.filter((p) => usedp.has(p)), pmap = new Map();
  newp.forEach((p, i) => pmap.set(p, i));

  const out = [];
  let sect = null, skip = 0, seenTex = false;
  const count = { sprites: 0, flats: 0, patches: 0, sounds: 0 };
  for (const { name: nm, data } of L) {
    const start = /^([SFP])\d?_START$/.exec(nm);
    if (start) { sect = start[1]; out.push({ name: nm, data }); continue; }
    if (/^[SFP]\d?_END$/.test(nm)) { if (nm.length === 5) sect = null; out.push({ name: nm, data }); continue; }
    if (isMap(nm) && nm !== "E1M1") { skip = 10; continue; }
    if (skip) { skip--; continue; }
    if (nm.startsWith("D_") && nm !== "D_E1M1" && nm !== "D_INTROA") continue;      // the level's music and the title jingle (the OPL version)
    if (nm.startsWith("DEMO")) continue;
    if (sect === "S" && MULTIPLAYER_ONLY.has(nm.slice(0, 4))) continue;
    if (nm.startsWith("DS") && !SFX.has(nm.slice(2))) continue;
    if (nm.startsWith("DP")) continue;
    if (sect === null && nm !== "ENDOOM" && DROP.some((p) => nm.startsWith(p))) continue;
    if (nm === "TEXTURE2") continue;                                                // its definitions were merged into TEXTURE1 below
    // E1M1 has corpse decorations drawn with player sprites (dead marine PLAYN0, gibs PLAYW0): keep just those frames
    if (sect === "S" && nm.slice(0, 4) === "PLAY") {
      if (nm[4] === "N" || nm[4] === "W") { out.push({ name: nm, data }); count.sprites++; }
      else if (nm === "PLAYA1") {
        // the converter wants every frame of a sprite present: a 1x1 single-pixel stand-in for the unused ones
        const tiny = Uint8Array.from([1, 0, 1, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 1, 0, 0, 0, 0xFF]);
        for (const letter of "ABCDEFGHIJKLMOPQRSTUV") out.push({ name: "PLAY" + letter + "0", data: tiny });
      }
      continue;
    }
    if (sect === "S" && !need.has(nm.slice(0, 4))) continue;
    if (sect === "F" && !fl.has(nm)) continue;
    if (sect === "P" && !usedp.has(nm)) continue;
    let d = data;
    if (nm === "TEXTURE1") {
      const kd = defs.filter((x) => tex.has(x.name)), table = [], body = [];
      const base = 4 + 4 * kd.length;
      for (const x of kd) {
        const raw = Uint8Array.from(x.raw);
        x.patches.forEach((p, j) => { const v = pmap.get(p); raw[22 + 10 * j + 4] = v & 255; raw[22 + 10 * j + 5] = (v >> 8) & 255; });
        putU32(table, base + body.length);
        for (const b of raw) body.push(b);
      }
      const h = []; putU32(h, kd.length);
      d = Uint8Array.from([...h, ...table, ...body]);
      seenTex = true;
    } else if (nm === "PNAMES") {
      const a = []; putU32(a, newp.length);
      for (const p of newp) putName(a, p);
      d = Uint8Array.from(a);
    } else if (nm.startsWith("DS") && data.length > 8 + 32 && data[0] === 3) {
      d = halfRate(data); count.sounds++;
    }
    if (sect === "S") count.sprites++;
    if (sect === "F") count.flats++;
    if (sect === "P") count.patches++;
    out.push({ name: nm, data: d });
  }
  if (!seenTex) throw new WadError("This WAD has no TEXTURE1 lump.");
  for (const nm of ["PLAYPAL", "COLORMAP", "D_E1M1", "D_INTROA", "TITLEPIC", "STBAR"])
    if (!out.some((l) => l.name === nm)) throw new WadError(`This WAD has no ${nm} lump.`);
  const wad = writeWad(out);
  return { wad, info: { lumps: out.length, textures: tex.size, ...count, unknownThings: unknown } };
}
