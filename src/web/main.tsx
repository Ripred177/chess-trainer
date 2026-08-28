import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import '@/styles.css'
import { installWebPlatform } from './platform'

/**
 * Browser entry point.
 *
 * `window.chess` must exist before any component renders, because the store
 * calls it during init, so the platform is installed before mounting rather
 * than inside an effect.
 */

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

function fail(message: string): void {
  container!.innerHTML = ''
  const box = document.createElement('div')
  box.style.cssText = 'padding:2rem;font:14px system-ui;color:#e5e5e7;max-width:34rem;margin:0 auto'
  box.textContent = `Chess Trainer could not start: ${message}`
  container!.appendChild(box)
}

installWebPlatform().then(
  () => {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  },
  (err: unknown) => fail(err instanceof Error ? err.message : String(err))
)
