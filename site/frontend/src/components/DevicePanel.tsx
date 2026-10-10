import type { Installer } from '../lib/useInstaller'
import type { Screen } from '../lib/screen'
import { Device } from './Device'
import './DevicePanel.css'

const SYNTH: Screen = { kind: 'synth' }
const OFF: Screen = { kind: 'off' }
const GAME: Screen = { kind: 'game' }
// the firmware's own modes (firmware/doom_dev.c), as the page hears them from the FM-1
const DOOM_SCREENS: Screen[] = [
  GAME,
  { kind: 'safe', tone: 'amber', squares: 0, host: true },
  { kind: 'safe', tone: 'cyan', squares: 0, host: true },
  { kind: 'safe', tone: 'blue', squares: 1, host: true },
  { kind: 'safe', tone: 'blue', squares: 2, host: true },
]

/** What the FM-1's screen should be showing at this point, and a line saying so. */
function expected(inst: Installer): { screen: Screen; says: string } {
  const { state } = inst
  const run = state.run
  if (run.status === 'done' || state.step === 5) return { screen: GAME, says: 'The game.' }
  if (run.status === 'running' || run.status === 'failed') {
    switch (run.phase) {
      case 'loader':
      case 'write':
      case 'reboot':
        return { screen: OFF, says: 'Dark while the firmware is written. This is normal.' }
      case 'wait':
        return { screen: { kind: 'safe', tone: 'blue', squares: 2, host: false }, says: 'Blue with two white squares: the new firmware is waiting for its game data.' }
      case 'data':
        return { screen: { kind: 'bar', f: run.phaseF }, says: 'Blue with a white bar growing: the game data is going in.' }
      case 'restart':
        return { screen: { kind: 'solid', tone: 'green' }, says: 'Green for a moment: the game data is complete.' }
      case 'game':
        return { screen: GAME, says: 'The game.' }
      default:
        break
    }
  }
  const c = state.connect
  if (c.status === 'done' && c.result.kind === 'loader') return { screen: OFF, says: 'Dark: it is waiting in update mode.' }
  if (c.status === 'done' && c.result.kind === 'device' && c.result.doom)
    return { screen: DOOM_SCREENS[c.result.doom.mode] ?? GAME, says: c.result.doom.mode === 0 ? 'The game.' : 'A plain colour: it is waiting for an install.' }
  return { screen: SYNTH, says: '' }
}

export function DevicePanel({ inst }: { inst: Installer }) {
  const { screen, says } = expected(inst)
  return (
    <aside className="devpanel" aria-label="What the FM-1 shows">
      <Device screen={screen} label={`A drawing of the FM-1. Its screen shows: ${says || 'its synth screen.'}`} />
      <p className="devpanel__says">
        <span className="label">You should see</span>
        {says}
      </p>
    </aside>
  )
}
