import { useEffect, useRef } from 'react'
import { Footer, Hero } from './components/Chrome'
import { DevicePanel } from './components/DevicePanel'
import { Manual } from './components/Manual'
import { Stepper } from './components/Stepper'
import { useInstaller } from './lib/useInstaller'
import { CheckStep } from './steps/CheckStep'
import { ConnectStep } from './steps/ConnectStep'
import { FileStep } from './steps/FileStep'
import { InstallStep } from './steps/InstallStep'
import { PlayStep } from './steps/PlayStep'
import { PrepareStep } from './steps/PrepareStep'
import './components/Wizard.css'

const PANELS = [CheckStep, FileStep, PrepareStep, ConnectStep, InstallStep, PlayStep]

export default function App() {
  const inst = useInstaller()
  const { state, busy, maxStep, go } = inst
  const Panel = PANELS[state.step]
  // the first panel is simply there; later ones take focus and come into view as they open
  const moved = useRef(false)
  const wizard = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!moved.current) {
      moved.current = true
      return
    }
    const top = wizard.current?.getBoundingClientRect().top ?? 0
    if (top < 0) wizard.current?.scrollIntoView({ block: 'start' })
  }, [state.step])

  return (
    <>
      <main>
        <div className="shell stage">
          <Hero />
          <DevicePanel inst={inst} />
          <div className="wizard" id="install" ref={wizard}>
            <Stepper step={state.step} maxStep={maxStep} locked={busy} onGo={go} />
            <Panel key={state.step} inst={inst} announce={moved.current} />
          </div>
        </div>
        <Manual />
      </main>
      <Footer />
    </>
  )
}
