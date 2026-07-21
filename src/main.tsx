import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './index.css'

// An IPC call that rejects (e.g. the DB was swapped out mid-session) would
// otherwise fail silently. Surface it instead of leaving the UI stuck.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[vault] unhandled rejection', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
