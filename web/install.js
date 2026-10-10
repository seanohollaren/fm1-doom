// SPDX-License-Identifier: GPL-3.0-only
// FM-1 Doom: the install itself, with no page around it. Both installer pages use it (web/installer.html, the
// site in site/frontend), and the tests drive it against a model of the firmware.
//
//   1. the standard firmware update (Felucca's Updater, unchanged): the firmware and the first block of the game
//      data, both inside the app slot
//   2. the second block of the game data: the Doom firmware asks for it and writes it to flash itself
//      (firmware/doom_dev.c, cmd 0x44)
//
// Nothing here touches the page: progress goes out through `on(event)`:
//   { t: "stage", n: 1..4, state: "now" | "done" | "fail" | "", note }     the four steps of the install
//   { t: "bar", f: 0..1 | null, state: "" | "done" | "fail" }              the one progress bar (null: keep its length)
//   { t: "say", text }                                                     the status line, for a person
//   { t: "log", text }                                                     state changes, for the details log
//   { t: "phase", name, f }                                                what the FM-1 is doing (its screen differs by phase):
//        "find" | "check" | "loader" | "write" | "reboot" | "wait" | "data" | "restart" | "game" | "fail"
import { Updater, pack7, unpack7 } from "./vendor/felucca/fm1ota.js";

export const QUERY = 2, FORCE = 1;      // cmd 0x44 flags: only answer / rewrite sectors that already match
export const MODES = ["game", "safe (last start failed)", "safe (HOME held)", "safe (no data)", "safe (second block missing)"];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const u32le = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const u32at = (u, i) => (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16) | (u[i + 3] << 24)) >>> 0;
const isLoader = (id) => /^ota-/i.test(id.model);

// one message of the update protocol: 00 59 cmd len24 body ~sum(body), 7-bit packed between F0 and F7
export function frame(cmd, body) {
  const d = [0x00, 0x59, cmd, body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, ...body];
  let s = 0;
  for (const b of body) s += b;
  d.push(~s & 255);
  return [0xF0, ...pack7(d), 0xF7];
}

export function parseDataReply(pkt) {
  if (pkt[0] !== 0xF0 || pkt[pkt.length - 1] !== 0xF7) return null;
  const u = unpack7(pkt.slice(1, -1));
  if (u.length < 27 || u[0] !== 0 || u[1] !== 0x59 || u[2] !== 0x44 || (u[3] | (u[4] << 8) | (u[5] << 16)) !== 20) return null;
  let s = 0;
  for (let i = 6; i < 26; i++) s += u[i];
  if ((~s & 255) !== u[26]) return null;
  return { code: u[6], mode: u[7], flash: u[8], total: u32at(u, 10), split: u32at(u, 14), crc2: u32at(u, 18), build: u32at(u, 22) };
}

// the page's own arithmetic, checked before anything is sent: the handshake query, built by frame()
export function selfCheck() {
  return JSON.stringify(frame(0x11, [])) === JSON.stringify([0xF0, 0x00, 0x32, 0x45, 0x00, 0x00, 0x00, 0x40, 0x7F, 0xF7]);
}

// ask the Doom firmware about its second data block (flags: QUERY = only answer, FORCE = rewrite even if it matches)
async function ask(link, len, crc, flags, log) {
  link.drain();
  for (let t = 0; t < 3; t++) {
    if (!link.send(frame(0x44, [...u32le(len), ...u32le(crc), ...u32le(flags)]))) return null;
    const end = Date.now() + 1500;
    while (Date.now() < end) {
      const p = await link.read(end - Date.now());
      if (!p) break;
      const r = parseDataReply(p);
      if (r) { log(`data reply: code ${r.code}, mode ${MODES[r.mode] || r.mode}, build ${r.build.toString(16)}`); return r; }
    }
  }
  return null;
}

/**
 * @typedef {{ product: string, build: number, total: number, split: number, data2_len: number, data2_crc16: number }} InstallMeta
 */

