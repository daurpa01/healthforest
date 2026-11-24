import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { useApp } from '../model/store'

const KEY = 'healthforest.ios'

function isIos(): boolean {
  const ua = navigator.userAgent
  const classic = /iPad|iPhone|iPod/.test(ua)
  const ipadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return classic || ipadOs
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export function IosHint() {
  const lang = useApp().lang
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const forced = new URLSearchParams(location.search).has('ios')
    let dismissed = false
    try { dismissed = localStorage.getItem(KEY) === '1' } catch { dismissed = false }
    if (forced || (isIos() && !isStandalone() && !dismissed && location.protocol !== 'file:')) setOpen(true)
  }, [])
  if (!open) return null
  return (
    <div className="ios-hint" role="note">
      <p>{t(lang, 'iosHint')}</p>
      <button
        className="btn"
        onClick={() => {
          try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
          setOpen(false)
        }}
      >
        {t(lang, 'iosHide')}
      </button>
    </div>
  )
}
