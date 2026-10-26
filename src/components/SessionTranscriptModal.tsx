import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMessageRow } from '../../shared/ipc'
import { chatAlignForDialog, chatBubbleShellClass, chatRowFlex } from '../chatBubbleLayout'
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
        <pre className="max-h-[min(70vh,32rem)] max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] text-zinc-300 [overflow-wrap:anywhere]">
          {text}
        </pre>
      )}
      {oversized && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-brand-text hover:underline"
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-e3"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="transcript-title" className="text-sm font-semibold text-white">
              {t('transcript.title')}
            </h2>
            <p
              className="mt-1 break-all font-mono text-xs leading-snug text-zinc-200"
              title={open.sessionFile}
            >
              {open.sessionFile}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-500" title={open.projectLabel}>
              {open.projectLabel}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {t('transcript.hint')}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                <input type="checkbox" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} />
                {t('transcript.showMeta')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={showMarkdown}
                  onChange={(e) => setShowMarkdown(e.target.checked)}
                />
                {t('transcript.markdown')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={showToolResults}
                  onChange={(e) => setShowToolResults(e.target.checked)}
                />
                {t('transcript.showTools')}{toolRowCount > 0 ? ` (${toolRowCount})` : ''}
              </label>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
              onClick={() => copyAll()}
            >
              {t('action.copyAll')}
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg transition-colors duration-150 ease-out hover:bg-brand-hover"
              onClick={onClose}
            >
              {t('action.close')}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loadErr && <p className="text-sm text-red-400">{loadErr}</p>}
          {!loadErr && rows.length === 0 && <p className="text-sm text-zinc-500">불러오는 중…</p>}
          {(() => {
            const hiddenMeta = showMeta ? 0 : rows.filter((m) => m.messageClass === 'meta').length
            const hiddenTools = showToolResults ? 0 : toolRowCount
            if (!hiddenMeta && !hiddenTools) return null
            const bits = [
              hiddenMeta ? t('transcript.hidden.meta', { count: hiddenMeta }) : '',
              hiddenTools ? t('transcript.hidden.tools', { count: hiddenTools }) : '',
            ].filter(Boolean)
            return (
              <p className="mb-2 text-[11px] text-zinc-500">
                {t('transcript.hidden', { parts: bits.join(' · ') })}
              </p>
            )
          })()}
          {shownRows.map((m) => {
            const isHi = m.lineIndex === open.highlightLine
            const align = chatAlignForDialog(m.role, m.messageClass)
            const isUser = m.role === 'user'
            const mcKey = messageClassKey(m.messageClass)
            return (
              <div key={m.messageId} className={`mb-2 flex w-full min-w-0 ${chatRowFlex(align)}`}>
                <div
                  ref={isHi ? highlightRef : undefined}
                  className={`${chatBubbleShellClass(align, isHi)} ${m.messageClass === 'meta' ? 'opacity-90' : ''}`}
                  aria-label={`${m.role} · ${m.lineIndex}`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    {align !== 'center' ? (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          isUser ? 'bg-brand-soft text-brand-text' : 'bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        {isUser ? '나' : 'Claude'}
                      </span>
                    ) : null}
                    <span className="font-mono text-zinc-400">#{m.lineIndex}</span>
                    <span className={isUser ? 'text-emerald-400' : 'text-zinc-400'}>{m.role}</span>
                    {mcKey ? (
                      <span className="rounded bg-zinc-800 px-1 text-[10px] text-amber-200/80">{t(mcKey)}</span>
                    ) : null}
                    <button
                      type="button"
                      className="ml-auto text-sky-400 hover:underline"
                      onClick={() => void window.vault.copyText(m.body)}
                    >
                      복사
                    </button>
                  </div>
                  <TranscriptBody
                    body={m.body}
                    markdown={showMarkdown && shouldRenderMarkdown(m)}
                  />
                </div>
              </div>
            )
          })}
          {shownRows.length < visibleRows.length && (
            <div ref={sentinelRef} className="py-4 text-center font-mono text-[11px] text-zinc-600">
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
