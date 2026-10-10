// Headless test of the installer page (web/installer.html as built by web/make_installer.py): the data step
// (the page cuts and converts a WAD itself, with the real converter) and the install flow against a model of the
// Doom firmware's side of the protocol (firmware/doom_dev.c: handshake, cmd 0x44, read requests).
// Step 1 of the install (the standard firmware update) is Felucca's code and is not modelled: every install
// scenario starts with the firmware already on the device.
//     node web/test_installer.js SITE_DIR [DOOM1.WAD]        (default WAD: wads/doom1.wad)
const fs = require('fs'), path = require('path'), vm = require('vm');
const site = path.resolve(process.argv[2]);
const wadPath = process.argv[3] || path.join(__dirname, '..', 'wads', 'doom1.wad');
const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
const siteMeta = JSON.parse(/const site = (\{.*?\});\n/.exec(script)[1]);
const WhdGen = require(path.join(site, 'whd_gen.js'));
let meta = null, data2 = null;          // what the page prepared (the same for every scenario: one WAD)

const pack7 = (data) => { const out = []; let acc = 0, nb = 0; for (const b of data) { acc |= b << nb; nb += 8; while (nb >= 7) { out.push(acc & 0x7F); acc >>>= 7; nb -= 7; } } if (nb) out.push(acc & 0x7F); return out; };
const unpack7 = (s) => { const out = []; let acc = 0, nb = 0; for (const b of s) { acc |= (b & 0x7F) << nb; nb += 7; while (nb >= 8) { out.push(acc & 0xFF); acc >>>= 8; nb -= 8; } } return out; };
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const rd32 = (u, i) => (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16) | (u[i + 3] << 24)) >>> 0;

// what ota.c's ota_send_msg puts on the wire
const msg = (cmd, body) => { let s = 0; for (const b of body) s += b; return [0xF0, ...pack7([0, 0x59, cmd, body.length & 255, body.length >> 8, 0, ...body, ~s & 255]), 0xF7]; };

class DoomDev {                       // mode: 0 game, 4 safe (second block missing), 2 safe (HOME held)
  constructor(o) { Object.assign(this, { mode: 4, stopAt: -1, got: null, flags: [], log: [] }, o); }
  adopt(m) { for (const [k, v] of Object.entries({ build: m.build, total: m.total, split: m.split, crc2: m.data2_crc16 })) if (this[k] === undefined) this[k] = v; }
  attach(emit) { this.emit = (bytes) => setTimeout(() => emit(bytes), 1); }
  recv(bytes) {
    if (bytes[0] !== 0xF0) return;
    const u = unpack7(bytes.slice(1, -1));                               // ota_take
    if (u.length < 7 || u[0] !== 0 || u[1] !== 0x59) return;
    const len = u[3] | (u[4] << 8) | (u[5] << 16), d = len + 7;
    if (u.length < d) return;
    let s = 0; for (let i = 6; i < d - 1; i++) s += u[i];
    if ((~s & 255) !== u[d - 1]) return;
    if (d === 7 && u[2] === 0x11) return this.emit(msg(0x11, [...Buffer.from(meta.product), ...new Array(27 - meta.product.length).fill(0)]));
    if (d === 19 && u[2] === 0x44) return this.request(rd32(u, 6), rd32(u, 10), rd32(u, 14));
    if (u[2] === 0x30 && this.want) return this.answer(u, d);
  }
  reply(code) { this.emit(msg(0x44, [code, this.mode, 1, 0, ...le32(this.total), ...le32(this.split), ...le32(this.crc2), ...le32(this.build)])); }
  request(len, crc, flags) {
    this.flags.push(flags);
    if (this.mode === 0) return this.reply(1);
    if (len !== this.total - this.split || crc !== this.crc2) return this.reply(2);
    this.reply(0);
    if (flags & 2) return;
    this.got = Buffer.alloc(len); this.off = 0; this.len = len; this.ask();
  }
  ask() {                                                                  // ota_read: one request, the answer comes to recv()
    if (this.off === this.stopAt) { this.want = null; return; }            // (a firmware that has stopped)
    const fin = this.off >= this.len, addr = fin ? 0xF0000000 : this.off, n = fin ? 8 : Math.min(512, this.len - this.off);
    this.want = { addr, n };
    this.emit(msg(0x30, [0, ...le32(addr), n & 255, n >> 8, 0]));
  }
  answer(u, d) {
    const { addr, n } = this.want;
    if (d !== n + 15 || (u[3] | (u[4] << 8)) !== n + 8 || rd32(u, 7) !== addr || (u[11] | (u[12] << 8)) !== n) return;
    const data = Buffer.from(u.slice(14, 14 + n));
    if (addr === 0xF0000000) {
      this.want = null; this.finished = data.toString('latin1') === 'success\0';
      if (this.finished) setTimeout(() => { this.mode = 0; }, 300);         // restart into the game
      return;
    }
    data.copy(this.got, addr); this.off += n; this.ask();
  }
}

