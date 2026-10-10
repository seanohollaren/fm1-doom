// Headless test of the one-button installer page (web/installer.html as built by web/make_installer.py) against a
// model of the Doom firmware's side of the protocol (firmware/doom_dev.c: handshake, cmd 0x44, read requests).
// Step 1 (the standard firmware update) is Felucca's code and is not modelled: every scenario starts with the
// firmware already on the device.     node web/test_installer.js SITE_DIR
const fs = require('fs'), path = require('path'), vm = require('vm');
const site = process.argv[2];
const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
const meta = JSON.parse(/const meta = (\{.*?\});/.exec(script)[1]);
const data2 = fs.readFileSync(path.join(site, meta.data2));

const pack7 = (data) => { const out = []; let acc = 0, nb = 0; for (const b of data) { acc |= b << nb; nb += 8; while (nb >= 7) { out.push(acc & 0x7F); acc >>>= 7; nb -= 7; } } if (nb) out.push(acc & 0x7F); return out; };
const unpack7 = (s) => { const out = []; let acc = 0, nb = 0; for (const b of s) { acc |= (b & 0x7F) << nb; nb += 7; while (nb >= 8) { out.push(acc & 0xFF); acc >>>= 8; nb -= 8; } } return out; };
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const rd32 = (u, i) => (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16) | (u[i + 3] << 24)) >>> 0;

// what ota.c's ota_send_msg puts on the wire
const msg = (cmd, body) => { let s = 0; for (const b of body) s += b; return [0xF0, ...pack7([0, 0x59, cmd, body.length & 255, body.length >> 8, 0, ...body, ~s & 255]), 0xF7]; };

class DoomDev {                       // mode: 0 game, 4 safe (second block missing), 2 safe (HOME held)
  constructor(o) { Object.assign(this, { mode: 4, build: meta.build, total: meta.total, split: meta.split, crc2: meta.data2_crc16, stopAt: -1, got: null, flags: [], log: [] }, o); }
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

async function run(name, dev, search, expect) {
  const els = {}, el = (id) => els[id] || (els[id] = { textContent: '', className: '', style: {}, value: 0, disabled: false, scrollTop: 0, addEventListener(t, f) { this['on' + t] = f; } });
  const input = { name: 'Felucca', state: 'connected', open: async () => {}, onmidimessage: null };
  const output = { name: 'Felucca', state: 'connected', open: async () => {}, send: (b) => dev.recv(Array.from(b)) };
  dev.attach((bytes) => { if (input.onmidimessage) input.onmidimessage({ data: Uint8Array.from(bytes) }); });
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, URLSearchParams, TextEncoder, Uint8Array, JSON, Math, Date, Array, String, Error, Map, parseInt,
    location: { search }, document: { getElementById: el }, window: { addEventListener() {} },
    navigator: { requestMIDIAccess: async () => ({ inputs: new Map([['i', input]]), outputs: new Map([['o', output]]) }) },
    fetch: async (f) => { const b = fs.readFileSync(path.join(site, f)); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; },
    crypto: globalThis.crypto });
  vm.runInContext(script, ctx);
  await new Promise((r) => setTimeout(r, 300));
  const ready = el('say').textContent;
  await el('go').onclick();
  const said = el('say').textContent, st = [1, 2, 3, 4].map((n) => el('st' + n).className.replace('stage', '').trim() || '-').join(' ');
  const ok = expect(said, dev, ready, st, el('bar').style.width);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}\n          page: "${said}"  stages: ${st}  bar: ${el('bar').style.width}  log lines: ${el('log').textContent.split(String.fromCharCode(10)).length - 1}`);
  if (!ok) console.log(el('log').textContent.split('\n').slice(-12).join('\n'));
  return ok;
}

(async () => {
  let all = true;
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
