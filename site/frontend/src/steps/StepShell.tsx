import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  index: number
  title: string
  children: ReactNode
  /** the row at the foot of the panel: Back on the left, the way forward on the right */
  back?: () => void
  next?: ReactNode
  locked?: boolean
  /** move focus to the heading when the step appears (every step change; not the first paint of the page) */
  announce: boolean
}

export function StepShell({ index, title, children, back, next, locked = false, announce }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (announce) heading.current?.focus({ preventScroll: true })
  }, [announce])

  return (
    <section className="panel" aria-labelledby={`step-${index}`}>
      <p className="panel__count label">
        Step {index + 1} <span aria-hidden="true">/</span> <span className="vh">of</span> 6
      </p>
      <h2 className="panel__title display" id={`step-${index}`} ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <div className="panel__body">{children}</div>
      {(back || next) && (
        <div className="panel__foot">
          {back ? (
            <button type="button" className="btn btn--quiet" onClick={back} disabled={locked}>
              <span aria-hidden="true">←</span> Back
            </button>
          ) : (
            <span />
          )}
          {next}
        </div>
      )}
    </section>
  )
}

export function Notice({ tone, title, children }: { tone: 'ok' | 'warn' | 'bad' | 'work' | 'plain'; title: string; children?: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role="status" aria-live="polite">
      <span className="notice__mark" aria-hidden="true">
        {tone === 'ok' ? '✓' : tone === 'warn' ? '!' : tone === 'bad' ? '×' : ''}
      </span>
      <div>
        <strong className="notice__title">{title}</strong>
        {children && <div className="notice__more">{children}</div>}
      </div>
    </div>
  )
}
