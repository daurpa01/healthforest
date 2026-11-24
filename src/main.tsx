import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    const worker = new URL('sw.js', window.location.href)
    navigator.serviceWorker.register(worker).catch(() => {
      /* La app sigue funcionando si el navegador no instala el worker. */
    })
  })
}
