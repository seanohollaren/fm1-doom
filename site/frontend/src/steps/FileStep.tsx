import { useRef, useState, type DragEvent } from 'react'
import type { Installer } from '../lib/useInstaller'
import { site } from '../site'
import { Notice, StepShell } from './StepShell'

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('en')} KB`

export function FileStep({ inst, announce }: { inst: Installer; announce: boolean }) {
  const { state, go, chooseFile } = inst
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const file = state.file
  const working = file.status === 'working'

  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f) void chooseFile(f)
  }

  return (
    <StepShell
      index={1}
      title="Bring the game file"
      announce={announce}
      back={() => go(0)}
      next={
        <button type="button" className="btn btn--primary" disabled={file.status !== 'ready'} onClick={() => go(2)}>
          Next <span aria-hidden="true">→</span>
        </button>
      }
    >
      <p className="lead">
        Doom’s engine is free software. Its levels, pictures and sounds are not, so this page doesn’t carry them. You bring the game file;
        the page cuts it down to the first level and packs it to fit the FM-1.
      </p>

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
          <strong>Drop DOOM1.WAD here</strong>
          <span>It stays on this computer. Nothing is uploaded.</span>
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

      {file.status === 'working' && (
        <Notice tone="work" title={`Preparing ${file.name}`}>
          Cutting it down to one level and packing it. This takes a few seconds.
        </Notice>
      )}
      {file.status === 'ready' && file.prepared.known && (
        <Notice tone="ok" title="Ready: Doom shareware 1.9, level E1M1">
          {kb(file.prepared.dataBytes)} of game data; about {kb(file.prepared.capacityBytes)} fit. This is exactly the data that has been
          tested on an FM-1.
        </Notice>
      )}
      {file.status === 'ready' && !file.prepared.known && (
        <Notice tone="warn" title={`Ready: level E1M1 from ${file.prepared.fileName}`}>
          {kb(file.prepared.dataBytes)} of game data; about {kb(file.prepared.capacityBytes)} fit. This is not the shareware 1.9 file, so
          this exact data has not been tried on an FM-1. If the game doesn’t start, the FM-1 shows a plain colour and waits for another
          install.
        </Notice>
      )}
      {file.status === 'failed' && (
        <Notice tone="bad" title={`Can’t use ${file.name}`}>
          {file.message} The shareware DOOM1.WAD, version 1.9, is the file this was made for.
        </Notice>
      )}

      <h3 className="sub">Which file</h3>
      <p className="quiet">
        <strong>DOOM1.WAD</strong> is the free shareware release of Doom: version 1.9, 4.2 MB.{' '}
        <a href={site.wadHelpUrl} target="_blank" rel="noopener noreferrer">
          About the file
        </a>
        . DOOM.WAD from the full game should work as well, but only the shareware file has been tested. Doom II and Freedoom don’t fit.
      </p>
    </StepShell>
  )
}
