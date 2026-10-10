import { useEffect, useRef, useState } from 'react'
import { BUTTONS, KEYS, KEY_LABELS, KNOBS, TIPS, type Group } from '../lib/controls'
import { N, gameShot, hasGameShot, melt, paint, sameScene, type Frame, type Screen } from '../lib/screen'
import './Device.css'

// The FM-1 from above, to scale with Felucca's controls picture: 640 x 366 units.
const W = 640
const H = 366
const SCREEN = { x: 177, y: 33, s: 122 }
const WHITE_CHROMATIC = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26]
const BLACK_AFTER_WHITE = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14]
const whiteX = (i: number) => 22 + i * 37.4
const LABEL_LINE = 9 // between the two lines of a note key's label, in the drawing's units
const TIP_ROOM = 70 // a control whose top is nearer the top of the drawing than this is explained below itself
const ROW1 = ['FX', 'SCL', 'ENV', 'LFO', 'EDIT', 'GLO']
const ROW2 = ['HOME', 'SAVE', 'ARP', 'SEQ', 'PLAY', 'REC']
const LEFT_KNOBS: [string, number, number][] = [['MASTER', 44, 52], ['SELECT', 114, 52], ['PRESETS', 44, 120], ['ALGORITHM', 114, 120]]
const RIGHT_KNOBS: [string, number, number][] = [['KNOB 1', 360, 48], ['KNOB 2', 433, 48], ['KNOB 3', 507, 48], ['KNOB 4', 581, 48]]

function ScreenCanvas({ screen }: { screen: Screen }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const shown = useRef<{ screen: Screen; frame: Frame } | null>(null)
  // the picture of the game is an image file: draw it once the browser has it
  const [shot, setShot] = useState(hasGameShot)
  useEffect(() => {
    let mounted = true
    if (!shot) void gameShot().then(() => mounted && setShot(true))
    return () => {
      mounted = false
    }
  }, [shot])
  // redraw when the picture changes, not whenever the page around it renders (which would cut a melt short)
  const key = JSON.stringify(screen) + (screen.kind === 'game' && shot ? ' drawn' : '')

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
  /** colour the controls by what they do in the game, write it on the note keys, and explain a button or knob under the pointer */
  controls?: boolean
  /** only this group lit (the list next to the drawing sets it on hover and focus) */
  focus?: Group | null
  label: string
}

export function Device({ screen, controls = false, focus = null, label }: Props) {
  const cls = (base: string, g: Group | undefined) =>
    !controls || !g ? base : `${base} has-group is-${g}${focus && focus !== g ? ' is-dim' : ''}`
  const dimIdle = controls && focus ? ' is-dim' : ''
  // the button or knob under the pointer, and where its explanation hangs: above the control's top edge, or, for the
  // top row (no room above it inside the drawing), below its bottom edge
  const [tip, setTip] = useState<{ name: string; x: number; y: number; below: boolean } | null>(null)
  const explains = (name: string, x: number, top: number, bottom: number) =>
    controls && TIPS[name]
      ? { onMouseEnter: () => setTip({ name, x, y: top < TIP_ROOM ? bottom : top, below: top < TIP_ROOM }), onMouseLeave: () => setTip(null) }
      : {}
  const tipGroup = tip && (BUTTONS[tip.name] ?? KNOBS[tip.name])
  const keyLabel = (idx: number, x: number, y: number, h: number) => {
    const words = controls ? KEY_LABELS[idx] : undefined
    if (!words) return null
    return (
      <text className={`dv-key-label${focus && focus !== KEYS[idx] ? ' is-dim' : ''}`} y={y + h / 2 - (words.length - 1) * (LABEL_LINE / 2)}>
        {words.map((word, i) => (
          <tspan key={word} x={x + 15} dy={i ? LABEL_LINE : 0}>
            {word}
          </tspan>
        ))}
      </text>
    )
  }

  return (
    <figure className={`device${controls ? ' device--controls' : ''}`} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} className="device__body">
        <rect className="dv-case" x="1" y="1" width={W - 2} height={H - 2} rx="18" />
        <rect className="dv-case-edge" x="1" y="1" width={W - 2} height={H - 2} rx="18" />

        {[...LEFT_KNOBS, ...RIGHT_KNOBS].map(([name, cx, cy]) => (
          <g key={name} className={cls('dv-knob', KNOBS[name]) + (KNOBS[name] ? '' : dimIdle)} {...explains(name, cx, cy - 18, cy + 38)}>
            <circle cx={cx} cy={cy} r="18" className="dv-knob__skirt" />
            <circle cx={cx} cy={cy} r="12.5" className="dv-knob__cap" />
            <line x1={cx} y1={cy - 11} x2={cx} y2={cy - 4} className="dv-knob__mark" />
            {controls && KNOBS[name] && <text x={cx} y={cy + 33} className="dv-tag">{name}</text>}
          </g>
        ))}

        {(['OCT−', 'OCT+'] as const).map((name, i) => (
          <g key={name} className={cls('dv-btn', BUTTONS[name])} {...explains(name, 48 + i * 54, 160, 184)}>
            <rect x={24 + i * 54} y={160} width="48" height="24" rx="5" />
            <text x={48 + i * 54} y={176}>{name}</text>
          </g>
        ))}

        <rect className="dv-bezel" x="160" y="16" width="156" height="156" rx="15" />
        <rect className="dv-glass" x={SCREEN.x} y={SCREEN.y} width={SCREEN.s} height={SCREEN.s} rx="2" />

        {[ROW1, ROW2].map((row, r) =>
          row.map((name, i) => (
            <g key={name} className={cls('dv-btn', BUTTONS[name]) + (BUTTONS[name] ? '' : dimIdle)} {...explains(name, 367 + i * 42, 104 + r * 42, 132 + r * 42)}>
              <rect x={348 + i * 42} y={104 + r * 42} width="38" height="28" rx="5" />
              <text x={367 + i * 42} y={122 + r * 42}>{name}</text>
            </g>
          )),
        )}

        <rect className="dv-well" x="8" y="206" width={W - 16} height="152" rx="16" />
        {BLACK_AFTER_WHITE.map((w) => {
          const idx = WHITE_CHROMATIC[w] + 1
          return (
            <g key={idx}>
              <rect className={cls('dv-key', KEYS[idx]) + (KEYS[idx] ? '' : dimIdle)} x={whiteX(w + 0.5)} y="220" width="30" height="56" rx="13" />
              {keyLabel(idx, whiteX(w + 0.5), 220, 56)}
            </g>
          )
        })}
        {WHITE_CHROMATIC.map((idx, i) => (
          <g key={idx}>
            <rect className={cls('dv-key', KEYS[idx]) + (KEYS[idx] ? '' : dimIdle)} x={whiteX(i)} y="284" width="30" height="64" rx="13" />
            {keyLabel(idx, whiteX(i), 284, 64)}
          </g>
        ))}
      </svg>
      <ScreenCanvas screen={screen} />
      {tip && (
        <div
          className={`device__tip${tip.x < W * 0.3 ? ' is-start' : tip.x > W * 0.7 ? ' is-end' : ''}${tip.below ? ' is-below' : ''}`}
          style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%`, borderLeftColor: `var(--g-${tipGroup})` }}
        >
          <kbd>{tip.name}</kbd>
          <span>{TIPS[tip.name]}</span>
        </div>
      )}
    </figure>
  )
}
