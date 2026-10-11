// What the FM-1's 240x240 screen shows, pixel for pixel. The plain-colour screens are the firmware's own
// (firmware/doom_dev.c: same colours, same squares and bars), laid out on a grid of 4x4 pixels. The picture of the
// game is a real one: the panel two seconds after E1M1 appears, taken from the firmware's browser build by
// site/capture_screen.js.
import shotUrl from '../assets/e1m1-start.png'

export const N = 240
/** the plain screens and the melt are laid out in cells of this many pixels: G cells across */
const CELL = 4
const G = N / CELL

export type Screen =
  | { kind: 'off' }
  /** some other firmware is running: a synth's screen, whatever it shows */
  | { kind: 'synth' }
  /** safe mode: waiting for an install. squares: 1 = no game data, 2 = second block missing. host: a page is talking to it */
  | { kind: 'safe'; tone: 'blue' | 'cyan' | 'amber'; squares: 0 | 1 | 2; host: boolean }
  /** taking the game data: blue with a white bar growing */
  | { kind: 'bar'; f: number }
  | { kind: 'solid'; tone: 'green' | 'red' | 'magenta' }
  | { kind: 'game' }

type RGB = readonly [number, number, number]
// RGB565 values from the firmware, widened to 8 bits a channel
const BLUE: RGB = [0, 0, 132]
const CYAN: RGB = [0, 255, 255]
const AMBER: RGB = [255, 166, 0]
const GREEN: RGB = [0, 255, 0]
const RED: RGB = [255, 0, 0]
const MAGENTA: RGB = [255, 0, 255]
const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

export type Frame = Uint8ClampedArray // N * N * 4, RGBA

/** fill a rectangle given in cells */
function rect(f: Frame, x: number, y: number, w: number, h: number, c: RGB) {
  const x0 = Math.max(0, x * CELL)
  const x1 = Math.min(N, (x + w) * CELL)
  for (let j = Math.max(0, y * CELL); j < Math.min(N, (y + h) * CELL); j++)
    for (let i = (j * N + x0) * 4; i < (j * N + x1) * 4; i += 4) {
      f[i] = c[0]
      f[i + 1] = c[1]
      f[i + 2] = c[2]
      f[i + 3] = 255
    }
}
const px = (f: Frame, x: number, y: number, c: RGB) => rect(f, x, y, 1, 1, c)

function synth(f: Frame) {
  rect(f, 0, 0, G, G, [9, 11, 12])
  const dim: RGB = [70, 84, 86]
  const lit: RGB = [150, 190, 186]
  rect(f, 3, 3, 12, 2, dim)
  rect(f, 44, 3, 13, 2, dim)
  for (let c = 0; c < 4; c++) {
    rect(f, 3 + c * 14, 9, 11, 1, dim)
    rect(f, 3 + c * 14, 12, 7, 2, lit)
  }
  for (let x = 3; x < 57; x++) px(f, x, 30 + Math.round(Math.sin(x * 0.55) * 3 + Math.sin(x * 1.7) * 1.2), lit)
  rect(f, 3, 44, 54, 1, dim)
  for (let x = 6; x < 56; x += 7) rect(f, x, 42, 1, 2, dim)
  rect(f, 3, 51, 20, 2, dim)
  rect(f, 47, 51, 10, 2, dim)
}

// ---- the picture of the game: a PNG, read into a frame once the browser has decoded it
let shot: Frame | null = null
let loading: Promise<void> | null = null

/** Resolves when paint() can draw the game (at once if it already can; never where there is no browser). */
export function gameShot(): Promise<void> {
  loading ??= (async () => {
    if (typeof document === 'undefined') return new Promise<void>(() => {})
    const img = new Image()
    img.src = shotUrl
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = N
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, N, N)
    shot = ctx.getImageData(0, 0, N, N).data
  })()
  return loading
}
export const hasGameShot = () => shot !== null

export function paint(s: Screen): Frame {
  const f = new Uint8ClampedArray(N * N * 4)
  switch (s.kind) {
    case 'off':
      rect(f, 0, 0, G, G, [6, 6, 7])
      break
    case 'synth':
      synth(f)
      break
    case 'safe': {
      rect(f, 0, 0, G, G, s.tone === 'cyan' ? CYAN : s.tone === 'amber' ? AMBER : BLUE)
      if (s.squares >= 1) rect(f, 0, 0, 6, 6, WHITE)
      if (s.squares >= 2) rect(f, G - 6, 0, 6, 6, WHITE)
      // the bottom strip: a white countdown until a host has spoken, then green
      if (s.host) rect(f, 0, G - 2, G, 2, GREEN)
      else {
        rect(f, 0, G - 2, G, 2, BLACK)
        rect(f, 0, G - 2, 42, 2, WHITE)
      }
      break
    }
    case 'bar':
      rect(f, 0, 0, G, G, BLUE)
      rect(f, 5, 27, Math.max(1, Math.round(50 * Math.max(0, Math.min(1, s.f)))), 5, WHITE)
      break
    case 'solid':
      rect(f, 0, 0, G, G, s.tone === 'green' ? GREEN : s.tone === 'red' ? RED : MAGENTA)
      break
    case 'game':
      // (dark for the moment before the picture has been decoded)
      if (shot) f.set(shot)
      else rect(f, 0, 0, G, G, BLACK)
      break
  }
  return f
}

/** screens that differ only in how far a bar has got are the same picture as far as transitions go */
export const sameScene = (a: Screen, b: Screen) =>
  a.kind === b.kind && (a.kind !== 'safe' || (b.kind === 'safe' && a.tone === b.tone && a.squares === b.squares)) &&
  (a.kind !== 'solid' || (b.kind === 'solid' && a.tone === b.tone))

/**
 * The classic column melt: the old picture slides down in strips of uneven start, uncovering the new one.
 * Returns a function that writes frame `t` (0, 1, 2, ...) into `out` and says whether the melt has finished.
 * It moves in whole cells: strips a cell wide, dropping a cell at a time.
 */
export function melt(from: Frame, to: Frame, rand: () => number = Math.random) {
  const y = new Int16Array(G)
  y[0] = -Math.floor(rand() * 12)
  for (let c = 1; c < G; c++) y[c] = Math.max(-12, Math.min(0, y[c - 1] + Math.floor(rand() * 3) - 1))
  return (out: Frame): boolean => {
    let done = true
    for (let c = 0; c < G; c++) {
      if (y[c] < 0) {
        y[c]++
        done = false
      } else if (y[c] < G) {
        y[c] += y[c] < 6 ? y[c] + 1 : 4
        if (y[c] < G) done = false
      }
      const off = Math.max(0, Math.min(G, y[c])) * CELL
      for (let row = 0; row < N; row++) {
        const src = row < off ? to : from
        const at = ((row < off ? row : row - off) * N + c * CELL) * 4
        out.set(src.subarray(at, at + CELL * 4), (row * N + c * CELL) * 4)
      }
    }
    return done
  }
}
