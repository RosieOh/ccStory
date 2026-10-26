import type { FavoriteRow, TagRow } from '../../shared/ipc'
import { useI18n } from '../i18n'
import { GHOST_BTN, sidebarPrimaryLabel } from '../ui'
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
    <div className="h-full overflow-y-auto p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">{t('nav.favorites')}</h2>
      <div className="space-y-3">
        {favorites.length === 0 && <p className="text-sm text-zinc-500">{t('favorites.empty')}</p>}
        {favorites.map((f) => (
          <div key={f.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-zinc-500">
              <span className="font-sans font-medium text-zinc-300">{sidebarPrimaryLabel(f.projectLabel)}</span>
              <span className="truncate">{f.sessionFile}</span>
              <span className="tabular">{formatTs(f.createdAt, locale)}</span>
              {f.archived && (
                <span
                  className="rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[10px] text-amber-700"
                  title={t('badge.archived.hint')}
                >
                  {f.messageId == null ? t('favorites.snapshot') : t('badge.archived')}
                </span>
              )}
            </div>
            <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-200 [overflow-wrap:anywhere]">
              {f.body}
            </pre>
            <div className="flex flex-wrap items-center gap-1.5">
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
                  onRemoved()
                }}
              >
                {t('action.remove')}
              </button>
            </div>
            <TagEditor msgKey={f.msgKey} tagIds={f.tagIds} tags={tags} onChange={onTagsChanged} />
          </div>
        ))}
      </div>
    </div>
  )
}
