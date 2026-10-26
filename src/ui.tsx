
/** 사이드바: 경로 꼬리만 짧게 (전체는 title 툴팁). */
export function sidebarPrimaryLabel(displayName: string): string {
  const parts = displayName.split(/[/\\]/u).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  }
  return parts[parts.length - 1] ?? displayName
}

/** 16px stroke icons — one visual family across the whole shell. */
export function Icon({ name, className = '' }: { name: TabIcon; className?: string }) {
  const d: Record<TabIcon, string> = {
    search: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35',
    star: 'm12 3 2.9 5.9 6.1.9-4.5 4.3 1.1 6.4L12 17.5 6.4 20.5l1.1-6.4L3 9.8l6.1-.9L12 3Z',
    template: 'M5 3h9l5 5v13H5V3Zm9 0v5h5M8 13h8M8 17h5',
    chart: 'M4 20V10m5 10V4m5 16v-7m5 7V8',
    export: 'M12 15V3m0 0L8 7m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
    file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5',
    prompt: 'M4 5h16v11H8l-4 4V5Zm4 4h8m-8 3h5',
    settings:
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.4 7.4 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 shrink-0 ${className}`}
    >
      <path d={d[name]} />
    </svg>
  )
}

export type TabIcon =
  | 'search'
  | 'star'
  | 'template'
  | 'chart'
  | 'export'
  | 'folder'
  | 'file'
  | 'prompt'
  | 'settings'

/** Segmented control: canvas track, raised surface thumb for the active option. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string])[]
  disabled?: boolean
}) {
  return (
    <div
      className={`flex shrink-0 rounded-md border border-zinc-800 bg-zinc-950 p-[2px] ${
        disabled ? 'pointer-events-none opacity-40' : ''
      }`}
    >
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-[3px] px-2 py-0.5 text-[11px] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
            value === v
              ? 'bg-zinc-900 font-medium text-white shadow-e2'
              : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Labelled row inside the inspector panel. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      {children}
    </div>
  )
}

/** Quiet secondary action — one shape for every non-primary button in the app. */
export const GHOST_BTN =
  'rounded-md border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-40'
