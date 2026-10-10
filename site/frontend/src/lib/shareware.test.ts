import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FetchError, fetchShareware, SHAREWARE_BYTES } from './shareware'
import { site } from '../site'
import headers from '../../../security-headers.json'

const wadPath = fileURLToPath(new URL('../../../../wads/doom1.wad', import.meta.url))
const A = 'https://a.example/DOOM1.WAD'
const B = 'https://b.example/doom1.wad'

/** a fetch that serves each URL from a table: bytes, a status, or a function */
function serve(table: Record<string, Uint8Array | number>) {
  const asked: string[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    asked.push(url)
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
    const v = table[url]
    if (typeof v === 'number') return new Response(null, { status: v })
    // in pieces, as a network gives them
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let o = 0; o < v.length; o += 500_000) c.enqueue(v.subarray(o, o + 500_000))
        c.close()
      },
    })
    return new Response(body, { status: 200 })
  })
  return asked
}
afterEach(() => vi.unstubAllGlobals())

describe('fetching the shareware file', () => {
  it('the mirrors on the site are ones the content security policy lets the page reach', () => {
    const allowed = /connect-src ([^;]+)/.exec(headers['Content-Security-Policy'])![1].split(' ')
    expect(site.sharewareMirrors.length).toBeGreaterThan(0)
    for (const m of site.sharewareMirrors) {
      expect(m.startsWith('https://')).toBe(true)
      expect(allowed).toContain(new URL(m).origin)
    }
  })

  it('a wrong status, a short file, a file too long and a file of the right length with other bytes are all refused', async () => {
    const wrong = new Uint8Array(SHAREWARE_BYTES).fill(7)
    for (const bad of [404, new Uint8Array(1000), new Uint8Array(SHAREWARE_BYTES + 1), wrong]) {
      serve({ [A]: bad })
      await expect(fetchShareware([A])).rejects.toThrow(FetchError)
    }
  })

  it('says what each mirror did when none works', async () => {
    serve({ [A]: 503, [B]: new Uint8Array(12) })
    const e = await fetchShareware([A, B]).catch((x) => x)
    expect(e).toBeInstanceOf(FetchError)
    expect(e.detail).toBe(`a.example: HTTP 503; b.example: 12 bytes instead of ${SHAREWARE_BYTES}`)
  })

  it.skipIf(!existsSync(wadPath))('takes the real file, reports progress, and goes to the next mirror when the first fails', async () => {
    const wad = new Uint8Array(readFileSync(wadPath))
    const asked = serve({ [A]: 500, [B]: wad })
    const seen: number[] = []
    const got = await fetchShareware([A, B], (n) => seen.push(n))
    expect(asked).toEqual([A, B])
    expect(got).toEqual(wad)
    expect(seen.at(-1)).toBe(SHAREWARE_BYTES)
    expect(seen.length).toBeGreaterThan(5)
  })
})
