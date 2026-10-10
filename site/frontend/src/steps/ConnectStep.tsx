import type { Installer } from '../lib/useInstaller'
import type { ProbeResult } from '../lib/types'
import { site } from '../site'
import { Notice, StepShell } from './StepShell'

const hex = (n: number) => n.toString(16).padStart(8, '0')
const DOOM_MODES = [
  'The game is running.',
  'It is on its amber screen: the last start of the game failed.',
  'It is on its cyan screen, waiting for an install.',
  'It is on its blue screen: it has no game data yet.',
  'It is on its blue screen: the second part of the game data is missing.',
]

function Found({ result, product }: { result: Exclude<ProbeResult, { kind: 'none' }>; product: string }) {
  if (result.kind === 'loader')
    return (
      <Notice tone="warn" title="Found an FM-1 waiting in update mode">
        An earlier install was interrupted. The install step will pick it up and finish it.
      </Notice>
    )
  if (result.id === product) {
    const mode = result.doom ? DOOM_MODES[result.doom.mode] : ''
    return result.same && result.doom?.code === 1 ? (
      <Notice tone="ok" title="Found an FM-1 that already runs this build">
        Same firmware, same game data. Installing again changes nothing.
      </Notice>
    ) : (
      <Notice tone="ok" title="Found an FM-1 running Doom">
        {result.doom ? `Firmware build ${hex(result.doom.build)}. ${mode}` : 'It answered as the Doom firmware.'} The install will bring it to this
        page’s build and game data.
      </Notice>
    )
  }
  if (result.model === 'FM-1' && result.version >= 900)
    return (
      <Notice tone="ok" title="Found an FM-1 running Felucca">
        It reports <span className="mono">{result.id}</span>. This is the firmware the installer has been tested from.
      </Notice>
    )
  return (
    <Notice tone="warn" title="Found an FM-1">
      It reports <span className="mono">{result.id}</span>. The installer has been tested starting from Felucca. M-VAVE’s original firmware
      takes updates the same way, so it should work; other custom firmware may not start the update. If the install won’t start, put{' '}
      <a href={site.feluccaInstallerUrl} target="_blank" rel="noopener noreferrer">
        Felucca
      </a>{' '}
      on first.
    </Notice>
  )
}

export function ConnectStep({ inst, announce }: { inst: Installer; announce: boolean }) {
  const { state, go, connect, firmware } = inst
  const c = state.connect
  const found = c.status === 'done' && c.result.kind !== 'none'

  return (
    <StepShell
      index={3}
      title="Find the FM-1"
      announce={announce}
      back={() => go(2)}
      next={
        <button type="button" className="btn btn--primary" disabled={!found} onClick={() => go(4)}>
          Next <span aria-hidden="true">→</span>
        </button>
      }
    >
      <p className="lead">
        Connect to the FM-1 so we can check which firmware it’s currently running. Your browser will ask whether this site may use MIDI
        devices.
      </p>

      <div className="action">
        <button type="button" className={`btn${found ? '' : ' btn--primary'}`} disabled={c.status === 'working'} onClick={() => void connect()}>
          {c.status === 'idle' ? 'Connect' : c.status === 'working' ? 'Looking…' : 'Look again'}
        </button>
      </div>

      {c.status === 'working' && <Notice tone="work" title="Looking for the FM-1" />}
      {c.status === 'denied' && (
        <Notice tone="bad" title="The browser did not allow MIDI">
          Allow MIDI devices for this site (the icon at the left of the address bar), then press Look again.
        </Notice>
      )}
      {c.status === 'done' && c.result.kind !== 'none' && <Found result={c.result} product={firmware.product} />}
      {c.status === 'done' && c.result.kind === 'none' && (
        <Notice tone="bad" title="No FM-1 answered">
          <ul className="hints">
            <li>Is it switched on, and plugged straight into the computer?</li>
            <li>Try another USB cable: some only charge.</li>
            <li>Close other apps and browser tabs that use MIDI.</li>
            <li>If its screen is dark although it is on, switch it off and on again.</li>
          </ul>
        </Notice>
      )}
    </StepShell>
  )
}
