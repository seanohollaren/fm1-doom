#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""fm1boot: talk to an M-VAVE FM-1 that is in the chip's built-in boot mode (JieLi WL82 "UBOOT1.00"),
straight from a Mac over the ordinary USB cable. READ-ONLY: this file contains no command that erases or
writes flash.

  fm1boot.py selftest             no device: run the protocol code against a simulated FM-1
  fm1boot.py probe                no root:   is an FM-1 in boot mode on the bus? print what it reports
  sudo fm1boot.py info            start the RAM loader, read chip key and flash id
  sudo fm1boot.py dump [OUT.bin]  info, then read the whole 1 MiB flash twice, compare, save
  sudo fm1boot.py ramdump [OUT.bin]  read the chip's 512 KB of RAM as the firmware left it (before the RAM
                                  loader is uploaded), save it, then start the loader so the FM-1 restarts

Why sudo: macOS's own mass-storage driver owns the device; libusb can only take it over as root.

How the FM-1 gets into boot mode: Felucca (and our firmware) enter it when OCT- and OCT+ are held for 5 s.
How it leaves: the RAM loader resets the chip about 3 s after the last command, and it boots its firmware.
After `probe` alone (no loader started) switch the FM-1 off and on.

The protocol (commands, addresses, the order of operations) is ported from FM-1 Transporter
src/jieli_uboot.c and docs/PROTOCOL.md (MIT, (c) 2026 kurogedelic), which was verified on FM-1 hardware and
is itself ported from jl-uboot-tool (MIT, (c) 2023 Andrey Grigoryev). The RAM loader `wl82loader.bin` is
read from the jl-uboot-tool checkout at run time; it is not part of this repository.
"""
import errno
import hashlib
import os
import struct
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIBUSB = "/opt/homebrew/lib/libusb-1.0.dylib"
LOADER_FILE = ROOT / "jl-uboot-tool" / "data" / "loaderblobs" / "usb" / "wl82loader.bin"
LOADER_SHA256 = "d41da6126760c9d66660bcc0cac8d27d221806c5e369a8036921efe68dca5376"
LOADER_SIZE = 24064
LOADER_ADDR, LOADER_ARG = 0x01C02000, 0x0001

VID, PID = 0x4C4A, 0x8057
CHIP_KEY, FLASH_ID, DEV_SPI_NOR = 0x980F, 0x856014, 3
FLASH_SIZE = 1 << 20
IO = 512                 # loader upload chunk
READ_MAX = 4096          # largest READ_FLASH issued

# ROM UBOOT1.00
CMD_WRITE_MEMORY = 0xFB06        # RAM only; used for the loader upload and nothing else
CMD_JUMP = 0xFB08
CMD_READ_MEMORY = 0xFD07         # RAM read, boot ROM stage only (tools/ramlook.py reads the result)
RAM_LO, RAM_HI = 0x01C00000, 0x01C80000
# LoaderV2 (after the jump)
CMD_READ_FLASH = 0xFD05
CMD_READ_KEY = 0xFC09
CMD_GET_ONLINE_DEVICE = 0xFC0A
CMD_GET_USB_BUFF_SIZE = 0xFC14
# Every command this tool may put on the wire. Flash erase (FB00..FB02), flash write (FB04), key write (FC12)
# and the rest are absent on purpose; cdb() refuses anything not listed.
ALLOWED = {CMD_WRITE_MEMORY, CMD_JUMP, CMD_READ_MEMORY, CMD_READ_FLASH, CMD_READ_KEY, CMD_GET_ONLINE_DEVICE,
           CMD_GET_USB_BUFF_SIZE}

MAGIC = bytes([0xC3, 0xCF, 0xC0, 0xE8, 0xCE, 0xD2, 0xB0, 0xAE, 0xC4, 0xE3, 0xA3, 0xAC, 0xD3, 0xF1, 0xC1, 0xD6])


class Fm1Error(Exception):
    pass


def crc16(data, crc=0):
    """CRC-16/XMODEM (poly 0x1021, no reflection), caller-supplied start value."""
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def crc_cipher(data):
    """jl_crc_cipher with key 0xFFFFFFFF (its own inverse)."""
    out, crc = bytearray(data), crc16(b"\xff\xff", 0xFFFF)
    for i in range(len(out)):
        crc = crc16(MAGIC[i % 16:i % 16 + 1], crc)
        out[i] ^= crc & 0xFF
    return bytes(out)


def cdb(cmd, args=b""):
    """cmd (u16 BE) + args, padded with 0xFF to 16 bytes."""
    if cmd not in ALLOWED:
        raise Fm1Error(f"command {cmd:04X} is not one this tool sends")
    if len(args) > 14:
        raise Fm1Error("arguments too long")
    return (struct.pack(">H", cmd) + args).ljust(16, b"\xff")


class Log:
    def __init__(self, path=None):
        self.t0, self.f = time.time(), None
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            self.f = open(path, "a")
            self.f.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')}  {' '.join(sys.argv[1:])}\n")
            give_back(path.parent)
            give_back(path)

    def __call__(self, msg, show=True):
        line = f"[{time.time() - self.t0:7.3f}] {msg}"
        if show:
            print(line, flush=True)
        if self.f:
            self.f.write(line + "\n")
            self.f.flush()


def give_back(path):
    """Under sudo: hand files we create back to the user who ran sudo."""
    uid, gid = os.environ.get("SUDO_UID"), os.environ.get("SUDO_GID")
    if uid and gid and os.geteuid() == 0:
        try:
            os.chown(path, int(uid), int(gid))
        except OSError:
            pass


# ---------------------------------------------------------------------------------------------------------
# The protocol, on top of a transport with one method:
#   bot(cdb, n_in=0, out=b"", timeout_ms=...) -> bytes      one Bulk-Only Transport command
# ---------------------------------------------------------------------------------------------------------
class Fm1Boot:
    def __init__(self, transport, log):
        self.t, self.log = transport, log
        self.loader_running = False
        self.chunk = IO

    def inquiry(self):
        d = self.t.bot(bytes([0x12, 0, 0, 0, 36, 0]), n_in=36)
        if len(d) < 36:
            raise Fm1Error(f"INQUIRY returned {len(d)} bytes")
        v, p, r = (d[8:16].decode("ascii", "replace").strip(), d[16:32].decode("ascii", "replace").strip(),
                   d[32:36].decode("ascii", "replace").strip())
        self.log(f'INQUIRY: vendor "{v}" product "{p}" rev "{r}"')
        return v, p, r

    def exec(self, cmd, args=b"", timeout_ms=3000):
        """16-byte answer whose first two bytes echo the command; returns the 14 bytes after them."""
        r = self.t.bot(cdb(cmd, args), n_in=16, timeout_ms=timeout_ms)
        if len(r) != 16 or struct.unpack(">H", r[:2])[0] != cmd:
            raise Fm1Error(f"command {cmd:04X} answered {r.hex()}")
        return r[2:]

    def read_ram(self, addr, n):
        """RAM through the boot ROM (not once the loader runs: it lives in the same RAM)."""
        if self.loader_running:
            raise Fm1Error("RAM can only be read before the loader is started")
        if n <= 0 or n > IO or addr < RAM_LO or addr + n > RAM_HI:
            raise Fm1Error(f"RAM read {addr:08X}+{n} out of range")
        d = self.t.bot(cdb(CMD_READ_MEMORY, struct.pack(">IH", addr, n)), n_in=n)
        if len(d) != n:
            raise Fm1Error(f"RAM read {addr:08X}+{n} returned {len(d)} bytes")
        return crc_cipher(d)                     # the ROM ciphers every memory transfer

    def ramdump(self):
        v, p, _ = self.inquiry()
        if v != "WL82" or not p.startswith("UBOOT1"):
            raise Fm1Error(f'not the WL82 boot ROM ("{v}" / "{p}"); nothing read')
        t0, out = time.time(), bytearray()
        for addr in range(RAM_LO, RAM_HI, IO):
            out += self.read_ram(addr, IO)
        self.log(f"RAM {RAM_LO:08X}-{RAM_HI:08X}: {len(out)} B in {time.time() - t0:.1f} s, "
                 f"sha256 {hashlib.sha256(out).hexdigest()[:16]}")
        return bytes(out)

    def start_loader(self, blob):
        if self.loader_running:
            return
        if len(blob) != LOADER_SIZE or hashlib.sha256(blob).hexdigest() != LOADER_SHA256:
            raise Fm1Error("wl82loader.bin is not the expected file")
        v, p, _ = self.inquiry()
        if v != "WL82" or not p.startswith("UBOOT1"):
            raise Fm1Error(f'not the WL82 boot ROM ("{v}" / "{p}"); nothing sent')
        self.log(f"uploading the RAM loader ({len(blob)} B) to {LOADER_ADDR:08X} (RAM, not flash)")
        for off in range(0, len(blob), IO):
            block = blob[off:off + IO]                       # shipped already ciphered: sent as it is
            args = struct.pack(">IH", LOADER_ADDR + off, len(block)) + b"\x00" + struct.pack("<H", crc16(block))
            self.t.bot(cdb(CMD_WRITE_MEMORY, args), out=block)
        self.exec(CMD_JUMP, struct.pack(">IH", LOADER_ADDR, LOADER_ARG), timeout_ms=5000)
        self.loader_running = True
        self.log("loader running")
        try:
            size = struct.unpack(">I", self.exec(CMD_GET_USB_BUFF_SIZE)[:4])[0]
            chunk = min(size, READ_MAX) // IO * IO
            if chunk >= IO:
                self.chunk = chunk
            self.log(f"loader USB buffer {size} B, reading {self.chunk} B at a time")
        except Fm1Error as e:
            self.log(f"buffer size query failed ({e}); reading {self.chunk} B at a time")

    def info(self):
        p = self.exec(CMD_READ_KEY, struct.pack(">I", 0x00AC6900))
        key = int.from_bytes(crc_cipher(p[4:6][::-1]), "little")
        p = self.exec(CMD_GET_ONLINE_DEVICE)
        dev_type, flash_id = p[0], int.from_bytes(p[2:6], "little")
        self.log(f"chip key {key:04X} (expected {CHIP_KEY:04X}), device type {dev_type} (expected {DEV_SPI_NOR}), "
                 f"flash id {flash_id:06X} (expected {FLASH_ID:06X})")
        return key, dev_type, flash_id

    def require_fm1(self):
        key, dev_type, flash_id = self.info()
        if (key, dev_type, flash_id) != (CHIP_KEY, DEV_SPI_NOR, FLASH_ID):
            raise Fm1Error("this is not an FM-1 as we know it; stopping")

    def read_flash(self, addr, n):
        if n <= 0 or n > READ_MAX or addr < 0 or addr + n > FLASH_SIZE:
            raise Fm1Error(f"read {addr:06X}+{n} out of range")
        d = self.t.bot(cdb(CMD_READ_FLASH, struct.pack(">IH", addr, n)), n_in=n)
        if len(d) != n:
            raise Fm1Error(f"read {addr:06X}+{n} returned {len(d)} bytes")
        return d

    def read_all(self, label):
        t0, out = time.time(), bytearray()
        for addr in range(0, FLASH_SIZE, self.chunk):
            out += self.read_flash(addr, min(self.chunk, FLASH_SIZE - addr))
            if addr % 0x20000 == 0:
                self.log(f"{label}: {addr:06X}", show=False)
        self.log(f"{label}: {len(out)} B in {time.time() - t0:.1f} s, sha256 {hashlib.sha256(out).hexdigest()[:16]}")
        return bytes(out)

    def dump(self):
        a = self.read_all("read 1")
        b = self.read_all("read 2")
        if a != b:
            bad = [i for i in range(0, FLASH_SIZE, 0x1000) if a[i:i + 0x1000] != b[i:i + 0x1000]]
            raise Fm1Error(f"the two reads differ in {len(bad)} sectors (first at {bad[0]:06X}); nothing saved")
        return a


# ---------------------------------------------------------------------------------------------------------
# USB transport (pyusb on libusb)
# ---------------------------------------------------------------------------------------------------------
def usb_backend():
    import usb.backend.libusb1
    be = usb.backend.libusb1.get_backend(find_library=lambda _: LIBUSB)
    if be is None:
        raise Fm1Error(f"libusb not found at {LIBUSB} (brew install libusb)")
    return be


def usb_find():
    import usb.core
    return usb.core.find(idVendor=VID, idProduct=PID, backend=usb_backend())


class UsbTransport:
    FIRST_CBW_DELAY = 1.5        # as FM-1 Transporter: the ROM wants a moment after enumeration
    INQUIRY_TRIES, INQUIRY_RETRY = 30, 0.3

    def __init__(self, log):
        import usb.core
        import usb.util
        self.usb, self.util, self.log, self.tag = usb.core, usb.util, log, 0x464D3100
        self.dev = usb_find()
        if self.dev is None:
            raise Fm1Error("no FM-1 in boot mode on USB (4C4A:8057). On Felucca hold OCT- and OCT+ for 5 s.")
        intf = None
        for cfg in self.dev:
            for i in cfg:
                if i.bInterfaceClass == 8:
                    intf = intf or i
        if intf is None:
            raise Fm1Error("the device has no mass-storage interface")
        self.itf = intf.bInterfaceNumber
        eps = {(self.util.endpoint_direction(e.bEndpointAddress) == self.util.ENDPOINT_IN): e.bEndpointAddress
               for e in intf if self.util.endpoint_type(e.bmAttributes) == self.util.ENDPOINT_TYPE_BULK}
        if True not in eps or False not in eps:
            raise Fm1Error("bulk endpoints not found")
        self.ep_in, self.ep_out = eps[True], eps[False]
        log(f"found 4C4A:8057, interface {self.itf}, bulk IN {self.ep_in:02X}, bulk OUT {self.ep_out:02X}")
        try:
            active = self.dev.is_kernel_driver_active(self.itf)
        except (NotImplementedError, self.usb.USBError) as e:
            log(f"kernel driver query: {e}")
            active = True
        if active:
            if os.geteuid() != 0:
                raise Fm1Error("macOS's storage driver owns the device; run this command with sudo")
            log("taking the device over from macOS's storage driver (it re-enumerates)")
            try:
                self.dev.detach_kernel_driver(self.itf)
            except self.usb.USBError as e:
                raise Fm1Error(f"could not take the device over: {e}")
        try:
            self.dev.get_active_configuration()
        except self.usb.USBError:
            log("SET_CONFIGURATION 1")
            self.dev.set_configuration()
        try:
            self.util.claim_interface(self.dev, self.itf)
        except self.usb.USBError as e:
            raise Fm1Error(f"could not claim the interface: {e}" +
                           ("" if os.geteuid() == 0 else " (run with sudo)"))
        time.sleep(self.FIRST_CBW_DELAY)
        try:
            lun = self.dev.ctrl_transfer(0xA1, 0xFE, 0, self.itf, 1, timeout=1000)
            log(f"GET MAX LUN: {list(lun)}")
        except self.usb.USBError as e:
            log(f"GET MAX LUN: {e} (ignored)")

    def wait_ready(self, proto):
        for n in range(self.INQUIRY_TRIES):
            try:
                return proto.inquiry()
            except (Fm1Error, self.usb.USBError) as e:
                self.log(f"INQUIRY attempt {n + 1}: {e}")
                time.sleep(self.INQUIRY_RETRY)
        raise Fm1Error("the boot ROM never answered INQUIRY")

    def bot(self, cb, n_in=0, out=b"", timeout_ms=3000):
        if n_in and out:
            raise Fm1Error("one data direction per command")
        self.tag = (self.tag + 1) & 0xFFFFFFFF
        cbw = struct.pack("<4sIIBBB", b"USBC", self.tag, n_in or len(out), 0x80 if n_in else 0, 0, len(cb)) + \
            bytes(cb).ljust(16, b"\x00")
        name = bytes(cb)[:2].hex()
        try:
            self.dev.write(self.ep_out, cbw, timeout_ms)
            data = b""
            try:
                if out:
                    self.dev.write(self.ep_out, out, timeout_ms)
                elif n_in:
                    data = bytes(self.dev.read(self.ep_in, n_in, timeout_ms))
            except self.usb.USBError as e:
                if e.errno != errno.EPIPE:
                    raise
                self.log(f"command {name}: data stage stalled; clearing and reading the status")
                self.dev.clear_halt(self.ep_out if out else self.ep_in)
            try:
                csw = bytes(self.dev.read(self.ep_in, 13, timeout_ms))
            except self.usb.USBError as e:
                if e.errno != errno.EPIPE:
                    raise
                self.dev.clear_halt(self.ep_in)
                csw = bytes(self.dev.read(self.ep_in, 13, timeout_ms))
        except self.usb.USBError as e:
            raise Fm1Error(f"USB transfer failed during command {name}: {e}")
        if len(csw) != 13:
            raise Fm1Error(f"status block is {len(csw)} bytes")
        sig, tag, residue, status = struct.unpack("<4sIIB", csw)
        if sig != b"USBS" or tag != self.tag:
            raise Fm1Error(f"bad status block {csw.hex()}")
        if status != 0:
            raise Fm1Error(f"command {name} failed: status {status}, residue {residue}")
        return data

    def close(self):
        try:
            self.util.release_interface(self.dev, self.itf)
            self.util.dispose_resources(self.dev)
        except Exception:
            pass


# ---------------------------------------------------------------------------------------------------------
# A simulated FM-1 in boot mode, for `selftest`. It fails loudly on anything a read-only tool must not send.
# ---------------------------------------------------------------------------------------------------------
class SimFm1:
    def __init__(self, image, loader, key=CHIP_KEY, flash_id=FLASH_ID, buf=4096, flip_on_pass2=None, ram=None):
        self.image, self.loader, self.key, self.flash_id, self.buf = image, loader, key, flash_id, buf
        self.sim_ram = ram
        self.mode, self.ram, self.reads, self.flip, self.log = "rom", {}, 0, flip_on_pass2, []

    def bot(self, cb, n_in=0, out=b"", timeout_ms=3000):
        cb = bytes(cb)
        if cb[0] == 0x12 and len(cb) == 6:                      # INQUIRY
            assert n_in == 36
            return bytes(8) + b"WL82    " + b"UBOOT1.00       " + b"1.00"
        assert len(cb) == 16, "vendor commands are 16 bytes"
        cmd = struct.unpack(">H", cb[:2])[0]
        self.log.append(cmd)
        if self.mode == "rom":
            if cmd == CMD_WRITE_MEMORY:
                addr, n = struct.unpack(">IH", cb[2:8])
                assert cb[8] == 0 and struct.unpack("<H", cb[9:11])[0] == crc16(out) and n == len(out) <= IO
                assert cb[11:] == b"\xff" * 5 and not n_in
                assert LOADER_ADDR <= addr and addr + n <= LOADER_ADDR + LOADER_SIZE, "RAM write outside the loader"
                self.ram[addr] = out
                return b""
            if cmd == CMD_JUMP:
                addr, arg = struct.unpack(">IH", cb[2:8])
                got = b"".join(self.ram[a] for a in sorted(self.ram))
                assert (addr, arg) == (LOADER_ADDR, LOADER_ARG) and got == self.loader, "jump without the loader"
                assert sorted(self.ram) == list(range(LOADER_ADDR, LOADER_ADDR + LOADER_SIZE, IO))
                self.mode = "loader"
                return cb[:2] + bytes(14)
            if cmd == CMD_READ_MEMORY and self.sim_ram is not None:
                addr, n = struct.unpack(">IH", cb[2:8])
                assert n == n_in and 0 < n <= IO and RAM_LO <= addr and addr + n <= RAM_HI and not out
                assert not self.ram, "RAM read after the loader upload began"
                return crc_cipher(self.sim_ram[addr - RAM_LO:addr - RAM_LO + n])
            raise AssertionError(f"sim ROM: unexpected command {cmd:04X}")
        assert n_in and not out, "the loader must only be asked to send data"
        if cmd == CMD_READ_KEY:
            assert cb[2:6] == struct.pack(">I", 0x00AC6900)
            k = crc_cipher(self.key.to_bytes(2, "little"))[::-1]
            return cb[:2] + bytes(4) + k + bytes(8)
        if cmd == CMD_GET_ONLINE_DEVICE:
            return cb[:2] + bytes([DEV_SPI_NOR, 0]) + self.flash_id.to_bytes(4, "little") + bytes(8)
        if cmd == CMD_GET_USB_BUFF_SIZE:
            return cb[:2] + struct.pack(">I", self.buf) + bytes(10)
        if cmd == CMD_READ_FLASH:
            addr, n = struct.unpack(">IH", cb[2:8])
            assert n == n_in and 0 < n <= READ_MAX and addr + n <= FLASH_SIZE and cb[8:] == b"\xff" * 8
            self.reads += n
            d = bytearray(self.image[addr:addr + n])
            if self.flip is not None and self.reads > FLASH_SIZE and addr <= self.flip < addr + n:
                d[self.flip - addr] ^= 0x10
            return bytes(d)
        raise AssertionError(f"sim loader: unexpected command {cmd:04X}")


def selftest():
    import random
    ok = True

    def check(name, cond):
        nonlocal ok
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}")
        ok &= bool(cond)

    silent = lambda *a, **k: None                                      # noqa: E731
    check("CRC-16/XMODEM of '123456789' is 31C3", crc16(b"123456789") == 0x31C3)
    check("cipher is its own inverse", crc_cipher(crc_cipher(bytes(range(64)))) == bytes(range(64)))
    try:                                                               # cross-check with jl-uboot-tool's own code
        sys.path.insert(0, str(ROOT / "jl-uboot-tool"))
        from jltech.cipher import cipher_bytes, jl_crc_cipher
        from jltech.crc import jl_crc16
        data = bytes(random.Random(1).randrange(256) for _ in range(1500))
        check("crc16 equals jl-uboot-tool's jl_crc16", jl_crc16(data) == crc16(data))
        check("cipher equals jl-uboot-tool's jl_crc_cipher", cipher_bytes(jl_crc_cipher, data) == crc_cipher(data))
    except ImportError as e:
        print(f"  --    jl-uboot-tool cross-check skipped ({e})")
    for c in (0xFB00, 0xFB01, 0xFB02, 0xFB04, 0xFC12, 0xFC0C, 0xFC0D):
        try:
            cdb(c)
            check(f"command {c:04X} is refused", False)
        except Fm1Error:
            pass
    check("erase, write-flash, write-key, set-flash-command opcodes are refused", True)
    if not LOADER_FILE.exists():
        print(f"  --    {LOADER_FILE} missing: simulated runs skipped")
        return ok
    loader = LOADER_FILE.read_bytes()
    image = bytes(random.Random(2).randrange(256) for _ in range(FLASH_SIZE))
    for buf in (4096, 512, 1000, 65536):
        sim = SimFm1(image, loader, buf=buf)
        p = Fm1Boot(sim, silent)
        p.start_loader(loader)
        p.require_fm1()
        check(f"dump equals the simulated flash (loader buffer {buf}, {p.chunk} B reads)", p.dump() == image)
        check("  only read commands after the jump", set(sim.log[sim.log.index(CMD_JUMP) + 1:]) <=
              {CMD_READ_FLASH, CMD_READ_KEY, CMD_GET_ONLINE_DEVICE, CMD_GET_USB_BUFF_SIZE})
    for name, kw in (("wrong chip key", {"key": 0x1234}), ("wrong flash id", {"flash_id": 0xEF4015})):
        sim = SimFm1(image, loader, **kw)
        p = Fm1Boot(sim, silent)
        p.start_loader(loader)
        try:
            p.require_fm1()
            check(f"{name}: stops", False)
        except Fm1Error:
            check(f"{name}: stops before any flash read", sim.reads == 0)
    sim = SimFm1(image, loader, flip_on_pass2=0x54321)
    p = Fm1Boot(sim, silent)
    p.start_loader(loader)
    try:
        p.dump()
        check("one flipped bit in the second read: refused", False)
    except Fm1Error as e:
        check(f"one flipped bit in the second read: refused ({e})", "054000" in str(e))
    ram = bytes(random.Random(3).randrange(256) for _ in range(RAM_HI - RAM_LO))
    sim = SimFm1(image, loader, ram=ram)
    p = Fm1Boot(sim, silent)
    check("RAM dump equals the simulated RAM", p.ramdump() == ram)
    p.start_loader(loader)
    try:
        p.read_ram(RAM_LO, 16)
        check("RAM read after the loader started: refused", False)
    except Fm1Error:
        check("RAM read after the loader started: refused", True)
    try:
        Fm1Boot(SimFm1(image, loader), silent).start_loader(loader[:-1] + b"\x00")
        check("altered loader file: refused", False)
    except Fm1Error:
        check("altered loader file: refused, nothing sent", True)
    print("SELFTEST PASSED" if ok else "SELFTEST FAILED")
    return ok


def probe(log):
    dev = usb_find()
    if dev is None:
        log("no device 4C4A:8057 on USB: the FM-1 is not in boot mode (or not connected)")
        return 1
    log(f"found {dev.idVendor:04X}:{dev.idProduct:04X}, USB {dev.bcdUSB:04X}, device release {dev.bcdDevice:04X}, "
        f"bus {dev.bus} address {dev.address}, speed code {dev.speed}")
    for cfg in dev:
        for i in cfg:
            eps = ", ".join(f"{e.bEndpointAddress:02X}/{e.wMaxPacketSize}" for e in i)
            log(f"  interface {i.bInterfaceNumber}: class {i.bInterfaceClass:02X} sub {i.bInterfaceSubClass:02X} "
                f"protocol {i.bInterfaceProtocol:02X}, endpoints {eps}")
    import usb.util
    for label, idx in (("manufacturer", dev.iManufacturer), ("product", dev.iProduct), ("serial", dev.iSerialNumber)):
        try:
            log(f"  {label}: {usb.util.get_string(dev, idx) if idx else '(none)'}")
        except Exception as e:
            log(f"  {label}: not readable without taking the device over ({e})")
    try:
        log(f"  macOS driver attached: {dev.is_kernel_driver_active(0)}")
    except Exception as e:
        log(f"  macOS driver attached: unknown ({e})")
    return 0


def main(argv):
    if len(argv) < 2 or argv[1] not in ("selftest", "probe", "info", "dump", "ramdump"):
        print(__doc__)
        return 2
    if argv[1] == "selftest":
        return 0 if selftest() else 1
    backups = ROOT / "backups"
    log = Log(backups / "fm1boot.log")
    try:
        if argv[1] == "probe":
            rc = probe(log)
            if rc == 0:
                log("only standard USB descriptor requests were sent; switch the FM-1 off and on to leave boot mode")
            return rc
        loader = LOADER_FILE.read_bytes()
        if probe(log):
            return 1
        t = UsbTransport(log)
        try:
            p = Fm1Boot(t, log)
            t.wait_ready(p)
            if argv[1] == "ramdump":
                ram = p.ramdump()
                out = Path(argv[2]) if len(argv) > 2 else backups / f"fm1-ram-{time.strftime('%Y%m%d-%H%M%S')}.bin"
                if out.exists():
                    raise Fm1Error(f"{out} exists; not overwriting")
                out.write_bytes(ram)
                give_back(out)
                log(f"saved {out} ({len(ram)} B)")
            p.start_loader(loader)
            p.require_fm1()
            if argv[1] == "dump":
                image = p.dump()
                out = Path(argv[2]) if len(argv) > 2 else backups / f"fm1-flash-{time.strftime('%Y%m%d-%H%M%S')}.bin"
                if out.exists():
                    raise Fm1Error(f"{out} exists; not overwriting")
                out.write_bytes(image)
                digest = hashlib.sha256(image).hexdigest()
                Path(str(out) + ".sha256").write_text(f"{digest}  {out.name}\n")
                give_back(out)
                give_back(Path(str(out) + ".sha256"))
                log(f"saved {out} ({len(image)} B), sha256 {digest}")
        finally:
            t.close()
        log("done. The FM-1 restarts into its firmware by itself in a few seconds (power-cycle it if it does not).")
        return 0
    except Fm1Error as e:
        log(f"STOPPED: {e}")
        return 1
    except KeyboardInterrupt:
        log("interrupted")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
