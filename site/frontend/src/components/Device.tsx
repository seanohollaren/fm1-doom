import { useEffect, useRef } from 'react'
import { BUTTONS, KEYS, KNOBS, type Group } from '../lib/controls'
import { N, melt, paint, sameScene, type Frame, type Screen } from '../lib/screen'
import './Device.css'

// The FM-1 from above, to scale with Felucca's controls picture: 640 x 366 units.
const W = 640
const H = 366
const SCREEN = { x: 177, y: 33, s: 122 }
const WHITE_CHROMATIC = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26]
const BLACK_AFTER_WHITE = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14]
const whiteX = (i: number) => 22 + i * 37.4
const ROW1 = ['FX', 'SCL', 'ENV', 'LFO', 'EDIT', 'GLO']
const ROW2 = ['HOME', 'SAVE', 'ARP', 'SEQ', 'PLAY', 'REC']
const LEFT_KNOBS: [string, number, number][] = [['MASTER', 44, 52], ['SELECT', 114, 52], ['PRESETS', 44, 120], ['ALGORITHM', 114, 120]]
const RIGHT_KNOBS: [string, number, number][] = [['KNOB 1', 360, 48], ['KNOB 2', 433, 48], ['KNOB 3', 507, 48], ['KNOB 4', 581, 48]]

function ScreenCanvas({ screen }: { screen: Screen }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const shown = useRef<{ screen: Screen; frame: Frame } | null>(null)
  // redraw when the picture changes, not whenever the page around it renders (which would cut a melt short)
  const key = JSON.stringify(screen)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const target = paint(screen)
    const put = (f: Frame) => ctx.putImageData(new ImageData(new Uint8ClampedArray(f), N, N), 0, 0)
    const prev = shown.current
    shown.current = { screen, frame: target }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!prev || still || sameScene(prev.screen, screen)) {
      put(target)
      return
    }
    // a change of picture melts in, the way the game changes screens
    // (on a timer, not on animation frames: the picture has to keep up even while the tab is not being painted)
    const step = melt(prev.frame, target)
    const out = new Uint8ClampedArray(N * N * 4)
    const timer = window.setInterval(() => {
      const done = step(out)
      put(done ? target : out)
      if (done) window.clearInterval(timer)
    }, 30)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <canvas
      ref={ref}
      className="device__screen"
      width={N}
      height={N}
      style={{ left: `${(SCREEN.x / W) * 100}%`, top: `${(SCREEN.y / H) * 100}%`, width: `${(SCREEN.s / W) * 100}%` }}
      aria-hidden="true"
    />
  )
}

interface Props {
  screen: Screen
  /** colour the controls by what they do in the game */
  controls?: boolean
  /** only this group lit (the list next to the drawing sets it on hover and focus) */
  focus?: Group | null
  label: string
}

export function Device({ screen, controls = false, focus = null, label }: Props) {
  const cls = (base: string, g: Group | undefined) =>
    !controls || !g ? base : `${base} has-group is-${g}${focus && focus !== g ? ' is-dim' : ''}`
  const dimIdle = controls && focus ? ' is-dim' : ''

  return (
    <figure className={`device${controls ? ' device--controls' : ''}`} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} className="device__body">
        <rect className="dv-case" x="1" y="1" width={W - 2} height={H - 2} rx="18" />
        <rect className="dv-case-edge" x="1" y="1" width={W - 2} height={H - 2} rx="18" />

        {[...LEFT_KNOBS, ...RIGHT_KNOBS].map(([name, cx, cy]) => (
          <g key={name} className={cls('dv-knob', KNOBS[name]) + (KNOBS[name] ? '' : dimIdle)}>
            <circle cx={cx} cy={cy} r="18" className="dv-knob__skirt" />
            <circle cx={cx} cy={cy} r="12.5" className="dv-knob__cap" />
            <line x1={cx} y1={cy - 11} x2={cx} y2={cy - 4} className="dv-knob__mark" />
            {controls && KNOBS[name] && <text x={cx} y={cy + 33} className="dv-tag">{name}</text>}
          </g>
        ))}

        {(['OCT−', 'OCT+'] as const).map((name, i) => (
          <g key={name} className={cls('dv-btn', BUTTONS[name])}>
            <rect x={24 + i * 54} y={160} width="48" height="24" rx="5" />
            <text x={48 + i * 54} y={176}>{name}</text>
          </g>
        ))}

        <rect className="dv-bezel" x="160" y="16" width="156" height="156" rx="15" />
        <rect className="dv-glass" x={SCREEN.x} y={SCREEN.y} width={SCREEN.s} height={SCREEN.s} rx="2" />

        {[ROW1, ROW2].map((row, r) =>
          row.map((name, i) => (
            <g key={name} className={cls('dv-btn', BUTTONS[name]) + (BUTTONS[name] ? '' : dimIdle)}>
              <rect x={348 + i * 42} y={104 + r * 42} width="38" height="28" rx="5" />
              <text x={367 + i * 42} y={122 + r * 42}>{name}</text>
            </g>
          )),
        )}

        <rect className="dv-well" x="8" y="206" width={W - 16} height="152" rx="16" />
        {BLACK_AFTER_WHITE.map((w) => {
          const idx = WHITE_CHROMATIC[w] + 1
          return <rect key={idx} className={cls('dv-key', KEYS[idx]) + (KEYS[idx] ? '' : dimIdle)} x={whiteX(w + 0.5)} y="220" width="30" height="56" rx="13" />
        })}
        {WHITE_CHROMATIC.map((idx, i) => (
          <rect key={idx} className={cls('dv-key', KEYS[idx]) + (KEYS[idx] ? '' : dimIdle)} x={whiteX(i)} y="284" width="30" height="64" rx="13" />
        ))}
      </svg>
      <ScreenCanvas screen={screen} />
    </figure>
  )
}