function page(search, dev) {
  const els = {};
  const mk = () => ({ textContent: '', className: '', style: {}, value: '', disabled: false, files: [], children: [],
    classList: { add() {}, remove() {} }, addEventListener(t, f) { this['on' + t] = f; }, appendChild(c) { this.children.push(c); }, click() {} });
  const el = (id) => els[id] || (els[id] = mk());
  const input = { name: 'Felucca', state: 'connected', open: async () => {}, onmidimessage: null };
  const output = { name: 'Felucca', state: 'connected', open: async () => {}, send: (b) => dev && dev.recv(Array.from(b)) };
  if (dev) dev.attach((bytes) => { if (input.onmidimessage) input.onmidimessage({ data: Uint8Array.from(bytes) }); });
  const window = { addEventListener() {} };
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, URLSearchParams, TextEncoder, Uint8Array, DataView, Set, RegExp, JSON, Math, Date, Array, String, Error, Map, Object, parseInt,
    location: { search }, window, requestAnimationFrame: (f) => setTimeout(f, 0),
    document: { getElementById: el, querySelectorAll: () => (els.bundled ? els.bundled.children : []), createElement: mk,
      head: { appendChild(s) { setTimeout(() => { window.WhdGen = WhdGen; s.onload(); }, 0); } } },
    navigator: { requestMIDIAccess: async () => ({ inputs: new Map([['i', input]]), outputs: new Map([['o', output]]) }) },
    fetch: async (f) => { const b = fs.readFileSync(path.join(site, f)); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; },
    crypto: globalThis.crypto });
  vm.runInContext(script, ctx);
  const until = async (f, ms) => { for (const end = Date.now() + ms; Date.now() < end;) { if (f()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };
  const pick = async (name, bytes) => {
    el('file').files = [{ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }];
    el('file').onchange();
    await until(() => /\b(ok|warn|fail)\b/.test(el('res').className), 30000);
    return { state: el('res').className.replace('result show', '').trim(), title: el('rest').textContent, more: el('resm').textContent, go: !el('go').disabled };
  };
  return { el, ctx, until, pick };
}

async function check(name, f) {
  let ok = false, note = '';
  try { [ok, note] = await f(); } catch (e) { note = String(e && e.stack || e); }
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}\n          ${note}`);
  return ok;
}

async function run(name, dev, search, expect) {
  const p = page(search, dev), el = p.el;
  await p.until(() => /Choose the game file/.test(el('say').textContent), 3000);
  const r = await p.pick('DOOM1.WAD', wad);
  dev.adopt(vm.runInContext('meta', p.ctx));
  const ready = el('say').textContent;
  await el('go').onclick();
  const said = el('say').textContent, st = [1, 2, 3, 4].map((n) => el('st' + n).className.replace('stage', '').trim() || '-').join(' ');
  const ok = r.state === 'ok' && expect(said, dev, ready, st, el('bar').style.width);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}\n          page: "${said}"  stages: ${st}  bar: ${el('bar').style.width}  log lines: ${el('log').textContent.split(String.fromCharCode(10)).length - 1}`);
  if (!ok) console.log(el('log').textContent.split('\n').slice(-12).join('\n'));
  return ok;
}

