import { firmware } from '../lib/prepare'
import './FlashMap.css'

type Fate = 'fixed' | 'new' | 'work' | 'kept'

// The FM-1's 1 MB flash chip as the installer treats it (addresses in NOTES.md, checked against a full read-out
// of the test unit before and after an install).
const KB = 1024
const engine = Math.round(firmware.img_len / KB)
const REGIONS: { name: string; kb: number; fate: Fate; says: string }[] = [
  { name: 'Boot code', kb: 16, fate: 'fixed', says: 'No install touches it.' },
  { name: 'Doom engine', kb: engine, fate: 'new', says: 'Takes the place of the synth firmware.' },
  { name: 'Game data, first part', kb: 572 - engine, fate: 'new', says: 'Fills the rest of the firmware’s space.' },
  { name: 'Game data, second part', kb: 308, fate: 'new', says: 'Lies over what Felucca saved here: projects and samples.' },
  { name: 'Update workspace', kb: 20, fate: 'work', says: 'Used by every firmware update while it runs.' },
  { name: 'Felucca autosave', kb: 12, fate: 'kept', says: 'Not touched.' },
  { name: 'M-VAVE presets', kb: 80, fate: 'kept', says: 'The presets saved by the original firmware.' },
  { name: 'Settings', kb: 16, fate: 'kept', says: 'Not touched.' },
]
const FATES: Record<Fate, string> = { fixed: 'Never written', new: 'Replaced', work: 'Workspace', kept: 'Kept' }

export function FlashMap() {
  return (
    <figure className="flash">
      <figcaption className="label">The FM-1’s memory chip · 1,024 KB</figcaption>
      <div className="flash__bar" aria-hidden="true">
        {REGIONS.map((r) => (
          <span key={r.name} className={`flash__seg is-${r.fate}`} style={{ flexGrow: r.kb }} title={`${r.name}: ${r.kb} KB`} />
        ))}
      </div>
      <table className="flash__table">
        <thead className="vh">
          <tr>
            <th>Area</th>
            <th>Size</th>
            <th>What happens to it</th>
          </tr>
        </thead>
        <tbody>
          {REGIONS.map((r) => (
            <tr key={r.name}>
              <th scope="row">
                <span className={`flash__dot is-${r.fate}`} aria-hidden="true" />
                {r.name}
              </th>
              <td className="mono">{r.kb} KB</td>
              <td>
                <strong className={`flash__fate is-${r.fate}`}>{FATES[r.fate]}.</strong> {r.says}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