// Look for the FM-1 without changing anything on it (the identity handshake; for our own firmware also the
// question about its game data, which it only answers). meta: what is about to be installed, or null.
//   -> { kind: "none" } | { kind: "loader", id } | { kind: "device", id, version, port, doom: reply | null, same }
/**
 * @param {any} midi a MIDIAccess with SysEx
 * @param {InstallMeta | null} [meta]
 */
export async function probe(midi, meta = null) {
  const up = new Updater(midi, () => {});
  const ota = await up.find(isLoader);
  if (ota) { ota.link.close(); return { kind: "loader", id: ota.id.text, port: ota.name }; }
  const dev = await up.find((id) => !isLoader(id));
  if (!dev) return { kind: "none" };
  let doom = null;
  if (meta && dev.id.text === meta.product) doom = await ask(dev.link, meta.data2_len, meta.data2_crc16, QUERY, () => {});
  dev.link.close();
  const same = !!(doom && meta && doom.build === meta.build && doom.total === meta.total && doom.split === meta.split && doom.crc2 === meta.data2_crc16);
  return { kind: "device", id: dev.id.text, model: dev.id.model, version: dev.id.version, port: dev.name, doom, same };
}

// image: the logical image of the package (fm1pkg.js logicalImage); data2: the second block;
// meta: { product, build, total, split, data2_len, data2_crc16 }; force: test mode (rewrite block 2 once).
//   -> { ok: true } | { ok: false, message }
/**
 * @param {{ midi: any, image: Uint8Array, data2: Uint8Array, meta: InstallMeta, force?: boolean, on?: (ev: any) => void }} opts
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function install({ midi, image, data2, meta, force = false, on = () => {} }) {
  let current = 0;
  const stage = (n, state, note) => { if (state === "now") current = n; on({ t: "stage", n, state, note }); };
  const bar = (f, state = "") => on({ t: "bar", f, state });
  const say = (text) => on({ t: "say", text });
  const log = (text) => on({ t: "log", text });
  const phase = (name, f) => on({ t: "phase", name, f });
  const mine = (r) => r && r.build === meta.build && r.total === meta.total && r.split === meta.split && r.crc2 === meta.data2_crc16;
  const stop = (msg) => { const e = new Error(msg); e.shown = true; return e; };
  const query = (link, flags) => ask(link, data2.length, meta.data2_crc16, flags, log);
  try {
    const up = new Updater(midi, () => {});
    // the bar: stage 1 to 4 %, stage 2 to 60 %, stage 3 to 97 %, 100 % when the game answers
    const N1 = 74 + 1167, N2 = Math.ceil(data2.length / 512);
    let last = "";
    const step = (k, a) => {
      if (k !== last) { log(`${k}${a !== undefined && typeof a !== "number" ? " " + a : ""}`); last = k; }
      if (k === "verify") { say("Checking the firmware file with the FM-1"); bar(0.04 + 0.56 * a / N1); phase("check", a / 74); }
      if (k === "loader") { say("Switching to update mode. The FM-1's screen goes dark for a while."); phase("loader"); }
      if (k === "write") { say("Writing the firmware. Don't unplug the FM-1."); bar(0.04 + 0.56 * (74 + a) / N1); phase("write", a / 1167); }
      if (k === "reboot") { say("Restarting the FM-1"); phase("reboot"); }
    };
    stage(1, "now"); say("Looking for the FM-1"); phase("find");
    // an update loader left waiting by an interrupted install: finish that first
    const ota = await up.find(isLoader);
    if (ota) {
      ota.link.close();
      log("found an FM-1 waiting in update mode: resuming");
      stage(1, "done", "in update mode"); stage(2, "now"); bar(0.04);
      if (!(await up.resume(image, step, meta.product))) throw stop("The update stopped. Replug the USB cable and press Install again.");
      stage(2, "done");
    } else {
      const dev = await up.find((id) => !isLoader(id));
      if (!dev) throw stop("FM-1 not found. Check that the USB cable carries data, close other apps that use MIDI, and press Install again.");
      log(`found ${dev.id.text} on "${dev.name}"`);
      let have = false;
      if (dev.id.text === meta.product) have = mine(await query(dev.link, QUERY));   // only our own firmware is asked
      dev.link.close();
      stage(1, "done"); stage(2, "now"); bar(0.04);
      if (have) { log("this firmware build and this game data's first block are already installed: stage 2 skipped"); stage(2, "done", "already installed"); }
      else { await up.install(image, meta.product, step); stage(2, "done"); }
    }
    bar(0.6); stage(3, "now");
    // the second block of the game data, written by the firmware itself
    for (let round = 0; ; round++) {
      say(round ? "Restarting the FM-1" : "Looking for the new firmware"); phase(round ? "restart" : "wait");
      await pause(round ? 3000 : 500);
      const dev = await up.waitFor((id) => id.text === meta.product, 40000);
      if (!dev) throw stop("The FM-1 did not come back. Switch it off and on, then press Install again.");
      const q = await query(dev.link, QUERY);
      if (!q) { dev.link.close(); throw stop("The firmware did not answer the question about its game data. Press Install again."); }
      if (!mine(q)) { dev.link.close(); throw stop("The FM-1 reports a different build than this page installs. Press Install again."); }
      if (q.code === 1 && !(force && round === 0)) {
        dev.link.close();
        stage(3, "done", round ? "" : "already there"); stage(4, "done"); bar(1, "done");
        say("Done. Doom is running on the FM-1."); phase("game");
        return { ok: true };
      }
      if (q.code === 1) { dev.link.close(); throw stop("Test mode needs the safe screen: switch the FM-1 off, hold HOME, switch it on, then press Install again."); }
      if (q.code !== 0) { dev.link.close(); throw stop(q.code === 3 ? "The FM-1's flash chip is not the expected one. Nothing was written." : "The firmware refused the game data (code " + q.code + ")."); }
      if (round >= 2) { dev.link.close(); throw stop("The game data was sent twice and the game still does not start. Press Install again, or report this."); }
      const go = await query(dev.link, force && round === 0 ? FORCE : 0);
      if (!go || go.code !== 0) { dev.link.close(); throw stop("The firmware did not start taking the game data. Press Install again."); }
      say("Sending the game data. Don't unplug the FM-1."); phase("data", 0);
      const s = await up.serve(dev.link, data2, 0xF0000000, 30000, (n) => { const f = Math.min(1, n / N2); bar(0.6 + 0.37 * f); phase("data", f); });
      dev.link.close();
      log(`data: ${s.served} requests served, finished ${s.finished}`);
      if (!s.finished) throw stop(s.lost ? "The USB connection was lost while sending the game data. Replug it and press Install again." :
                                          "The FM-1 stopped asking for the game data. Press Install again; it carries on where it was.");
      stage(3, "done"); stage(4, "now"); bar(0.97);
    }
  } catch (e) {
    const T = { notfound: "FM-1 not found. Check that the USB cable carries data, close other apps that use MIDI, and press Install again.",
                model: "The connected device is not an FM-1.", stopped: "The update stopped before anything was written. Replug the USB cable and press Install again.",
                lost: "The USB connection was lost. Replug it and press Install again.",
                noloader: "The FM-1 did not appear in update mode. Replug the USB cable and press Install again; it stays in update mode until the update is finished.",
                noreturn: "The FM-1 did not come back. Switch it off and on, then press Install again.",
                mismatch: "The firmware was written, but the FM-1 reports another version: " + (e && e.detail || "") };
    const message = e && e.shown ? e.message : e && e.code && T[e.code] ? T[e.code] : "Something went wrong: " + (e && e.message);
    log(String(e && e.stack || e));
    if (current) stage(current, "fail");
    bar(null, "fail"); phase("fail");
    say(message);
    return { ok: false, message };
  }
}
