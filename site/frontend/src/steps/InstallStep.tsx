import { Hud } from '../components/Hud'
import { testMode, type Installer } from '../lib/useInstaller'
import { Notice, StepShell } from './StepShell'

const hex = (n: number) => n.toString(16).padStart(8, '0')
const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('en')} KB`

export function InstallStep({ inst, announce }: { inst: Installer; announce: boolean }) {
  const { state, go, run, prepared, firmware, busy } = inst
  const r = state.run
  if (!prepared) return null

  return (
    <StepShell index={4} title="Install" announce={announce} back={() => go(3)} locked={busy}>
      <dl className="manifest">
        <div>
          <dt className="label">Firmware</dt>
          <dd>
            Doom for the FM-1, build {firmware.version} <span className="mono manifest__id">{hex(firmware.build)}</span>
          </dd>
        </div>
        <div>
          <dt className="label">Game data</dt>
          <dd>
            {prepared.known ? 'Doom shareware 1.9, level E1M1' : `Level E1M1 from ${prepared.fileName}`}{' '}
            <span className="mono manifest__id">{kb(prepared.dataBytes)}</span>
          </dd>
        </div>
      </dl>

      {testMode && (
        <Notice tone="warn" title="Test mode">
          The second part of the game data will be rewritten even if the FM-1 already holds it. Start from the cyan screen (hold HOME while
          switching on).
        </Notice>
      )}

      {r.status === 'idle' && (
        <div className="launch">
          <button type="button" className="btn btn--primary btn--big" onClick={() => void run()}>
            Install
          </button>
          <p className="quiet">
            It takes a few minutes. The FM-1’s screen goes dark for part of it. Keep this tab in front, and don’t unplug the cable or close
            the page until it says done.
          </p>
        </div>
      )}

      {r.status !== 'idle' && (
        <>
          <Hud run={r} />
          <p className={`status status--${r.status}`} role="status" aria-live="polite">
            {r.status === 'running' && <span className="status__spin" aria-hidden="true" />}
            {r.say}
          </p>
        </>
      )}

      {r.status === 'failed' && (
        <div className="launch">
          <button type="button" className="btn btn--primary" onClick={() => void run()}>
            Install again
          </button>
          <p className="quiet">Nothing is lost by trying again: the install carries on from where it can.</p>
        </div>
      )}

      {r.status === 'done' && (
        <div className="launch">
          <button type="button" className="btn" onClick={() => void run()}>
            Install again
          </button>
          <p className="quiet">The FM-1 already holds this build, so another run only checks it and changes nothing.</p>
        </div>
      )}

      {r.log.length > 0 && (
        <details className="log">
          <summary>Details of this run</summary>
          <pre>{r.log.join('\n')}</pre>
        </details>
      )}
    </StepShell>
  )
}
