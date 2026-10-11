import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUTTONS, KEYS, KEY_LABELS, KNOBS, TIPS } from './controls'
import { N, melt, paint, sameScene } from './screen'

const at = (f: Uint8ClampedArray, x: number, y: number) => [...f.subarray((y * N + x) * 4, (y * N + x) * 4 + 3)]

describe('the drawn FM-1 screen', () => {
  it('is the panel pixel for pixel', () => {
    expect(N).toBe(240)
    expect(paint({ kind: 'off' }).length).toBe(240 * 240 * 4)
  })

  it('safe mode as the firmware draws it: blue, a white square a corner, a strip along the bottom', () => {
    const one = paint({ kind: 'safe', tone: 'blue', squares: 1, host: false })
    expect(at(one, 120, 120)).toEqual([0, 0, 132])
    expect(at(one, 8, 8)).toEqual([255, 255, 255])
    expect(at(one, 23, 23)).toEqual([255, 255, 255])
    expect(at(one, 24, 24)).toEqual([0, 0, 132])
    expect(at(one, N - 12, 8)).toEqual([0, 0, 132])
    expect(at(one, 20, N - 1)).toEqual([255, 255, 255])
    const two = paint({ kind: 'safe', tone: 'blue', squares: 2, host: true })
    expect(at(two, N - 12, 8)).toEqual([255, 255, 255])
    expect(at(two, 20, N - 1)).toEqual([0, 255, 0])
  })

  it('the data bar grows from the left', () => {
    const white = (f: Uint8ClampedArray) => Array.from({ length: N }, (_, x) => at(f, x, 116)).filter((c) => c[0] === 255).length
    expect(white(paint({ kind: 'bar', f: 0 }))).toBe(4)
    expect(white(paint({ kind: 'bar', f: 0.5 }))).toBe(100)
    expect(white(paint({ kind: 'bar', f: 1 }))).toBe(200)
  })

  it('the picture of the game is a 240 x 240 PNG, and the panel is dark until it has been read', () => {
    const png = readFileSync(fileURLToPath(new URL('../assets/e1m1-start.png', import.meta.url)))
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png.readUInt32BE(16)).toBe(N)
    expect(png.readUInt32BE(20)).toBe(N)
    // (no browser here, so it never is)
    expect(at(paint({ kind: 'game' }), 120, 120)).toEqual([0, 0, 0])
  })

  it('a melt ends on exactly the new picture', () => {
    const from = paint({ kind: 'off' })
    const to = paint({ kind: 'safe', tone: 'blue', squares: 2, host: false })
    let seed = 1
    const step = melt(from, to, () => ((seed = (seed * 16807) % 2147483647) % 1000) / 1000)
    const out = new Uint8ClampedArray(N * N * 4)
    let frames = 0
    while (!step(out)) expect(++frames).toBeLessThan(200)
    expect(out).toEqual(to)
    expect(frames).toBeGreaterThan(8)
  })

  it('a bar moving is the same scene; a change of colour is not', () => {
    expect(sameScene({ kind: 'bar', f: 0.1 }, { kind: 'bar', f: 0.9 })).toBe(true)
    expect(sameScene({ kind: 'safe', tone: 'blue', squares: 1, host: false }, { kind: 'safe', tone: 'blue', squares: 2, host: false })).toBe(false)
    expect(sameScene({ kind: 'solid', tone: 'green' }, { kind: 'solid', tone: 'red' })).toBe(false)
  })
})

describe('the words on the drawn FM-1', () => {
  it('every note key the game uses carries one word, or two', () => {
    expect(Object.keys(KEY_LABELS).sort()).toEqual(Object.keys(KEYS).sort())
    for (const words of Object.values(KEY_LABELS)) {
      expect(words.length === 1 || words.length === 2).toBe(true)
      for (const w of words) expect(w).toMatch(/^[A-Za-z]{2,7}$/) // "Forward" is as long as fits across a key
    }
  })

  it('every button and knob the game uses explains itself under the pointer, and nothing else does', () => {
    expect(Object.keys(TIPS).sort()).toEqual([...Object.keys(BUTTONS), ...Object.keys(KNOBS)].sort())
    for (const tip of Object.values(TIPS)) expect(tip).toMatch(/^[A-Z].{3,90}\.$/)
  })
})

// The page's controls table restates the firmware's. With the engine source at hand (it is a separate clone, not
// in this repository), check that they still agree.
const source = fileURLToPath(new URL('../../../../rp2040-doom/src/fm1/fm1_controls.c', import.meta.url))
describe.skipIf(!existsSync(source))('the controls table against the firmware source', () => {
  const c = existsSync(source) ? readFileSync(source, 'utf8') : ''
  const map = /FM1_MAP\[\] = \{([\s\S]*?)\};/.exec(c)?.[1] ?? ''
  const LABEL: Record<string, string> = { OCTDN: 'OCT−', OCTUP: 'OCT+' }
  const DOES: Record<string, string> = {
    KEY_UPARROW: 'move', KEY_DOWNARROW: 'move', KEY_LEFTARROW: 'move', KEY_RIGHTARROW: 'move', "','": 'side', "'.'": 'side', KEY_RSHIFT: 'side',
    KEY_RCTRL: 'fire', "' '": 'use', KEY_ESCAPE: 'menu', KEY_ENTER: 'menu', "'y'": 'menu', FM1_KEY_PREVWEAPON: 'weapon', FM1_KEY_NEXTWEAPON: 'weapon',
  }

  it('every key and button the firmware maps is in the table, doing the same thing', () => {
    const keys: Record<number, string> = {}
    const buttons: Record<string, string> = {}
    for (const m of map.matchAll(/\{(\d+|BTN\(FM1_BTN_(\w+)\)), ([^}]+)\}/g)) {
      const does = DOES[m[3].trim()]
      expect(does, `the page has no word for ${m[3]}`).toBeTruthy()
      if (m[2]) buttons[LABEL[m[2]] ?? m[2]] = does
      else keys[Number(m[1])] = does
    }
    expect(Object.keys(keys).length).toBeGreaterThan(8)
    expect(KEYS).toEqual(keys)
    // EDIT, ENV and LFO are handled outside the map, in code. So are SCL and GLO (picture shape, frame rate), which
    // the page leaves out on purpose.
    for (const b of ['EDIT', 'ENV', 'LFO']) {
      expect(c).toContain(`FM1_BTN_${b})`)
      buttons[b] = 'sound'
    }
    // the knobs: every encoder the firmware reads is in the table, and no other
    const read = new Set([...c.matchAll(/enc\[FM1_ENC_(\w+?)(?: \+ i)?\]/g)].map((m) => m[1]))
    const NAME: Record<string, string> = { SELECT: 'SELECT', PRESET: 'PRESETS', ALGO: 'ALGORITHM', K1: 'KNOB 1', K2: 'KNOB 2', K3: 'KNOB 3', K4: 'KNOB 4' }
    expect([...read].map((k) => NAME[k]).sort()).toEqual(Object.keys(KNOBS).filter((k) => k !== 'MASTER').sort())
    expect(BUTTONS).toEqual(buttons)
  })
})
