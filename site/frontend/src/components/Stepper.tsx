import { STEPS } from '../site'

interface Props {
  step: number
  maxStep: number
  locked: boolean
  onGo: (step: number) => void
}

export function Stepper({ step, maxStep, locked, onGo }: Props) {
  return (
    <nav aria-label="Install steps">
      <ol className="stepper">
        {STEPS.map((s, i) => {
          const state = i === step ? 'now' : i < step ? 'done' : 'todo'
          const reachable = !locked && i <= maxStep && i !== step
          return (
            <li key={s.id} className={`stepper__item is-${state}`}>
              <button type="button" className="stepper__btn" disabled={!reachable} aria-current={i === step ? 'step' : undefined} onClick={() => onGo(i)}>
                <span className="stepper__num">{String(i + 1).padStart(2, '0')}</span>
                <span className="stepper__name">{s.name}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
