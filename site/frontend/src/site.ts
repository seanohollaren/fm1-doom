// The few facts about this site that are not code.
export const site = {
  /** where the source of the firmware and of this page can be had (the GPL asks for it); empty hides the link */
  sourceUrl: '',
  /** where a visitor can read about the shareware game file */
  wadHelpUrl: 'https://doomwiki.org/wiki/DOOM1.WAD',
  feluccaInstallerUrl: 'https://hugelton.github.io/Felucca/',
  publisher: 'Deadlock Interactive',
  /** what a player should know about the build the page installs; edit with every firmware release */
  buildNotes: [
    'One level: E1M1. Finishing it returns to the title picture.',
    'No saved games, no map screen, no end-of-level tally: there was no room.',
    'Sound plays at one fixed, low volume. The volume knob is not connected yet.',
    'Sound effects are stored at half their original sample rate to fit.',
  ],
}

export const STEPS = [
  { id: 'check', name: 'Check' },
  { id: 'file', name: 'Game file' },
  { id: 'prepare', name: 'Prepare' },
  { id: 'connect', name: 'Connect' },
  { id: 'install', name: 'Install' },
  { id: 'play', name: 'Play' },
] as const

export type StepId = (typeof STEPS)[number]['id']
