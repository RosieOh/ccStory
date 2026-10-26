import { useEffect, useState } from 'react'
import type { FileRow, FileTouchRow } from '../../shared/ipc'
import { useI18n } from '../i18n'
import { Icon, sidebarPrimaryLabel } from '../ui'
import { formatTs } from '../format'
import type { TranscriptOpen } from '../types'

/**
 * File reverse-index. A file is normally buried inside a tool payload, so full-text
 * search rarely surfaces it — this answers "when did I last touch this file, in
 * which session, and on what branch" directly.
 */
export function FilesTab({ onOpenSession }: { onOpenSession: (o: TranscriptOpen) => void }) {
  const { locale, t } = useI18n()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileRow[]>([])
  const [selected, setSelected] = useState<FileRow | null>(null)
  const [timeline, setTimeline] = useState<FileTouchRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      void window.vault.filesList(query).then((rows) => {
        if (cancelled) return
        setFiles(rows)
        setLoading(false)
      })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  useEffect(() => {
    if (!selected) {
      setTimeline([])
      return
    }
    let cancelled = false
    void window.vault.fileTimeline(selected.path).then((rows) => {
      if (!cancelled) setTimeline(rows)
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[380px] shrink-0 flex-col border-r border-zinc-800">
        <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('files.placeholder')}
              aria-label={t('files.search')}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-[13px] text-white outline-none transition duration-150 placeholder:text-zinc-600 focus:border-brand focus:bg-zinc-900 focus:ring-1 focus:ring-brand/40"
            />
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-zinc-600">
            {loading ? '…' : t('files.count', { count: files.length })}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!loading && files.length === 0 && (
            <p className="p-3 text-[12px] text-zinc-500">
              {t('files.empty')}
            </p>
          )}
          {files.map((f) => {
            const active = selected?.path === f.path
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => setSelected(f)}
                className={`block w-full border-b border-zinc-800 px-3 py-2 text-left transition-colors duration-100 ${
                  active ? 'bg-brand-soft' : 'hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={`min-w-0 truncate text-[13px] ${active ? 'font-medium text-brand-text' : 'text-white'}`}
                  >
                    {f.basename}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] tabular text-zinc-600">
                    {t('files.touches', { touches: f.touches, sessions: f.sessions })}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">{f.path}</div>
                {f.lastTouched ? (
                  <div className="mt-0.5 font-mono text-[11px] tabular text-zinc-600">
                    {formatTs(f.lastTouched, locale)}
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <p className="text-[13px] text-zinc-400">{t('files.selectPrompt')}</p>
              <p className="mt-1 text-[12px] text-zinc-600">
                {t('files.selectHint')}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2">
              <h2 className="truncate text-[13px] font-semibold text-white">{selected.basename}</h2>
              <p className="truncate font-mono text-[11px] text-zinc-600">{selected.path}</p>
            </div>
            {timeline.map((row) => (
              <article key={row.messageId} className="border-b border-zinc-800 px-3 py-2.5">
                <div className="mb-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-zinc-600">
                  <span
                    className={`rounded-[3px] px-1 py-px text-[10px] font-medium uppercase ${
                      row.role === 'user' ? 'bg-brand-soft text-brand-text' : 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {row.role === 'user' ? 'me' : row.role === 'assistant' ? 'ai' : row.role}
                  </span>
                  <span className="truncate font-sans font-medium text-zinc-300">
                    {sidebarPrimaryLabel(row.projectName)}
                  </span>
                  {row.gitBranch ? (
                    <span className="rounded-[3px] border border-zinc-800 px-1 text-[10px]">
                      {row.gitBranch}
                    </span>
                  ) : null}
                  {row.tsMs ? <span className="tabular">{formatTs(row.tsMs, locale)}</span> : null}
                  <button
                    type="button"
                    className="ml-auto text-brand-text hover:underline"
                    onClick={() =>
                      onOpenSession({
                        sessionId: row.sessionId,
                        sessionFile: row.sessionFile,
                        projectLabel: row.projectName,
                        highlightLine: row.lineIndex,
                      })
                    }
                  >
                    {t('action.openSession')}
                  </button>
                </div>
                <p className="line-clamp-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] text-zinc-400 [overflow-wrap:anywhere]">
                  {row.preview}
                </p>
              </article>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
