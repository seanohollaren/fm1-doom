#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""fm1restore: the part of the boot-mode tooling that can WRITE the FM-1's flash (tools/fm1boot.py cannot).

  fm1restore.py selftest                             no device: everything below against a simulated FM-1
  sudo fm1restore.py compare BACKUP.bin [--all]      reads only: which 4 KB sectors differ from the backup
  sudo fm1restore.py sectortest [BACKUP.bin] [--sector=0x95000]
                                                     erase / program / verify / erase one BLANK sector that no
                                                     firmware uses, and leave it blank again; with a backup,
                                                     then read everything and compare
  sudo fm1restore.py restore BACKUP.bin --write [--all]
                                                     make the flash equal the backup: application area
                                                     [0x4000, 0x93000), or with --all everything from 0x4000

Rules built in:
  * nothing below 0x4000 (flash header, boot loader, chip configuration) is ever erased or written;
  * only whole 4 KB sectors, only sectors that differ, each read back after writing, three tries each;
  * the backup must be a sound image (tools/check_dump.py) whose first 0x4000 bytes equal the device's;
  * `restore` without --write only lists what it would do;
  * the only flash-changing commands in this file are "erase one 4 KB sector" and "program up to 512 bytes".
    Block erase, chip erase and key write are absent.

The FM-1 must be in boot mode (Felucca / our firmware: hold OCT- and OCT+ for 5 s). The chip restarts by itself
about 3 s after the last command. Commands and their order are those of FM-1 Transporter src/jieli_uboot.c
(MIT, (c) 2026 kurogedelic), verified on FM-1 hardware by its author.
"""
import hashlib
import select
import signal
import struct
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fm1boot as fb                                  # noqa: E402
from fm1boot import Fm1Error, FLASH_SIZE, IO          # noqa: E402

SECTOR = 0x1000
FLOOR = 0x4000                          # never write below this, whatever the caller asks
APP_LO, APP_HI = 0x4000, 0x93000
GAP_LO, GAP_HI = 0x93000, 0x97000       # blank on this unit and outside every firmware's own ranges
TEST_SECTOR = 0x95000
CMD_ERASE_SECTOR = 0xFB01
CMD_WRITE_FLASH = 0xFB04
TRIES = 3


def wcdb(cmd, args):
    if cmd not in (CMD_ERASE_SECTOR, CMD_WRITE_FLASH):
        raise Fm1Error(f"command {cmd:04X} is not one this tool sends")
    return (struct.pack(">H", cmd) + args).ljust(16, b"\xff")


class Writer:
    def __init__(self, proto, log, lo, hi):
        if lo < FLOOR or hi > FLASH_SIZE or lo % SECTOR or hi % SECTOR or lo >= hi:
            raise Fm1Error(f"write window {lo:06X}-{hi:06X} not allowed")
        self.p, self.log, self.lo, self.hi = proto, log, lo, hi

    def guard(self, addr):
        if addr < FLOOR or addr % SECTOR or not self.lo <= addr < self.hi:
            raise Fm1Error(f"sector {addr:06X} is outside the write window {self.lo:06X}-{self.hi:06X}; nothing sent")

    def erase(self, addr):
        self.guard(addr)
        r = self.p.t.bot(wcdb(CMD_ERASE_SECTOR, struct.pack(">I", addr)), n_in=16)
        if len(r) != 16 or struct.unpack(">H", r[:2])[0] != CMD_ERASE_SECTOR:
            raise Fm1Error(f"erase {addr:06X} answered {r.hex()}")

    def program(self, addr, data):
        self.guard(addr)
        if len(data) != SECTOR:
            raise Fm1Error("whole sectors only")
        for off in range(0, SECTOR, IO):
            block = data[off:off + IO]
            args = struct.pack(">IH", addr + off, IO) + b"\x00" + struct.pack("<H", fb.crc16(block))
            self.p.t.bot(wcdb(CMD_WRITE_FLASH, args), out=block)

    def read(self, addr):
        return self.p.read_flash(addr, SECTOR)

    def put(self, addr, data):
        """erase, program, read back; up to TRIES times. True when the sector reads back as `data`."""
        self.guard(addr)
        for n in range(1, TRIES + 1):
            try:
                self.erase(addr)
                if data != b"\xff" * SECTOR:
                    self.program(addr, data)
                if self.read(addr) == data:
                    return True
                self.log(f"sector {addr:06X}: read-back differs (try {n} of {TRIES})")
            except Fm1Error as e:
                self.log(f"sector {addr:06X}: {e} (try {n} of {TRIES})")
        return False


def differing(cur, want, lo, hi):
    return [a for a in range(lo, hi, SECTOR) if cur[a:a + SECTOR] != want[a:a + SECTOR]]


def load_backup(path, log):
    path = Path(path)
    want = path.read_bytes()
    if len(want) != FLASH_SIZE:
        raise Fm1Error(f"{path} is {len(want)} bytes, not 1 MiB")
    digest = hashlib.sha256(want).hexdigest()
    side = Path(str(path) + ".sha256")
    if side.exists() and side.read_text().split()[0] != digest:
        raise Fm1Error(f"{path} does not match its .sha256 file")
    import contextlib
    import io
    import check_dump
    buf = io.StringIO()
    check_dump.ok = True
    with contextlib.redirect_stdout(buf):
        rc = check_dump.main(["check_dump", str(path)])
    if rc != 0:
        log(buf.getvalue(), show=False)
        raise Fm1Error(f"{path} is not a sound flash image (run tools/check_dump.py on it)")
    log(f"backup {path.name}: sound image, sha256 {digest[:16]}")
    return want


def wait_enter(proto, prompt):
    """Wait for Enter while keeping the loader alive (it resets the chip ~3 s after the last command)."""
    print(prompt, flush=True)
    while True:
        r, _, _ = select.select([sys.stdin], [], [], 1.0)
        if r:
            sys.stdin.readline()
            return
        proto.info_quiet()


def restore(proto, log, want, lo, hi, write, interactive=True):
    """Returns the list of sectors that still differ (empty = flash equals the backup in [lo, hi))."""
    cur = proto.read_all("read before")
    if cur[:FLOOR] != want[:FLOOR]:
        raise Fm1Error("the first 0x4000 bytes on the device differ from the backup's: not this unit's backup; "
                       "nothing written")
    todo = differing(cur, want, lo, hi)
    log(f"{len(todo)} of {(hi - lo) // SECTOR} sectors in {lo:06X}-{hi:06X} differ from the backup" +
        (f": {todo[0]:06X} .. {todo[-1]:06X}" if todo else ""))
    if not todo or not write:
        if todo:
            log("dry run: nothing written (add --write)")
        return todo
    w = Writer(proto, log, lo, hi)
    head = APP_LO if APP_LO in todo else None
    if head is not None:
        # The sector holding the application directory goes blank first and is written last, so an interrupted
        # restore leaves "no application" rather than a directory that points at half-written code.
        w.erase(head)
        todo = [a for a in todo if a != head] + [head]
    while True:
        t0, left = time.time(), []
        old = signal.signal(signal.SIGINT, signal.SIG_IGN)       # Ctrl-C must not stop a write half way
        try:
            for i, a in enumerate(todo):
                if not w.put(a, want[a:a + SECTOR]):
                    left.append(a)
                if i % 16 == 15:
                    log(f"  {i + 1} of {len(todo)} sectors", show=True)
        finally:
            signal.signal(signal.SIGINT, old)
        log(f"wrote {len(todo) - len(left)} sectors in {time.time() - t0:.1f} s")
        cur = proto.read_all("read after")
        left = differing(cur, want, lo, hi)
        if cur[:FLOOR] != want[:FLOOR]:
            log("WARNING: the first 0x4000 bytes changed although nothing was written there")
        if not left:
            log(f"flash equals the backup in {lo:06X}-{hi:06X}")
            return []
        log(f"{len(left)} sectors still differ: {', '.join(f'{a:06X}' for a in left[:8])}")
        if not interactive:
            return left
        wait_enter(proto, "DO NOT unplug or switch off. Press Enter to try those sectors again (Ctrl-C gives up).")
        todo = left


REGIONS = [(0x00000, 0x04000, "header and boot loader"), (0x04000, 0x93000, "application"),
           (0x93000, 0x97000, "gap"), (0x97000, 0xE0000, "Felucca's store"), (0xE0000, 0xE5000, "update staging"),
           (0xE5000, 0xE8000, "Felucca autosave / voice bank"), (0xE8000, 0xFC000, "stock firmware's data"),
           (0xFC000, 0x100000, "Felucca settings")]
MAY_CHANGE = (0xE5000, 0xE8000), (0xFC000, 0x100000)     # what a running Felucca writes by itself


def compare_all(proto, log, want):
    """Full read against a backup. True when only regions a running firmware rewrites differ."""
    cur = proto.read_all("read after the test")
    good = True
    for lo, hi, name in REGIONS:
        n = len(differing(cur, want, lo, hi))
        allowed = any(a <= lo and hi <= b for a, b in MAY_CHANGE)
        if n:
            log(f"  {'note' if allowed else 'FAIL'}  {lo:06X}-{hi:06X} {name}: {n} sectors differ from the backup" +
                (" (Felucca's own saves)" if allowed else ""))
            good &= allowed
    if good:
        log("  ok    every sector outside Felucca's own save areas equals the backup")
    return good


def sectortest(proto, log, addr, want=None):
    if not GAP_LO <= addr < GAP_HI or addr % SECTOR:
        raise Fm1Error(f"the test sector must be one of {GAP_LO:06X}..{GAP_HI - SECTOR:06X}")
    w = Writer(proto, log, GAP_LO, GAP_HI)
    blank = b"\xff" * SECTOR
    around = [a for a in (addr - SECTOR, addr + SECTOR) if 0 <= a < FLASH_SIZE]
    before = {a: proto.read_flash(a, SECTOR) for a in around}
    if w.read(addr) != blank:
        raise Fm1Error(f"sector {addr:06X} is not blank; nothing written")
    # The last 256 bytes stay blank: the boot code looks for update records at "4 KB boundary minus 256".
    body = (b"FM1BOOT WRITE TEST " + bytes((i * 7 + 3) & 0xFF for i in range(SECTOR)))[:SECTOR - 256]
    pattern = body + b"\xff" * 256
    steps = []
    w.erase(addr)
    steps.append(("erase: sector reads blank", w.read(addr) == blank))
    w.program(addr, pattern)
    steps.append(("program: sector reads back as the test pattern", w.read(addr) == pattern))
    w.erase(addr)
    steps.append(("erase again: sector reads blank", w.read(addr) == blank))
    steps.append(("neighbouring sectors unchanged", all(proto.read_flash(a, SECTOR) == before[a] for a in around)))
    for name, good in steps:
        log(f"  {'ok  ' if good else 'FAIL'}  {name}")
    if not all(g for _, g in steps):
        if w.read(addr) != blank:
            log(f"sector {addr:06X} is not blank; trying to erase it once more")
            w.put(addr, blank)
        raise Fm1Error("write test failed")
    log(f"write test passed on sector {addr:06X}; it is blank again")
    if want is not None and not compare_all(proto, log, want):
        raise Fm1Error("the flash differs from the backup where it should not")


def _info_quiet(self):
    self.exec(fb.CMD_GET_ONLINE_DEVICE)


fb.Fm1Boot.info_quiet = _info_quiet


# ---------------------------------------------------------------------------------------------------------
class SimFlash(fb.SimFm1):
    """The simulated FM-1 of fm1boot.py with a flash that can be erased and programmed like NOR flash."""

    def __init__(self, image, loader, corrupt_once=(), fail_always=(), die_after=None):
        super().__init__(bytearray(image), loader)
        self.corrupt_once, self.fail_always, self.die_after = set(corrupt_once), set(fail_always), die_after
        self.erased, self.programmed, self.n, self.sent = [], [], 0, {}

    def bot(self, cb, n_in=0, out=b"", timeout_ms=3000):
        cb = bytes(cb)
        self.n += 1
        if self.die_after is not None and self.n > self.die_after:
            raise Fm1Error("simulated USB failure")
        cmd = struct.unpack(">H", cb[:2])[0] if len(cb) == 16 else None
        if cmd == CMD_ERASE_SECTOR:
            assert self.mode == "loader" and n_in == 16 and not out and cb[6:] == b"\xff" * 10
            addr = struct.unpack(">I", cb[2:6])[0]
            assert addr >= FLOOR and addr % SECTOR == 0 and addr < FLASH_SIZE, f"erase at {addr:06X}"
            self.erased.append(addr)
            if addr not in self.fail_always:
                self.image[addr:addr + SECTOR] = b"\xff" * SECTOR
            return cb[:2] + bytes(14)
        if cmd == CMD_WRITE_FLASH:
            assert self.mode == "loader" and not n_in and cb[11:] == b"\xff" * 5 and cb[8] == 0
            addr, n = struct.unpack(">IH", cb[2:8])
            assert n == len(out) == IO and struct.unpack("<H", cb[9:11])[0] == fb.crc16(out)
            assert addr >= FLOOR and addr + n <= FLASH_SIZE, f"write at {addr:06X}"
            assert addr // SECTOR * SECTOR in self.erased, "program without an erase first"
            self.programmed.append(addr)
            self.sent[addr] = bytes(out)
            data = bytearray(out)
            sec = addr // SECTOR * SECTOR
            if sec in self.corrupt_once and addr == sec:
                self.corrupt_once.discard(sec)
                data[5] ^= 0x01
            for i, b in enumerate(data):                 # NOR flash: programming only clears bits
                self.image[addr + i] &= b
            return b""
        return super().bot(cb, n_in, out, timeout_ms)


def selftest():
    import random
    ok = True
    silent = lambda *a, **k: None                                      # noqa: E731

    def check(name, cond):
        nonlocal ok
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}")
        ok &= bool(cond)

    def refuses(name, fn):
        try:
            fn()
            check(name, False)
        except Fm1Error:
            check(name, True)

    loader = fb.LOADER_FILE.read_bytes()
    rnd = random.Random(7)
    backup = bytearray(rnd.randrange(256) for _ in range(FLASH_SIZE))
    backup[0x93000:0xE5000] = b"\xff" * (0xE5000 - 0x93000)
    backup = bytes(backup)

    def session(image, **kw):
        sim = SimFlash(image, loader, **kw)
        p = fb.Fm1Boot(sim, silent)
        p.start_loader(loader)
        p.require_fm1()
        return sim, p

    # --- sector test
    sim, p = session(backup)
    sectortest(p, silent, TEST_SECTOR, backup)
    check("sector test passes and leaves the flash exactly as it was", bytes(sim.image) == backup)
    check("  it erased and programmed only the test sector",
          set(sim.erased) == {TEST_SECTOR} and {a // SECTOR * SECTOR for a in sim.programmed} == {TEST_SECTOR})
    check("  the last 256 bytes of the sector were only ever written as blank",
          sim.sent[TEST_SECTOR + SECTOR - IO][-256:] == b"\xff" * 256 and
          sim.sent[TEST_SECTOR][:19] == b"FM1BOOT WRITE TEST ")
    saved = bytearray(backup)
    saved[0xE5000 + 3] ^= 1
    saved[0xFC000 + 3] ^= 1
    sim, p = session(saved)
    sectortest(p, silent, TEST_SECTOR, backup)
    check("sector test + compare: changes in Felucca's own save areas are noted, not failed", True)
    moved = bytearray(backup)
    moved[0x60000 + 3] ^= 1
    sim, p = session(moved)
    refuses("sector test + compare: a changed application sector is reported", lambda: sectortest(p, silent, TEST_SECTOR, backup))
    dirty = bytearray(backup)
    dirty[TEST_SECTOR + 9] = 0
    sim, p = session(dirty)
    refuses("sector test refuses a sector that is not blank", lambda: sectortest(p, silent, TEST_SECTOR))
    check("  and sent no erase or program", not sim.erased and not sim.programmed)
    for bad in (0x0, 0x3000, 0x4000, 0x92000, 0x97000, 0xE8000, 0x95100):
        sim, p = session(backup)
        refuses(f"sector test refuses {bad:06X}", lambda: sectortest(p, silent, bad))
        check("  and sent no erase or program", not sim.erased and not sim.programmed)
    # --- the hard floor and the window
    sim, p = session(backup)
    refuses("a write window that starts below 0x4000 cannot be made", lambda: Writer(p, silent, 0x3000, APP_HI))
    w = Writer(p, silent, APP_LO, APP_HI)
    for bad in (0x0, 0x3000, 0x93000, 0x4100, 0xFF000):
        refuses(f"window [4000, 93000): sector {bad:06X} refused", lambda: w.put(bad, b"\x00" * SECTOR))
    check("  and nothing was sent", not sim.erased and not sim.programmed)
    # --- restore: a device with other firmware in the app area and other data above it
    other = bytearray(backup)
    for a in range(APP_LO, APP_HI, SECTOR):
        if a not in (0x20000, 0x21000):                                  # two sectors happen to be equal
            other[a + 1] ^= 0xFF
    other[0x95000 + 5] = 0x12
    other[0xE6000 + 5] ^= 0x40
    sim, p = session(other)
    left = restore(p, silent, backup, APP_LO, APP_HI, write=False, interactive=False)
    check("dry run: lists 141 differing sectors, writes nothing",
          len(left) == 141 and not sim.erased and not sim.programmed and bytes(sim.image) == bytes(other))
    sim, p = session(other)
    left = restore(p, silent, backup, APP_LO, APP_HI, write=True, interactive=False)
    check("restore (app area): flash equals the backup there", not left and
          sim.image[APP_LO:APP_HI] == backup[APP_LO:APP_HI])
    check("  sectors above the app area untouched", sim.image[0x95000 + 5] == 0x12 and
          sim.image[APP_HI:] == other[APP_HI:] and max(sim.erased) < APP_HI)
    check("  equal sectors were not rewritten", 0x20000 not in sim.erased and 0x21000 not in sim.erased)
    check("  the directory sector 0x4000 was erased first and programmed last",
          sim.erased[0] == APP_LO and sim.programmed[-1] // SECTOR * SECTOR == APP_LO)
    check("  nothing below 0x4000 erased or programmed", min(sim.erased) >= FLOOR and min(sim.programmed) >= FLOOR)
    sim, p = session(other)
    left = restore(p, silent, backup, FLOOR, FLASH_SIZE, write=True, interactive=False)
    check("restore --all: everything from 0x4000 equals the backup", not left and bytes(sim.image) == backup)
    # --- faults
    sim, p = session(other, corrupt_once={0x30000, 0x4000})
    left = restore(p, silent, backup, APP_LO, APP_HI, write=True, interactive=False)
    check("a sector that programs wrongly once is retried and ends correct", not left and
          sim.image[APP_LO:APP_HI] == backup[APP_LO:APP_HI] and sim.erased.count(0x30000) == 2)
    sim, p = session(other, fail_always={0x50000})
    left = restore(p, silent, backup, APP_LO, APP_HI, write=True, interactive=False)
    check("a sector that never erases is reported, every other sector is restored",
          left == [0x50000] and differing(bytes(sim.image), backup, APP_LO, APP_HI) == [0x50000])
    wrong_head = bytearray(other)
    wrong_head[0x100] ^= 1
    sim, p = session(wrong_head)
    refuses("a backup whose first 0x4000 bytes differ from the device is refused",
            lambda: restore(p, silent, backup, APP_LO, APP_HI, write=True, interactive=False))
    check("  and nothing was sent", not sim.erased and not sim.programmed)
    sim, p = session(other, die_after=400)
    try:
        restore(p, silent, backup, APP_LO, APP_HI, write=True, interactive=False)
        check("USB failure in the middle is reported", False)
    except Fm1Error:
        check("USB failure in the middle is reported", True)
    for c in (0xFB00, 0xFB02, 0xFC12, 0xFC0D, 0xFB06):
        refuses(f"command {c:04X} cannot be built by this tool", lambda: wcdb(c, b""))
    print("SELFTEST PASSED" if ok else "SELFTEST FAILED")
    return ok


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    flags = {a for a in argv[1:] if a.startswith("--") and "=" not in a}
    cmd = args[0] if args else ""
    if cmd == "selftest":
        return 0 if selftest() else 1
    if cmd not in ("compare", "sectortest", "restore") or (cmd != "sectortest" and len(args) != 2) or len(args) > 2:
        print(__doc__)
        return 2
    log = fb.Log(fb.ROOT / "backups" / "fm1boot.log")
    try:
        sector = TEST_SECTOR
        for a in argv[1:]:
            if a.startswith("--sector="):
                sector = int(a.split("=", 1)[1], 0)
        want = load_backup(args[1], log) if len(args) == 2 else None
        lo, hi = (FLOOR, FLASH_SIZE) if "--all" in flags else (APP_LO, APP_HI)
        loader = fb.LOADER_FILE.read_bytes()
        if fb.probe(log):
            return 1
        t = fb.UsbTransport(log)
        rc = 0
        try:
            p = fb.Fm1Boot(t, log)
            t.wait_ready(p)
            p.start_loader(loader)
            p.require_fm1()
            if cmd == "sectortest":
                log(f"WRITE TEST on blank sector {sector:06X}")
                sectortest(p, log, sector, want)
            else:
                write = cmd == "restore" and "--write" in flags
                log(f"{'RESTORE (writing)' if write else 'compare (reads only)'}: window {lo:06X}-{hi:06X}")
                left = restore(p, log, want, lo, hi, write)
                rc = 1 if (left and write) else 0
        finally:
            t.close()
        log("done. The FM-1 restarts into its firmware by itself in a few seconds (power-cycle it if it does not).")
        return rc
    except Fm1Error as e:
        log(f"STOPPED: {e}")
        return 1
    except KeyboardInterrupt:
        log("interrupted")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
