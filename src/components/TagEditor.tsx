import { useEffect, useState } from 'react'
import type { TagRow } from '../../shared/ipc'

/**
 * Tag toggles for one message. The current tags arrive with the row (search hits and
 * favorites carry `tagIds`), so rendering a result list costs no extra IPC per row.
 * Tags key on the message's stable `msgKey`, so they survive re-indexing.
 */
export function TagEditor({
  msgKey,
  tagIds,
  tags,
  onChange,
}: {
  msgKey: string
  tagIds: number[]
  tags: TagRow[]
  onChange: () => void
}) {
  const [selected, setSelected] = useState<number[]>(tagIds)

  // A refreshed result list brings fresh tag ids for the same row.
  const idsKey = tagIds.join(',')
  useEffect(() => {
    setSelected(idsKey ? idsKey.split(',').map(Number) : [])
  }, [msgKey, idsKey])

  const toggle = async (id: number) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    setSelected(next)
    await window.vault.messageTagsSet(msgKey, next)
    onChange()
  }

  // No tags yet: the inspector's "new tag" field is the one place to start; repeating a
  // hint under every result is noise.
  if (!tags.length) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.map((tag) => {
        const on = selected.includes(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => void toggle(tag.id)}
            aria-pressed={on}
            className={`rounded-full px-2 py-0.5 text-[12px] transition-colors duration-150 ${
              on ? 'bg-brand font-semibold text-white' : 'bg-well text-ink-3 hover:text-ink-1'
            }`}
          >
            {tag.name}
          </button>
        )
      })}
    </div>
  )
}
