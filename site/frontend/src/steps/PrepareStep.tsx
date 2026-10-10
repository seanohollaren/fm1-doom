import { FlashMap } from '../components/FlashMap'
import type { Installer } from '../lib/useInstaller'
import { StepShell } from './StepShell'

export function PrepareStep({ inst, announce }: { inst: Installer; announce: boolean }) {
  const { state, go, setAck } = inst

  return (
    <StepShell
      index={2}
      title="Get the FM-1 ready"
      announce={announce}
      back={() => go(1)}
      next={
        <button type="button" className="btn btn--primary" disabled={!state.ack} onClick={() => go(3)}>
          Next <span aria-hidden="true">→</span>
        </button>
      }
    >
      <ol className="todo">
        <li>
          <strong>Plug the FM-1 straight into this computer and switch it on.</strong>
        </li>
        <li>
          <strong>Close anything else that uses the FM-1.</strong>
        </li>
        <li>
          <strong>Keep this tab in front, and the computer plugged in.</strong>
        </li>
        <li>
          <strong>Export anything you want to keep from your current firmware.</strong>
          <span>Doom takes pretty much the entire storage space of the FM-1, though your presets should remain.</span>
        </li>
      </ol>

      <h3 className="sub">What the install changes</h3>
      <FlashMap />

      <label className="ack">
        <input type="checkbox" checked={state.ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          I understand this replaces the synth firmware on my FM-1 with experimental software and I’m using it at my own risk.
        </span>
      </label>
    </StepShell>
  )
}
