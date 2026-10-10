// Cuts, converts and packs the chosen WAD off the main thread (the converter runs for a second or more).
// The work itself is in ../../web: wadcut.js, rp2040-doom's whd_gen as WebAssembly, datapack.js.
import { prepare, ConvertError } from '@fm1/convert.js'
import { WadError } from '@fm1/wadcut.js'
import { DataError } from '@fm1/datapack.js'

export interface PrepareRequest {
  wad: ArrayBuffer
  base: Uint8Array
  fw: { product: string; build: number; img_len: number; desc_at: number; app_slot: number }
  /** the converter's wrapper and its .wasm; both carry the build's hash, so a cached copy of another build is never used */
  converterUrl: string
  wasmUrl: string
}

export type PrepareReply =
  | { ok: true; pkg: Uint8Array; data2: Uint8Array; meta: unknown; info: unknown }
  | { ok: false; message: string; detail?: string }

self.onmessage = async (ev: MessageEvent<PrepareRequest>) => {
  const { wad, base, fw, converterUrl, wasmUrl } = ev.data
  let reply: PrepareReply
  try {
    const { default: factory } = await import(/* @vite-ignore */ converterUrl)
    const r = await prepare(new Uint8Array(wad), base, fw, factory, { locateFile: () => wasmUrl })
    reply = { ok: true, pkg: r.pkg, data2: r.data2, meta: r.meta, info: r.info }
  } catch (e) {
    const err = e as Error & { detail?: string }
    if (e instanceof WadError || e instanceof ConvertError) reply = { ok: false, message: err.message, detail: err.detail }
    else if (e instanceof DataError) reply = { ok: false, message: `This WAD can't be used: ${err.message}.` }
    else reply = { ok: false, message: 'Something went wrong while preparing this file.', detail: String(err?.stack || err) }
  }
  self.postMessage(reply)
}
