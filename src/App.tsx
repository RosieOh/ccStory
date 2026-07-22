import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import type {
  FavoriteRow,
  FileRow,
  FileTouchRow,
  IndexProgress,
  UpdateStatus,
  MatchMode,
  MessageClass,
  ModelTokenRow,
  PlanHit,
  PlanListRow,
  ProjectRow,
  RecentSessionRow,
  SearchScope,
  SessionMessageRow,
  SortMode,
  StatsPayload,
  TagRow,
  TemplateRow,
  UnifiedSearchHit,
} from '../shared/ipc'
import {
  chatAlignForDialog,
  chatBubbleShellClass,
  chatRowFlex,
  isMessageHit,
  isPlanHit,
} from './chatBubbleLayout'
import { Markdown } from './Markdown'
import { extractTemplateVariables, renderTemplate } from '../shared/templates'
import { useI18n, useT } from './i18n'
import { BCP47, LOCALES, LOCALE_LABEL, type Locale, type MessageKey } from '../shared/i18n'
import { PRICES_AS_OF, costOf, formatUsd, type ModelPrice } from '../shared/pricing'

type Tab = 'search' | 'files' | 'favorites' | 'templates' | 'stats' | 'export'

type TranscriptOpen = {
  sessionId: number
  /** sessions.rel_path — 세션마다 다름 (제목 앞줄) */
  sessionFile: string
  /** projects.display_name 또는 slug */
  projectLabel: string
  highlightLine: number
}

type PlanPreviewOpen = {
  planId: number
  title: string
  filePath: string
}

/** 사이드바: 경로 꼬리만 짧게 (전체는 title 툴팁). */
function sidebarPrimaryLabel(displayName: string): string {
  const parts = displayName.split(/[/\\]/u).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  }
  return parts[parts.length - 1] ?? displayName
}

