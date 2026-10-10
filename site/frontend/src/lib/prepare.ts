import { logicalImage, productOf, sha256hex } from '@fm1/vendor/felucca/fm1pkg.js'
import firmwareJson from '../firmware.json'
import type { FirmwareMeta, InstallMeta, Prepared, PrepareFailure } from './types'
import type { PrepareReply, PrepareRequest } from './prepare.worker'

export const firmware = firmwareJson as FirmwareMeta
const asset = (path: string) => new URL(import.meta.env.BASE_URL + path, window.location.origin).href

/** The firmware-only package, checked against the hash this build of the page was made with. */
export async function loadFirmware(): Promise<Uint8Array> {
  const r = await fetch(asset(firmware.file))
  if (!r.ok) throw new Error(`the firmware file could not be downloaded (HTTP ${r.status})`)
  const pkg = new Uint8Array(await r.arrayBuffer())
  if (productOf(pkg) !== firmware.product || (await sha256hex(pkg)) !== firmware.sha256)
    throw new Error('the firmware file is not the one this page was built with')
  return pkg
}

interface WorkerInfo {
  known: boolean
  wadSha: string
  dataSha: string
  whxLen: number
  capacity: number
}

/** Cut the WAD down to one level, convert it and pack it with the firmware. The file never leaves the browser. */
export function prepareWad(file: File, base: Uint8Array): Promise<{ ok: true; prepared: Prepared } | ({ ok: false } & PrepareFailure)> {
  return new Promise((resolve) => {
    if (file.size > 64 << 20) {
      resolve({ ok: false, message: 'This file is too large to be a Doom WAD.' })
      return
    }
    const worker = new Worker(new URL('./prepare.worker.ts', import.meta.url), { type: 'module' })
    const done = (v: Parameters<typeof resolve>[0]) => {
      worker.terminate()
      resolve(v)
    }
    worker.onerror = (e) => done({ ok: false, message: 'The converter could not be started. Reload the page and try again.', detail: e.message })
    worker.onmessage = (ev: MessageEvent<PrepareReply>) => {
      const r = ev.data
      if (!r.ok) {
        done({ ok: false, message: r.message, detail: r.detail })
        return
      }
      const info = r.info as WorkerInfo
      done({
        ok: true,
        prepared: {
          fileName: file.name,
          image: logicalImage(r.pkg),
          data2: r.data2,
          meta: r.meta as InstallMeta,
          known: info.known,
          dataBytes: info.whxLen,
          capacityBytes: info.capacity,
          wadSha: info.wadSha,
          dataSha: info.dataSha,
        },
      })
    }
    file.arrayBuffer().then(
      (wad) => {
        const req: PrepareRequest = {
          wad,
          base,
          fw: { product: firmware.product, build: firmware.build, img_len: firmware.img_len, desc_at: firmware.desc_at, app_slot: firmware.app_slot },
          converterUrl: asset(`whdgen/whd_gen_es.js?v=${firmware.converter_sha256.slice(0, 12)}`),
          wasmUrl: asset(`whdgen/whd_gen_es.wasm?v=${firmware.converter_sha256.slice(0, 12)}`),
        }
        worker.postMessage(req, [wad])
      },
      () => done({ ok: false, message: 'This file could not be read.' }),
    )
  })
}
