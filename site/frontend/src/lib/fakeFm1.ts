// A stand-in for an FM-1 on the other end of Web MIDI: enough of the update protocol to run a whole install
// against it. The tests use it; so does the page's dev-only demo (?demo, never in a production build).
//
// Two halves, as on the real thing:
//   - the standard update: the running firmware reads a few parts of the package, restarts into the update
//     loader, and the loader reads the whole image (Felucca's ota.c and loader; the reads are simplified here)
//   - the Doom firmware: identity, the question about its game data (cmd 0x44), and the pull of data block 2
//     (firmware/doom_dev.c, firmware/dev_data.h)
import { pack7, unpack7 } from '@fm1/vendor/felucca/fm1ota.js'
import type { InstallMeta } from './types'

const le32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]
const rd32 = (u: number[], i: number) => (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16) | (u[i + 3] << 24)) >>> 0
// what ota.c's ota_send_msg puts on the wire
const msg = (cmd: number, body: number[]) => {
  let s = 0
  for (const b of body) s += b
  return [0xf0, ...pack7([0, 0x59, cmd, body.length & 255, body.length >> 8, 0, ...body, ~s & 255]), 0xf7]
}
const UPGRADE = [0xf0, 0x22, 0x24, 0x35, 0x7f, 0xf7]

export interface FakeOptions {
  /** what the device runs at the start: another firmware's identity (e.g. "FM-1_915"), or the Doom firmware's */
  identity: string
  /** the Doom firmware's mode: 0 game, 1 amber, 2 cyan (HOME held), 3 no data, 4 second block missing */
  mode: number
  /** what a Doom firmware already on the device reports about itself (default: exactly what is being installed) */
  holds: InstallMeta | null
  /** stop asking for data block 2 at this offset: a firmware that has hung */
  stopAt: number
  /** milliseconds between the device's requests (0 in tests; a little in the demo, so it can be watched) */
  pace: number
}

export class FakeFm1 {
  opts: FakeOptions
  /** what the page was asked to install: learned from the package the "loader" reads */
  written: Uint8Array | null = null
  got: Uint8Array | null = null
  finished = false
  flags: number[] = []
  private emit: (bytes: number[]) => void = () => {}
  private state: 'app' | 'verify' | 'loader' | 'write' = 'app'
  private want: { addr: number; n: number } | null = null
  private off = 0
  private len = 0
  private verifyLeft = 0
  /** what the package being installed will make of the device */
  private next: InstallMeta | null = null
  /** what the Doom firmware on the device reports now (null: another firmware runs) */
  private now: InstallMeta | null = null
  private product = 'FM-1_666'
  /** the loader knows the image's length from its header; the stand-in is told */
  private imageLength = 0

  constructor(o: Partial<FakeOptions> = {}) {
    this.opts = { identity: 'FM-1_666', mode: 4, holds: null, stopAt: -1, pace: 0, ...o }
  }

  /** what is about to be installed: the stand-in cannot read a package, so it is told what the package holds */
  expect(meta: InstallMeta, imageLength: number) {
    this.next = meta
    this.product = meta.product
    this.imageLength = imageLength
    this.now = this.opts.identity === meta.product ? (this.opts.holds ?? meta) : null
  }

  attach(emit: (bytes: number[]) => void) {
    this.emit = (bytes) => setTimeout(() => emit(bytes), this.opts.pace)
  }

  private ident() {
    const text = this.state === 'loader' || this.state === 'write' ? 'ota-FM-1_1' : this.opts.identity
    this.emit(msg(0x11, [...new TextEncoder().encode(text), ...new Array(27 - text.length).fill(0)]))
  }

  recv(bytes: number[]) {
    if (bytes.length === UPGRADE.length && bytes.every((b, i) => b === UPGRADE[i])) return this.upgrade()
    if (bytes[0] !== 0xf0) return
    const u = unpack7(bytes.slice(1, -1)) as number[]
    if (u.length < 7 || u[0] !== 0 || u[1] !== 0x59) return
    const len = u[3] | (u[4] << 8) | (u[5] << 16)
    const d = len + 7
    if (u.length < d) return
    let s = 0
    for (let i = 6; i < d - 1; i++) s += u[i]
    if ((~s & 255) !== u[d - 1]) return
    if (d === 7 && u[2] === 0x11) return this.ident()
    if (d === 19 && u[2] === 0x44 && this.state === 'app' && this.now) return this.dataRequest(rd32(u, 6), rd32(u, 10), rd32(u, 14))
    if (u[2] === 0x30 && this.want) return this.answer(u, d)
  }

