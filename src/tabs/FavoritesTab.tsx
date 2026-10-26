import type { FavoriteRow, TagRow } from '../../shared/ipc'
import { useI18n } from '../i18n'
import { GHOST_BTN, RoleBadge, sidebarPrimaryLabel } from '../ui'
import { formatTs } from '../format'
import { TagEditor } from '../components/TagEditor'
import type { TranscriptOpen } from '../types'

/**
 * Starred messages. Each favorite stores a snapshot of what was starred, so it stays
 * readable and copyable even after the source line left the index; "open session"
 * is offered only while the line is still indexed.
 */
export function FavoritesTab({
  favorites,
  tags,
  onOpenSession,
  onRemoved,
  onTagsChanged,
  onStatus,
}: {
  favorites: FavoriteRow[]
  tags: TagRow[]
  onOpenSession: (o: TranscriptOpen) => void
  onRemoved: () => void
  onTagsChanged: () => void
  onStatus: (s: string) => void
}) {
  const { locale, t } = useI18n()
  return (
    <div className="page">
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{t('favorites.count', { count: favorites.length.toLocaleString() })}</h2>
        </div>
        <div className="list glass">
          {favorites.length === 0 && <p className="empty">{t('favorites.empty')}</p>}
          {favorites.map((f) => (
            <article key={f.id} className="row">
              <div className="flex items-start gap-2">
                <div className="row-meta flex-1">
                  <RoleBadge role={f.role} />
                  <span className="font-semibold text-ink-2">{sidebarPrimaryLabel(f.projectLabel)}</span>
                  <span className="tabular">{formatTs(f.createdAt, locale)}</span>
                  {f.archived && (
                    <span className="badge tone-amber" title={t('badge.archived.hint')}>
                      {f.messageId == null ? t('favorites.snapshot') : t('badge.archived')}
                    </span>
                  )}
                </div>
                <div className="row-actions">
                  {f.sessionId != null && (
                    <button
                      type="button"
                      className={GHOST_BTN}
                      onClick={() =>
                        onOpenSession({
                          sessionId: f.sessionId!,
                          sessionFile: f.sessionFile,
                          projectLabel: f.projectLabel,
                          highlightLine: f.lineIndex ?? -1,
                        })
                      }
                    >
                      {t('action.openSession')}
                    </button>
                  )}
                  <button
                    type="button"
                    className={GHOST_BTN}
                    onClick={() => {
                      void window.vault.copyText(f.body)
                      onStatus(t('toast.copied'))
                    }}
                  >
                    {t('action.copy')}
                  </button>
                  <button
                    type="button"
                    className={GHOST_BTN}
                    onClick={async () => {
                      await window.vault.favoriteRemove(f.msgKey)
                      onStatus(t('toast.unfavorited'))
                      onRemoved()
                    }}
                  >
                    {t('action.remove')}
                  </button>
                </div>
              </div>
              <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-1 [overflow-wrap:anywhere]">
                {f.body}
              </p>
              <p className="mono mt-1 truncate text-ink-3">{f.sessionFile}</p>
              <TagEditor msgKey={f.msgKey} tagIds={f.tagIds} tags={tags} onChange={onTagsChanged} />
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
