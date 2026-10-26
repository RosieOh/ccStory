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

/** Bubble surfaces live in index.css (`.bubble-*`); the highlight is a `data-highlight` ring. */
export function chatBubbleShellClass(align: ChatAlign): string {
  if (align === 'end') return 'bubble bubble-user'
  if (align === 'start') return 'bubble bubble-ai'
  return 'bubble-meta'
}

export function isMessageHit(h: UnifiedSearchHit): h is MessageHit {
  return h.hitType === 'message'
}

export function isPlanHit(h: UnifiedSearchHit): h is PlanHit {
  return h.hitType === 'plan'
}
