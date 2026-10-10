// The install flow (../../../../web/install.js, the same code the page runs) against a stand-in FM-1.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { install, probe, selfCheck } from '@fm1/install.js'
import { FakeFm1, fakeMidi, type FakeOptions } from './fakeFm1'
import type { InstallEvent, InstallMeta, ProbeResult } from './types'

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 17 + (i >> 8)) & 255)
const image = bytes(40_000, 1) // a small "package": the flow does not care what is in it
const data2 = bytes(20_000, 2)
const meta: InstallMeta = { product: 'FM-1_666', build: 0x9a3465a8, split: 294980, total: 607328, data2_len: data2.length, data2_crc16: 0x751c }

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

/** let the flow's own waits (seconds of them) pass in no time */
async function drive<T>(p: Promise<T>): Promise<T> {
  let out: { v: T } | null = null
  void p.then((v) => (out = { v }))
  while (!out) await vi.advanceTimersByTimeAsync(100)
  return (out as { v: T }).v
}

async function run(o: Partial<FakeOptions>, force = false) {
  const dev = new FakeFm1(o)
  dev.expect(meta, image.length)
  const events: InstallEvent[] = []
  const result = await drive(install({ midi: fakeMidi(dev), image, data2, meta, force, on: (ev: InstallEvent) => events.push(ev) }))
  const stages = ['', '', '', '']
  let bar = 0
  let say = ''
  for (const ev of events) {
    if (ev.t === 'stage') stages[ev.n - 1] = ev.state
    if (ev.t === 'bar' && ev.f !== null) bar = ev.f
    if (ev.t === 'say') say = ev.text
  }
  const phases = [...new Set(events.filter((e) => e.t === 'phase').map((e) => (e as { name: string }).name))]
  return { dev, result, stages: stages.join(' '), bar, say, phases, events }
}

describe('install', () => {
  it('builds the handshake query the firmware expects', () => {
    expect(selfCheck()).toBe(true)
  })

  it('from another firmware: writes the package, then sends the second block, and the game starts', async () => {
    const r = await run({ identity: 'FM-1_915' })
    expect(r.result.ok).toBe(true)
    expect(r.dev.written).toEqual(image)
    expect(r.dev.got).toEqual(data2)
    expect(r.dev.finished).toBe(true)
    expect(r.stages).toBe('done done done done')
    expect(r.bar).toBe(1)
    expect(r.say).toMatch(/^Done/)
    expect(r.phases).toEqual(['find', 'check', 'loader', 'write', 'reboot', 'wait', 'data', 'restart', 'game'])
  })

  it('Doom already there in safe mode, second block missing: the firmware is left alone, the block is sent', async () => {
    const r = await run({ mode: 4 })
    expect(r.result.ok).toBe(true)
    expect(r.dev.written).toBeNull()
    expect(r.dev.got).toEqual(data2)
    expect(r.dev.flags).toEqual([2, 2, 0, 2])
    expect(r.stages).toBe('done done done done')
    expect(r.events).toContainEqual({ t: 'stage', n: 2, state: 'done', note: 'already installed' })
  })

  it('this build and this data already running: nothing is written, nothing is sent', async () => {
    const r = await run({ mode: 0 })
    expect(r.result.ok).toBe(true)
    expect(r.dev.written).toBeNull()
    expect(r.dev.got).toBeNull()
    expect(r.dev.flags.every((f) => f === 2)).toBe(true)
    expect(r.events).toContainEqual({ t: 'stage', n: 3, state: 'done', note: 'already there' })
  })

  it('an older Doom build holding the same data: only the firmware is written', async () => {
    const r = await run({ mode: 0, holds: { ...meta, build: 0x11111111 } })
    expect(r.result.ok).toBe(true)
    expect(r.dev.written).toEqual(image)
    expect(r.dev.got).toBeNull()
    expect(r.events).toContainEqual({ t: 'stage', n: 3, state: 'done', note: 'already there' })
  })

  it('test mode from the safe screen: the rewrite flag reaches the firmware', async () => {
    const r = await run({ mode: 2 }, true)
    expect(r.result.ok).toBe(true)
    expect(r.dev.got).toEqual(data2)
    expect(r.dev.flags).toContain(1)
  })

  it('test mode while the game runs: asks for the safe screen and sends nothing', async () => {
    const r = await run({ mode: 0 }, true)
    expect(r.result.ok).toBe(false)
    expect(r.result.message).toMatch(/hold HOME/)
    expect(r.dev.got).toBeNull()
    expect(r.stages).toBe('done done fail ')
  })

  it('the firmware stops asking part way: said so, and the bar stays where it was', async () => {
    const r = await run({ mode: 4, stopAt: 512 * 20 })
    expect(r.result.ok).toBe(false)
    expect(r.result.message).toMatch(/stopped asking/)
    expect(r.dev.finished).toBe(false)
    expect(r.stages).toBe('done done fail ')
    expect(r.bar).toBeGreaterThan(0.6)
    expect(r.bar).toBeLessThan(0.97)
    expect(r.events).toContainEqual({ t: 'bar', f: null, state: 'fail' })
  })

  it('no FM-1 at all: said so, nothing else happens', async () => {
    const events: InstallEvent[] = []
    const result = await drive(install({ midi: { inputs: new Map(), outputs: new Map() }, image, data2, meta, on: (ev: InstallEvent) => events.push(ev) }))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/FM-1 not found/)
    expect(events).toContainEqual({ t: 'stage', n: 1, state: 'fail', note: undefined })
  })
})

describe('probe (asks, never writes)', () => {
  const ask = async (o: Partial<FakeOptions> | null) => {
    if (!o) return (await drive(probe({ inputs: new Map(), outputs: new Map() }, meta))) as ProbeResult
    const dev = new FakeFm1(o)
    dev.expect(meta, image.length)
    const result = (await drive(probe(fakeMidi(dev), meta))) as ProbeResult
    expect(dev.written).toBeNull()
    expect(dev.got).toBeNull()
    return result
  }

  it('nothing connected', async () => {
    expect(await ask(null)).toEqual({ kind: 'none' })
  })

  it('another firmware', async () => {
    expect(await ask({ identity: 'FM-1_915' })).toMatchObject({ kind: 'device', id: 'FM-1_915', model: 'FM-1', version: 915, doom: null, same: false })
  })

  it('this very build, running', async () => {
    expect(await ask({ mode: 0 })).toMatchObject({ kind: 'device', id: 'FM-1_666', same: true, doom: { code: 1, mode: 0, build: meta.build } })
  })

  it('an older Doom build on its cyan screen', async () => {
    expect(await ask({ mode: 2, holds: { ...meta, build: 7 } })).toMatchObject({ kind: 'device', same: false, doom: { mode: 2, build: 7 } })
  })
})
