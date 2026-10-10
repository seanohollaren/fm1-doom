import { useRef, useState, type DragEvent } from 'react'
import type { Installer } from '../lib/useInstaller'
import { Notice, StepShell } from './StepShell'

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('en')} KB`
const mb = (n: number) => (n / 1e6).toFixed(1)

export function FileStep({ inst, announce }: { inst: Installer; announce: boolean }) {
  const { state, go, chooseFile, fetchFile, fileBusy } = inst
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const file = state.file
  const working = fileBusy

  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f && !working) void chooseFile(f)
  }

  return (
    <StepShell
      index={1}
      title="Grab Doom"
      announce={announce}
      back={() => go(0)}
      next={
        <button type="button" className="btn btn--primary" disabled={file.status !== 'ready'} onClick={() => go(2)}>
          Next <span aria-hidden="true">→</span>
        </button>
      }
    >
      <p className="lead">
        Since I can’t host the Doom wad, click this button to load it from Archive.org. Then it’ll be automatically slimmed down to fit on the
        FM‑1, leaving the complete first level. You can also supply your own doom.wad if you have it.
      </p>

      <div className="fetch">
        <div className="fetch__text">
          <strong>Fetch the shareware game</strong>
          <span>This downloads DOOM1.WAD from Archive.org</span>
        </div>
        <button type="button" className={`btn${file.status === 'ready' ? '' : ' btn--primary'}`} disabled={working || !state.base} onClick={() => void fetchFile()}>
          Fetch it
        </button>
      </div>

      <div
        className={`drop${over ? ' is-over' : ''}${working ? ' is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <svg className="drop__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v11m0 0l-4-4m4 4l4-4M4 17v3h16v-3" />
        </svg>
        <div className="drop__text">
          <strong>Or drop your own DOOM1.WAD here</strong>
        </div>
        <button type="button" className="btn" disabled={working || !state.base} onClick={() => input.current?.click()}>
          Choose file
        </button>
        <input
          ref={input}
          className="vh"
          type="file"
          accept=".wad,.WAD"
          tabIndex={-1}
          aria-label="Doom WAD file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void chooseFile(f)
          }}
        />
      </div>

      {file.status === 'fetching' && (
        <Notice tone="work" title="Downloading DOOM1.WAD">
          <span className="mono">
            {mb(file.received)} of {mb(file.total)} MB
          </span>
          <span className="meter" aria-hidden="true">
            <span style={{ width: `${(file.received / file.total) * 100}%` }} />
          </span>
        </Notice>
      )}
      {file.status === 'working' && (
        <Notice tone="work" title={`Preparing ${file.name}`}>
          Cutting it down to one level and packing it. This takes a few seconds.
        </Notice>
      )}
      {file.status === 'ready' && file.prepared.known && (
        <Notice tone="ok" title="Ready: Doom shareware 1.9" />
      )}
      {file.status === 'ready' && !file.prepared.known && (
        <Notice tone="warn" title={`Ready: level E1M1 from ${file.prepared.fileName}`}>
          {kb(file.prepared.dataBytes)} of game data; about {kb(file.prepared.capacityBytes)} fit. This is not the shareware 1.9 file, so
          this exact data has not been tried on an FM-1. If the game doesn’t start, the FM-1 shows a plain colour and waits for another
          install.
        </Notice>
      )}
      {file.status === 'failed' && file.download && (
        <Notice tone="bad" title="The download didn’t work">
          {file.message}
        </Notice>
      )}
      {file.status === 'failed' && !file.download && (
        <Notice tone="bad" title={`Can’t use ${file.name}`}>
          {file.message} The shareware DOOM1.WAD, version 1.9, is the file this was made for.
        </Notice>
      )}
    </StepShell>
  )
}
