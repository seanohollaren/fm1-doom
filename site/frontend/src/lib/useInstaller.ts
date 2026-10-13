import { useCallback, useEffect, useReducer, useRef } from 'react'
import { install, probe, selfCheck } from '@fm1/install.js'
import { firmware, loadFirmware, prepareWad } from './prepare'
import { fetchShareware, SHAREWARE_BYTES } from './shareware'
import { count } from './telemetry'
import { site } from '../site'
import type { InstallEvent, Phase, Prepared, ProbeResult, StageState } from './types'

export type FileState =
  | { status: 'idle' }
  /** the page is downloading the shareware file itself */
  | { status: 'fetching'; received: number; total: number }
  | { status: 'working'; name: string }
  | { status: 'ready'; prepared: Prepared }
  /** download: the page's own fetch of the shareware file failed (nothing wrong with any file of the visitor's) */
  | { status: 'failed'; name: string; message: string; download?: boolean }

export type ConnectState =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'denied' }
  | { status: 'done'; result: ProbeResult }

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'failed'
  stages: { state: StageState; note: string }[]
  bar: number
  say: string
  phase: Phase | null
  phaseF: number
  log: string[]
}

export interface State {
  step: number
  /** null while it downloads; a string when it could not be had */
  base: Uint8Array | null
  baseError: string | null
  canInstall: boolean
  file: FileState
  ack: boolean
  connect: ConnectState
  run: RunState
}

const freshRun = (): RunState => ({
  status: 'idle',
  stages: [1, 2, 3, 4].map(() => ({ state: '' as StageState, note: '' })),
  bar: 0,
  say: '',
  phase: null,
  phaseF: 0,
  log: [],
})

type Action =
  | { type: 'base'; base: Uint8Array }
  | { type: 'baseError'; message: string }
  | { type: 'step'; step: number }
  | { type: 'file'; file: FileState }
  | { type: 'ack'; ack: boolean }
  | { type: 'connect'; connect: ConnectState }
  | { type: 'runStart' }
  | { type: 'runEvent'; ev: InstallEvent }
  | { type: 'runEnd'; ok: boolean }
  | { type: 'log'; text: string }

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'base':
      return { ...s, base: a.base }
    case 'baseError':
      return { ...s, baseError: a.message }
    case 'step':
      return { ...s, step: a.step }
    case 'file':
      // other game data means the device has to be asked again, and any earlier run says nothing about it
      return { ...s, file: a.file, connect: { status: 'idle' }, run: { ...freshRun(), log: s.run.log } }
    case 'ack':
      return { ...s, ack: a.ack }
    case 'connect':
      return { ...s, connect: a.connect }
    case 'runStart':
      return { ...s, run: { ...freshRun(), status: 'running', log: s.run.log } }
    case 'log':
      return { ...s, run: { ...s.run, log: [...s.run.log, a.text] } }
    case 'runEnd':
      return { ...s, run: { ...s.run, status: a.ok ? 'done' : 'failed' }, step: a.ok ? 5 : s.step }
    case 'runEvent': {
      const r = s.run
      const ev = a.ev
      if (ev.t === 'stage') {
        const stages = r.stages.map((st, i) => (i === ev.n - 1 ? { state: ev.state, note: ev.note ?? st.note } : st))
        return { ...s, run: { ...r, stages } }
      }
      if (ev.t === 'bar') return { ...s, run: { ...r, bar: ev.f ?? r.bar } }
      if (ev.t === 'say') return { ...s, run: { ...r, say: ev.text } }
      if (ev.t === 'log') return { ...s, run: { ...r, log: [...r.log, ev.text] } }
      // a failure says nothing new about the FM-1's screen: keep showing what it last showed
      if (ev.name === 'fail') return s
      return { ...s, run: { ...r, phase: ev.name, phaseF: ev.f ?? 0 } }
    }
  }
}

