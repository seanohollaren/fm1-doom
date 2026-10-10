// Numerals built from square pixels, 5 wide and 7 high, for the install readout: a nod to a status bar,
// drawn for this page rather than borrowed from one.
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '%': ['11000', '11001', '00010', '00100', '01000', '10011', '00011'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  // a tick
  v: ['00000', '00001', '00010', '00010', '10100', '10100', '01000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

interface Props {
  text: string
  /** what a screen reader should say instead of the pixels */
  label: string
  tone?: 'red' | 'green' | 'dim' | 'amber'
}

export function PixelText({ text, label, tone = 'red' }: Props) {
  const chars = [...text]
  const width = chars.length * 6 - 1
  return (
    <svg className={`pixel pixel--${tone}`} viewBox={`0 0 ${width} 7`} role="img" aria-label={label} shapeRendering="crispEdges">
      {chars.map((ch, c) =>
        (GLYPHS[ch] ?? GLYPHS[' ']).flatMap((row, y) =>
          [...row].map((bit, x) => (bit === '1' ? <rect key={`${c}-${x}-${y}`} className="pixel__ink" x={c * 6 + x} y={y} width="1" height="1" /> : null)),
        ),
      )}
    </svg>
  )
}
