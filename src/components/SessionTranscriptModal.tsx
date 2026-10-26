import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMessageRow } from '../../shared/ipc'
import { chatAlignForDialog, chatBubbleShellClass, chatRowFlex } from '../chatBubbleLayout'
import { Icon, RoleBadge } from '../ui'
import { Markdown } from '../Markdown'
import { useT } from '../i18n'
import { messageClassKey } from '../format'
import type { TranscriptOpen } from '../types'

/** Rows rendered per transcript page, and the point where a body gets clamped. */
const TRANSCRIPT_PAGE = 150
const MAX_INLINE_BODY = 8000

/** A single message body can exceed 700 KB; clamp it behind an explicit expand. */
function TranscriptBody({ body, markdown }: { body: string; markdown: boolean }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const oversized = body.length > MAX_INLINE_BODY
  const text = oversized && !expanded ? body.slice(0, MAX_INLINE_BODY) : body

  return (
    <>
      {markdown ? (
        <div className="max-h-[min(70vh,32rem)] max-w-full overflow-auto">
          <Markdown>{text}</Markdown>
        </div>
      ) : (
        <pre className="mono max-h-[min(70vh,32rem)] max-w-full overflow-auto whitespace-pre-wrap break-words leading-[1.6] text-ink-2 [overflow-wrap:anywhere]">
          {text}
        </pre>
      )}
      {oversized && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[12.5px] font-semibold text-brand-ink hover:underline"
        >
          {expanded
            ? t('action.collapse')
            : t('transcript.clamped', {
                total: (body.length / 1024).toFixed(0),
                shown: (MAX_INLINE_BODY / 1024).toFixed(0),
              })}
        </button>
      )}
    </>
  )
}

/**
 * Tool activity = a tool call (`tool_use`) or a tool result (re-attributed to the
 * `tool` role). Hidden by default so a session reads as the actual conversation.
 */
function isToolRow(m: SessionMessageRow): boolean {
  return m.role === 'tool' || m.contentKinds.includes('tool_use')
}

/**
 * Markdown is right for prose, but it mangles tool payloads: `__pycache__`
 * becomes bold and Windows paths lose their backslashes. Render those verbatim.
 */
function shouldRenderMarkdown(m: SessionMessageRow): boolean {
  return m.messageClass === 'dialog' && !isToolRow(m)
}

