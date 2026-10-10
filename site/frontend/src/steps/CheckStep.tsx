import type { Installer } from '../lib/useInstaller'
import { Notice, StepShell } from './StepShell'

/** yes: a Chromium browser with Web MIDI. untested: Web MIDI is there, but installs have only been done from Chromium. */
function browserVerdict(canInstall: boolean): 'yes' | 'untested' | 'no' {
  if (!canInstall) return 'no'
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands
  const chromium = brands ? brands.some((b) => /Chromium|Chrome|Edge/i.test(b.brand)) : /Chrome\//.test(navigator.userAgent)
  return chromium ? 'yes' : 'untested'
}

export function CheckStep({ inst, announce }: { inst: Installer; announce: boolean }) {
  const { state, go } = inst
  const verdict = browserVerdict(state.canInstall)
  const ready = state.canInstall && !!state.base

  return (
    <StepShell
      index={0}
      title="Before you start"
      announce={announce}
      next={
        <button type="button" className="btn btn--primary" disabled={!ready} onClick={() => go(1)}>
          Next <span aria-hidden="true">→</span>
        </button>
      }
    >
      <p className="lead">
        This puts experimental firmware on an M-VAVE FM-1 that turns it into a one-level Doom machine. The synth firmware can be put back
        afterwards.
      </p>

      {verdict === 'yes' && <Notice tone="ok" title="This browser can install it">It can talk to the FM-1 over USB.</Notice>}
      {verdict === 'untested' && (
        <Notice tone="warn" title="This browser might work">
          It has what the installer needs, but installs have only been done from Chrome and Edge. Use one of those if you can.
        </Notice>
      )}
      {verdict === 'no' && (
        <Notice tone="bad" title="This browser can’t reach the FM-1">
          Open this page in Chrome or Edge on a computer. Safari and iPhones can’t talk to USB instruments from a web page.
        </Notice>
      )}
      {state.baseError && (
        <Notice tone="bad" title="The firmware could not be loaded">
          {state.baseError}. Reload the page.
        </Notice>
      )}

      <h3 className="sub">You need</h3>
      <ul className="needs">
        <li>
          <strong>An M-VAVE FM-1</strong>
          <span>The installer has been tested on one, starting from the Felucca firmware.</span>
        </li>
        <li>
          <strong>A USB cable that carries data</strong>
          <span>Some cables only charge, and the browser never sees the FM-1 through those.</span>
        </li>
        <li>
          <strong>The game file, DOOM1.WAD</strong>
          <span>The free shareware release of Doom. The next step explains.</span>
        </li>
      </ul>
    </StepShell>
  )
}
