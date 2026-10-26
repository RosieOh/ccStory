import { useEffect, useRef, useState } from 'react'
import type { PlanHit } from '../../shared/ipc'
import { BCP47 } from '../../shared/i18n'
import { Markdown } from '../Markdown'
import { useI18n, useT } from '../i18n'
import { GHOST_BTN } from '../ui'
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
    <article
      className={`group border-b border-zinc-800 px-3 py-2.5 transition-colors duration-100 ${
        active ? 'bg-plan-bg' : 'hover:bg-zinc-900'
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-zinc-600">
          <span className="rounded-[3px] bg-plan-bg px-1 py-px text-[10px] font-medium uppercase text-plan-text">
            plan
          </span>
          <span className="truncate font-sans font-medium text-zinc-300" title={h.filePath}>
            {h.title}
          </span>
          <span className="truncate">{h.filePath}</span>
          <span className="tabular">{new Date(h.mtime).toLocaleDateString(BCP47[locale])}</span>
        </div>
        <div
          className={`flex shrink-0 items-center gap-1 transition-opacity duration-100 ${
            active ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
          }`}
        >
          <button type="button" className={GHOST_BTN} onClick={() => void copyFull()}>
            복사
          </button>
          <button type="button" className={GHOST_BTN} onClick={() => void toggle()}>
            {expanded ? t('action.collapse') : t('action.body')}
          </button>
        </div>
      </div>
      <p className="truncate text-[12px] text-snippet">« {h.snippet} »</p>
      {expanded && body !== null ? (
        <div className="mt-2 max-h-64 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3">
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-plan-line bg-zinc-900 shadow-e3"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="plan-preview-title" className="truncate text-sm font-semibold text-white">
              {open.title}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{open.filePath}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
              onClick={() => void window.vault.copyText(body)}
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
          {err && <p className="text-sm text-red-400">{err}</p>}
          {!err && !body && <p className="text-sm text-zinc-500">불러오는 중…</p>}
          {!err && body ? <Markdown>{body}</Markdown> : null}
        </div>
      </div>
    </div>
  )
}
