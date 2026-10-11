import type { Installer } from '../lib/useInstaller'
import { Notice, StepShell } from './StepShell'

export function PlayStep({ inst, announce }: { inst: Installer; announce: boolean }) {
  return (
    <StepShell
      index={5}
      title="Play"
      announce={announce}
      back={() => inst.go(4)}
      next={
        <a className="btn btn--primary" href="#controls">
          View controls
        </a>
      }
    >
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

      <p className="quiet">
        The manual is further down this page: the controls, what the plain-colour screens mean, and how to put a synth firmware back.
      </p>
    </StepShell>
  )
}
