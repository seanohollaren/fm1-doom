// What each control does in the game: one table for the drawing of the FM-1 and for the list next to it.
// It restates rp2040-doom/src/fm1/fm1_controls.c (FM1_MAP and the knob code below it); change both together.

export type Group = 'move' | 'side' | 'fire' | 'use' | 'weapon' | 'menu' | 'view'

export const GROUPS: { id: Group; name: string }[] = [
  { id: 'move', name: 'Move' },
  { id: 'side', name: 'Sidestep and run' },
  { id: 'fire', name: 'Fire' },
  { id: 'use', name: 'Open doors, press switches' },
  { id: 'weapon', name: 'Change weapon' },
  { id: 'menu', name: 'Menu' },
  { id: 'view', name: 'Picture' },
]

/** note keys by position: 0 = the lowest key (F3) … 26 = the highest (G5) */
export const KEYS: Record<number, Group> = {
  0: 'side', 1: 'side', 2: 'move', 3: 'move', 4: 'move', 5: 'move', 6: 'move', 7: 'side',
  21: 'use', 23: 'fire', 24: 'fire', 25: 'side', 26: 'use',
}

/** buttons by their printed label */
export const BUTTONS: Record<string, Group> = {
  HOME: 'menu', PLAY: 'menu', FX: 'menu', REC: 'fire', 'OCT−': 'weapon', 'OCT+': 'weapon', SCL: 'view', LFO: 'view', ENV: 'view',
}

export const KNOBS: Record<string, Group> = { SELECT: 'weapon', 'KNOB 4': 'weapon' }

export const LEGEND: { group: Group; rows: { keys: string[]; what: string }[] }[] = [
  {
    group: 'move',
    rows: [
      { keys: ['G', 'B'], what: 'Turn left and right' },
      { keys: ['G♯', 'A♯'], what: 'Walk forward' },
      { keys: ['A'], what: 'Walk backward' },
    ],
  },
  {
    group: 'side',
    rows: [
      { keys: ['F', 'C'], what: 'Step left and right' },
      { keys: ['F♯'], what: 'Run while held (low or high F♯)' },
    ],
  },
  { group: 'fire', rows: [{ keys: ['high E', 'high F', 'REC'], what: 'Fire' }] },
  { group: 'use', rows: [{ keys: ['high D', 'top G'], what: 'Open a door, press a switch' }] },
  { group: 'weapon', rows: [{ keys: ['OCT−', 'OCT+', 'SELECT', 'KNOB 4'], what: 'Previous and next weapon' }] },
  {
    group: 'menu',
    rows: [
      { keys: ['HOME'], what: 'Open or close the menu' },
      { keys: ['SELECT'], what: 'Move through the menu' },
      { keys: ['PLAY'], what: 'Choose' },
      { keys: ['FX'], what: 'Answer yes' },
    ],
  },
  {
    group: 'view',
    rows: [
      { keys: ['SCL'], what: 'Picture shape: full screen, 4:3, wide' },
      { keys: ['LFO'], what: 'Screen speed: change it if the picture tears' },
      { keys: ['ENV'], what: 'Show the frame rate' },
    ],
  },
]
