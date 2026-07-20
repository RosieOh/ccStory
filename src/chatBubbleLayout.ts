import type { MessageClass, MessageHit, PlanHit, UnifiedSearchHit } from '../shared/ipc'

/** Assistant left, user right; meta → full-width neutral strip. */
export type ChatAlign = 'start' | 'end' | 'center'

/** Only true meta strips stay centered; `other` still uses user/assistant sides when role is known. */
export function chatAlignForDialog(role: string, messageClass: MessageClass): ChatAlign {
  if (messageClass === 'meta') return 'center'
  if (role === 'user') return 'end'
  if (role === 'assistant') return 'start'
  return 'center'
}

export function chatRowFlex(align: ChatAlign): string {
  if (align === 'end') return 'justify-end'
  if (align === 'start') return 'justify-start'
  return 'justify-center'
}

export function chatBubbleShellClass(align: ChatAlign, highlighted: boolean): string {
  // Bubble tints are CSS-variable driven (see index.css) so they stay legible in
  // both themes instead of baking in dark-only accents.
  const hi = highlighted ? 'ring-2 ring-amber-400/60 border-amber-400/70' : ''
  const base = 'rounded-2xl border px-3.5 py-2.5 text-sm min-w-0 overflow-hidden'
  const dialogBubbleMax = 'max-w-[min(92vw,34rem)] sm:max-w-[min(92vw,38rem)]'
  if (align === 'end') {
    return `${base} ${dialogBubbleMax} flex-[0_1_auto] border-bubble-user-line bg-bubble-user text-zinc-200 ${hi}`
  }
  if (align === 'start') {
    return `${base} ${dialogBubbleMax} flex-[0_1_auto] border-bubble-ai-line bg-bubble-ai text-zinc-200 ${hi}`
  }
  return `${base} w-full max-w-4xl border-zinc-800 bg-zinc-950 text-zinc-300 ${hi}`
}

export function isMessageHit(h: UnifiedSearchHit): h is MessageHit {
  return h.hitType === 'message'
}

export function isPlanHit(h: UnifiedSearchHit): h is PlanHit {
  return h.hitType === 'plan'
}
