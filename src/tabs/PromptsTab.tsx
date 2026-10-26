import { useCallback, useEffect, useState } from 'react'
import type { PromptRow, PromptSort } from '../../shared/ipc'
import { useI18n } from '../i18n'
import { GHOST_BTN, Icon, Segmented, sidebarPrimaryLabel } from '../ui'
import { formatTs } from '../format'
import type { TranscriptOpen } from '../types'

/**
 * "What did I ask last time?" — the prompts I typed, deduplicated, newest or most
 * reused first. This is the reuse half of the product: on a real corpus fewer than
 * 1% of indexed lines are prompts, so they need their own view rather than a filter
 * buried under tool output.
 */
export function PromptsTab({
  projectId,
  onOpenSession,
  onStatus,
  refreshKey,
}: {
  projectId?: number
  onOpenSession: (o: TranscriptOpen) => void
  onStatus: (s: string) => void
  /** Bumps when the index changes so the list refreshes. */
  refreshKey: number
}) {
  const { locale, t } = useI18n()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PromptSort>('recent')
  const [rows, setRows] = useState<PromptRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const list = await window.vault.promptsList({ query, projectId, sort, limit: 300 })
    setRows(list)
    setLoading(false)
  }, [query, projectId, sort])

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => void load(), 180)
    return () => clearTimeout(timer)
  }, [load, refreshKey])

  const toggleFavorite = async (r: PromptRow) => {
    if (r.isFavorite) {
      await window.vault.favoriteRemove(r.msgKey)
      onStatus(t('toast.unfavorited'))
    } else {
      await window.vault.favoriteAdd(r.messageId)
      onStatus(t('toast.favorited'))
    }
    await load()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Icon
              name="search"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('prompts.placeholder')}
              aria-label={t('prompts.placeholder')}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-[13px] text-white outline-none transition duration-150 ease-out placeholder:text-zinc-600 focus:border-brand focus:bg-zinc-900 focus:ring-1 focus:ring-brand/40"
            />
          </div>
          <Segmented
            value={sort}
            onChange={setSort}
            options={
              [
                ['recent', t('prompts.sort.recent')],
                ['frequent', t('prompts.sort.frequent')],
              ] as const
            }
          />
        </div>
        <p className="mt-1.5 font-mono text-[11px] text-zinc-600">
          {loading ? '…' : t('prompts.count', { count: rows.length })} · {t('prompts.subtitle')}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loading && rows.length === 0 && (
          <p className="p-3 text-[12px] text-zinc-500">{query.trim() ? t('prompts.noMatch') : t('prompts.empty')}</p>
        )}
        {rows.map((r) => (
          <article key={r.messageId} className="group border-b border-zinc-800 px-3 py-2.5 hover:bg-zinc-900">
            <div className="mb-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-zinc-600">
              <span className="truncate font-sans font-medium text-zinc-300">{sidebarPrimaryLabel(r.projectName)}</span>
              {r.lastTsMs ? <span className="tabular">{formatTs(r.lastTsMs, locale)}</span> : null}
              {r.uses > 1 ? (
                <span className="rounded-[3px] bg-brand-soft px-1 text-[10px] font-medium text-brand-text">
                  {t('prompts.uses', { uses: r.uses })}
                </span>
              ) : null}
              {r.archived ? (
                <span
                  className="rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[10px] text-amber-700"
                  title={t('badge.archived.hint')}
                >
                  {t('badge.archived')}
                </span>
              ) : null}
              <div className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  className={GHOST_BTN}
                  onClick={() => {
                    void window.vault.copyText(r.text)
                    onStatus(t('toast.copied'))
                  }}
                >
                  {t('action.copy')}
                </button>
                <button
                  type="button"
                  className={GHOST_BTN}
                  onClick={() =>
                    onOpenSession({
                      sessionId: r.sessionId,
                      sessionFile: r.sessionFile,
                      projectLabel: r.projectName,
                      highlightLine: r.lineIndex,
                    })
                  }
                >
                  {t('action.session')}
                </button>
                <button type="button" className={GHOST_BTN} onClick={() => void toggleFavorite(r)}>
                  {r.isFavorite ? t('action.unfavorite') : t('action.favorite')}
                </button>
                <button
                  type="button"
                  className={GHOST_BTN}
                  onClick={async () => {
                    const name = r.text.slice(0, 40).replace(/\s+/g, ' ').trim() || t('nav.templates')
                    await window.vault.templateCreate(name, r.text)
                    onStatus(t('toast.templated'))
                  }}
                >
                  {t('action.template')}
                </button>
              </div>
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-200 [overflow-wrap:anywhere]">
              {r.isFavorite ? '★ ' : ''}
              {r.text}
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}
