import { firmware } from '../lib/prepare'
import { site } from '../site'

const hex = (n: number) => n.toString(16).padStart(8, '0')
const kb = (n: number) => Math.round(n / 1024)

export function Header() {
  return (
    <header className="top">
      <div className="shell top__row">
        <span className="top__mark">{site.publisher}</span>
        <nav className="top__nav" aria-label="On this page">
          <a href="#install">Install</a>
          <a href="#controls">Controls</a>
          <a href="#screens">Screens</a>
          <a href="#back">Going back</a>
          {site.sourceUrl && (
            <a href={site.sourceUrl} target="_blank" rel="noopener noreferrer">
              Source
            </a>
          )}
        </nav>
      </div>
    </header>
  )
}

export function Hero() {
  return (
    <div className="hero">
      <p className="label hero__eyebrow">Experimental firmware for the M‑VAVE FM‑1</p>
      <h1 className="display hero__title">
        <span>Doom</span>{' '}
        <span>
          <span className="hero__for">for the</span> FM-1
        </span>
      </h1>
      <p className="hero__lede">
        The first level of Doom on a pocket synthesizer: its own screen, its own keys, its own speaker. It installs from this page over
        USB.
      </p>
      <dl className="specs">
        <div>
          <dt className="label">Memory chip</dt>
          <dd className="display">1 MB</dd>
        </div>
        <div>
          <dt className="label">Working memory</dt>
          <dd className="display">512 KB</dd>
        </div>
        <div>
          <dt className="label">Screen</dt>
          <dd className="display">240 × 240</dd>
        </div>
        <div>
          <dt className="label">Engine</dt>
          <dd className="display">{kb(firmware.img_len)} KB</dd>
        </div>
      </dl>
    </div>
  )
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="shell foot__grid">
        <div>
          <p className="label">Built on</p>
          <p>
            <a href="https://github.com/kilograham/rp2040-doom" target="_blank" rel="noopener noreferrer">
              rp2040-doom
            </a>{' '}
            by Graham Sanderson and{' '}
            <a href="https://www.chocolate-doom.org/" target="_blank" rel="noopener noreferrer">
              Chocolate Doom
            </a>{' '}
            (GPL-2.0-or-later; Doom source © id Software), and the hardware layer and update loader of{' '}
            <a href="https://github.com/hugelton/Felucca" target="_blank" rel="noopener noreferrer">
              Felucca
            </a>{' '}
            by Leo Kuroshita (GPL-3.0-only). The firmware file also holds three files of the JieLi AC79 SDK (Apache-2.0).
          </p>
        </div>
        <div>
          <p className="label">Licence</p>
          <p>
            The firmware as a whole is under the GNU GPL, version 3.{' '}
            {site.sourceUrl && (
              <>
                <a href={site.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Source code
                </a>
                .{' '}
              </>
            )}
            Licence texts: <a href={`${import.meta.env.BASE_URL}licenses/GPL-3.0.txt`}>GPL-3.0</a>,{' '}
            <a href={`${import.meta.env.BASE_URL}licenses/GPL-2.0.txt`}>GPL-2.0</a>,{' '}
            <a href={`${import.meta.env.BASE_URL}licenses/Apache-2.0.txt`}>Apache-2.0</a>,{' '}
            <a href={`${import.meta.env.BASE_URL}licenses/BSD-3-Clause-adpcm-xq.txt`}>BSD-3-Clause</a>.
          </p>
        </div>
        <div>
          <p className="label">Build</p>
          <p className="mono">
            {firmware.version} · firmware {hex(firmware.build)}
          </p>
          <p>
            DOOM is a trademark of id Software. This project is not affiliated with id Software, ZeniMax, M-VAVE or Hügelton Instruments.
          </p>
        </div>
      </div>
    </footer>
  )
}
