// SPDX-License-Identifier: GPL-3.0-only
// FM-1 Doom: put converted game data (a .whx file) and the firmware together into what gets installed.
// The same steps as firmware/pack.py, for the installer page (the user's own data never leaves the browser):
//
//   firmware package (doom_code.fwsc: the firmware alone, Felucca's layout and loader)  +  game data
//     -> a package whose app slot holds firmware + a 64-byte descriptor + the first block of the data
//     -> the second block, which the firmware writes to flash [0x93000, 0xE0000) itself
//
// Needs Felucca's fm1pkg.js (Package, crc16) in scope: the installer page inlines both files; web/test_data.js
// loads them together.

const APP_AREA_END = 0x93000;   // flash from here up reads unencrypted; the second block starts here
const DATA_END = 0xE0000;       // the update staging area starts here
const DESC_LEN = 64;

export class DataError extends Error {}

// The split depends on the data file alone: the FIRST lump boundary at which block 2 fits its region.
export function splitPoint(whx, room) {
  if (whx.length < 12 || String.fromCharCode(whx[0], whx[1], whx[2], whx[3]) !== "IWHX") throw new DataError("the converter did not write a game data file");
  const rd = (o) => (whx[o] | (whx[o + 1] << 8) | (whx[o + 2] << 16) | (whx[o + 3] << 24)) >>> 0;
  const n = rd(4), table = rd(8);
  if (table + 4 * (n + 1) > whx.length) throw new DataError("unexpected game data directory");
  const offs = [...new Set(Array.from({ length: n + 1 }, (_, i) => rd(table + 4 * i) & 0xFFFFFF))].sort((a, b) => a - b);
  if (offs[offs.length - 1] > whx.length || table + 4 * (n + 1) > offs[0]) throw new DataError("unexpected game data directory");
  if (whx.length <= room) return whx.length;
  const fit = offs.filter((o) => whx.length - o <= DATA_END - APP_AREA_END && o > table + 4 * (n + 1));
  if (!fit.length || fit[0] > room) {
    const over = whx.length - (room + DATA_END - APP_AREA_END);
    throw new DataError(`the game data is ${whx.length} bytes, ${over > 0 ? over + " bytes" : "a little"} more than fits in the FM-1's flash next to the firmware`);
  }
  return fit[0];
}

export function descriptor(whx, split, build) {
  const d = new Uint8Array(DESC_LEN), v = new DataView(d.buffer);
  d.set([0x46, 0x4D, 0x31, 0x44]);                       // "FM1D"
  v.setUint32(4, 1, true);
  v.setUint32(8, whx.length, true);
  v.setUint32(12, split, true);
  v.setUint32(16, crc16(whx.subarray(0, split)), true);
  v.setUint32(20, APP_AREA_END, true);
  v.setUint32(24, crc16(whx.subarray(split)), true);
  v.setUint32(28, build >>> 0, true);
  v.setUint32(60, crc16(d.subarray(0, 60)), true);
  return d;
}

// the boot code looks for an update record 256 bytes below each 4 KB boundary from 0x94000 up: the data must not look like one
function recordLookalikes(block2) {
  const hits = [];
  for (let s = APP_AREA_END + 0x1000; s - 0x100 + 80 <= APP_AREA_END + block2.length; s += 0x1000) {
    const r = block2.subarray(s - 0x100 - APP_AREA_END, s - 0x100 - APP_AREA_END + 80);
    const c = r[0] | (r[1] << 8);
    if ((r[6] | (r[7] << 8)) === 0x5441 && c && c === crc16(r.subarray(2, 80))) hits.push(s - 0x100);
  }
  return hits;
}

// base: the bytes of the firmware-only package. fw: { product, build, desc_at, img_len } from doom_install.json.
// -> { pkg (the .fwsc to install), data2, meta: { product, build, split, total, data2_len, data2_crc16 } }
export function buildInstall(base, fw, whx) {
  const p = new Package(base);
  if (p.product !== fw.product) throw new DataError("the firmware file is not the expected one");
  const slot = p.app.size;
  const old = p.dec.subarray(p.appOff, p.appOff + slot);
  for (let i = fw.img_len; i < slot; i++) if (old[i] !== 0xFF) throw new DataError("the firmware file already carries data");
  const room = slot - (fw.desc_at + DESC_LEN);
  const split = splitPoint(whx, room);
  const block2 = whx.slice(split);
  if (block2.length > DATA_END - APP_AREA_END) throw new DataError("the second block of the game data does not fit its region");
  const hits = recordLookalikes(block2);
  if (hits.length) throw new DataError("the game data would look like an update record to the FM-1's boot code (at 0x" + hits[0].toString(16) + ")");
  const desc = descriptor(whx, split, fw.build);
  const app = new Uint8Array(fw.desc_at + DESC_LEN + split).fill(0xFF);
  app.set(old.subarray(0, fw.img_len));
  app.set(desc, fw.desc_at);
  app.set(whx.subarray(0, split), fw.desc_at + DESC_LEN);
  p.setApp(app);
  const pkg = p.serialize();
  // read it back the way the device will: parse the new package, decrypt, compare
  const q = new Package(pkg);
  const back = q.dec.subarray(q.appOff, q.appOff + slot);
  for (let i = 0; i < slot; i++) if (back[i] !== (i < app.length ? app[i] : 0xFF)) throw new DataError("the package does not read back (internal error)");
  if (q.product !== fw.product || q.flashSize !== p.flashSize) throw new DataError("the package does not read back (internal error)");
  return { pkg, data2: block2, meta: { product: fw.product, build: fw.build >>> 0, split, total: whx.length, data2_len: block2.length, data2_crc16: crc16(block2) } };
}
