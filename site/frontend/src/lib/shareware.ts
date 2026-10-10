// The one-click way to the game file: the page itself downloads id Software's shareware DOOM1.WAD (version 1.9),
// unmodified, from a public mirror into the browser, and accepts it only if it is that exact file.
// Nothing of it is hosted on this site, and nothing but that file is accepted from a mirror.
import { SHAREWARE_19_SHA256 } from '@fm1/convert.js'
import { sha256hex } from '@fm1/vendor/felucca/fm1pkg.js'

export const SHAREWARE_BYTES = 4_196_020

export class FetchError extends Error {}

/**
 * Tries each mirror in turn. `onProgress(received)` runs as the bytes come in.
 * Throws FetchError (with a sentence for the visitor) when no mirror gave the right file.
 */
export async function fetchShareware(mirrors: readonly string[], onProgress: (received: number) => void = () => {}, timeoutMs = 90_000): Promise<Uint8Array> {
  const said: string[] = []
  for (const url of mirrors) {
    const host = new URL(url).host
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    try {
      onProgress(0)
      // no cookies, no referrer: the mirror learns only that someone asked for the file
      const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: abort.signal })
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`)
      const out = new Uint8Array(SHAREWARE_BYTES)
      const reader = r.body.getReader()
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (got + value.length > SHAREWARE_BYTES) {
          void reader.cancel()
          throw new Error('more bytes than the file has')
        }
        out.set(value, got)
        got += value.length
        onProgress(got)
      }
      if (got !== SHAREWARE_BYTES) throw new Error(`${got} bytes instead of ${SHAREWARE_BYTES}`)
      if ((await sha256hex(out)) !== SHAREWARE_19_SHA256) throw new Error('not the shareware 1.9 file (checksum)')
      return out
    } catch (e) {
      said.push(`${host}: ${abort.signal.aborted ? 'timed out' : (e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  }
  const err = new FetchError('The game file could not be downloaded just now. Try again, or use your own copy of DOOM1.WAD.')
  ;(err as FetchError & { detail: string }).detail = said.join('; ')
  throw err
}
