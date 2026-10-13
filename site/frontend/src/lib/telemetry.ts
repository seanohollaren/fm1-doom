// The install counter, the page's side: how far a visitor got, told to this site so the installs can be counted.
//
// What is sent is the event and four short values (below), to this site only. Nothing identifies the visitor or
// their FM-1: no cookie, nothing stored in the browser, and the server keeps no address
// (site/infra/functions/count.js writes the line; site/infra/lib/telemetry-stack.ts counts the lines).
import spec from '../../../install-count.json'
import firmware from '../firmware.json'

/** in the order a visitor meets them; the same list as install-count.json and the server's (a test checks) */
export const COUNT_EVENTS = ['visit', 'file', 'connect', 'start', 'done', 'fail'] as const
export type CountEvent = (typeof COUNT_EVENTS)[number]

export interface CountFields {
  /** what the FM-1 answered when it was found: the firmware it ran before, e.g. "FM-1_015" */
  had?: string
  /** a failed install: which of its four stages stopped (web/install.js) */
  stage?: number
}

/** the server logs a value only if it is this plain (anything else becomes "-") */
const plain = (v: string) => v.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 24)

/**
 * One load of the page: a random number made when it is first needed and kept only in memory. It ties a visit's
 * events together (started, then finished), so a retry is not counted as a second person; the next load has another.
 */
let visit = ''
const visitId = () => (visit ||= Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join(''))

export function countUrl(event: CountEvent, fields: CountFields = {}, sid = visitId()): string {
  const q = new URLSearchParams({ fw: plain(firmware.version) })
  if (fields.had) q.set('had', plain(fields.had))
  if (fields.stage) q.set('stage', String(fields.stage))
  q.set('sid', sid)
  return `${spec.path}/${event}?${q}`
}

const sent = new Set<CountEvent>()

/** once: at most one of this event per load of the page */
export function count(event: CountEvent, fields: CountFields = {}, once = false): void {
  if (once && sent.has(event)) return
  sent.add(event)
  const url = countUrl(event, fields)
  // only the built site counts: the development server (and its stand-in FM-1) and the tests say what would go out
  if (!import.meta.env.PROD) return console.debug(`count, not sent in development: ${url}`)
  try {
    // keepalive: the last event of a visit ("done") still goes out if the tab is closed straight after
    void fetch(url, { method: 'POST', keepalive: true, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => {})
  } catch {
    // counting must never get in the way of an install
  }
}