/** 16px stroke icons — one visual family across the whole shell. */
function Icon({ name, className = '' }: { name: TabIcon; className?: string }) {
  const d: Record<TabIcon, string> = {
    search: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35',
    star: 'm12 3 2.9 5.9 6.1.9-4.5 4.3 1.1 6.4L12 17.5 6.4 20.5l1.1-6.4L3 9.8l6.1-.9L12 3Z',
    template: 'M5 3h9l5 5v13H5V3Zm9 0v5h5M8 13h8M8 17h5',
    chart: 'M4 20V10m5 10V4m5 16v-7m5 7V8',
    export: 'M12 15V3m0 0L8 7m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
    file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5',
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

type TabIcon = 'search' | 'star' | 'template' | 'chart' | 'export' | 'folder' | 'file'

/** Segmented control: canvas track, raised surface thumb for the active option. */
function Segmented<T extends string>({
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
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      {children}
    </div>
  )
}

const NAV_GROUPS: {
  labelKey: MessageKey
  items: { key: Tab; labelKey: MessageKey; icon: TabIcon }[]
}[] = [
  {
    labelKey: 'nav.group.explore',
    items: [
      { key: 'search', labelKey: 'nav.search' as const, icon: 'search' },
      { key: 'files', labelKey: 'nav.files' as const, icon: 'file' },
      { key: 'favorites', labelKey: 'nav.favorites' as const, icon: 'star' },
      { key: 'templates', labelKey: 'nav.templates' as const, icon: 'template' },
    ],
  },
  {
    labelKey: 'nav.group.analyze',
    items: [
      { key: 'stats', labelKey: 'nav.stats' as const, icon: 'chart' },
      { key: 'export', labelKey: 'nav.export' as const, icon: 'export' },
    ],
  },
]

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

/** Quiet secondary action — one shape for every non-primary button in the app. */
const GHOST_BTN =
  'rounded-md border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-40'

type Command = { id: string; label: string; hint?: string; run: () => void }

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

type DateRange = 'all' | '24h' | '7d' | '30d'

/** Convert a date-range preset to an epoch-ms lower bound (null = no bound). */
function sinceMsFor(range: DateRange): number | undefined {
  const day = 24 * 60 * 60 * 1000
  if (range === '24h') return Date.now() - day
  if (range === '7d') return Date.now() - 7 * day
  if (range === '30d') return Date.now() - 30 * day
  return undefined
}

/** Short local timestamp for hit cards; empty string when unknown. */
function formatTs(ms: number | null | undefined, locale: Locale): string {
  if (ms == null) return ''
  return new Date(ms).toLocaleString(BCP47[locale])
}

/** 1_234_567 → "1.2M", 12_300 → "12.3K" — compact token counts for stat tiles. */
function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** Returns a dictionary key, not text — the caller owns translation. */
function messageClassKey(c: MessageClass): MessageKey | null {
  if (c === 'meta') return 'class.meta'
  if (c === 'other') return 'class.other'
  return null
}

export default function App() {
  const { locale, setLocale, t } = useI18n()
  const [tab, setTab] = useState<Tab>('search')
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState<number | undefined>(undefined)
  const [role, setRole] = useState<'user' | 'assistant' | ''>('')
  const [query, setQuery] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('messages')
  const [matchMode, setMatchMode] = useState<MatchMode>('any')
  const [sortMode, setSortMode] = useState<SortMode>('relevance')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [hits, setHits] = useState<UnifiedSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [favorites, setFavorites] = useState<FavoriteRow[]>([])
  const [tags, setTags] = useState<TagRow[]>([])
  const [newTag, setNewTag] = useState('')
  const [stats, setStats] = useState<StatsPayload | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [exportText, setExportText] = useState('')
  const [status, setStatus] = useState('')
  const [transcriptOpen, setTranscriptOpen] = useState<TranscriptOpen | null>(null)
  const [planPreview, setPlanPreview] = useState<PlanPreviewOpen | null>(null)
  const [excludeMeta, setExcludeMeta] = useState(true)
  const [excludeSubagents, setExcludeSubagents] = useState(false)
  const [recentSessions, setRecentSessions] = useState<RecentSessionRow[]>([])
  const [recentPlans, setRecentPlans] = useState<PlanListRow[]>([])
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [activeResult, setActiveResult] = useState(-1)
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('vault-theme') === 'dark'
      ? 'dark'
      : 'light',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('vault-theme', theme)
    } catch {
      /* ignore storage errors */
    }
  }, [theme])

  const searchParamsRef = useRef({
    query,
    projectId,
    role,
    excludeMeta,
    excludeSubagents,
    searchScope,
    matchMode,
    sortMode,
    dateRange,
  })
  searchParamsRef.current = {
    query,
    projectId,
    role,
    excludeMeta,
    excludeSubagents,
    searchScope,
    matchMode,
    sortMode,
    dateRange,
  }

  const loadProjects = useCallback(async () => {
    const list = await window.vault.projectsList()
    setProjects(list)
  }, [])

  const loadRecentSessions = useCallback(async () => {
    setRecentSessions(await window.vault.recentSessions(projectId ?? null))
  }, [projectId])

  const loadRecentPlans = useCallback(async () => {
    setRecentPlans(await window.vault.plansList())
  }, [])

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const raw = await window.vault.search({
        query,
        projectId,
        role,
        limit: 120,
        excludeMeta,
        excludeSubagents,
        scope: searchScope,
        matchMode,
        sort: sortMode,
        sinceMs: sinceMsFor(dateRange),
      })
      setHits(raw)
    } finally {
      setLoading(false)
    }
  }, [query, projectId, role, excludeMeta, excludeSubagents, searchScope, matchMode, sortMode, dateRange])

  const fuzzyHits = useMemo(() => {
    if (!query.trim() || hits.length === 0) return hits
    const allMsg = hits.every(isMessageHit)
    const allPlan = hits.every(isPlanHit)
    if (allPlan) {
      const fuse = new Fuse(hits, {
        keys: ['title', 'snippet', 'filePath'],
        threshold: 0.42,
        ignoreLocation: true,
      })
      const fused = fuse.search(query.trim())
      if (fused.length === 0) return hits
      return fused.map((r) => r.item)
    }
    if (!allMsg) return hits
    const fuse = new Fuse(hits, {
      keys: ['body', 'snippet', 'projectSlug', 'projectName'],
      threshold: 0.42,
      ignoreLocation: true,
    })
    const fused = fuse.search(query.trim())
    if (fused.length === 0) return hits
    return fused.map((r) => r.item)
  }, [hits, query])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    const off = window.vault.onIndexProgress((p) => {
      setIndexProgress(p.phase === 'done' ? null : p)
      if (p.phase === 'done') void loadProjects()
    })
    return off
  }, [loadProjects])

  useEffect(() => {
    void window.vault.updateStatus().then(setUpdate)
    return window.vault.onUpdateStatus(setUpdate)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** How many filters differ from their default — shown on the 필터 button. */
  const activeFilterCount = useMemo(() => {
    let n = 0
    if (role) n += 1
    if (matchMode !== 'any') n += 1
    if (sortMode !== 'relevance') n += 1
    if (dateRange !== 'all') n += 1
    if (!excludeMeta) n += 1
    if (excludeSubagents) n += 1
    return n
  }, [role, matchMode, sortMode, dateRange, excludeMeta, excludeSubagents])

  const resetFilters = useCallback(() => {
    setRole('')
    setMatchMode('any')
    setSortMode('relevance')
    setDateRange('all')
    setExcludeMeta(true)
    setExcludeSubagents(false)
  }, [])

  useEffect(() => {
    setActiveResult(-1)
  }, [query, searchScope, projectId, hits])

  useEffect(() => {
    if (tab !== 'search') return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (paletteOpen || transcriptOpen || planPreview) return
      if (!fuzzyHits.length) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveResult((a) => Math.min(a + 1, fuzzyHits.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveResult((a) => Math.max(a <= 0 ? 0 : a - 1, 0))
      } else if (e.key === 'Enter' && activeResult >= 0) {
        const h = fuzzyHits[activeResult]
        if (!h) return
        if (isPlanHit(h)) {
          setPlanPreview({ planId: h.planId, title: h.title, filePath: h.filePath })
        } else {
          setTranscriptOpen({
            sessionId: h.sessionId,
            sessionFile: h.sessionFile,
            projectLabel: h.projectName || h.projectSlug,
            highlightLine: h.lineIndex,
          })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, fuzzyHits, activeResult, paletteOpen, transcriptOpen, planPreview])

  const commands = useMemo<Command[]>(() => {
    const tabCmds: Command[] = (
      [
        ['search', 'nav.search'],
        ['files', 'nav.files'],
        ['favorites', 'nav.favorites'],
        ['templates', 'nav.templates'],
        ['stats', 'nav.stats'],
        ['export', 'nav.export'],
      ] as const
    ).map(([k, labelKey]) => ({
      id: `tab:${k}`,
      label: t('palette.goto', { label: t(labelKey) }),
      hint: t('palette.hint.tab'),
      run: () => setTab(k),
    }))
    const actions: Command[] = [
      { id: 'proj:all', label: t('palette.project.all'), hint: t('palette.hint.filter'), run: () => setProjectId(undefined) },
      {
        id: 'action:reindex',
        label: t('app.reindex'),
        hint: t('palette.hint.action'),
        run: () => {
          void window.vault.reindex()
        },
      },
      {
        id: 'action:focus-search',
        label: t('palette.focusSearch'),
        hint: t('palette.hint.action'),
        run: () => {
          setTab('search')
          setTimeout(() => searchInputRef.current?.focus(), 0)
        },
      },
    ]
    const projCmds: Command[] = projects.map((p) => ({
      id: `proj:${p.id}`,
      label: t('palette.project', { label: sidebarPrimaryLabel(p.displayName) }),
      hint: t('palette.hint.filter'),
      run: () => {
        setProjectId(p.id)
        setTab('search')
      },
    }))
    return [...tabCmds, ...actions, ...projCmds]
  }, [projects, t])

  useEffect(() => {
    const off = window.vault.onIndexUpdated(() => {
      void loadProjects()
      void loadRecentSessions()
      void loadRecentPlans()
      void (async () => {
        const p = searchParamsRef.current
        if (!p.query.trim()) {
          setHits([])
          return
        }
        const raw = await window.vault.search({
          query: p.query,
          projectId: p.projectId,
          role: p.role,
          limit: 120,
          excludeMeta: p.excludeMeta,
          excludeSubagents: p.excludeSubagents,
          scope: p.searchScope,
          matchMode: p.matchMode,
          sort: p.sortMode,
          sinceMs: sinceMsFor(p.dateRange),
        })
        setHits(raw)
      })()
    })
    return off
  }, [loadProjects, loadRecentSessions, loadRecentPlans])

  useEffect(() => {
    const t = setTimeout(() => {
      void runSearch()
    }, 200)
    return () => clearTimeout(t)
  }, [runSearch])

  const loadFavorites = useCallback(async () => {
    setFavorites(await window.vault.favoritesList())
  }, [])

  const loadTags = useCallback(async () => {
    setTags(await window.vault.tagsList())
  }, [])

  const loadStats = useCallback(async () => {
    setStats(await window.vault.stats())
  }, [])

  useEffect(() => {
    if (tab === 'favorites') void loadFavorites()
    if (tab === 'stats') void loadStats()
    if (tab === 'search') {
      void loadRecentSessions()
      void loadRecentPlans()
    }
    void loadTags()
  }, [tab, projectId, loadFavorites, loadStats, loadTags, loadRecentSessions, loadRecentPlans])

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const doExport = async (format: 'md' | 'csv') => {
    const ids = [...selected]
    if (!ids.length) {
      setStatus(t('toast.exportEmpty'))
      return
    }
    const text = await window.vault.exportMessages(ids, format, {
      excludeMeta,
      excludeSubagents,
    })
    setExportText(text)
    setTab('export')
    setStatus(t('toast.exported'))
  }

  const createTag = async () => {
    const name = newTag.trim()
    if (!name) return
    await window.vault.tagCreate(name, null)
    setNewTag('')
    await loadTags()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px] bg-brand" />
          <h1 className="truncate text-[13px] font-semibold tracking-tight text-white">
            Claude Vault
          </h1>
          <span className="truncate text-[11px] text-zinc-500">{t('app.subtitle')}</span>
        </div>
        <div className="flex items-center gap-2">
          {update.state === 'ready' && (
            <button
              type="button"
              onClick={() => void window.vault.updateInstall()}
              className="rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-brand-fg transition-colors duration-150 hover:bg-brand-hover"
              title={t('app.update.restart', { version: update.version ?? '' })}
            >
              {t('app.update.install')}{update.version ? ` ${update.version}` : ''}
            </button>
          )}
          {update.state === 'downloading' && (
            <span className="font-mono text-[11px] text-zinc-500">
              {t('app.update.downloading', { percent: update.percent ?? 0 })}
            </span>
          )}
          <Segmented
            value={locale}
            onChange={setLocale}
            options={LOCALES.map((l) => [l, LOCALE_LABEL[l]] as const)}
          />
          <button
            type="button"
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
            title={t('app.theme.toggle')}
          >
            {theme === 'dark' ? t('app.theme.light') : t('app.theme.dark')}
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded-md border border-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-500 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
            title={t('app.palette')}
          >
            ⌘K
          </button>
          {indexProgress && (
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              {indexProgress.phase === 'plans'
                ? t('app.indexing.plans')
                : t('app.indexing', { current: indexProgress.current, total: indexProgress.total })}
            </span>
          )}
          <button
            type="button"
            className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg transition-colors duration-150 ease-out hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            onClick={async () => {
              const r = await window.vault.reindex()
              setStatus(
                t('toast.reindexed', { projects: r.projects, sessions: r.sessions, plans: r.planFiles }),
              )
              await loadProjects()
              await loadRecentSessions()
              await loadRecentPlans()
              await runSearch()
            }}
          >
            {t('app.reindex')}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
          <nav className="space-y-3 p-2">
            {NAV_GROUPS.map((group) => (
              <div key={group.labelKey}>
                <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">{t(group.labelKey)}</p>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = tab === item.key
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setTab(item.key)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                          active
                            ? 'bg-brand-soft font-medium text-brand-text'
                            : 'text-zinc-400 hover:bg-zinc-950 hover:text-zinc-200'
                        }`}
                      >
                        <Icon name={item.icon} />
                        {t(item.labelKey)}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-800 p-2">
            <div className="mb-1 flex items-center gap-2 px-2">
              <Icon name="folder" className="text-zinc-500" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{t('nav.projects')}</p>
              <span className="ml-auto font-mono text-[11px] tabular text-zinc-600">{projects.length}</span>
            </div>
            <div className="-mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
              <button
                type="button"
                className={`flex w-full items-center rounded-md px-2 py-1 text-left text-[13px] transition-colors duration-150 ease-out ${
                  projectId === undefined
                    ? 'bg-brand-soft font-medium text-brand-text'
                    : 'text-zinc-400 hover:bg-zinc-950 hover:text-zinc-200'
                }`}
                onClick={() => setProjectId(undefined)}
              >
                {t('nav.projects.all')}
              </button>
              {projects.map((p) => {
                const active = projectId === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`block w-full rounded-md px-2 py-1 text-left transition-colors duration-150 ease-out ${
                      active
                        ? 'bg-brand-soft text-brand-text'
                        : 'text-zinc-400 hover:bg-zinc-950 hover:text-zinc-200'
                    }`}
                    title={`${p.displayName}\n${p.path}`}
                    onClick={() => setProjectId(p.id)}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`min-w-0 truncate text-[13px] ${active ? 'font-medium' : ''}`}
                      >
                        {sidebarPrimaryLabel(p.displayName)}
                      </span>
                      {p.tool && p.tool !== 'claude' ? (
                        <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[9px] font-medium uppercase text-amber-600">
                          {p.tool}
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 font-mono text-[11px] tabular text-zinc-600">
                        {p.sessionCount}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          {tab === 'search' && (
            <div className="flex h-full flex-col">
              <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2">
                <div className="flex items-center gap-3">
                  <div className="relative min-w-0 flex-1">
                    <Icon
                      name="search"
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600"
                    />
                    <input
                      ref={searchInputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('search.placeholder')}
                      aria-label={t('search.label')}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-[13px] text-white outline-none transition duration-150 ease-out placeholder:text-zinc-600 focus:border-brand focus:bg-zinc-900 focus:ring-1 focus:ring-brand/40"
                    />
                  </div>
                  <Segmented
                    value={searchScope}
                    onChange={setSearchScope}
                    options={
                      [
                        ['messages', t('search.scope.messages')],
                        ['plans', t('search.scope.plans')],
                        ['all', t('search.scope.all')],
                      ] as const
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setInspectorOpen((v) => !v)}
                    aria-expanded={inspectorOpen}
                    className={`shrink-0 rounded-md border px-2 py-1 text-[11px] transition-colors duration-150 ease-out ${
                      activeFilterCount > 0
                        ? 'border-brand-line bg-brand-soft text-brand-text'
                        : 'border-zinc-800 text-zinc-500 hover:bg-zinc-950 hover:text-zinc-200'
                    }`}
                  >
                    {t('search.filters')}{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
                  </button>
                </div>
                <p className="mt-1.5 font-mono text-[11px] text-zinc-600">
                  {query.trim()
                    ? `${t('search.resultCount', { count: fuzzyHits.length })}${loading ? t('search.searching') : ''}`
                    : t('search.emptyHint')}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading && <p className="p-3 font-mono text-[11px] text-zinc-500">{t('search.loading')}</p>}
                {!loading && query.trim() === '' && searchScope !== 'plans' && recentSessions.length > 0 && (
                  <section className="p-3">
                    <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">{t('search.recentSessions')}</h3>
                    <ul className="space-y-1">
                      {recentSessions.map((s) => (
                        <li key={s.sessionId}>
                          <button
                            type="button"
                            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-left transition-colors duration-100 hover:border-brand-line hover:bg-brand-soft/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
                            onClick={() =>
                              setTranscriptOpen({
                                sessionId: s.sessionId,
                                sessionFile: s.sessionFile,
                                projectLabel: s.projectName,
                                highlightLine: -1,
                              })
                            }
                          >
                            <span className="flex items-baseline gap-2">
                              <span className="min-w-0 truncate text-[13px] font-medium text-white">
                                {sidebarPrimaryLabel(s.projectName)}
                              </span>
                              <span className="ml-auto shrink-0 font-mono text-[11px] tabular text-zinc-600">
                                {new Date(s.mtime).toLocaleDateString(BCP47[locale])}
                              </span>
                            </span>
                            {s.preview ? (
                              <span className="mt-0.5 block truncate text-[12px] text-zinc-400">
                                {s.preview}
                              </span>
                            ) : null}
                            <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-600">
                              {s.sessionFile}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {!loading && query.trim() === '' && searchScope !== 'messages' && recentPlans.length > 0 && (
                  <section className="px-3 pb-3">
                    <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">{t('search.recentPlans')}</h3>
                    <ul className="space-y-1">
                      {recentPlans.map((pl) => (
                        <li key={pl.id}>
                          <button
                            type="button"
                            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-left transition-colors duration-100 hover:border-plan-line hover:bg-plan-bg/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-plan-text"
                            onClick={() =>
                              setPlanPreview({
                                planId: pl.id,
                                title: pl.title,
                                filePath: pl.filePath,
                              })
                            }
                          >
                            <span className="flex items-baseline gap-2">
                              <span className="min-w-0 truncate text-sm font-medium text-violet-600">
                                {pl.title}
                              </span>
                              <span className="ml-auto shrink-0 font-mono text-[11px] tabular text-zinc-600">
                                {new Date(pl.mtime).toLocaleDateString(BCP47[locale])}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-600">
                              {pl.filePath}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {!loading && query.trim() !== '' && fuzzyHits.length === 0 && (
                  <div className="m-3 rounded-md border border-dashed border-zinc-700 px-5 py-10 text-center">
                    <p className="text-sm font-medium text-white">{t('search.noResults')}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t('search.noResults.hint')}
                    </p>
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-3 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
                      >
                        {t('search.resetFilters')}
                      </button>
                    )}
                  </div>
                )}
                {fuzzyHits.map((h, i) =>
                  isPlanHit(h) ? (
                    <PlanSearchHitCard
                      key={`plan-${h.planId}`}
                      h={h}
                      active={i === activeResult}
                      onStatus={setStatus}
                    />
                  ) : (
                    <article
                      key={h.messageId}
                      className={`group border-b border-zinc-800 px-3 py-2.5 transition-colors duration-100 ${
                        i === activeResult
                          ? 'bg-brand-soft/60'
                          : 'hover:bg-zinc-900'
                      }`}
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-zinc-600">
                          <span
                            className={`rounded-[3px] px-1 py-px text-[10px] font-medium uppercase ${
                              h.role === 'user'
                                ? 'bg-brand-soft text-brand-text'
                                : 'bg-zinc-800 text-zinc-500'
                            }`}
                          >
                            {h.role === 'user' ? 'me' : h.role === 'assistant' ? 'ai' : h.role}
                          </span>
                          <span className="truncate font-sans font-medium text-zinc-300" title={h.projectSlug}>
                            {sidebarPrimaryLabel(h.projectName || h.projectSlug)}
                          </span>
                          <span className="truncate">
                            {h.sessionFile}:{h.lineIndex}
                          </span>
                          {h.tsMs ? <span className="tabular">{formatTs(h.tsMs, locale)}</span> : null}
                          {messageClassKey(h.messageClass) ? (
                            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700">
                              {t(messageClassKey(h.messageClass)!)}
                            </span>
                          ) : null}
                        </div>
                        {/* Row actions stay out of the way until the row is
                            hovered or keyboard-selected — density first. */}
                        <div
                          className={`flex shrink-0 items-center gap-1 transition-opacity duration-100 ${
                            i === activeResult
                              ? 'opacity-100'
                              : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
                          }`}
                        >
                          <label className="mr-1 flex items-center gap-1 text-[11px] text-zinc-500">
                            <input
                              type="checkbox"
                              checked={selected.has(h.messageId)}
                              onChange={() => toggleSelect(h.messageId)}
                              className="accent-brand"
                            />
                            {t('action.select')}
                          </label>
                          <button
                            type="button"
                            className={GHOST_BTN}
                            onClick={() => window.vault.copyText(h.body)}
                          >
                            {t('action.copy')}
                          </button>
                          <button
                            type="button"
                            className={GHOST_BTN}
                            onClick={() =>
                              setTranscriptOpen({
                                sessionId: h.sessionId,
                                sessionFile: h.sessionFile,
                                projectLabel: h.projectName || h.projectSlug,
                                highlightLine: h.lineIndex,
                              })
                            }
                          >
                            {t('action.session')}
                          </button>
                          <button
                            type="button"
                            className={GHOST_BTN}
                            onClick={async () => {
                              await window.vault.favoriteAdd(h.messageId)
                              setStatus(t('toast.favorited'))
                            }}
                          >
                            {t('action.favorite')}
                          </button>
                          <button
                            type="button"
                            className={GHOST_BTN}
                            onClick={async () => {
                              const name = h.body.slice(0, 40).replace(/\s+/g, ' ').trim() || t('nav.templates')
                              await window.vault.templateCreate(name, h.body)
                              setStatus(t('toast.templated'))
                            }}
                          >
                            {t('action.template')}
                          </button>
                        </div>
                      </div>
                      <p className="truncate text-[12px] text-snippet">« {h.snippet} »</p>
                      <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] text-zinc-400 [overflow-wrap:anywhere]">
                        {h.body}
                      </p>
                      <TagEditor messageId={h.messageId} tags={tags} onChange={loadTags} />
                    </article>
                  ),
                )}
              </div>
            </div>
          )}

          {tab === 'favorites' && (
            <div className="h-full overflow-y-auto p-4">
              <h2 className="mb-3 text-sm font-semibold text-white">{t('nav.favorites')}</h2>
              <div className="space-y-3">
                {favorites.length === 0 && <p className="text-sm text-zinc-500">{t('favorites.empty')}</p>}
                {favorites.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm"
                  >
                    <div className="mb-1 text-xs text-zinc-500">
                      {f.projectSlug} · {f.sessionFile} · {f.role}
                    </div>
                    <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-zinc-200">
                      {f.body}
                    </pre>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-sky-800/80 bg-sky-950/40 px-2 py-1 text-xs text-sky-100"
                        onClick={() =>
                          setTranscriptOpen({
                            sessionId: f.sessionId,
                            sessionFile: f.sessionFile,
                            projectLabel: f.projectSlug,
                            highlightLine: -1,
                          })
                        }
                      >
                        {t('transcript.title')}
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white"
                        onClick={() => window.vault.copyText(f.body)}
                      >
                        {t('action.copy')}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
                        onClick={async () => {
                          await window.vault.favoriteRemove(f.messageId)
                          await loadFavorites()
                        }}
                      >
                        {t('action.remove')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'files' && <FilesTab onOpenSession={setTranscriptOpen} />}

          {tab === 'templates' && <TemplatesTab onStatus={setStatus} />}

          {tab === 'stats' && (
            <div className="h-full overflow-y-auto p-4 text-sm">
              <h2 className="mb-3 text-sm font-semibold text-white">{t('stats.title')}</h2>
              {!stats && <p className="text-zinc-500">{t('stats.loading')}</p>}
              {stats && (
                <div className="grid gap-6 md:grid-cols-2">
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.summary')}</h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {(
                        [
                          [t('stats.projects'), stats.totalProjects],
                          [t('stats.sessions'), stats.totalSessions],
                          [t('stats.messages'), stats.totalMessages],
                        ] as const
                      ).map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5 shadow-e1"
                        >
                          <div className="text-lg font-semibold tabular text-white">
                            {value.toLocaleString()}
                          </div>
                          <div className="text-[11px] text-zinc-500">{label}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.byRole')}</h3>
                    <div className="space-y-1.5">
                      {(() => {
                        const max = Math.max(1, ...stats.messagesByRole.map((r) => r.count))
                        const label: Record<string, string> = {
                          user: t('role.me'),
                          assistant: t('role.assistant'),
                          tool: t('role.tool'),
                        }
                        return stats.messagesByRole.map((r) => (
                          <div key={r.role} className="flex items-center gap-2 text-xs">
                            <span className="w-16 shrink-0 text-zinc-400">
                              {label[r.role] ?? r.role}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-brand"
                                style={{ width: `${(r.count / max) * 100}%` }}
                              />
                            </div>
                            <span className="w-16 shrink-0 text-right tabular text-zinc-500">
                              {r.count.toLocaleString()}
                            </span>
                          </div>
                        ))
                      })()}
                    </div>
                  </section>
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.tokens')}</h3>
                    {stats.tokenTotals.input + stats.tokenTotals.output === 0 ? (
                      <p className="text-xs text-zinc-500">
                        {t('stats.tokens.empty')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {(
                          [
                            [t('stats.tokens.input'), stats.tokenTotals.input, 'text-brand-text'],
                            [t('stats.tokens.output'), stats.tokenTotals.output, 'text-sky-600'],
                            [t('stats.tokens.cacheRead'), stats.tokenTotals.cacheRead, 'text-plan-text'],
                            [t('stats.tokens.cacheCreation'), stats.tokenTotals.cacheCreation, 'text-amber-600'],
                          ] as const
                        ).map(([label, value, cls]) => (
                          <div
                            key={label}
                            className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                          >
                            <div className={`text-lg font-semibold ${cls}`}>
                              {formatCompact(value)}
                            </div>
                            <div className="text-[11px] text-zinc-500">{label} {t('stats.tokens.suffix')}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  {stats.tokensByModel.length > 0 && (
                    <section className="md:col-span-2">
                      <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.byModel')}</h3>
                      <div className="space-y-2">
                        {(() => {
                          const max = Math.max(
                            1,
                            ...stats.tokensByModel.map((m) => m.input + m.output),
                          )
                          return stats.tokensByModel.map((m) => {
                            const total = m.input + m.output
                            return (
                              <div key={m.model}>
                                <div className="mb-0.5 flex justify-between text-xs text-zinc-300">
                                  <span className="font-mono">{m.model}</span>
                                  <span className="text-zinc-500">
                                    {t('stats.byModel.turns', { turns: m.messages, tokens: formatCompact(total) })}
                                  </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                                  <div
                                    className="h-full rounded-full bg-brand"
                                    style={{ width: `${(total / max) * 100}%` }}
                                  />
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </section>
                  )}
                  <CostPanel byModel={stats.tokensByModel} />
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.topWords')}</h3>
                    <div className="flex flex-wrap gap-2">
                      {stats.topTokens.map((tok) => (
                        <span
                          key={tok.token}
                          className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300"
                        >
                          {tok.token}{' '}
                          <span className="text-zinc-500">×{tok.count}</span>
                        </span>
                      ))}
                    </div>
                  </section>
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">
                      {stats.activityFromTimestamps ? t('stats.activity.ts') : t('stats.activity.mtime')}
                    </h3>
                    {(() => {
                      const max = Math.max(1, ...stats.activityByDay.map((d) => d.count))
                      return (
                        <div className="max-h-56 space-y-1 overflow-auto pr-1 text-xs text-zinc-400">
                          {stats.activityByDay.map((d) => (
                            <div key={d.day} className="flex items-center gap-2">
                              <span className="w-20 shrink-0 font-mono text-[11px]">{d.day}</span>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                                <div
                                  className="h-full rounded-full bg-brand/70"
                                  style={{ width: `${(d.count / max) * 100}%` }}
                                />
                              </div>
                              <span className="w-10 shrink-0 text-right tabular-nums">{d.count}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </section>
                </div>
              )}
            </div>
          )}

          {tab === 'export' && (
            <div className="flex h-full flex-col gap-3 p-4">
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-400">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={excludeMeta}
                    onChange={(e) => setExcludeMeta(e.target.checked)}
                  />
                  {t('export.excludeMeta')}
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={excludeSubagents}
                    onChange={(e) => setExcludeSubagents(e.target.checked)}
                  />
                  {t('export.excludeSubagents')}
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900"
                  onClick={() => doExport('md')}
                >
                  {t('export.markdown')}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
                  onClick={() => doExport('csv')}
                >
                  {t('export.csv')}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
                  onClick={() => exportText && window.vault.copyText(exportText)}
                >
                  {t('export.copyResult')}
                </button>
              </div>
              <textarea
                readOnly
                className="min-h-0 flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200"
                value={exportText}
                placeholder={t('export.placeholder')}
              />
            </div>
          )}
        </main>

        {tab === 'search' && inspectorOpen && (
          <aside className="flex w-[276px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-900">
            <div className="flex h-11 items-center justify-between border-b border-zinc-800 px-3">
              <div>
                <h2 className="text-[12px] font-semibold text-white">{t('inspector.title')}</h2>
                <p className="text-[11px] text-zinc-500">
                  {activeFilterCount > 0 ? t('inspector.applied', { count: activeFilterCount }) : t('inspector.default')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-lg px-2 py-1 text-[11px] text-zinc-500 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
                  >
                    {t('inspector.reset')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInspectorOpen(false)}
                  aria-label={t('inspector.close')}
                  className="rounded-lg px-2 py-1 text-zinc-500 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
                >
                  ›
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              <Field label={t('inspector.precision')}>
                <Segmented
                  value={matchMode}
                  onChange={setMatchMode}
                  options={
                    [
                      ['any', t('inspector.precision.any')],
                      ['all', t('inspector.precision.all')],
                      ['phrase', t('inspector.precision.phrase')],
                    ] as const
                  }
                />
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  {matchMode === 'any'
                    ? t('inspector.precision.anyHelp')
                    : matchMode === 'all'
                      ? t('inspector.precision.allHelp')
                      : t('inspector.precision.phraseHelp')}
                </p>
              </Field>

              <Field label={t('inspector.sort')}>
                <Segmented
                  value={sortMode}
                  onChange={setSortMode}
                  options={
                    [
                      ['relevance', t('inspector.sort.relevance')],
                      ['newest', t('inspector.sort.newest')],
                      ['oldest', t('inspector.sort.oldest')],
                    ] as const
                  }
                />
              </Field>

              <Field label={t('inspector.range')}>
                <Segmented
                  value={dateRange}
                  onChange={setDateRange}
                  options={
                    [
                      ['all', t('inspector.range.all')],
                      ['24h', t('inspector.range.24h')],
                      ['7d', t('inspector.range.7d')],
                      ['30d', t('inspector.range.30d')],
                    ] as const
                  }
                />
              </Field>

              <Field label={t('inspector.role')}>
                <Segmented
                  value={role}
                  onChange={setRole}
                  disabled={searchScope === 'plans'}
                  options={
                    [
                      ['', t('inspector.role.all')],
                      ['user', t('role.me')],
                      ['assistant', t('role.assistant')],
                    ] as const
                  }
                />
              </Field>

              <Field label={t('inspector.exclude')}>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-2 text-[12px] text-zinc-300">
                    <input
                      type="checkbox"
                      checked={excludeMeta}
                      disabled={searchScope === 'plans'}
                      onChange={(e) => setExcludeMeta(e.target.checked)}
                      className="mt-0.5 accent-brand"
                    />
                    <span>
                      {t('inspector.exclude.meta')}
                      <span className="block text-[11px] text-zinc-500">{t('inspector.exclude.metaHelp')}</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-[12px] text-zinc-300">
                    <input
                      type="checkbox"
                      checked={excludeSubagents}
                      disabled={searchScope === 'plans'}
                      onChange={(e) => setExcludeSubagents(e.target.checked)}
                      className="mt-0.5 accent-brand"
                    />
                    <span>
                      {t('inspector.exclude.subagents')}
                      <span className="block text-[11px] text-zinc-500">{t('inspector.exclude.subagentsHelp')}</span>
                    </span>
                  </label>
                </div>
              </Field>

              <Field label={t('inspector.tags')}>
                <div className="flex gap-1.5">
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void createTag()
                    }}
                    placeholder={t('inspector.tags.placeholder')}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white outline-none transition duration-150 ease-out placeholder:text-zinc-500 focus:border-brand focus:bg-zinc-900 focus:ring-2 focus:ring-brand/25"
                  />
                  <button
                    type="button"
                    onClick={() => void createTag()}
                    disabled={!newTag.trim()}
                    className="shrink-0 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('inspector.tags.add')}
                  </button>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </Field>

              {searchScope !== 'messages' && (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-700">
                  플랜은 <code>~/.claude/plans</code> 아래 Markdown만 대상입니다. 왼쪽 프로젝트 필터는
                  대화 검색에만 적용됩니다.
                </p>
              )}
              {searchScope === 'all' && (
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  「전체」는 대화 히트를 먼저, 이어서 플랜 히트를 보여줍니다. 두 점수는 서로 비교되지
                  않습니다.
                </p>
              )}
            </div>
          </aside>
        )}
      </div>

      <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-zinc-800 bg-zinc-900 px-3 font-mono text-[11px] text-zinc-600">
        {status ? (
          <span className="flex items-center gap-1.5 truncate text-zinc-400">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
            {status}
          </span>
        ) : (
          <span className="text-zinc-600">{t('app.status.idle')}</span>
        )}
        <span className="ml-auto shrink-0 tabular">
          {tab === 'search' && query.trim() ? t('app.status.hits', { hits: fuzzyHits.length }) : ''}
          {t('app.status.counts', { projects: projects.length, tags: tags.length })}
        </span>
      </footer>

      {transcriptOpen && (
        <SessionTranscriptModal open={transcriptOpen} onClose={() => setTranscriptOpen(null)} />
      )}
      {planPreview && (
        <PlanMarkdownModal open={planPreview} onClose={() => setPlanPreview(null)} />
      )}
      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  )
}

function PlanSearchHitCard({
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

function PlanMarkdownModal({
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

function SessionTranscriptModal({
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

function TagEditor({
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

function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
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
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-scrim p-4 pt-[12vh]"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-e3"
        role="dialog"
        aria-modal="true"
        aria-label="명령 팔레트"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('palette.placeholder')}
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-white outline-none"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-xs text-zinc-500">{t('palette.empty')}</li>
          )}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  c.run()
                  onClose()
                }}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                  i === active ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                <span className="truncate">{c.label}</span>
                {c.hint ? <span className="ml-3 shrink-0 text-[10px] text-zinc-500">{c.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * File reverse-index. A file is normally buried inside a tool payload, so full-text
 * search rarely surfaces it — this answers "when did I last touch this file, in
 * which session, and on what branch" directly.
 */
function FilesTab({ onOpenSession }: { onOpenSession: (o: TranscriptOpen) => void }) {
  const { locale, t } = useI18n()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileRow[]>([])
  const [selected, setSelected] = useState<FileRow | null>(null)
  const [timeline, setTimeline] = useState<FileTouchRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      void window.vault.filesList(query).then((rows) => {
        if (cancelled) return
        setFiles(rows)
        setLoading(false)
      })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  useEffect(() => {
    if (!selected) {
      setTimeline([])
      return
    }
    let cancelled = false
    void window.vault.fileTimeline(selected.path).then((rows) => {
      if (!cancelled) setTimeline(rows)
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[380px] shrink-0 flex-col border-r border-zinc-800">
        <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('files.placeholder')}
              aria-label={t('files.search')}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-[13px] text-white outline-none transition duration-150 placeholder:text-zinc-600 focus:border-brand focus:bg-zinc-900 focus:ring-1 focus:ring-brand/40"
            />
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-zinc-600">
            {loading ? '…' : t('files.count', { count: files.length })}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!loading && files.length === 0 && (
            <p className="p-3 text-[12px] text-zinc-500">
              {t('files.empty')}
            </p>
          )}
          {files.map((f) => {
            const active = selected?.path === f.path
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => setSelected(f)}
                className={`block w-full border-b border-zinc-800 px-3 py-2 text-left transition-colors duration-100 ${
                  active ? 'bg-brand-soft' : 'hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={`min-w-0 truncate text-[13px] ${active ? 'font-medium text-brand-text' : 'text-white'}`}
                  >
                    {f.basename}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] tabular text-zinc-600">
                    {t('files.touches', { touches: f.touches, sessions: f.sessions })}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">{f.path}</div>
                {f.lastTouched ? (
                  <div className="mt-0.5 font-mono text-[11px] tabular text-zinc-600">
                    {formatTs(f.lastTouched, locale)}
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <p className="text-[13px] text-zinc-400">{t('files.selectPrompt')}</p>
              <p className="mt-1 text-[12px] text-zinc-600">
                {t('files.selectHint')}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2">
              <h2 className="truncate text-[13px] font-semibold text-white">{selected.basename}</h2>
              <p className="truncate font-mono text-[11px] text-zinc-600">{selected.path}</p>
            </div>
            {timeline.map((row) => (
              <article key={row.messageId} className="border-b border-zinc-800 px-3 py-2.5">
                <div className="mb-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-zinc-600">
                  <span
                    className={`rounded-[3px] px-1 py-px text-[10px] font-medium uppercase ${
                      row.role === 'user' ? 'bg-brand-soft text-brand-text' : 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {row.role === 'user' ? 'me' : row.role === 'assistant' ? 'ai' : row.role}
                  </span>
                  <span className="truncate font-sans font-medium text-zinc-300">
                    {sidebarPrimaryLabel(row.projectName)}
                  </span>
                  {row.gitBranch ? (
                    <span className="rounded-[3px] border border-zinc-800 px-1 text-[10px]">
                      {row.gitBranch}
                    </span>
                  ) : null}
                  {row.tsMs ? <span className="tabular">{formatTs(row.tsMs, locale)}</span> : null}
                  <button
                    type="button"
                    className="ml-auto text-brand-text hover:underline"
                    onClick={() =>
                      onOpenSession({
                        sessionId: row.sessionId,
                        sessionFile: row.sessionFile,
                        projectLabel: row.projectName,
                        highlightLine: row.lineIndex,
                      })
                    }
                  >
                    {t('action.openSession')}
                  </button>
                </div>
                <p className="line-clamp-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] text-zinc-400 [overflow-wrap:anywhere]">
                  {row.preview}
                </p>
              </article>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function TemplatesTab({ onStatus }: { onStatus: (s: string) => void }) {
  const t = useT()
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const list = await window.vault.templatesList()
    setTemplates(list)
    return list
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const variables = useMemo(() => extractTemplateVariables(body), [body])
  const rendered = useMemo(() => renderTemplate(body, values), [body, values])

  const startNew = () => {
    setSelectedId(null)
    setName('')
    setBody('')
    setValues({})
  }

  const openTemplate = (t: TemplateRow) => {
    setSelectedId(t.id)
    setName(t.name)
    setBody(t.body)
    setValues({})
  }

  const save = async () => {
    if (!body.trim() && !name.trim()) return
    if (selectedId == null) {
      const id = await window.vault.templateCreate(name, body)
      onStatus(t('toast.templateCreated'))
      const list = await load()
      const created = list.find((t) => t.id === id)
      if (created) openTemplate(created)
    } else {
      await window.vault.templateUpdate(selectedId, name, body)
      onStatus(t('toast.templateSaved'))
      await load()
    }
  }

  const remove = async () => {
    if (selectedId == null) return
    await window.vault.templateDelete(selectedId)
    onStatus(t('toast.templateDeleted'))
    startNew()
    await load()
  }

  const copyRendered = () => {
    void window.vault.copyText(rendered)
    onStatus(t('toast.promptCopied'))
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-zinc-800 p-3">
        <button
          type="button"
          onClick={startNew}
          className="mb-3 w-full rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
        >
          {t('templates.new')}
        </button>
        {templates.length === 0 && (
          <p className="text-xs text-zinc-500">
            {t('templates.empty')}
          </p>
        )}
        <ul className="space-y-1">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <button
                type="button"
                onClick={() => openTemplate(tpl)}
                className={`w-full truncate rounded px-2 py-1.5 text-left text-xs ${
                  selectedId === tpl.id
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-300 hover:bg-zinc-900'
                }`}
                title={tpl.name}
              >
                {tpl.name || t('templates.untitled')}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('templates.name')}
            className="min-w-[200px] flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            {t('templates.save')}
          </button>
          {selectedId != null && (
            <button
              type="button"
              onClick={() => void remove()}
              className="rounded-md border border-red-800/70 px-3 py-2 text-sm text-red-200 hover:bg-red-950/40"
            >
              {t('templates.delete')}
            </button>
          )}
        </div>
        <label className="mb-1 block text-xs text-zinc-500">
          {t('templates.bodyLabel', { token: '{{…}}' })}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('templates.bodyPlaceholder')}
          className="h-48 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-100"
        />
        {variables.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('templates.variables')}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {variables.map((v) => (
                <label key={v} className="flex flex-col gap-1 text-xs text-zinc-400">
                  {v}
                  <input
                    value={values[v] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                  />
                </label>
              ))}
            </div>
          </section>
        )}
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('templates.preview')}</h3>
            <button
              type="button"
              onClick={copyRendered}
              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
            >
              {t('templates.copyFilled')}
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-200">
            {rendered || t('templates.previewEmpty')}
          </pre>
        </section>
      </div>
    </div>
  )
}

/**
 * Estimated spend from the token counts already in the index.
 *
 * Two deliberate choices: models with no price row are *excluded* from the total
 * and called out separately (a silent 0 would read as "this was free"), and the
 * price table is editable inline because published rates move and a baked-in
 * number would quietly drift wrong.
 */
function CostPanel({ byModel }: { byModel: ModelTokenRow[] }) {
  const t = useT()
  const [prices, setPrices] = useState<ModelPrice[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ModelPrice[]>([])
  const [newModel, setNewModel] = useState('')

  useEffect(() => {
    let alive = true
    window.vault
      .pricesList()
      .then((p) => {
        if (alive) setPrices(p)
      })
      .catch(() => {
        if (alive) setPrices([])
      })
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(() => {
    if (!prices) return []
    return byModel
      // Claude Code records placeholder ids like `<synthetic>` with no usage at
      // all. Costing them contributes nothing but would inflate the
      // "unpriced models" warning, so drop anything with zero tokens.
      .filter((m) => m.input + m.output + m.cacheRead + m.cacheCreation > 0)
      .map((m) => ({
        model: m.model,
        cost: costOf(
          m.model,
          {
            input: m.input,
            output: m.output,
            cacheRead: m.cacheRead,
            cacheCreation: m.cacheCreation,
          },
          prices,
        ),
      }))
      .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1))
  }, [byModel, prices])

  const priced = rows.filter((r) => r.cost != null)
  const unpriced = rows.length - priced.length
  const total = priced.reduce((sum, r) => sum + (r.cost ?? 0), 0)
  const max = Math.max(1e-9, ...priced.map((r) => r.cost ?? 0))

  if (!prices || byModel.length === 0) return null

  const startEdit = () => {
    setDraft(prices.map((p) => ({ ...p })))
    setEditing(true)
  }

  const commit = async () => {
    setPrices(await window.vault.pricesSave(draft))
    setEditing(false)
  }

  const patch = (i: number, field: keyof ModelPrice, value: string) => {
    setDraft((d) =>
      d.map((p, idx) =>
        idx === i ? { ...p, [field]: field === 'model' ? value : Number(value) } : p,
      ),
    )
  }

  return (
    <section className="md:col-span-2">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-medium text-zinc-500">{t('cost.title')}</h3>
        <button
          type="button"
          className={`${GHOST_BTN} ml-auto`}
          onClick={() => (editing ? void commit() : startEdit())}
        >
          {editing ? t('cost.donePrices') : t('cost.editPrices')}
        </button>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-zinc-500">{t('cost.total')}</span>
          <span className="tabular text-lg font-semibold text-white">{formatUsd(total)}</span>
          {unpriced > 0 && (
            <span
              className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700"
              title={t('cost.unpriced.hint')}
            >
              {unpriced === 1 ? t('cost.unpriced.one') : t('cost.unpriced', { count: unpriced })}
            </span>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {priced.map((r) => (
            <div key={r.model}>
              <div className="mb-0.5 flex justify-between text-xs text-zinc-300">
                <span className="font-mono">{r.model}</span>
                <span className="tabular text-zinc-500">{formatUsd(r.cost ?? 0)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${((r.cost ?? 0) / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">{t('cost.disclaimer')}</p>
      </div>

      {editing && (
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <h4 className="text-[11px] font-medium text-zinc-400">{t('cost.prices.title')}</h4>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            {t('cost.prices.note', { date: PRICES_AS_OF })}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[11px]">
              <thead>
                <tr className="text-left text-zinc-600">
                  <th className="py-1 pr-2 font-medium">{t('cost.prices.model')}</th>
                  <th className="py-1 pr-2 font-medium">{t('cost.prices.input')}</th>
                  <th className="py-1 pr-2 font-medium">{t('cost.prices.output')}</th>
                  <th className="py-1 pr-2 font-medium">{t('cost.prices.cacheRead')}</th>
                  <th className="py-1 font-medium">{t('cost.prices.cacheWrite')}</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((p, i) => (
                  <tr key={p.model} className="border-t border-zinc-800">
                    <td className="py-1 pr-2 font-mono text-zinc-300">{p.model}</td>
                    {(
                      [
                        'inputPerMTok',
                        'outputPerMTok',
                        'cacheReadPerMTok',
                        'cacheWritePerMTok',
                      ] as const
                    ).map((field) => (
                      <td key={field} className="py-1 pr-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={p[field]}
                          onChange={(e) => patch(i, field, e.target.value)}
                          className="tabular w-20 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder={t('cost.prices.addPlaceholder')}
              className="w-56 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            />
            <button
              type="button"
              className={GHOST_BTN}
              disabled={!newModel.trim() || draft.some((p) => p.model === newModel.trim())}
              onClick={() => {
                setDraft((d) => [
                  ...d,
                  {
                    model: newModel.trim(),
                    inputPerMTok: 0,
                    outputPerMTok: 0,
                    cacheReadPerMTok: 0,
                    cacheWritePerMTok: 0,
                  },
                ])
                setNewModel('')
              }}
            >
              {t('cost.prices.add')}
            </button>
            <button
              type="button"
              className={`${GHOST_BTN} ml-auto`}
              onClick={async () => {
                const restored = await window.vault.pricesReset()
                setPrices(restored)
                setDraft(restored.map((p) => ({ ...p })))
              }}
            >
              {t('cost.prices.reset')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
