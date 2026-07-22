import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useT } from './i18n'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Split out so the fallback can use the i18n hook — the boundary itself must stay a class. */
function ErrorFallback({ error, onDismiss }: { error: Error; onDismiss: () => void }) {
  const t = useT()
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 p-8">
      <div className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h1 className="text-sm font-semibold text-white">{t('error.title')}</h1>
        <p className="mt-1 text-[12px] text-zinc-500">{t('error.hint')}</p>
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-400">
          {error.message}
        </pre>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg transition-colors duration-150 hover:bg-brand-hover"
          >
            {t('error.reload')}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors duration-150 hover:bg-zinc-950 hover:text-zinc-200"
          >
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
