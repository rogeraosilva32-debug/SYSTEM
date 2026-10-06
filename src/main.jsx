import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import theme from './theme.js'
import { startEventLog } from './services/eventLog.js'
import "leaflet/dist/leaflet.css";

startEventLog()

// Versão nova publicada: o app instalado abre primeiro a versão guardada no
// celular e baixa a nova em segundo plano. Quando a nova assume logo na
// abertura (primeiros 15 s), recarrega uma vez para a pessoa já ver a
// versão nova, em vez de só na próxima vez que abrir. Depois disso não
// recarrega sozinho, para não perder nada que esteja sendo digitado.
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  const openedAt = Date.now()
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (Date.now() - openedAt > 15000) return
    try {
      if (sessionStorage.getItem('sw-reloaded')) return
      sessionStorage.setItem('sw-reloaded', '1')
    } catch { /* sem sessionStorage: recarrega mesmo assim, uma vez por abertura */ }
    window.location.reload()
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)
