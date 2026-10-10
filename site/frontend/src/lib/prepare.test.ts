// What the page ships (the firmware file, the converter) and what it makes of a WAD.
// The WAD tests need wads/doom1.wad, which is never in the repository: they are skipped without it.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { prepare, SHAREWARE_19_DATA_SHA256, SHAREWARE_19_SHA256 } from '@fm1/convert.js'
import { DataError, splitPoint } from '@fm1/datapack.js'
import { WadError } from '@fm1/wadcut.js'
import { logicalImage, Package, productOf, sha256hex } from '@fm1/vendor/felucca/fm1pkg.js'
import firmware from '../firmware.json'

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
const pub = at('../../public/')
const root = at('../../../../')
const base = new Uint8Array(readFileSync(pub + firmware.file))
const wadPath = root + 'wads/doom1.wad'
const converter = async () => (await import(/* @vite-ignore */ 'file://' + pub + 'whdgen/whd_gen_es.js')).default

describe('what the site ships', () => {
  it('the firmware file is the one firmware.json describes', async () => {
    expect(await sha256hex(base)).toBe(firmware.sha256)
    expect(productOf(base)).toBe(firmware.product)
  })

  it('the converter is the one firmware.json describes', async () => {
    expect(await sha256hex(new Uint8Array(readFileSync(pub + 'whdgen/whd_gen_es.wasm')))).toBe(firmware.converter_sha256)
  })

  it('the firmware file holds no game data', () => {
    // everything after the firmware image in its slot is blank (0xFF), up to the end of the slot
    // (Felucca's Package is plain JavaScript: its fields are filled in by its constructor)
    const p = new Package(base) as unknown as { dec: Uint8Array; appOff: number; app: { size: number } }
    const slot = p.dec.subarray(p.appOff, p.appOff + p.app.size)
    expect(p.app.size).toBe(firmware.app_slot)
    expect(slot.subarray(firmware.img_len).every((b: number) => b === 0xff)).toBe(true)
    expect(slot.subarray(0, firmware.img_len).some((b: number) => b !== 0xff)).toBe(true)
  })

  it('data too large for the FM-1 is refused with its size', () => {
    const whx = new Uint8Array(700_000)
    whx.set(new TextEncoder().encode('IWHX'))
    new DataView(whx.buffer).setUint32(4, 1, true) // one lump
    new DataView(whx.buffer).setUint32(8, 12, true) // directory at 12: offsets 20 and 700000
    new DataView(whx.buffer).setUint32(12, 20, true)
    new DataView(whx.buffer).setUint32(16, 700_000, true)
    expect(() => splitPoint(whx, 300_000)).toThrow(DataError)
    expect(() => splitPoint(whx, 300_000)).toThrow(/more than fits/)
  })
})

describe('files that are no use', () => {
  const refuse = async (bytes: Uint8Array) => prepare(bytes, base, firmware, await converter())

  it('not a WAD', async () => {
    await expect(refuse(new TextEncoder().encode('this is not a wad at all, only some text'))).rejects.toThrow(WadError)
  })

  it('an add-on WAD', async () => {
    const pwad = new Uint8Array(64)
    pwad.set(new TextEncoder().encode('PWAD'))
    await expect(refuse(pwad)).rejects.toThrow(/add-on/)
  })

  it.skipIf(!existsSync(wadPath))('a WAD cut short', async () => {
    const wad = new Uint8Array(readFileSync(wadPath))
    await expect(refuse(wad.subarray(0, wad.length - 5000))).rejects.toThrow(WadError)
  })

  const freedoom = root + 'wads/freedoom-0.13.0/freedoom1.wad'
  it.skipIf(!existsSync(freedoom))('Freedoom', async () => {
    await expect(refuse(new Uint8Array(readFileSync(freedoom)))).rejects.toThrow(/Freedoom/)
  })
})

describe.skipIf(!existsSync(wadPath))('the shareware WAD', () => {
  it('becomes exactly the data tested on an FM-1, packed as firmware/pack.py packs it', async () => {
    const wad = new Uint8Array(readFileSync(wadPath))
    expect(await sha256hex(wad)).toBe(SHAREWARE_19_SHA256)
    const r = await prepare(wad, base, firmware, await converter())
    expect(r.info.known).toBe(true)
    expect(r.info.dataSha).toBe(SHAREWARE_19_DATA_SHA256)
    expect(r.meta).toMatchObject({ product: firmware.product, build: firmware.build, total: 607328 })
    // the same bytes the Mac-side packer made for this firmware build, when its output is at hand
    const made = root + 'firmware/build/'
    if (existsSync(made + 'doom_install.json') && JSON.parse(readFileSync(made + 'doom_install.json', 'utf8')).build === firmware.build) {
      expect(logicalImage(r.pkg)).toEqual(logicalImage(new Uint8Array(readFileSync(made + 'doom_part1.fwsc'))))
      expect(r.data2).toEqual(new Uint8Array(readFileSync(made + 'doom_data2.bin')))
    }
  })

  it('with one sound changed: still converts, but is not called tested', async () => {
    const wad = new Uint8Array(readFileSync(wadPath))
    const view = new DataView(wad.buffer, wad.byteOffset)
    const n = view.getUint32(4, true)
    const dir = view.getUint32(8, true)
    for (let i = 0; i < n; i++) {
      const name = String.fromCharCode(...wad.subarray(dir + 16 * i + 8, dir + 16 * i + 16)).replace(/\0+$/, '')
      if (name === 'DSPISTOL') wad[view.getUint32(dir + 16 * i, true) + 100] ^= 0x20
    }
    const r = await prepare(wad, base, firmware, await converter())
    expect(r.info.known).toBe(false)
    expect(r.info.dataSha).not.toBe(SHAREWARE_19_DATA_SHA256)
  })
})
