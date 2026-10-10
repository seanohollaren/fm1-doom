// What the FM-1's 240x240 screen shows, drawn at a quarter of its resolution (60x60) and scaled up without
// smoothing. The plain-colour screens are the firmware's own (firmware/doom_dev.c: same colours, same squares and
// bars, positions divided by four). The picture of the game is a drawing made for this page, not a screenshot.

export const N = 60

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

function px(f: Frame, x: number, y: number, c: RGB) {
  if (x < 0 || y < 0 || x >= N || y >= N) return
  const i = (y * N + x) * 4
  f[i] = c[0]
  f[i + 1] = c[1]
  f[i + 2] = c[2]
  f[i + 3] = 255
}
function rect(f: Frame, x: number, y: number, w: number, h: number, c: RGB) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(f, i, j, c)
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function synth(f: Frame) {
  rect(f, 0, 0, N, N, [9, 11, 12])
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

// an original drawing in the manner of an early-nineties corridor shooter: converging walls, a door, a status bar
function game(f: Frame) {
  const horizon = 24
  const HUD = 50
  for (let y = 0; y < HUD; y++) {
    const t = Math.abs(y - horizon) / horizon
    const c = y < horizon ? mix([20, 16, 14], [78, 66, 58], t * t) : mix([24, 18, 13], [104, 80, 52], Math.min(1, t * t * 1.1))
    rect(f, 0, y, N, 1, c)
  }
  // side walls: the far end is at x = 22..37, y = 17..31
  for (let x = 0; x < 22; x++) {
    const t = x / 22
    const top = Math.round(17 * t)
    const bot = Math.round(HUD - 1 - (HUD - 1 - 31) * t)
    const seam = x % 6 === 5
    const base = mix([112, 98, 86], [38, 32, 28], t)
    for (let y = top; y <= bot; y++) {
      const band = y - top < 2 || (y > top + (bot - top) * 0.55 && y < top + (bot - top) * 0.55 + 1.2)
      const c = seam ? mix(base, BLACK, 0.45) : band ? mix(base, [190, 170, 140], 0.25) : base
      px(f, x, y, c)
      px(f, N - 1 - x, y, mix(c, BLACK, 0.18))
    }
  }
  rect(f, 22, 17, 16, 15, [44, 38, 34])
  rect(f, 26, 20, 8, 12, [22, 18, 16])
  rect(f, 27, 21, 6, 11, [120, 30, 18])
  rect(f, 27, 21, 6, 1, [170, 52, 30])
  rect(f, 29, 26, 2, 1, [226, 178, 60])
  rect(f, 24, 18, 1, 1, [230, 60, 40])
  rect(f, 35, 18, 1, 1, [230, 60, 40])
  // the pistol, held low
  rect(f, 26, 45, 8, 5, [176, 132, 96])
  rect(f, 28, 40, 4, 8, [96, 96, 100])
  rect(f, 28, 40, 4, 1, [160, 160, 166])
  rect(f, 29, 41, 2, 2, [40, 40, 44])
  // the status bar
  rect(f, 0, HUD, N, N - HUD, [62, 58, 54])
  rect(f, 0, HUD, N, 1, [104, 98, 92])
  for (const x of [13, 25, 35, 47]) rect(f, x, HUD + 1, 1, N - HUD - 1, [34, 31, 29])
  const digit = (x: number) => {
    rect(f, x, HUD + 3, 3, 5, [196, 34, 20])
    px(f, x + 1, HUD + 4, [62, 58, 54])
    px(f, x + 1, HUD + 6, [62, 58, 54])
  }
  digit(3)
  digit(7)
  digit(15)
  digit(19)
  rect(f, 22, HUD + 6, 2, 2, [196, 34, 20])
  rect(f, 27, HUD + 2, 7, 7, [188, 146, 104])
  rect(f, 28, HUD + 4, 2, 1, [40, 30, 24])
  rect(f, 31, HUD + 4, 2, 1, [40, 30, 24])
  rect(f, 29, HUD + 7, 3, 1, [120, 70, 50])
  digit(38)
  digit(42)
  for (let r = 0; r < 3; r++) rect(f, 49, HUD + 2 + r * 3, 9, 1, [150, 140, 90])
}

export function paint(s: Screen): Frame {
  const f = new Uint8ClampedArray(N * N * 4)
  switch (s.kind) {
    case 'off':
      rect(f, 0, 0, N, N, [6, 6, 7])
      break
    case 'synth':
      synth(f)
      break
    case 'safe': {
      rect(f, 0, 0, N, N, s.tone === 'cyan' ? CYAN : s.tone === 'amber' ? AMBER : BLUE)
      if (s.squares >= 1) rect(f, 0, 0, 6, 6, WHITE)
      if (s.squares >= 2) rect(f, N - 6, 0, 6, 6, WHITE)
      // the bottom strip: a white countdown until a host has spoken, then green
      if (s.host) rect(f, 0, N - 2, N, 2, GREEN)
      else {
        rect(f, 0, N - 2, N, 2, BLACK)
        rect(f, 0, N - 2, 42, 2, WHITE)
      }
      break
    }
    case 'bar':
      rect(f, 0, 0, N, N, BLUE)
      rect(f, 5, 27, Math.max(1, Math.round(50 * Math.max(0, Math.min(1, s.f)))), 5, WHITE)
      break
    case 'solid':
      rect(f, 0, 0, N, N, s.tone === 'green' ? GREEN : s.tone === 'red' ? RED : MAGENTA)
      break
    case 'game':
      game(f)
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
 */
export function melt(from: Frame, to: Frame, rand: () => number = Math.random) {
  const y = new Int16Array(N)
  y[0] = -Math.floor(rand() * 12)
  for (let x = 1; x < N; x++) y[x] = Math.max(-12, Math.min(0, y[x - 1] + Math.floor(rand() * 3) - 1))
  return (out: Frame): boolean => {
    let done = true
    for (let x = 0; x < N; x++) {
      if (y[x] < 0) {
        y[x]++
        done = false
      } else if (y[x] < N) {
        y[x] += y[x] < 6 ? y[x] + 1 : 4
        if (y[x] < N) done = false
      }
      const off = Math.max(0, Math.min(N, y[x]))
      for (let row = 0; row < N; row++) {
        const src = row < off ? to : from
        const sy = row < off ? row : row - off
        const i = (row * N + x) * 4
        const j = (sy * N + x) * 4
        out[i] = src[j]
        out[i + 1] = src[j + 1]
        out[i + 2] = src[j + 2]
        out[i + 3] = 255
      }
    }
    return done
  }
}
