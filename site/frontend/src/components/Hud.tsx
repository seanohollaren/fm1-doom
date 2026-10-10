import type { RunState } from '../lib/useInstaller'
import { PixelText } from './PixelText'
import './Hud.css'

const CELLS = ['Find', 'Firmware', 'Game data', 'Start'] as const
// where each stage sits on the install's one progress scale (web/install.js)
const SPAN: [number, number][] = [[0, 0.04], [0.04, 0.6], [0.6, 0.97], [0.97, 1]]

/** The install as four cells of a status bar: found, firmware written, game data written, game started. */
export function Hud({ run }: { run: RunState }) {
  return (
    <div className="hud" aria-label="Install progress">
      <ol className="hud__cells">
        {CELLS.map((name, i) => {
          const { state, note } = run.stages[i]
          const [lo, hi] = SPAN[i]
          const pct = state === 'done' ? 100 : state === 'now' || state === 'fail' ? Math.round(Math.max(0, Math.min(1, (run.bar - lo) / (hi - lo))) * 100) : 0
          const counted = i === 1 || i === 2
          const text = state === 'fail' ? '!!' : state === 'done' ? (counted ? '100%' : 'v') : state === 'now' && counted ? `${pct}%` : '--'
          const said = state === 'fail' ? 'failed' : state === 'done' ? 'done' : state === 'now' ? (counted ? `${pct} percent` : 'in progress') : 'waiting'
          const tone = state === 'fail' ? 'amber' : state === 'done' ? 'green' : state === 'now' ? 'red' : 'dim'
          return (
            <li key={name} className={`hud__cell is-${state || 'idle'}`} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="hud__value">
                <PixelText text={text} label={`${name}: ${said}`} tone={tone} />
              </span>
              <span className="hud__name label">{name}</span>
              <span className="hud__note">{note}</span>
            </li>
          )
        })}
      </ol>
      <div className="hud__track" role="progressbar" aria-label="Whole install" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run.bar * 100)}>
        <div className={`hud__fill is-${run.status}`} style={{ width: `${Math.round(run.bar * 1000) / 10}%` }} />
      </div>
    </div>
  )
}
