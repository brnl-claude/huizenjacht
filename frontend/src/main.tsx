import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startServiceWorker } from './appUpdate'
import { StoreProvider } from './store'
import { applyTheme, rememberedTheme } from './theme'
import { installTooltips } from './tooltip'
import './index.css'

applyTheme(rememberedTheme())
startServiceWorker()
installTooltips()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
)
