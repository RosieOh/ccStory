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
  const hi = highlighted
    ? 'ring-2 ring-amber-500/60 border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]'
    : ''
  const base = 'rounded-2xl border px-3 py-2 text-sm min-w-0 overflow-hidden'
  const dialogBubbleMax = 'max-w-[min(92vw,34rem)] sm:max-w-[min(92vw,38rem)]'
  if (align === 'end') {
    return `${base} ${dialogBubbleMax} flex-[0_1_auto] border-emerald-600/50 bg-emerald-950/55 text-zinc-100 ${hi}`
  }
  if (align === 'start') {
    return `${base} ${dialogBubbleMax} flex-[0_1_auto] border-sky-800/45 bg-sky-950/35 text-zinc-100 ${hi}`
  }
  return `${base} w-full max-w-4xl border-zinc-700 bg-zinc-900/75 text-zinc-200 ${hi}`
}

export function isMessageHit(h: UnifiedSearchHit): h is MessageHit {
  return h.hitType === 'message'
}

export function isPlanHit(h: UnifiedSearchHit): h is PlanHit {
  return h.hitType === 'plan'
}
