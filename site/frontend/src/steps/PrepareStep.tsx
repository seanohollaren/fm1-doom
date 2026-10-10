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
          <span>No hub: a hub can hide the FM-1 from the browser.</span>
        </li>
        <li>
          <strong>Close anything else that uses the FM-1.</strong>
          <span>Music software, M-VAVE’s app and other installer tabs hold on to its connection.</span>
        </li>
        <li>
          <strong>Keep this tab in front, and the computer plugged in.</strong>
          <span>Browsers slow a tab to a crawl when it is in the background. The page keeps the screen awake while it installs.</span>
        </li>
        <li>
          <strong>Using Felucca? Save what you want to keep first.</strong>
          <span>Its saved projects and samples sit where the game data goes, and the install overwrites them.</span>
        </li>
      </ol>

      <h3 className="sub">What the install changes</h3>
      <FlashMap />

      <label className="ack">
        <input type="checkbox" checked={state.ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          I understand this replaces the synth firmware on my FM-1 with experimental software, tested on one unit, and that I use it at my
          own risk.
        </span>
      </label>
    </StepShell>
  )
}
