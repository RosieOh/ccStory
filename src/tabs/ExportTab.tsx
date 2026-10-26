import { useT } from '../i18n'

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
    <div className="page page-fill">
      <section className="glass panel flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex items-baseline gap-2">
          <span className="stat-value !text-[30px]">{selectedCount.toLocaleString()}</span>
          <span className="text-[13.5px] text-ink-3">{t('export.selectedLabel')}</span>
        </div>
        {selectedCount > 0 && (
          <button type="button" className="btn btn-tertiary btn-xs" onClick={onClearSelection}>
            {t('search.clearSelection')}
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink-2">
          <input type="checkbox" className="check" checked={excludeMeta} onChange={(e) => onExcludeMeta(e.target.checked)} />
          {t('export.excludeMeta')}
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink-2">
          <input
            type="checkbox"
            className="check"
            checked={excludeSubagents}
            onChange={(e) => onExcludeSubagents(e.target.checked)}
          />
          {t('export.excludeSubagents')}
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={!selectedCount} onClick={() => onExport('md')}>
            {t('export.markdown')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!selectedCount} onClick={() => onExport('csv')}>
            {t('export.csv')}
          </button>
        </div>
      </section>

      <section className="glass panel flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">{t('export.result')}</h2>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-tertiary"
              disabled={!exportText}
              onClick={() => {
                void window.vault.copyText(exportText)
                onStatus(t('toast.copied'))
              }}
            >
              {t('export.copyResult')}
            </button>
            <button type="button" className="btn btn-tertiary" disabled={!exportText} onClick={() => void save()}>
              {t('export.save')}
            </button>
          </div>
        </div>
        <textarea
          readOnly
          className="input mono min-h-[12rem] flex-1 resize-none !p-3 leading-relaxed"
          value={exportText}
          placeholder={t('export.placeholder')}
          aria-label={t('export.result')}
        />
      </section>
    </div>
  )
}
