import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import type {
  FavoriteRow,
  IndexProgress,
  MatchMode,
  MessageClass,
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

type Tab = 'search' | 'favorites' | 'templates' | 'stats' | 'export'

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

type TabIcon = 'search' | 'star' | 'template' | 'chart' | 'export' | 'folder'

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

const NAV_GROUPS: { label: string; items: { key: Tab; label: string; icon: TabIcon }[] }[] = [
  {
    label: '탐색',
    items: [
      { key: 'search', label: '검색', icon: 'search' },
      { key: 'favorites', label: '즐겨찾기', icon: 'star' },
      { key: 'templates', label: '템플릿', icon: 'template' },
    ],
  },
  {
    label: '분석',
    items: [
      { key: 'stats', label: '통계', icon: 'chart' },
      { key: 'export', label: '보내기', icon: 'export' },
    ],
  },
]

/** Rows rendered per transcript page, and the point where a body gets clamped. */
const TRANSCRIPT_PAGE = 150
const MAX_INLINE_BODY = 8000

/** A single message body can exceed 700 KB; clamp it behind an explicit expand. */
function TranscriptBody({ body, markdown }: { body: string; markdown: boolean }) {
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
            ? '접기'
            : `${(body.length / 1024).toFixed(0)}KB 중 ${(MAX_INLINE_BODY / 1024).toFixed(0)}KB 표시 — 전체 보기`}
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
function formatTs(ms: number | null | undefined): string {
  if (ms == null) return ''
  return new Date(ms).toLocaleString()
}

/** 1_234_567 → "1.2M", 12_300 → "12.3K" — compact token counts for stat tiles. */
function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function messageClassLabel(c: MessageClass): string | null {
  if (c === 'meta') return '메타'
  if (c === 'other') return '기타'
  return null
}

export default function App() {
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
        ['search', '검색'],
        ['favorites', '즐겨찾기'],
        ['templates', '템플릿'],
        ['stats', '통계'],
        ['export', '보내기'],
      ] as const
    ).map(([k, label]) => ({ id: `tab:${k}`, label: `이동: ${label}`, hint: '탭', run: () => setTab(k) }))
    const actions: Command[] = [
      { id: 'proj:all', label: '프로젝트: 전체', hint: '필터', run: () => setProjectId(undefined) },
      {
        id: 'action:reindex',
        label: '재인덱싱',
        hint: '액션',
        run: () => {
          void window.vault.reindex()
        },
      },
      {
        id: 'action:focus-search',
        label: '검색창 포커스',
        hint: '액션',
        run: () => {
          setTab('search')
          setTimeout(() => searchInputRef.current?.focus(), 0)
        },
      },
    ]
    const projCmds: Command[] = projects.map((p) => ({
      id: `proj:${p.id}`,
      label: `프로젝트: ${sidebarPrimaryLabel(p.displayName)}`,
      hint: '필터',
      run: () => {
        setProjectId(p.id)
        setTab('search')
      },
    }))
    return [...tabCmds, ...actions, ...projCmds]
  }, [projects])

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
      setStatus('보낼 메시지를 선택하세요.')
      return
    }
    const text = await window.vault.exportMessages(ids, format, {
      excludeMeta,
      excludeSubagents,
    })
    setExportText(text)
    setTab('export')
    setStatus('보내기 완료')
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
          <span className="truncate text-[11px] text-zinc-500">로컬 대화 인덱스</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
            title="테마 전환"
          >
            {theme === 'dark' ? '라이트' : '다크'}
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded-md border border-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-500 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
            title="명령 팔레트"
          >
            ⌘K
          </button>
          {indexProgress && (
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              {indexProgress.phase === 'plans'
                ? '플랜 인덱싱…'
                : `인덱싱 ${indexProgress.current}/${indexProgress.total}`}
            </span>
          )}
          <button
            type="button"
            className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg transition-colors duration-150 ease-out hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            onClick={async () => {
              const r = await window.vault.reindex()
              setStatus(
                `재인덱싱 완료: 프로젝트 ${r.projects}, 세션 ${r.sessions}, 플랜 파일 ${r.planFiles}. 메타/역할 분류는 새 인덱스에 반영됩니다.`,
              )
              await loadProjects()
              await loadRecentSessions()
              await loadRecentPlans()
              await runSearch()
            }}
          >
            재인덱싱
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
          <nav className="space-y-3 p-2">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">{group.label}</p>
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
                        {item.label}
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
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">프로젝트</p>
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
                전체 프로젝트
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
                      placeholder="키워드, 문장, 기억에 남는 단어…"
                      aria-label="검색어"
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-[13px] text-white outline-none transition duration-150 ease-out placeholder:text-zinc-600 focus:border-brand focus:bg-zinc-900 focus:ring-1 focus:ring-brand/40"
                    />
                  </div>
                  <Segmented
                    value={searchScope}
                    onChange={setSearchScope}
                    options={
                      [
                        ['messages', '대화'],
                        ['plans', '플랜'],
                        ['all', '전체'],
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
                    필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
                  </button>
                </div>
                <p className="mt-1.5 font-mono text-[11px] text-zinc-600">
                  {query.trim()
                    ? `${fuzzyHits.length}건${loading ? ' · 검색 중…' : ''}`
                    : '검색어를 비우면 최근 세션과 플랜을 보여줍니다.'}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading && <p className="p-3 font-mono text-[11px] text-zinc-500">검색 중…</p>}
                {!loading && query.trim() === '' && searchScope !== 'plans' && recentSessions.length > 0 && (
                  <section className="p-3">
                    <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">최근 세션</h3>
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
                                {new Date(s.mtime).toLocaleDateString()}
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
                    <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">최근 플랜</h3>
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
                                {new Date(pl.mtime).toLocaleDateString()}
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
                    <p className="text-sm font-medium text-white">일치하는 결과가 없습니다</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      정밀도를 「아무거나」로 낮추거나 기간 필터를 넓혀 보세요.
                    </p>
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-3 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
                      >
                        필터 초기화
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
                          {h.tsMs ? <span className="tabular">{formatTs(h.tsMs)}</span> : null}
                          {messageClassLabel(h.messageClass) ? (
                            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700">
                              {messageClassLabel(h.messageClass)}
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
                            선택
                          </label>
                          <button
                            type="button"
                            className={GHOST_BTN}
                            onClick={() => window.vault.copyText(h.body)}
                          >
                            복사
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
                            세션
                          </button>
                          <button
                            type="button"
                            className={GHOST_BTN}
                            onClick={async () => {
                              await window.vault.favoriteAdd(h.messageId)
                              setStatus('즐겨찾기에 추가했습니다.')
                            }}
                          >
                            즐겨찾기
                          </button>
                          <button
                            type="button"
                            className={GHOST_BTN}
                            onClick={async () => {
                              const name = h.body.slice(0, 40).replace(/\s+/g, ' ').trim() || '템플릿'
                              await window.vault.templateCreate(name, h.body)
                              setStatus('템플릿으로 저장했습니다. 템플릿 탭에서 편집하세요.')
                            }}
                          >
                            템플릿
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
              <h2 className="mb-3 text-sm font-semibold text-white">즐겨찾기</h2>
              <div className="space-y-3">
                {favorites.length === 0 && <p className="text-sm text-zinc-500">비어 있습니다.</p>}
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
                        세션 전체
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white"
                        onClick={() => window.vault.copyText(f.body)}
                      >
                        복사
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
                        onClick={async () => {
                          await window.vault.favoriteRemove(f.messageId)
                          await loadFavorites()
                        }}
                      >
                        제거
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'templates' && <TemplatesTab onStatus={setStatus} />}

          {tab === 'stats' && (
            <div className="h-full overflow-y-auto p-4 text-sm">
              <h2 className="mb-3 text-sm font-semibold text-white">사용 통계</h2>
              {!stats && <p className="text-zinc-500">불러오는 중…</p>}
              {stats && (
                <div className="grid gap-6 md:grid-cols-2">
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">요약</h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {(
                        [
                          ['프로젝트', stats.totalProjects],
                          ['세션', stats.totalSessions],
                          ['메시지', stats.totalMessages],
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
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">역할별 메시지</h3>
                    <div className="space-y-1.5">
                      {(() => {
                        const max = Math.max(1, ...stats.messagesByRole.map((r) => r.count))
                        const label: Record<string, string> = {
                          user: '나',
                          assistant: 'Claude',
                          tool: '도구',
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
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">토큰 사용량 (실측)</h3>
                    {stats.tokenTotals.input + stats.tokenTotals.output === 0 ? (
                      <p className="text-xs text-zinc-500">
                        토큰 사용량 데이터가 없습니다. 재인덱싱하면 어시스턴트 응답의 usage에서 수집됩니다.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {(
                          [
                            ['입력', stats.tokenTotals.input, 'text-brand-text'],
                            ['출력', stats.tokenTotals.output, 'text-sky-600'],
                            ['캐시 읽기', stats.tokenTotals.cacheRead, 'text-plan-text'],
                            ['캐시 생성', stats.tokenTotals.cacheCreation, 'text-amber-600'],
                          ] as const
                        ).map(([label, value, cls]) => (
                          <div
                            key={label}
                            className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                          >
                            <div className={`text-lg font-semibold ${cls}`}>
                              {formatCompact(value)}
                            </div>
                            <div className="text-[11px] text-zinc-500">{label} 토큰</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  {stats.tokensByModel.length > 0 && (
                    <section className="md:col-span-2">
                      <h3 className="mb-2 text-xs font-medium text-zinc-500">모델별 사용</h3>
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
                                    {m.messages}턴 · {formatCompact(total)} 토큰
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
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">자주 등장한 단어</h3>
                    <div className="flex flex-wrap gap-2">
                      {stats.topTokens.map((t) => (
                        <span
                          key={t.token}
                          className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300"
                        >
                          {t.token}{' '}
                          <span className="text-zinc-500">×{t.count}</span>
                        </span>
                      ))}
                    </div>
                  </section>
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">
                      {stats.activityFromTimestamps ? '메시지 타임스탬프 기준 활동' : '세션 수정일 기준 활동'}
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
                  보내기 시 메타 줄 제외
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={excludeSubagents}
                    onChange={(e) => setExcludeSubagents(e.target.checked)}
                  />
                  서브에이전트 제외
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900"
                  onClick={() => doExport('md')}
                >
                  Markdown 보내기
                </button>
                <button
                  type="button"
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
                  onClick={() => doExport('csv')}
                >
                  CSV 보내기
                </button>
                <button
                  type="button"
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
                  onClick={() => exportText && window.vault.copyText(exportText)}
                >
                  결과 복사
                </button>
              </div>
              <textarea
                readOnly
                className="min-h-0 flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200"
                value={exportText}
                placeholder="검색 탭에서 메시지를 선택한 뒤 Markdown/CSV를 누르면 여기에 표시됩니다."
              />
            </div>
          )}
        </main>

        {tab === 'search' && inspectorOpen && (
          <aside className="flex w-[276px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-900">
            <div className="flex h-11 items-center justify-between border-b border-zinc-800 px-3">
              <div>
                <h2 className="text-[12px] font-semibold text-white">검색 설정</h2>
                <p className="text-[11px] text-zinc-500">
                  {activeFilterCount > 0 ? `${activeFilterCount}개 적용됨` : '기본값'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-lg px-2 py-1 text-[11px] text-zinc-500 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
                  >
                    초기화
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInspectorOpen(false)}
                  aria-label="검색 설정 닫기"
                  className="rounded-lg px-2 py-1 text-zinc-500 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
                >
                  ›
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              <Field label="정밀도">
                <Segmented
                  value={matchMode}
                  onChange={setMatchMode}
                  options={
                    [
                      ['any', '아무거나'],
                      ['all', '모두'],
                      ['phrase', '구문'],
                    ] as const
                  }
                />
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  {matchMode === 'any'
                    ? '단어 중 하나라도 있으면 찾습니다.'
                    : matchMode === 'all'
                      ? '모든 단어를 포함한 결과만 찾습니다.'
                      : '입력한 문장 그대로를 찾습니다.'}
                </p>
              </Field>

              <Field label="정렬">
                <Segmented
                  value={sortMode}
                  onChange={setSortMode}
                  options={
                    [
                      ['relevance', '관련도'],
                      ['newest', '최신'],
                      ['oldest', '오래된'],
                    ] as const
                  }
                />
              </Field>

              <Field label="기간">
                <Segmented
                  value={dateRange}
                  onChange={setDateRange}
                  options={
                    [
                      ['all', '전체'],
                      ['24h', '24시간'],
                      ['7d', '7일'],
                      ['30d', '30일'],
                    ] as const
                  }
                />
              </Field>

              <Field label="역할">
                <Segmented
                  value={role}
                  onChange={setRole}
                  disabled={searchScope === 'plans'}
                  options={
                    [
                      ['', '전체'],
                      ['user', '나'],
                      ['assistant', 'Claude'],
                    ] as const
                  }
                />
              </Field>

              <Field label="제외">
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
                      메타 줄
                      <span className="block text-[11px] text-zinc-500">권한·제목 등 시스템 기록</span>
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
                      서브에이전트
                      <span className="block text-[11px] text-zinc-500">subagents 경로의 로그</span>
                    </span>
                  </label>
                </div>
              </Field>

              <Field label="태그">
                <div className="flex gap-1.5">
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void createTag()
                    }}
                    placeholder="새 태그 이름"
                    className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white outline-none transition duration-150 ease-out placeholder:text-zinc-500 focus:border-brand focus:bg-zinc-900 focus:ring-2 focus:ring-brand/25"
                  />
                  <button
                    type="button"
                    onClick={() => void createTag()}
                    disabled={!newTag.trim()}
                    className="shrink-0 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    추가
                  </button>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t.id}
                        className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400"
                      >
                        {t.name}
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
          <span className="text-zinc-600">idle</span>
        )}
        <span className="ml-auto shrink-0 tabular">
          {tab === 'search' && query.trim() ? `hits ${fuzzyHits.length} · ` : ''}
          projects {projects.length} · tags {tags.length}
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
    onStatus('플랜 전체를 복사했습니다.')
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
          <span className="tabular">{new Date(h.mtime).toLocaleDateString()}</span>
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
            {expanded ? '접기' : '본문'}
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
        if (!cancelled) setErr('플랜 본문을 불러오지 못했습니다.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [open.planId])

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
              전체 복사
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg transition-colors duration-150 ease-out hover:bg-brand-hover"
              onClick={onClose}
            >
              닫기
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
        if (!cancelled) setLoadErr('세션을 불러오지 못했습니다.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [open.sessionId])

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
              세션 전체
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
              한 JSONL 세션의 인덱스 순서 (최대 25,000줄) · Esc 로 닫기
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                <input type="checkbox" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} />
                메타 줄 표시 (권한·제목 등)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={showMarkdown}
                  onChange={(e) => setShowMarkdown(e.target.checked)}
                />
                마크다운 렌더링
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={showToolResults}
                  onChange={(e) => setShowToolResults(e.target.checked)}
                />
                도구 호출·결과 표시{toolRowCount > 0 ? ` (${toolRowCount})` : ''}
              </label>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors duration-150 ease-out hover:bg-zinc-950 hover:text-zinc-200"
              onClick={() => copyAll()}
            >
              전체 복사
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg transition-colors duration-150 ease-out hover:bg-brand-hover"
              onClick={onClose}
            >
              닫기
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
              hiddenMeta ? `메타 ${hiddenMeta}개` : '',
              hiddenTools ? `도구 ${hiddenTools}개` : '',
            ].filter(Boolean)
            return <p className="mb-2 text-[11px] text-zinc-500">{bits.join(' · ')} 숨김</p>
          })()}
          {shownRows.map((m) => {
            const isHi = m.lineIndex === open.highlightLine
            const align = chatAlignForDialog(m.role, m.messageClass)
            const isUser = m.role === 'user'
            const mc = messageClassLabel(m.messageClass)
            return (
              <div key={m.messageId} className={`mb-2 flex w-full min-w-0 ${chatRowFlex(align)}`}>
                <div
                  ref={isHi ? highlightRef : undefined}
                  className={`${chatBubbleShellClass(align, isHi)} ${m.messageClass === 'meta' ? 'opacity-90' : ''}`}
                  aria-label={`${m.role} · 줄 ${m.lineIndex}`}
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
                    {mc ? (
                      <span className="rounded bg-zinc-800 px-1 text-[10px] text-amber-200/80">{mc}</span>
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
              {shownRows.length.toLocaleString()} / {visibleRows.length.toLocaleString()} 행 —
              스크롤하면 더 불러옵니다
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
    return <p className="mt-1 text-[11px] text-zinc-600">태그 없음 — 우측 패널에서 추가</p>
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {tags.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => void toggle(t.id)}
          className={`rounded-[3px] border px-1.5 py-px text-[10px] transition-colors duration-100 ${
            selected.includes(t.id)
              ? 'border-brand-line bg-brand-soft font-medium text-brand-text'
              : 'border-zinc-800 text-zinc-600 hover:border-brand-line hover:text-zinc-300'
          }`}
        >
          {t.name}
        </button>
      ))}
    </div>
  )
}

function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
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
          placeholder="명령·프로젝트·탭 검색…  (Esc 닫기)"
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-white outline-none"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-xs text-zinc-500">일치하는 명령이 없습니다.</li>
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

function TemplatesTab({ onStatus }: { onStatus: (s: string) => void }) {
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
      onStatus('템플릿을 만들었습니다.')
      const list = await load()
      const created = list.find((t) => t.id === id)
      if (created) openTemplate(created)
    } else {
      await window.vault.templateUpdate(selectedId, name, body)
      onStatus('템플릿을 저장했습니다.')
      await load()
    }
  }

  const remove = async () => {
    if (selectedId == null) return
    await window.vault.templateDelete(selectedId)
    onStatus('템플릿을 삭제했습니다.')
    startNew()
    await load()
  }

  const copyRendered = () => {
    void window.vault.copyText(rendered)
    onStatus('채워진 프롬프트를 복사했습니다.')
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-zinc-800 p-3">
        <button
          type="button"
          onClick={startNew}
          className="mb-3 w-full rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
        >
          + 새 템플릿
        </button>
        {templates.length === 0 && (
          <p className="text-xs text-zinc-500">
            아직 템플릿이 없습니다. 검색 결과의 「템플릿 저장」이나 위 버튼으로 만들 수 있습니다.
          </p>
        )}
        <ul className="space-y-1">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => openTemplate(t)}
                className={`w-full truncate rounded px-2 py-1.5 text-left text-xs ${
                  selectedId === t.id ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'
                }`}
                title={t.name}
              >
                {t.name || '무제 템플릿'}
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
            placeholder="템플릿 이름"
            className="min-w-[200px] flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            저장
          </button>
          {selectedId != null && (
            <button
              type="button"
              onClick={() => void remove()}
              className="rounded-md border border-red-800/70 px-3 py-2 text-sm text-red-200 hover:bg-red-950/40"
            >
              삭제
            </button>
          )}
        </div>
        <label className="mb-1 block text-xs text-zinc-500">
          본문 — <code className="text-plan-text">{'{{변수}}'}</code> 형태로 채울 자리를 표시하세요.
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'예) {{언어}}로 작성된 {{파일}}을 리뷰하고 개선점을 제안해줘.'}
          className="h-48 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-100"
        />
        {variables.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-2 text-xs font-medium text-zinc-500">변수 채우기</h3>
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
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">미리보기</h3>
            <button
              type="button"
              onClick={copyRendered}
              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
            >
              채워서 복사
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-200">
            {rendered || '본문을 입력하면 여기에 미리보기가 표시됩니다.'}
          </pre>
        </section>
      </div>
    </div>
  )
}
