import { useEffect, useRef, useState } from 'react'
import type { PlanHit } from '../../shared/ipc'
import { BCP47 } from '../../shared/i18n'
import { Markdown } from '../Markdown'
import { useI18n, useT } from '../i18n'
import { GHOST_BTN, Icon, Snippet } from '../ui'
import type { PlanPreviewOpen } from '../types'

export function PlanSearchHitCard({
  h,
  active,
  onStatus,
}: {
  h: PlanHit
  active?: boolean
  onStatus: (s: string) => void
}) {
  const { locale, t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState<string | null>(null)

  const ensureBody = async () => {
    if (body !== null) return body
    const b = await window.vault.planBody(h.planId)
    setBody(b)
    return b
  }

  const toggle = async () => {
    if (!expanded) await ensureBody()
    setExpanded((v) => !v)
  }

  const copyFull = async () => {
    const b = await ensureBody()
    void window.vault.copyText(b)
    onStatus(t('toast.planCopied'))
  }

  // Same row rhythm as a message hit; plan-ness is carried by one small tag.
  return (
    <article className="row" data-active={active || undefined}>
      <div className="flex items-start gap-2">
        <div className="row-meta flex-1">
          <span className="badge tone-violet">{t('plan.badge')}</span>
          <span className="truncate font-semibold text-ink-2" title={h.filePath}>
            {h.title}
          </span>
          <span className="tabular">{new Date(h.mtime).toLocaleDateString(BCP47[locale])}</span>
        </div>
        <div className="row-actions">
          <button type="button" className={GHOST_BTN} onClick={() => void copyFull()}>
            {t('action.copy')}
          </button>
          <button type="button" className={GHOST_BTN} onClick={() => void toggle()}>
            {expanded ? t('action.collapse') : t('action.body')}
          </button>
        </div>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-ink-1">
        <Snippet text={h.snippet} />
      </p>
      <p className="mono mt-1 truncate text-ink-3">{h.filePath}</p>
      {expanded && body !== null ? (
        <div className="mt-3 max-h-72 overflow-auto rounded-2xl bg-well p-4">
          <Markdown>{body}</Markdown>
        </div>
      ) : null}
    </article>
  )
}

export function PlanMarkdownModal({
  open,
  onClose,
}: {
  open: PlanPreviewOpen
  onClose: () => void
}) {
  const t = useT()
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    closeBtnRef.current?.focus()
  }, [open.planId])

  useEffect(() => {
    let cancelled = false
    setBody('')
    setErr('')
    void window.vault.planBody(open.planId).then(
      (t) => {
        if (!cancelled) setBody(t)
      },
      () => {
        if (!cancelled) setErr(t('plan.loadError'))
      },
    )
    return () => {
      cancelled = true
    }
  }, [open.planId, t])

  return (
    <div className="scrim" role="presentation" onClick={onClose}>
      <div
        className="dialog glass-solid max-w-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 pb-4 pt-5">
          <div className="min-w-0">
            <span className="badge tone-violet">{t('plan.badge')}</span>
            <h2 id="plan-preview-title" className="mt-1.5 truncate text-[19px] font-bold tracking-[-0.03em] text-ink-1">
              {open.title}
            </h2>
            <p className="mono mt-0.5 break-all text-ink-3">{open.filePath}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="btn btn-tertiary btn-xs" onClick={() => void window.vault.copyText(body)}>
              {t('action.copyAll')}
            </button>
            <button ref={closeBtnRef} type="button" className="icon-btn" onClick={onClose} aria-label={t('action.close')}>
              <Icon name="close" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {err && <p className="alert tone-rose">{err}</p>}
          {!err && !body && <p className="empty">{t('common.loading')}</p>}
          {!err && body ? <Markdown>{body}</Markdown> : null}
        </div>
      </div>
    </div>
  )
}
