// What each control does in the game: one table for the drawing of the FM-1 and for the list next to it.
// It restates rp2040-doom/src/fm1/fm1_controls.c (FM1_MAP and the knob code below it); change both together.

export type Group = 'move' | 'side' | 'fire' | 'use' | 'weapon' | 'menu' | 'volume' | 'sound'

export const GROUPS: { id: Group; name: string }[] = [
  { id: 'move', name: 'Move' },
  { id: 'side', name: 'Sidestep and run' },
  { id: 'fire', name: 'Fire' },
  { id: 'use', name: 'Open doors, press switches' },
  { id: 'weapon', name: 'Change weapon' },
  { id: 'menu', name: 'Menu' },
  { id: 'volume', name: 'Volume' },
  { id: 'sound', name: 'Shape the sound' },
]

/** note keys by position: 0 = the lowest key (F3) … 26 = the highest (G5) */
export const KEYS: Record<number, Group> = {
  0: 'side', 1: 'move', 2: 'move', 3: 'move', 4: 'side', 5: 'move',
  24: 'fire', 25: 'side', 26: 'use',
}

/** buttons by their printed label (SCL and GLO also do something, picture shape and frame rate: left out on purpose) */
export const BUTTONS: Record<string, Group> = {
  HOME: 'menu', PLAY: 'menu', FX: 'menu', REC: 'fire', 'OCT−': 'weapon', 'OCT+': 'weapon', EDIT: 'sound', ENV: 'sound', LFO: 'sound',
}

export const KNOBS: Record<string, Group> = {
  SELECT: 'weapon', MASTER: 'volume', PRESETS: 'sound', ALGORITHM: 'sound',
  'KNOB 1': 'sound', 'KNOB 2': 'sound', 'KNOB 3': 'sound', 'KNOB 4': 'sound',
}

/** what is written on each note key in the drawing: one word, or two with a line each */
export const KEY_LABELS: Record<number, string[]> = {
  0: ['Strafe', 'Left'], 1: ['Turn', 'Left'], 2: ['Back'], 3: ['Forward'], 4: ['Strafe', 'Right'], 5: ['Turn', 'Right'],
  24: ['Fire'], 25: ['Run'], 26: ['Open'],
}

/** what the pointer is told over a button or a knob in the drawing */
export const TIPS: Record<string, string> = {
  MASTER: 'Volume. Right down is silent.',
  SELECT: 'Previous and next weapon. With the menu open, moves through it.',
  'KNOB 1': 'Filter sweep; the centre is off. After ENV: attack. After LFO: how fast the filter wobbles.',
  'KNOB 2': 'Filter resonance: how hard it rings where it cuts. After ENV: decay.',
  'KNOB 3': 'Pitch of the music, a semitone a click. After ENV: sustain.',
  'KNOB 4': 'Brings in a drum beat: off at the left, then eight beats. After ENV: release.',
  PRESETS: 'What plays the music: three synth sounds, then the game’s 128. Far left is as written.',
  ALGORITHM: 'FM depth: every instrument duller to the left, harsher to the right.',
  'OCT−': 'Previous weapon.',
  'OCT+': 'Next weapon.',
  FX: 'Answers yes when the game asks.',
  EDIT: 'Puts all of the sound back as it was.',
  ENV: 'The four knobs become attack, decay, sustain and release for the music. Again: back.',
  LFO: 'KNOB 1 becomes a wobble that swings the filter to and fro. Again: back.',
  HOME: 'Opens and closes the menu.',
  PLAY: 'Chooses in the menu.',
  REC: 'Fire.',
}

export const LEGEND: { group: Group; rows: { keys: string[]; what: string }[] }[] = [
  {
    group: 'move',
    rows: [
      { keys: ['G♯'], what: 'Walk forward' },
      { keys: ['G'], what: 'Walk backward' },
      { keys: ['F♯', 'A♯'], what: 'Turn left and right' },
    ],
  },
  {
    group: 'side',
    rows: [
      { keys: ['F', 'A'], what: 'Step left and right' },
      { keys: ['high F♯'], what: 'Run while held' },
    ],
  },
  { group: 'fire', rows: [{ keys: ['high F', 'REC'], what: 'Fire' }] },
  { group: 'use', rows: [{ keys: ['top G'], what: 'Open a door, press a switch' }] },
  { group: 'weapon', rows: [{ keys: ['OCT−', 'OCT+', 'SELECT'], what: 'Previous and next weapon' }] },
  {
    group: 'menu',
    rows: [
      { keys: ['HOME'], what: 'Open or close the menu' },
      { keys: ['SELECT'], what: 'Move through the menu' },
      { keys: ['PLAY'], what: 'Choose' },
      { keys: ['FX'], what: 'Answer yes' },
    ],
  },
  { group: 'volume', rows: [{ keys: ['MASTER'], what: 'Louder and quieter; right down is silent' }] },
  {
    // the synth's own tricks, over everything the game plays
    group: 'sound',
    rows: [
      { keys: ['KNOB 1'], what: 'Filter sweep. Left closes the sound down to a rumble; right thins it to a hiss; the centre is off' },
      { keys: ['KNOB 2'], what: 'Filter resonance: how hard the filter rings where it cuts' },
      { keys: ['PRESETS'], what: 'What plays the music: three synth sounds (SAW LEAD, ACID, RAVE), then the game’s own 128 instruments; all the way left is as written' },
      { keys: ['ALGORITHM'], what: 'FM depth: every instrument duller to the left, harsher to the right' },
      { keys: ['KNOB 3'], what: 'Pitch of the music, a semitone a click, an octave each way' },
      { keys: ['KNOB 4'], what: 'A drum beat under the music: off at the left, then eight beats' },
      { keys: ['ENV'], what: 'The four knobs become the envelope of the music’s notes: attack, decay, sustain, release. Press it again to go back' },
      { keys: ['LFO'], what: 'KNOB 1 becomes a wobble that swings the filter to and fro, slow to fast. Press it again to go back' },
      { keys: ['EDIT'], what: 'All of it as it was' },
    ],
  },
]
