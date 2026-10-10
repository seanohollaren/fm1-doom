import { Controls } from '../components/Controls'
import type { Installer } from '../lib/useInstaller'
import { Notice, StepShell } from './StepShell'

export function PlayStep({ inst, announce }: { inst: Installer; announce: boolean }) {
  return (
    <StepShell index={5} title="Play" announce={announce} back={() => inst.go(4)}>
      <Notice tone="ok" title="Doom is running on your FM-1">
        You can unplug it now. It starts the game every time you switch it on.
      </Notice>

      <ol className="todo">
        <li>
          <strong>Press any key at the title picture.</strong>
          <span>The menu opens.</span>
        </li>
        <li>
          <strong>
            Press <kbd>PLAY</kbd> on New Game and pick a skill.
          </strong>
          <span>
            Turn <kbd>SELECT</kbd> to move through the menu. The level starts straight away.
          </span>
        </li>
      </ol>

      <h3 className="sub">Controls</h3>
      <Controls />

      <p className="quiet">
        The rest of the manual is further down this page: what the plain-colour screens mean, and how to put a synth firmware back.
      </p>
    </StepShell>
  )
}
