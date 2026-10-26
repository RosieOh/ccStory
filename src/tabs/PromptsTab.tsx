import { useCallback, useEffect, useState } from 'react'
import type { ProjectRow, PromptRow, PromptSort } from '../../shared/ipc'
import { useI18n } from '../i18n'
import { GHOST_BTN, Icon, ProjectPicker, Segmented, sidebarPrimaryLabel } from '../ui'
import { formatTs } from '../format'
import type { TranscriptOpen } from '../types'

/**
 * "What did I ask last time?" — the prompts I typed, deduplicated, newest or most
 * reused first. This is the reuse half of the product: on a real corpus fewer than
 * 1% of indexed lines are prompts, so they need their own view rather than a filter
 * buried under tool output.
 */
export function PromptsTab({
  projects,
  projectId,
  onProjectChange,
  onOpenSession,
  onStatus,
  refreshKey,
}: {
  projects: ProjectRow[]
  projectId?: number
  onProjectChange: (id: number | undefined) => void
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
    <div className="page page-fill">
      <div className="flex shrink-0 flex-wrap items-center gap-2.5">
        <label className="search-field glass">
          <Icon name="search" className="h-[18px] w-[18px] text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('prompts.placeholder')}
            aria-label={t('prompts.placeholder')}
          />
        </label>
        <Segmented
          label={t('inspector.sort')}
          value={sort}
          onChange={setSort}
          options={
            [
              ['recent', t('prompts.sort.recent')],
              ['frequent', t('prompts.sort.frequent')],
            ] as const
          }
        />
        <ProjectPicker projects={projects} value={projectId} onChange={onProjectChange} />
      </div>

      <section className="section scroll-area flex-1">
        <div className="section-head">
          <h2 className="section-title">
            {loading ? t('common.loading') : t('prompts.count', { count: rows.length.toLocaleString() })}
          </h2>
          <span className="section-desc">{sort === 'frequent' ? t('prompts.sortHint.frequent') : t('prompts.sortHint.recent')}</span>
        </div>
        <div className="list glass">
          {!loading && rows.length === 0 && (
            <p className="empty">{query.trim() ? t('prompts.noMatch') : t('prompts.empty')}</p>
          )}
          {rows.map((r) => (
            <article key={r.messageId} className="row">
              <div className="flex items-start gap-2">
                <div className="row-meta flex-1">
                  <span className="font-semibold text-ink-2">{sidebarPrimaryLabel(r.projectName)}</span>
                  {r.lastTsMs ? <span className="tabular">{formatTs(r.lastTsMs, locale)}</span> : null}
                  {r.uses > 1 && <span className="badge tone-blue tabular">{t('prompts.uses', { uses: r.uses })}</span>}
                  {r.archived && (
                    <span className="badge tone-amber" title={t('badge.archived.hint')}>
                      {t('badge.archived')}
                    </span>
                  )}
                  {r.isFavorite && (
                    <span className="text-brand-ink" aria-label={t('nav.favorites')}>
                      <Icon name="star" className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <div className="row-actions">
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
              <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-ink-1 [overflow-wrap:anywhere]">
                {r.text}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
