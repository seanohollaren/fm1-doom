// Shapes shared by the page and the install modules in ../../web (plain JavaScript; these are their types).

/** src/firmware.json, written by site/sync_firmware.py */
export interface FirmwareMeta {
  version: string
  file: string
  sha256: string
  product: string
  build: number
  core: string
  img_len: number
  desc_at: number
  app_slot: number
  converter_sha256: string
  /** the commit of this repository the firmware was built from */
  source_commit?: string
}

/** what is about to be installed: the firmware reports the same numbers once it holds this data */
export interface InstallMeta {
  product: string
  build: number
  split: number
  total: number
  data2_len: number
  data2_crc16: number
}

export interface Prepared {
  fileName: string
  /** the package as the device addresses it during an update */
  image: Uint8Array
  /** the second block of the game data, which the firmware writes itself */
  data2: Uint8Array
  meta: InstallMeta
  /** true: the shareware DOOM1.WAD v1.9, whose converted data is the data tested on a real FM-1 */
  known: boolean
  dataBytes: number
  capacityBytes: number
  wadSha: string
  dataSha: string
}

export interface PrepareFailure {
  /** a sentence for the person; ends with a full stop */
  message: string
  /** the converter's own words, for the details log */
  detail?: string
}

export interface DataReply {
  code: number
  mode: number
  flash: number
  total: number
  split: number
  crc2: number
  build: number
}

export type ProbeResult =
  | { kind: 'none' }
  | { kind: 'loader'; id: string; port: string }
  | { kind: 'device'; id: string; model: string; version: number; port: string; doom: DataReply | null; same: boolean }

export type StageState = '' | 'now' | 'done' | 'fail'
export type Phase = 'find' | 'check' | 'loader' | 'write' | 'reboot' | 'wait' | 'data' | 'restart' | 'game' | 'fail'

export type InstallEvent =
  | { t: 'stage'; n: 1 | 2 | 3 | 4; state: StageState; note?: string }
  | { t: 'bar'; f: number | null; state: '' | 'done' | 'fail' }
  | { t: 'say'; text: string }
  | { t: 'log'; text: string }
  | { t: 'phase'; name: Phase; f?: number }
