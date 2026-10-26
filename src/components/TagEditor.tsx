import { useEffect, useState } from 'react'
import type { TagRow } from '../../shared/ipc'
import { useT } from '../i18n'

export function TagEditor({
  messageId,
  tags,
  onChange,
}: {
  messageId: number
  tags: TagRow[]
  onChange: () => void
}) {
  const t = useT()
  const [selected, setSelected] = useState<number[]>([])

  useEffect(() => {
    let cancelled = false
    void window.vault.messageTagsGet(messageId).then((ids) => {
      if (!cancelled) setSelected(ids)
    })
    return () => {
      cancelled = true
    }
  }, [messageId])

  const toggle = async (id: number) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    setSelected(next)
    await window.vault.messageTagsSet(messageId, next)
    onChange()
  }

  if (!tags.length) {
    return <p className="mt-1 text-[11px] text-zinc-600">{t('inspector.tags.empty')}</p>
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          onClick={() => void toggle(tag.id)}
          className={`rounded-[3px] border px-1.5 py-px text-[10px] transition-colors duration-100 ${
            selected.includes(tag.id)
              ? 'border-brand-line bg-brand-soft font-medium text-brand-text'
              : 'border-zinc-800 text-zinc-600 hover:border-brand-line hover:text-zinc-300'
          }`}
        >
          {tag.name}
        </button>
      ))}
    </div>
  )
}