export function SessionTranscriptModal({
  open,
  onClose,
}: {
  open: TranscriptOpen
  onClose: () => void
}) {
  const t = useT()
  const [rows, setRows] = useState<SessionMessageRow[]>([])
  const [loadErr, setLoadErr] = useState('')
  const [showMeta, setShowMeta] = useState(false)
  const [showMarkdown, setShowMarkdown] = useState(true)
  const [showToolResults, setShowToolResults] = useState(false)
  const [archived, setArchived] = useState(false)
  const highlightRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  const visibleRows = useMemo(() => {
    return rows.filter(
      (m) => (showMeta || m.messageClass !== 'meta') && (showToolResults || !isToolRow(m)),
    )
  }, [rows, showMeta, showToolResults])

  const toolRowCount = useMemo(() => rows.filter(isToolRow).length, [rows])

  // Sessions reach ~7k rows and 2.6 MB of text. Rendering that in one pass locks
  // the window, so grow the rendered slice as the user scrolls.
  const [renderLimit, setRenderLimit] = useState(TRANSCRIPT_PAGE)
  const shownRows = useMemo(() => visibleRows.slice(0, renderLimit), [visibleRows, renderLimit])
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setRenderLimit(TRANSCRIPT_PAGE)
  }, [open.sessionId, showMeta, showToolResults])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || shownRows.length >= visibleRows.length) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRenderLimit((n) => n + TRANSCRIPT_PAGE)
        }
      },
      { rootMargin: '400px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [shownRows.length, visibleRows.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    closeBtnRef.current?.focus()
  }, [open.sessionId])

  useEffect(() => {
    let cancelled = false
    setRows([])
    setLoadErr('')
    setShowMeta(false)
    setArchived(false)
    void window.vault.sessionInfo(open.sessionId).then((info) => {
      if (!cancelled) setArchived(info?.archivedAt != null)
    })
    void window.vault.sessionTranscript(open.sessionId).then(
      (r) => {
        if (!cancelled) setRows(r)
      },
      () => {
        if (!cancelled) setLoadErr(t('transcript.loadError'))
      },
    )
    return () => {
      cancelled = true
    }
  }, [open.sessionId, t])

  useEffect(() => {
    if (!visibleRows.length || open.highlightLine < 0) return
    const id = window.setTimeout(() => {
      highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 120)
    return () => window.clearTimeout(id)
  }, [visibleRows, open.highlightLine])

  const copyAll = () => {
    const text = rows
      .map((r) => `[#${r.lineIndex} ${r.role}]\n${r.body}`)
      .join('\n\n---\n\n')
    void window.vault.copyText(text)
  }

  return (
    <div className="scrim" role="presentation" onClick={onClose}>
      <div
        className="dialog glass-solid max-w-4xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-line px-6 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="transcript-title" className="text-[19px] font-bold tracking-[-0.03em] text-ink-1">
                {t('transcript.title')}
              </h2>
              <p className="mt-0.5 truncate text-[13.5px] text-ink-2" title={open.projectLabel}>
                {open.projectLabel}
              </p>
              <p className="mono mt-0.5 break-all text-ink-3" title={open.sessionFile}>
                {open.sessionFile}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" className="btn btn-tertiary btn-xs" onClick={() => copyAll()}>
                {t('action.copyAll')}
              </button>
              <button ref={closeBtnRef} type="button" className="icon-btn" onClick={onClose} aria-label={t('action.close')}>
                <Icon name="close" />
              </button>
            </div>
          </div>
          {archived && <p className="alert tone-amber">{t('transcript.archived')}</p>}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="check" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} />
              {t('transcript.showMeta')}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="check"
                checked={showMarkdown}
                onChange={(e) => setShowMarkdown(e.target.checked)}
              />
              {t('transcript.markdown')}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="check"
                checked={showToolResults}
                onChange={(e) => setShowToolResults(e.target.checked)}
              />
              {t('transcript.showTools')}
              {toolRowCount > 0 ? <span className="text-ink-3 tabular">{toolRowCount.toLocaleString()}</span> : null}
            </label>
            <span className="ml-auto text-[12.5px] text-ink-3">{t('transcript.hint')}</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loadErr && <p className="alert tone-rose">{loadErr}</p>}
          {!loadErr && rows.length === 0 && <p className="empty">{t('common.loading')}</p>}
          {(() => {
            const hiddenMeta = showMeta ? 0 : rows.filter((m) => m.messageClass === 'meta').length
            const hiddenTools = showToolResults ? 0 : toolRowCount
            if (!hiddenMeta && !hiddenTools) return null
            const bits = [
              hiddenMeta ? t('transcript.hidden.meta', { count: hiddenMeta.toLocaleString() }) : '',
              hiddenTools ? t('transcript.hidden.tools', { count: hiddenTools.toLocaleString() }) : '',
            ].filter(Boolean)
            return <p className="mb-4 text-center text-[12.5px] text-ink-3">{t('transcript.hidden', { parts: bits.join(' · ') })}</p>
          })()}
          <div className="flex flex-col gap-3">
            {shownRows.map((m) => {
              const isHi = m.lineIndex === open.highlightLine
              const align = chatAlignForDialog(m.role, m.messageClass)
              const mcKey = messageClassKey(m.messageClass)
              return (
                <div key={m.messageId} className={`flex w-full min-w-0 ${chatRowFlex(align)}`}>
                  <div
                    ref={isHi ? highlightRef : undefined}
                    className={chatBubbleShellClass(align)}
                    data-highlight={isHi || undefined}
                    aria-label={`${m.role} · ${m.lineIndex}`}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                      {align !== 'center' ? <RoleBadge role={m.role} /> : null}
                      {mcKey ? <span className="badge tone-gray">{t(mcKey)}</span> : null}
                      <span className="mono">#{m.lineIndex}</span>
                      <button
                        type="button"
                        className="ml-auto font-semibold text-brand-ink hover:underline"
                        onClick={() => void window.vault.copyText(m.body)}
                      >
                        {t('action.copy')}
                      </button>
                    </div>
                    <TranscriptBody body={m.body} markdown={showMarkdown && shouldRenderMarkdown(m)} />
                  </div>
                </div>
              )
            })}
          </div>
          {shownRows.length < visibleRows.length && (
            <div ref={sentinelRef} className="py-5 text-center text-[12.5px] text-ink-3 tabular">
              {t('transcript.more', {
                shown: shownRows.length.toLocaleString(),
                total: visibleRows.length.toLocaleString(),
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