const wad = fs.readFileSync(wadPath);
(async () => {
  let all = true;
  // ---- the data step
  all &= await check('before a file is chosen: Install is off and the page says what to do', async () => {
    const p = page('', null);
    await p.until(() => /Choose the game file/.test(p.el('say').textContent), 3000);
    return [p.el('go').disabled === true && /Choose the game file/.test(p.el('say').textContent), `page: "${p.el('say').textContent}"`];
  });
  all &= await check('the shareware WAD: prepared in the page, recognised, equal to what firmware/pack.py made', async () => {
    const p = page('', null);
    await p.until(() => /Choose the game file/.test(p.el('say').textContent), 3000);
    const r = await p.pick('DOOM1.WAD', wad);
    meta = JSON.parse(JSON.stringify(vm.runInContext('meta', p.ctx))); data2 = Buffer.from(vm.runInContext('data2', p.ctx));
    const image = Buffer.from(vm.runInContext('image', p.ctx));
    const B = path.join(__dirname, '..', 'firmware', 'build'), want = JSON.parse(fs.readFileSync(path.join(B, 'doom_install.json'), 'utf8'));
    const part1 = fs.readFileSync(path.join(B, 'doom_part1.fwsc')), logical = Buffer.concat([...Array(20).keys()].map((i) => part1.subarray(i * 48, i * 48 + 47)).concat([part1.subarray(960)]));
    const same = image.equals(logical) && data2.equals(fs.readFileSync(path.join(B, 'doom_data2.bin'))) &&
      ['product', 'build', 'split', 'total', 'data2_len', 'data2_crc16'].every((k) => meta[k] === want[k]);
    return [r.state === 'ok' && /shareware 1\.9/.test(r.title) && /tested on an FM-1/.test(r.more) && r.go && same, `"${r.title}" / "${r.more}"  identical to pack.py's package and block 2: ${same}`];
  });
  all &= await check('the same WAD with one sound changed: prepared, but flagged as untested', async () => {
    const p = page('', null), mod = Buffer.from(wad);
    await p.until(() => /Choose the game file/.test(p.el('say').textContent), 3000);
    const dir = mod.readUInt32LE(8), n = mod.readUInt32LE(4);
    for (let i = 0; i < n; i++) if (mod.toString('latin1', dir + 16 * i + 8, dir + 16 * i + 16).replace(/\0+$/, '') === 'DSPISTOL') mod[mod.readUInt32LE(dir + 16 * i) + 100] ^= 0x20;
    const r = await p.pick('mine.wad', mod);
    return [r.state === 'warn' && /mine\.wad/.test(r.title) && /not the shareware 1\.9 file/.test(r.more) && r.go, `"${r.title}" / "${r.more.slice(0, 90)}..."`];
  });
  all &= await check('a file that is no WAD: refused, Install stays off', async () => {
    const p = page('', null);
    await p.until(() => /Choose the game file/.test(p.el('say').textContent), 3000);
    const r = await p.pick('holiday.jpg', Buffer.from('this is not a wad at all, just some text'));
    return [r.state === 'fail' && /Can't use holiday\.jpg/.test(r.title) && /not a Doom WAD/.test(r.more) && !r.go, `"${r.title}" / "${r.more}"`];
  });
  all &= await check('an add-on WAD (PWAD): refused with the reason', async () => {
    const p = page('', null), pw = Buffer.from(wad.subarray(0, 4096)); pw.write('PWAD', 0, 'latin1');
    await p.until(() => /Choose the game file/.test(p.el('say').textContent), 3000);
    const r = await p.pick('addon.wad', pw);
    return [r.state === 'fail' && /add-on/.test(r.more) && !r.go, `"${r.title}" / "${r.more}"`];
  });
  all &= await check('a WAD cut short: refused', async () => {
    const p = page('', null);
    await p.until(() => /Choose the game file/.test(p.el('say').textContent), 3000);
    const r = await p.pick('DOOM1.WAD', wad.subarray(0, wad.length - 5000));
    return [r.state === 'fail' && /damaged|cut short/.test(r.more) && !r.go, `"${r.title}" / "${r.more}"`];
  });
  const fd = path.join(__dirname, '..', 'wads', 'freedoom-0.13.0', 'freedoom1.wad');
  if (fs.existsSync(fd)) all &= await check('Freedoom Phase 1: refused, and the page says why', async () => {
    const p = page('', null);
    await p.until(() => /Choose the game file/.test(p.el('say').textContent), 3000);
    const r = await p.pick('freedoom1.wad', fs.readFileSync(fd));
    return [r.state === 'fail' && /This is Freedoom/.test(r.more) && !r.go, `"${r.title}" / "${r.more}"`];
  });
  if (siteMeta.bundled.length) all &= await check('the bundled data button: prepared without a WAD', async () => {
    const p = page('', null);
    await p.until(() => /Choose the game file/.test(p.el('say').textContent), 3000);
    p.el('bundled').children[0].onclick();
    await p.until(() => /\b(ok|fail)\b/.test(p.el('res').className), 5000);
    return [/\bok\b/.test(p.el('res').className) && !p.el('go').disabled, `"${p.el('rest').textContent}"`];
  });
  if (!meta) { console.log('INSTALLER PAGE TEST FAILED (no data prepared)'); process.exit(1); }
  // ---- the install flow
  all &= await run('safe mode, second block missing: the page sends it and the game starts', new DoomDev({ mode: 4 }), '',
    (said, d, r, st, w) => /^Done/.test(said) && d.finished && d.got.equals(data2) && d.mode === 0 && d.flags.join() === '2,2,0,2' && st === 'done done done done' && w === '100%');
  all &= await run('the game already running this build: nothing to do, nothing sent', new DoomDev({ mode: 0 }), '',
    (said, d, r, st, w) => /^Done/.test(said) && d.got === null && d.flags.every((f) => f === 2) && st === 'done done done done' && w === '100%');
  all &= await run('test mode from the safe screen: the rewrite flag reaches the firmware', new DoomDev({ mode: 2 }), '?force=1',
    (said, d, ready) => /test mode/i.test(ready) && /^Done/.test(said) && d.finished && d.got.equals(data2) && d.flags.includes(1));
  all &= await run('test mode while the game runs: asks for the safe screen, sends nothing', new DoomDev({ mode: 0 }), '?force=1',
    (said, d, r, st) => /hold HOME/.test(said) && d.got === null && st === 'done done fail -');
  all &= await run('the firmware stops asking part way: reported', new DoomDev({ mode: 4, stopAt: 512 * 40 }), '',
    (said, d, r, st) => /stopped asking/.test(said) && !d.finished && st === 'done done fail -');
  console.log(all ? 'INSTALLER PAGE TEST PASSED' : 'INSTALLER PAGE TEST FAILED');
  process.exit(all ? 0 : 1);
})();
