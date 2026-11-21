import { blankModel } from '../model/defaults'
import { decisionExample, markovExample } from '../model/examples'
import { readSaved, useApp } from '../model/store'
import { t } from '../i18n'

export function HomeView() {
  const app = useApp()
  const lang = app.lang
  const saved = readSaved()
  return (
    <div className="home">
      <div className="home-hero">
        <p className="kicker">HealthForest</p>
        <h2>{t(lang, 'welcomeTitle')}</h2>
        <p>{t(lang, 'welcomeLead')}</p>
      </div>
      <div className="card-grid">
        <article className="card">
          <span className="card-index">01</span>
          <h3>{t(lang, 'welcomeDecision')}</h3>
          <p>{t(lang, 'welcomeDecisionBody')}</p>
          <button className="btn-gold" onClick={() => app.load(decisionExample(), 'tree')}>
            {t(lang, 'openExample')}
          </button>
        </article>
        <article className="card">
          <span className="card-index">02</span>
          <h3>{t(lang, 'welcomeMarkov')}</h3>
          <p>{t(lang, 'welcomeMarkovBody')}</p>
          <button className="btn-gold" onClick={() => app.load(markovExample(), 'tree')}>
            {t(lang, 'openExample')}
          </button>
        </article>
        <article className="card">
          <span className="card-index">03</span>
          <h3>{t(lang, 'welcomeBlank')}</h3>
          <p>{t(lang, 'welcomeBlankBody')}</p>
          <div className="btn-row">
            <button className="btn" onClick={() => app.load(blankModel(), 'tree')}>
              {t(lang, 'welcomeBlank')}
            </button>
            {saved && (
              <button className="btn" onClick={() => app.load(saved, 'tree')}>
                {t(lang, 'welcomeContinue')}
              </button>
            )}
          </div>
        </article>
      </div>
    </div>
  )
}
