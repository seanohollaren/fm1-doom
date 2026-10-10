import { useState } from 'react'
import { GROUPS, LEGEND, type Group } from '../lib/controls'
import { Device } from './Device'
import './Controls.css'

const GAME = { kind: 'game' } as const
const name = (g: Group) => GROUPS.find((x) => x.id === g)!.name

/** The FM-1 with each control coloured by what it does in the game, and the same thing as a list. */
export function Controls() {
  const [focus, setFocus] = useState<Group | null>(null)

  return (
    <div className="controls">
      <div className="controls__layout">
        <Device screen={GAME} controls focus={focus} label="The FM-1, with the keys, buttons and knobs the game uses coloured by what they do" />
        <ul className="controls__list" onMouseLeave={() => setFocus(null)}>
          {LEGEND.map(({ group, rows }) => (
            <li
              key={group}
              className={`controls__group g-${group}${focus && focus !== group ? ' is-dim' : ''}`}
              onMouseEnter={() => setFocus(group)}
            >
              <h4 className="controls__name">
                <span className="controls__dot" aria-hidden="true" />
                {name(group)}
              </h4>
              <dl>
                {rows.map((row) => (
                  <div key={row.what} className="controls__row">
                    <dt>
                      {row.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </dt>
                    <dd>{row.what}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
