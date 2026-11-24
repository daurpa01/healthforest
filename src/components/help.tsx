import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { useApp } from '../model/store'

const TOUR_KEY = 'healthforest.tour'

const guides = {
  es: [
    ['Tu primer árbol', 'docs/guia/es/primer-arbol.md'],
    ['Modelo de Markov', 'docs/guia/es/markov.md'],
    ['Sensibilidad y tornado', 'docs/guia/es/sensibilidad.md'],
    ['Monte Carlo, CEAC y EVPI', 'docs/guia/es/monte-carlo.md'],
    ['Impacto presupuestal', 'docs/guia/es/presupuesto.md'],
    ['Importar un archivo de TreeAge', 'docs/guia/es/importar.md'],
    ['Exportar gráficas', 'docs/guia/es/exportar.md'],
    ['Glosario', 'docs/guia/es/glosario.md'],
    ['Preguntas frecuentes', 'docs/guia/es/preguntas.md'],
  ],
  en: [
    ['Your first tree', 'docs/guia/en/first-tree.md'],
    ['Markov model', 'docs/guia/en/markov.md'],
    ['Sensitivity and tornado', 'docs/guia/en/sensitivity.md'],
    ['Monte Carlo, CEAC and EVPI', 'docs/guia/en/monte-carlo.md'],
    ['Budget impact', 'docs/guia/en/budget.md'],
    ['Import a TreeAge file', 'docs/guia/en/import.md'],
    ['Export figures', 'docs/guia/en/export.md'],
    ['Glossary', 'docs/guia/en/glossary.md'],
    ['FAQ', 'docs/guia/en/faq.md'],
  ],
} as const

function guideHref(path: string): string {
  if (location.protocol === 'file:') return new URL(path, location.href).href
  return `https://github.com/daurpa01/healthforest/blob/main/${path}`
}

export function HelpDialog() {
  const app = useApp()
  const lang = app.lang
  if (!app.help) return null
  return (
    <div className="modal-back" onClick={() => app.setHelp(false)}>
      <div className="card modal help-modal" onClick={(event) => event.stopPropagation()}>
        <h3>{t(lang, 'help')}</h3>
        <p>{t(lang, 'helpBody')}</p>
        <ul className="guide-list">
          {guides[lang].map(([label, path]) => (
            <li key={path}>
              <a href={guideHref(path)} target="_blank" rel="noreferrer">{label}</a>
            </li>
          ))}
        </ul>
        <p className="help">{t(lang, 'helpOffline')}</p>
        <p className="help">{t(lang, 'formulaHint')}</p>
        <div className="btn-row">
          <button className="btn" onClick={() => { app.setHelp(false); window.dispatchEvent(new Event('healthforest-tour')) }}>{t(lang, 'tourAgain')}</button>
          <button className="btn-gold" onClick={() => app.setHelp(false)}>{t(lang, 'close')}</button>
        </div>
      </div>
    </div>
  )
}

const steps = {
  es: [
    ['Empieza por un ejemplo', 'En la portada, abre Árbol de decisión o Modelo de Markov. También puedes abrir un archivo .trex de TreeAge.'],
    ['El árbol se dibuja solo', 'Haz clic en un nodo para cambiar un nombre, una probabilidad o un pago. # completa la probabilidad que falta.'],
    ['Mira el resultado', 'En Resultados ves el costo, el efecto, el RCEI y la frontera. Nada se calcula fuera de tu computador.'],
    ['Guarda tu trabajo', 'Guardar descarga un archivo .healthforest.json. El botón ? abre las guías cuando las necesites.'],
  ],
  en: [
    ['Start from an example', 'On the welcome screen, open Decision tree or Markov model. You can also open a TreeAge .trex file.'],
    ['The tree draws itself', 'Click a node to change a name, a probability or a payoff. # fills in the missing probability.'],
    ['Look at the result', 'Results shows cost, effect, the ICER and the frontier. Nothing is calculated outside your computer.'],
    ['Save your work', 'Save downloads a .healthforest.json file. The ? button opens the guides whenever you need them.'],
  ],
} as const

export function FirstRunTour() {
  const app = useApp()
  const lang = app.lang
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  useEffect(() => {
    let seen = false
    try { seen = localStorage.getItem(TOUR_KEY) === 'done' } catch { seen = true }
    if (!seen) setOpen(true)
    const again = () => { setStep(0); setOpen(true) }
    window.addEventListener('healthforest-tour', again)
    return () => window.removeEventListener('healthforest-tour', again)
  }, [])
  if (!open) return null
  const card = steps[lang][step]
  const last = step === steps[lang].length - 1
  const finish = () => {
    try { localStorage.setItem(TOUR_KEY, 'done') } catch { /* ignore */ }
    setOpen(false)
  }
  return (
    <div className="tour" role="dialog" aria-label={t(lang, 'tour')}>
      <p className="kicker">{t(lang, 'tour')} · {step + 1}/4</p>
      <h3>{card[0]}</h3>
      <p>{card[1]}</p>
      <div className="btn-row">
        <button className="btn" onClick={finish}>{t(lang, 'tourSkip')}</button>
        {last ? (
          <button className="btn-gold" onClick={finish}>{t(lang, 'tourDone')}</button>
        ) : (
          <button className="btn-gold" onClick={() => setStep(step + 1)}>{t(lang, 'tourNext')}</button>
        )}
      </div>
    </div>
  )
}
