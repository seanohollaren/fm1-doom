// The few facts about this site that are not code.
export const site = {
  /** where the source of the firmware and of this page can be had (the GPL asks for it); empty hides the link */
  sourceUrl: 'https://github.com/seanohollaren/fm1-doom',
  /**
   * Where the page may download id Software's shareware DOOM1.WAD v1.9 from, in the visitor's browser, in this
   * order. Each must allow cross-site requests; the page accepts only the exact file (size and SHA-256), whatever
   * a mirror sends. Each host must also be in connect-src in ../../security-headers.json (a test checks).
   */
  sharewareMirrors: [
    'https://cors.archive.org/cors/doom-shareware_1996/DOOM1.WAD',
    'https://raw.githubusercontent.com/Akbar30Bill/DOOM_wads/f412706f9fe89b9ed8b888b5ea4e56db9db78ebd/doom1.wad',
  ],
  feluccaInstallerUrl: 'https://hugelton.github.io/Felucca/',
  /** what a player should know about the build the page installs; edit with every firmware release */
  buildNotes: [
    'One level: E1M1. Finishing it returns to the title picture.',
    'No saved games, no map screen, no end-of-level tally: there was no room.',
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
