import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useT } from './i18n'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Split out so the fallback can use the i18n hook — the boundary itself must stay a class. */
function ErrorFallback({ error, onDismiss }: { error: Error; onDismiss: () => void }) {
  const t = useT()
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="glass-solid w-full max-w-lg rounded-[26px] p-6">
        <h1 className="text-[17px] font-semibold text-ink-1">{t('error.title')}</h1>
        <p className="mt-1 text-[13.5px] text-ink-3">{t('error.hint')}</p>
        <pre className="mono mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl bg-well p-3 text-ink-2">
          {error.message}
        </pre>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => window.location.reload()} className="btn btn-primary">
            {t('error.reload')}
          </button>
          <button type="button" onClick={onDismiss} className="btn btn-tertiary">
            {t('error.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * A render error in one panel must not leave the user staring at a blank window.
 * Catches, shows what broke, and offers a reload — the index itself is on disk,
 * so reloading is always safe.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[vault] render error', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return <ErrorFallback error={error} onDismiss={() => this.setState({ error: null })} />
  }
}