  // ---- the standard update
  private upgrade() {
    if (this.state === 'app') {
      this.state = 'verify'
      this.verifyLeft = 74
      this.off = 0
      this.ask(0)
    } else if (this.state === 'loader') {
      this.state = 'write'
      this.off = 0
      this.written = null
      this.ask(0)
    }
  }

  private ask(addr: number, n = 512) {
    this.want = { addr, n }
    this.emit(msg(0x30, [0, ...le32(addr), n & 255, n >> 8, 0]))
  }

  private answer(u: number[], d: number) {
    const { addr, n } = this.want!
    if (d !== n + 15 || (u[3] | (u[4] << 8)) !== n + 8 || rd32(u, 7) !== addr || (u[11] | (u[12] << 8)) !== n) return
    const data = u.slice(14, 14 + n)
    this.want = null
    if (addr === 0xe0000000) {
      // the app has staged the loader: restart into it
      setTimeout(() => (this.state = 'loader'), 300 + this.opts.pace * 20)
      return
    }
    if (addr === 0xf0000000) {
      if (this.state === 'write') {
        // the loader has written the image: restart into the new firmware, which lacks its second block
        setTimeout(() => {
          const before = this.now
          this.state = 'app'
          this.opts.identity = this.product
          this.now = this.next
          // block 2 is not part of the package: the game starts only if the flash already holds the right one
          this.opts.mode = before && this.next && before.data2_crc16 === this.next.data2_crc16 && before.data2_len === this.next.data2_len ? 0 : 4
        }, 300 + this.opts.pace * 20)
      } else {
        this.finished = String.fromCharCode(...data) === 'success\0'
        if (this.finished) setTimeout(() => (this.opts.mode = 0), 300) // restart into the game
      }
      return
    }
    if (this.state === 'verify') {
      this.off += n
      if (--this.verifyLeft > 0) this.ask(this.off)
      else this.ask(0xe0000000, 8)
    } else if (this.state === 'write') {
      if (!this.written) this.written = new Uint8Array(0)
      const grown = new Uint8Array(this.off + n)
      grown.set(this.written)
      grown.set(data, this.off)
      this.written = grown
      this.off += n
      // the loader reads to the end of the image; a short answer never comes, so it is told the length up front
      if (this.off < this.imageLength) this.ask(this.off, Math.min(512, this.imageLength - this.off))
      else this.ask(0xf0000000, 8)
    } else {
      this.got!.set(data, addr)
      this.off += n
      this.pull()
    }
  }

  // ---- the Doom firmware
  private reply(code: number) {
    const h = this.now
    this.emit(msg(0x44, [code, this.opts.mode, 1, 0, ...le32(h?.total ?? 0), ...le32(h?.split ?? 0), ...le32(h?.data2_crc16 ?? 0), ...le32(h?.build ?? 0)]))
  }

  private dataRequest(len: number, crc: number, flags: number) {
    this.flags.push(flags)
    const h = this.now
    if (this.opts.mode === 0) return this.reply(1)
    if (!h || len !== h.data2_len || crc !== h.data2_crc16) return this.reply(2)
    this.reply(0)
    if (flags & 2) return
    this.got = new Uint8Array(len)
    this.off = 0
    this.len = len
    this.pull()
  }

  private pull() {
    if (this.off === this.opts.stopAt) {
      this.want = null
      return
    }
    if (this.off >= this.len) this.ask(0xf0000000, 8)
    else this.ask(this.off, Math.min(512, this.len - this.off))
  }
}

/** A MIDIAccess with one FM-1 on it, good for Felucca's Updater. */
export function fakeMidi(dev: FakeFm1) {
  const input = { name: 'Felucca', state: 'connected', open: async () => {}, onmidimessage: null as null | ((ev: { data: Uint8Array }) => void) }
  const output = { name: 'Felucca', state: 'connected', open: async () => {}, send: (b: Iterable<number>) => dev.recv(Array.from(b)) }
  dev.attach((bytes) => input.onmidimessage?.({ data: Uint8Array.from(bytes) }))
  return { inputs: new Map([['i', input]]), outputs: new Map([['o', output]]) }
}
