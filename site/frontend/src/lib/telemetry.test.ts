// The install counter: what the page sends (./telemetry), against the function that receives it
// (site/infra/functions/count.js, the file CloudFront runs) and the names the dashboard is built from.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COUNT_EVENTS, count, countUrl, type CountEvent } from './telemetry'
import spec from '../../../install-count.json'
import firmware from '../firmware.json'

const source = readFileSync(fileURLToPath(new URL('../../../infra/functions/count.js', import.meta.url)), 'utf8')
// a CloudFront Function is a script with a global `handler`, not a module
const fn = new Function(`${source}\nreturn { handler, EVENTS, FIELDS }`)() as {
  handler: (event: unknown) => { statusCode: number; headers: Record<string, { value: string }> }
  EVENTS: string[]
  FIELDS: string[]
}
// the dashboard's own way of taking a line apart (site/infra/lib/telemetry-stack.ts)
const stack = readFileSync(fileURLToPath(new URL('../../../infra/lib/telemetry-stack.ts', import.meta.url)), 'utf8')

/** a request as CloudFront hands it to the function */
function request(url: string, method = 'POST') {
  const u = new URL(url, 'https://doom.example')
  const querystring: Record<string, { value: string }> = {}
  for (const [k, v] of new URLSearchParams(u.search)) querystring[k] = { value: v }
  return { version: '1.0', request: { method, uri: u.pathname, querystring, headers: {}, cookies: {} } }
}

/** run the function; what it answered and what it logged */
function serve(url: string, method = 'POST') {
  const lines: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line))
  try {
    return { status: fn.handler(request(url, method)).statusCode, lines }
  } finally {
    log.mockRestore()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the install counter', () => {
  it('uses the same names on the page, in the function and for the dashboard', () => {
    expect([...COUNT_EVENTS]).toEqual(spec.events)
    expect(fn.EVENTS).toEqual(spec.events)
    expect(fn.FIELDS).toEqual(spec.fields)
    expect(source).toContain(`'${spec.marker}'`)
    expect(source).toContain(`'${spec.path}/'`)
    // every event has a metric, and no metric is left without an event
    const named = [...stack.matchAll(/^ {2}(\w+): \{ metric: '/gm)].map((m) => m[1])
    expect(named).toEqual(spec.events)
  })

  it('logs one line for each event the page sends, and the dashboard can read it', () => {
    // the pattern the dashboard's queries use, with the marker filled in as the stack does
    const m = /String\.raw`parse @message \/(.+)\/`/.exec(stack)
    expect(m).not.toBeNull()
    const pattern = new RegExp(m![1].replace('${count.marker}', spec.marker))
    for (const event of spec.events as CountEvent[]) {
      const r = serve(countUrl(event, { had: 'FM-1_015', stage: event === 'fail' ? 3 : undefined }, '1a2b3c4d'))
      expect(r.status).toBe(204)
      expect(r.lines).toEqual([`${spec.marker}${event} fw=${firmware.version} had=FM-1_015 stage=${event === 'fail' ? 3 : '-'} sid=1a2b3c4d`])
      // CloudFront puts the request's id in front of the line
      expect(pattern.exec(`U7b4hR_RaxMADupvKAvr8== ${r.lines[0]}`)?.groups).toEqual({
        evt: event, fw: firmware.version, had: 'FM-1_015', stage: event === 'fail' ? '3' : '-', sid: '1a2b3c4d',
      })
      // and each line is counted by its own event's metric filter only (a term match on marker + event)
      expect(spec.events.filter((e) => r.lines[0].split(' ').includes(spec.marker + e))).toEqual([event])
    }
  })

  it('sends nothing but the event, the build, the firmware found, the stage and the visit', () => {
    const u = new URL(countUrl('done', { had: 'FM-1_015' }), 'https://doom.example')
    expect(u.pathname).toBe('/count/done')
    expect([...u.searchParams.keys()].sort()).toEqual(['fw', 'had', 'sid'])
    expect(u.searchParams.get('sid')).toMatch(/^[0-9a-f]{8}$/)
    // the same visit keeps its number; it is random, not derived from anything
    expect(new URL(countUrl('start'), 'https://doom.example').searchParams.get('sid')).toBe(u.searchParams.get('sid'))
    // whatever a device calls itself, the value stays short and plain
    const odd = new URL(countUrl('connect', { had: 'ota-FM 1\n<x>'.padEnd(60, '!') }), 'https://doom.example')
    expect(odd.searchParams.get('had')).toMatch(/^[A-Za-z0-9._-]{1,24}$/)
  })

  it('answers 404 and logs nothing for anything else', () => {
    expect(serve('/count/done', 'GET')).toEqual({ status: 404, lines: [] })
    expect(serve('/count/installed')).toEqual({ status: 404, lines: [] })
    expect(serve('/count/')).toEqual({ status: 404, lines: [] })
    expect(serve('/count/done/extra')).toEqual({ status: 404, lines: [] })
  })

  it('never logs a value it was not built to take', () => {
    const r = serve(`/count/done?fw=${encodeURIComponent('b16 FM1EVT_fail')}&had=${'x'.repeat(25)}&stage=${encodeURIComponent('1\nFM1EVT_done')}&ip=1.2.3.4`)
    expect(r).toEqual({ status: 204, lines: ['FM1EVT_done fw=- had=- stage=- sid=-'] })
  })

  it('on the built site: a POST to this site, once for the once-only events, and never in the way', async () => {
    vi.stubEnv('PROD', true)
    const calls: [string, RequestInit][] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => (calls.push([url, init]), Promise.reject(new Error('offline'))))
    count('file', {}, true)
    count('file', {}, true)
    count('fail', { had: 'FM-1_915', stage: 2 })
    count('fail', { had: 'FM-1_915', stage: 2 })
    await Promise.resolve() // the rejections are swallowed: an unhandled one would fail the run
    expect(calls.map(([url]) => url.replace(/sid=\w+/, 'sid=X'))).toEqual([
      `/count/file?fw=${firmware.version}&sid=X`,
      `/count/fail?fw=${firmware.version}&had=FM-1_915&stage=2&sid=X`,
      `/count/fail?fw=${firmware.version}&had=FM-1_915&stage=2&sid=X`,
    ])
    for (const [url, init] of calls) {
      expect(serve(url, init.method).status).toBe(204)
      expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' })
      expect(init.body).toBeUndefined()
    }
    // a browser that throws from fetch itself is no different
    vi.stubGlobal('fetch', () => { throw new Error('blocked') })
    expect(() => count('done')).not.toThrow()
  })

  it('sends nothing outside the built site, and says what it would have sent', () => {
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    const said: string[] = []
    const debug = vi.spyOn(console, 'debug').mockImplementation((line: string) => void said.push(line))
    count('visit')
    count('done', { had: 'FM-1_015' })
    debug.mockRestore()
    expect(fetched).not.toHaveBeenCalled()
    expect(said.map((line) => line.replace(/sid=\w+/, 'sid=X'))).toEqual([
      `count, not sent in development: /count/visit?fw=${firmware.version}&sid=X`,
      `count, not sent in development: /count/done?fw=${firmware.version}&had=FM-1_015&sid=X`,
    ])
  })
})
