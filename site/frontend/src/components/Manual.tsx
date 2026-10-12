import { site } from '../site'
import { Controls } from './Controls'
import './Manual.css'

const SCREENS: { cls: string; name: string; says: string }[] = [
  { cls: 'blue one', name: 'Blue, one white square', says: 'The firmware is on, with no game data yet. Run the install on this page.' },
  { cls: 'blue two', name: 'Blue, two white squares', says: 'Half the game data is there. Run the install again: it sends the rest.' },
  { cls: 'cyan', name: 'Cyan', says: 'You held HOME while switching on. The FM-1 waits for an install instead of starting the game.' },
  { cls: 'amber', name: 'Amber', says: 'The game stopped within half a minute of starting. Install again, or hold PLAY for two seconds to try the game once more.' },
  { cls: 'red', name: 'Red or magenta', says: 'The game stopped. The FM-1 restarts by itself after a moment.' },
  { cls: 'dark', name: 'Dark', says: 'After three minutes on a waiting screen with no computer talking to it, the FM-1 drops into the chip’s built-in update mode. Switch it off and on.' },
]

export function Manual() {
  return (
    <section className="manual" aria-labelledby="manual-title">
      <div className="shell">
        <header className="manual__head">
          <p className="label">Reference</p>
          <h2 className="display manual__title" id="manual-title">
            Manual
          </h2>
        </header>

        <article className="manual__block manual__block--wide" id="controls">
          <h3 className="display manual__h">Controls</h3>
          <p className="manual__lede">
            Movement controls on the left. You can change presets, drums, pass filters, wobble, and envelope stuff.
          </p>
          <Controls />
        </article>

        <div className="manual__grid">
          <article className="manual__block" id="screens">
            <h3 className="display manual__h">Plain-colour screens</h3>
            <p className="manual__lede">
              The firmware has no text of its own. When it is not showing the game, a colour says what it is doing. Every one of these
              accepts an install from this page.
            </p>
            <ul className="screens">
              {SCREENS.map((s) => (
                <li key={s.name}>
                  <span className={`screens__chip ${s.cls}`} aria-hidden="true" />
                  <div>
                    <strong>{s.name}</strong>
                    <p>{s.says}</p>
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="manual__block" id="back">
            <h3 className="display manual__h">Going back to a synth</h3>
            <p className="manual__lede">
              The FM-1 takes firmware the same way whatever it runs. Open{' '}
              <a href={site.feluccaInstallerUrl} target="_blank" rel="noopener noreferrer">
                Felucca’s installer
              </a>{' '}
              and install it as on any FM-1. From Felucca you can return to M-VAVE’s original firmware the usual way.
            </p>
            <ul className="facts">
              <li>
                <strong>If the installer can’t find the FM-1 while the game runs,</strong> switch it off, hold <kbd>HOME</kbd>, and switch it
                on. It waits on its cyan screen for an install.
              </li>
              <li>
                <strong>Presets saved by M-VAVE’s firmware survive.</strong> Doom never writes where they are kept.
              </li>
              <li>
                <strong>Felucca’s saved projects and samples do not.</strong> The game data lies over them.
              </li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  )
}