const query = new URLSearchParams(window.location.search)
export const testMode = query.get('force') === '1'

// Development only (never in a production build): ?demo runs the page against a stand-in FM-1, so the whole
// install can be watched without a device. ?demo=FM-1_666 starts from the Doom firmware instead of Felucca.
const demo = import.meta.env.DEV && query.has('demo') ? query.get('demo') || 'FM-1_915' : null
let demoDevice: import('./fakeFm1').FakeFm1 | null = null

async function openMidi(prepared: Prepared | null): Promise<MIDIAccess> {
  if (import.meta.env.DEV && demo) {
    const { FakeFm1, fakeMidi } = await import('./fakeFm1')
    // ?stop=N: the stand-in stops asking for game data after N requests, to see a failed run
    demoDevice ??= new FakeFm1({ identity: demo, mode: 2, pace: 1, stopAt: query.has('stop') ? Number(query.get('stop')) * 512 : -1 })
    if (prepared) demoDevice.expect(prepared.meta, prepared.image.length)
    return fakeMidi(demoDevice) as unknown as MIDIAccess
  }
  return navigator.requestMIDIAccess({ sysex: true })
}

export function useInstaller() {
  const [state, dispatch] = useReducer(reducer, undefined, (): State => ({
    step: 0,
    base: null,
    baseError: null,
    canInstall: !!demo || (typeof navigator.requestMIDIAccess === 'function' && window.isSecureContext),
    file: { status: 'idle' },
    ack: false,
    connect: { status: 'idle' },
    run: freshRun(),
  }))
  const midi = useRef<MIDIAccess | null>(null)
  const busy = state.run.status === 'running'

  useEffect(() => {
    let live = true
    count('visit', {}, true)
    if (!selfCheck()) {
      dispatch({ type: 'baseError', message: "the page's self-check failed" })
      return
    }
    loadFirmware().then(
      (base) => live && dispatch({ type: 'base', base }),
      (e: Error) => live && dispatch({ type: 'baseError', message: e.message }),
    )
    return () => {
      live = false
    }
  }, [])

  // leaving in the middle of a write is the one way to hurt an install: ask first, and keep the computer awake
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    let lock: WakeLockSentinel | null = null
    let over = false
    const hold = () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
      navigator.wakeLock.request('screen').then(
        (l) => (over ? void l.release() : (lock = l)),
        () => {},
      )
    }
    hold()
    document.addEventListener('visibilitychange', hold) // a lock is dropped when the tab is hidden: take it again
    return () => {
      over = true
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('visibilitychange', hold)
      void lock?.release()
    }
  }, [busy])

  const fileBusy = state.file.status === 'working' || state.file.status === 'fetching'

  const chooseFile = useCallback(
    async (file: File) => {
      if (!state.base || busy || state.file.status === 'working') return
      dispatch({ type: 'file', file: { status: 'working', name: file.name } })
      const r = await prepareWad(file, state.base)
      if (r.ok) {
        const p = r.prepared
        dispatch({ type: 'log', text: `${p.fileName}: sha256 ${p.wadSha.slice(0, 16)}; game data ${p.dataBytes} B (sha256 ${p.dataSha.slice(0, 16)}), block 1 ${p.meta.split} B, block 2 ${p.meta.data2_len} B` })
        dispatch({ type: 'file', file: { status: 'ready', prepared: p } })
        count('file', {}, true)
      } else {
        dispatch({ type: 'log', text: `${file.name}: ${r.message}${r.detail ? ` [${r.detail}]` : ''}` })
        dispatch({ type: 'file', file: { status: 'failed', name: file.name, message: r.message } })
      }
    },
    [state.base, state.file.status, busy],
  )

  // one click: download the shareware file from a mirror, check it is the exact file, then prepare it like any other
  const fetchFile = useCallback(async () => {
    if (!state.base || busy || fileBusy) return
    dispatch({ type: 'file', file: { status: 'fetching', received: 0, total: SHAREWARE_BYTES } })
    let last = 0
    try {
      const bytes = await fetchShareware(site.sharewareMirrors, (received) => {
        // a few times a second is plenty for a bar
        if (received === SHAREWARE_BYTES || received - last > 150_000) {
          last = received
          dispatch({ type: 'file', file: { status: 'fetching', received, total: SHAREWARE_BYTES } })
        }
      })
      dispatch({ type: 'log', text: `downloaded the shareware DOOM1.WAD (${bytes.length} B, checksum as expected)` })
      await chooseFile(new File([bytes as BlobPart], 'DOOM1.WAD'))
    } catch (e) {
      const err = e as Error & { detail?: string }
      dispatch({ type: 'log', text: `download failed: ${err.detail ?? err.message}` })
      dispatch({ type: 'file', file: { status: 'failed', name: 'DOOM1.WAD', message: err.message, download: true } })
    }
  }, [state.base, busy, fileBusy, chooseFile])

  const prepared = state.file.status === 'ready' ? state.file.prepared : null

  const connect = useCallback(async () => {
    if (busy) return
    dispatch({ type: 'connect', connect: { status: 'working' } })
    try {
      midi.current = demo ? await openMidi(prepared) : (midi.current ?? (await openMidi(prepared)))
    } catch {
      dispatch({ type: 'connect', connect: { status: 'denied' } })
      return
    }
    const result = (await probe(midi.current, prepared?.meta ?? null)) as ProbeResult
    dispatch({ type: 'log', text: result.kind === 'none' ? 'connect: no FM-1 answered' : `connect: ${result.id} on "${result.port}"` })
    dispatch({ type: 'connect', connect: { status: 'done', result } })
    if (result.kind !== 'none') count('connect', { had: result.id }, true)
  }, [busy, prepared])

  /** what the FM-1 said it runs when it was found, for the install counter (./telemetry) */
  const had = state.connect.status === 'done' && state.connect.result.kind !== 'none' ? state.connect.result.id : undefined

  const run = useCallback(async () => {
    if (busy || !prepared) return
    try {
      midi.current = demo ? await openMidi(prepared) : (midi.current ?? (await openMidi(prepared)))
    } catch {
      dispatch({ type: 'connect', connect: { status: 'denied' } })
      dispatch({ type: 'step', step: 3 })
      return
    }
    dispatch({ type: 'runStart' })
    count('start', { had })
    let failedAt = 0
    const r = await install({
      midi: midi.current,
      image: prepared.image,
      data2: prepared.data2,
      meta: prepared.meta,
      force: testMode,
      on: (ev: InstallEvent) => {
        if (ev.t === 'stage' && ev.state === 'fail') failedAt = ev.n
        dispatch({ type: 'runEvent', ev })
      },
    })
    dispatch({ type: 'runEnd', ok: r.ok })
    count(r.ok ? 'done' : 'fail', r.ok ? { had } : { had, stage: failedAt })
  }, [busy, prepared, had])

  // how far the visitor may go: each step opens the next
  const found = state.connect.status === 'done' && state.connect.result.kind !== 'none'
  const open = [
    true,
    state.canInstall && !!state.base,
    !!prepared,
    !!prepared && state.ack,
    !!prepared && state.ack && found,
    state.run.status === 'done',
  ]
  const reach = open.findIndex((ok) => !ok)
  const maxStep = reach === -1 ? open.length - 1 : reach - 1

  const go = useCallback(
    (step: number) => {
      if (!busy && step >= 0 && step <= maxStep) dispatch({ type: 'step', step })
    },
    [busy, maxStep],
  )
  const setAck = useCallback((ack: boolean) => dispatch({ type: 'ack', ack }), [])

  return { state, firmware, prepared, busy, fileBusy, maxStep, go, chooseFile, fetchFile, setAck, connect, run }
}

export type Installer = ReturnType<typeof useInstaller>
