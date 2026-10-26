import { useT } from '../i18n'
import { GHOST_BTN } from '../ui'

/** Export of messages selected in Search: build Markdown/CSV, then copy it or save it to a file. */
export function ExportTab({
  selectedCount,
  excludeMeta,
  excludeSubagents,
  onExcludeMeta,
  onExcludeSubagents,
  exportText,
  exportFormat,
  onExport,
  onClearSelection,
  onStatus,
}: {
  selectedCount: number
  excludeMeta: boolean
  excludeSubagents: boolean
  onExcludeMeta: (v: boolean) => void
  onExcludeSubagents: (v: boolean) => void
  exportText: string
  exportFormat: 'md' | 'csv'
  onExport: (format: 'md' | 'csv') => void
  onClearSelection: () => void
  onStatus: (s: string) => void
}) {
  const t = useT()

  const save = async () => {
    const r = await window.vault.exportSave(exportText, exportFormat)
    if (r.saved && r.path) onStatus(t('toast.saved', { path: r.path }))
    else if (r.error === 'claude-home') onStatus(t('toast.saveBlocked'))
    else if (r.error) onStatus(t('toast.saveFailed', { error: r.error }))
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-400">
        <span className="font-mono text-[11px] text-zinc-300">{t('export.selected', { count: selectedCount })}</span>
        {selectedCount > 0 && (
          <button type="button" className={GHOST_BTN} onClick={onClearSelection}>
            {t('search.clearSelection')}
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={excludeMeta} onChange={(e) => onExcludeMeta(e.target.checked)} />
          {t('export.excludeMeta')}
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={excludeSubagents} onChange={(e) => onExcludeSubagents(e.target.checked)} />
          {t('export.excludeSubagents')}
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-40"
          disabled={!selectedCount}
          onClick={() => onExport('md')}
        >
          {t('export.markdown')}
        </button>
        <button
          type="button"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-40"
          disabled={!selectedCount}
          onClick={() => onExport('csv')}
        >
          {t('export.csv')}
        </button>
        <button
          type="button"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-40"
          disabled={!exportText}
          onClick={() => {
            void window.vault.copyText(exportText)
            onStatus(t('toast.copied'))
          }}
        >
          {t('export.copyResult')}
        </button>
        <button
          type="button"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-40"
          disabled={!exportText}
          onClick={() => void save()}
        >
          {t('export.save')}
        </button>
      </div>
      <textarea
        readOnly
        className="min-h-0 flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200"
        value={exportText}
        placeholder={t('export.placeholder')}
      />
    </div>
  )
}
