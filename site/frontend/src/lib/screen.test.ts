import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUTTONS, KEYS } from './controls'
import { N, melt, paint, sameScene } from './screen'

const at = (f: Uint8ClampedArray, x: number, y: number) => [...f.subarray((y * N + x) * 4, (y * N + x) * 4 + 3)]

describe('the drawn FM-1 screen', () => {
  it('safe mode as the firmware draws it: blue, a white square a corner, a strip along the bottom', () => {
    const one = paint({ kind: 'safe', tone: 'blue', squares: 1, host: false })
    expect(at(one, 30, 30)).toEqual([0, 0, 132])
    expect(at(one, 2, 2)).toEqual([255, 255, 255])
    expect(at(one, N - 3, 2)).toEqual([0, 0, 132])
    expect(at(one, 5, N - 1)).toEqual([255, 255, 255])
    const two = paint({ kind: 'safe', tone: 'blue', squares: 2, host: true })
    expect(at(two, N - 3, 2)).toEqual([255, 255, 255])
    expect(at(two, 5, N - 1)).toEqual([0, 255, 0])
  })

  it('the data bar grows from the left', () => {
    const white = (f: Uint8ClampedArray) => Array.from({ length: N }, (_, x) => at(f, x, 29)).filter((c) => c[0] === 255).length
    expect(white(paint({ kind: 'bar', f: 0 }))).toBe(1)
    expect(white(paint({ kind: 'bar', f: 0.5 }))).toBe(25)
    expect(white(paint({ kind: 'bar', f: 1 }))).toBe(50)
  })

  it('a melt ends on exactly the new picture', () => {
    const from = paint({ kind: 'off' })
    const to = paint({ kind: 'game' })
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
    expect(Object.keys(keys).length).toBeGreaterThan(10)
    expect(KEYS).toEqual(keys)
    // SCL, LFO and ENV are handled outside the map, in code
    for (const b of ['SCL', 'LFO', 'ENV']) {
      expect(c).toContain(`FM1_BTN_${b})`)
      buttons[b] = 'view'
    }
    expect(BUTTONS).toEqual(buttons)
  })
})
