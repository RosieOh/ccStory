import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n'
import { Icon } from '../ui'
import type { Command } from '../types'

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return commands
    return commands.filter(
      (c) => c.label.toLowerCase().includes(s) || (c.hint?.toLowerCase().includes(s) ?? false),
    )
  }, [q, commands])

  useEffect(() => {
    setActive(0)
  }, [q])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, filtered.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = filtered[active]
      if (c) {
        c.run()
        onClose()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="scrim !items-start pt-[12vh]" role="presentation" onClick={onClose}>
      <div
        className="dialog glass-solid max-w-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('app.palette')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Icon name="search" className="h-[18px] w-[18px] text-ink-3" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('palette.placeholder')}
            aria-label={t('app.palette')}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink-1 outline-none placeholder:text-ink-4"
          />
          <span className="kbd">Esc</span>
        </div>
        <ul className="max-h-[22rem] overflow-y-auto p-2">
          {filtered.length === 0 && <li className="empty !py-8">{t('palette.empty')}</li>}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  c.run()
                  onClose()
                }}
                className="menu-item !py-2.5"
                data-active={i === active || undefined}
              >
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint ? <span className="badge tone-gray">{c.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
