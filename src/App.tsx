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

type Command = { id: string; label: string; hint?: string; run: () => void }

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
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [activeResult, setActiveResult] = useState(-1)
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('vault-theme') === 'light'
      ? 'light'
      : 'dark',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
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
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">Claude Vault</h1>
          <p className="text-xs text-zinc-500">로컬 Claude Code 대화 검색 · 재사용</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-900"
            title="테마 전환"
          >
            {theme === 'dark' ? '라이트' : '다크'}
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-900"
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
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900"
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
        <aside className="w-64 shrink-0 border-r border-zinc-800 bg-zinc-950/80 p-3">
          <nav className="mb-4 flex flex-col gap-1 text-sm">
            {(
              [
                ['search', '검색'],
                ['favorites', '즐겨찾기'],
                ['templates', '템플릿'],
                ['stats', '통계'],
                ['export', '보내기'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`rounded-md px-2 py-1.5 text-left ${
                  tab === k ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">프로젝트</p>
          <div className="max-h-[40vh] space-y-1 overflow-auto pr-1 text-sm">
            <button
              type="button"
              className={`block w-full truncate rounded px-2 py-1 text-left ${
                projectId === undefined ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900'
              }`}
              onClick={() => setProjectId(undefined)}
            >
              전체
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`block w-full truncate rounded px-2 py-1 text-left ${
                  projectId === p.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900'
                }`}
                title={`${p.displayName}\n${p.path}`}
                onClick={() => setProjectId(p.id)}
              >
                <span className="flex items-center gap-1">
                  <span className="block truncate">{sidebarPrimaryLabel(p.displayName)}</span>
                  {p.tool && p.tool !== 'claude' ? (
                    <span className="shrink-0 rounded bg-amber-900/60 px-1 text-[9px] uppercase text-amber-200">
                      {p.tool}
                    </span>
                  ) : null}
                </span>
                <span className="text-[10px] text-zinc-600">
                  세션 {p.sessionCount}
                  {p.lastModified ? ` · ${new Date(p.lastModified).toLocaleDateString()}` : ''}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          {tab === 'search' && (
            <div className="flex h-full flex-col">
              <div className="border-b border-zinc-800 p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-zinc-400">
                    검색
                    <input
                      ref={searchInputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="키워드, 문장, 기억에 남는 단어…"
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none ring-emerald-500/40 focus:ring-2"
                    />
                  </label>
                  <div className="flex flex-col gap-1 text-xs text-zinc-400">
                    <span>소스</span>
                    <div className="flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
                      {(
                        [
                          ['messages', '대화'],
                          ['plans', '플랜'],
                          ['all', '전체'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setSearchScope(value)}
                          className={`rounded px-2.5 py-1.5 text-sm ${
                            searchScope === value
                              ? 'bg-zinc-700 text-white'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    역할
                    <select
                      value={role}
                      disabled={searchScope === 'plans'}
                      onChange={(e) => setRole(e.target.value as typeof role)}
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <option value="">전체</option>
                      <option value="user">user</option>
                      <option value="assistant">assistant</option>
                    </select>
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-400">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={excludeMeta}
                      disabled={searchScope === 'plans'}
                      onChange={(e) => setExcludeMeta(e.target.checked)}
                    />
                    메타 줄 제외
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={excludeSubagents}
                      disabled={searchScope === 'plans'}
                      onChange={(e) => setExcludeSubagents(e.target.checked)}
                    />
                    서브에이전트 제외
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <span>정밀도</span>
                    <div className="flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
                      {(
                        [
                          ['any', '아무거나'],
                          ['all', '모두'],
                          ['phrase', '구문'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setMatchMode(value)}
                          className={`rounded px-2 py-1 ${
                            matchMode === value ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5">
                    정렬
                    <select
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as SortMode)}
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-white"
                    >
                      <option value="relevance">관련도</option>
                      <option value="newest">최신순</option>
                      <option value="oldest">오래된순</option>
                    </select>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span>기간</span>
                    <div className="flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
                      {(
                        [
                          ['all', '전체'],
                          ['24h', '24시간'],
                          ['7d', '7일'],
                          ['30d', '30일'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDateRange(value)}
                          className={`rounded px-2 py-1 ${
                            dateRange === value ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {searchScope !== 'messages' ? (
                  <p className="mt-2 text-xs text-amber-200/70">
                    플랜 검색은 ~/.claude/plans 아래 Markdown만 대상입니다. 왼쪽 프로젝트 필터는 대화
                    검색에만 적용됩니다.
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-zinc-500">
                  검색어가 비어 있으면 아래에 최근 세션·플랜(소스에 따라)이 표시됩니다. 키워드 입력 시
                  FTS5 검색 · 대화는「세션 전체」로 JSONL 시간순 대화를 열 수 있습니다.
                </p>
                {searchScope === 'all' ? (
                  <p className="mt-1 text-xs text-zinc-600">
                    소스「전체」: 대화 히트를 먼저(점수순), 이어서 플랜 히트를 표시합니다. 두 종류의 점수는
                    서로 비교되지 않습니다.
                  </p>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {loading && <p className="text-sm text-zinc-500">검색 중…</p>}
                {!loading && query.trim() === '' && searchScope !== 'plans' && recentSessions.length > 0 && (
                  <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      최근 세션
                    </h3>
                    <ul className="space-y-1.5">
                      {recentSessions.map((s) => (
                        <li key={s.sessionId}>
                          <button
                            type="button"
                            className="w-full rounded-md border border-zinc-800/80 px-2 py-1.5 text-left text-xs hover:bg-zinc-800/60"
                            onClick={() =>
                              setTranscriptOpen({
                                sessionId: s.sessionId,
                                sessionFile: s.sessionFile,
                                projectLabel: s.projectName,
                                highlightLine: -1,
                              })
                            }
                          >
                            <span className="block truncate font-medium text-zinc-200">
                              {sidebarPrimaryLabel(s.projectName)}
                            </span>
                            <span className="block truncate text-[10px] text-zinc-500">{s.sessionFile}</span>
                            {s.preview ? (
                              <span className="mt-0.5 block truncate text-[10px] text-zinc-600">
                                {s.preview}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {!loading && query.trim() === '' && searchScope !== 'messages' && recentPlans.length > 0 && (
                  <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      최근 플랜
                    </h3>
                    <ul className="space-y-1.5">
                      {recentPlans.map((pl) => (
                        <li key={pl.id}>
                          <button
                            type="button"
                            className="w-full rounded-md border border-zinc-800/80 px-2 py-1.5 text-left text-xs hover:bg-zinc-800/60"
                            onClick={() =>
                              setPlanPreview({
                                planId: pl.id,
                                title: pl.title,
                                filePath: pl.filePath,
                              })
                            }
                          >
                            <span className="block truncate font-medium text-violet-200">{pl.title}</span>
                            <span className="block truncate text-[10px] text-zinc-500">{pl.filePath}</span>
                            <span className="mt-0.5 block text-[10px] text-zinc-600">
                              {new Date(pl.mtime).toLocaleString()}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {!loading && query.trim() !== '' && fuzzyHits.length === 0 && (
                  <p className="text-sm text-zinc-500">
                    결과가 없습니다. 필터를 완화하거나 재인덱싱을 시도해 보세요.
                  </p>
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
                      className={`rounded-lg border bg-zinc-900/40 p-4 shadow-sm ${
                        i === activeResult ? 'border-emerald-500/60 ring-2 ring-emerald-500/40' : 'border-zinc-800'
                      }`}
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-zinc-500">
                          <span className="font-medium text-emerald-400" title={h.projectSlug}>
                            {h.projectName || h.projectSlug}
                          </span>
                          <span className="mx-1">·</span>
                          <span>{h.sessionFile}</span>
                          <span className="mx-1">·</span>
                          <span className="text-zinc-400">{h.role}</span>
                          {h.tsMs ? (
                            <>
                              <span className="mx-1">·</span>
                              <span className="text-zinc-600">{formatTs(h.tsMs)}</span>
                            </>
                          ) : null}
                          {messageClassLabel(h.messageClass) ? (
                            <span className="ml-1 rounded bg-zinc-800 px-1 py-px text-[10px] text-amber-200/90">
                              {messageClassLabel(h.messageClass)}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                            onClick={() => window.vault.copyText(h.body)}
                          >
                            복사
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-sky-800/80 bg-sky-950/40 px-2 py-1 text-xs text-sky-100 hover:bg-sky-900/50"
                            onClick={() =>
                              setTranscriptOpen({
                                sessionId: h.sessionId,
                                sessionFile: h.sessionFile,
                                projectLabel: h.projectName || h.projectSlug,
                                highlightLine: h.lineIndex,
                              })
                            }
                          >
                            세션 전체
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                            onClick={async () => {
                              await window.vault.favoriteAdd(h.messageId)
                              setStatus('즐겨찾기에 추가했습니다.')
                            }}
                          >
                            즐겨찾기
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-violet-800/80 bg-violet-950/40 px-2 py-1 text-xs text-violet-100 hover:bg-violet-900/50"
                            onClick={async () => {
                              const name = h.body.slice(0, 40).replace(/\s+/g, ' ').trim() || '템플릿'
                              await window.vault.templateCreate(name, h.body)
                              setStatus('템플릿으로 저장했습니다. 템플릿 탭에서 편집하세요.')
                            }}
                          >
                            템플릿 저장
                          </button>
                          <label className="flex items-center gap-1 text-xs text-zinc-400">
                            <input
                              type="checkbox"
                              checked={selected.has(h.messageId)}
                              onChange={() => toggleSelect(h.messageId)}
                            />
                            보내기 선택
                          </label>
                        </div>
                      </div>
                      {(() => {
                        const align = chatAlignForDialog(h.role, h.messageClass)
                        return (
                          <div className={`mt-2 flex w-full min-w-0 ${chatRowFlex(align)}`}>
                            <div className={chatBubbleShellClass(align, false)}>
                              <p className="mb-2 text-sm text-amber-100/90">« {h.snippet} »</p>
                              <pre className="max-h-48 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-200 [overflow-wrap:anywhere]">
                                {h.body}
                              </pre>
                            </div>
                          </div>
                        )
                      })()}
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
                  <section>
                    <h3 className="mb-2 text-xs font-medium uppercase text-zinc-500">요약</h3>
                    <ul className="space-y-1 text-zinc-300">
                      <li>프로젝트: {stats.totalProjects}</li>
                      <li>세션: {stats.totalSessions}</li>
                      <li>메시지: {stats.totalMessages}</li>
                    </ul>
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs font-medium uppercase text-zinc-500">역할별</h3>
                    <ul className="space-y-1 text-zinc-300">
                      {stats.messagesByRole.map((r) => (
                        <li key={r.role}>
                          {r.role}: {r.count}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium uppercase text-zinc-500">토큰 사용량 (실측)</h3>
                    {stats.tokenTotals.input + stats.tokenTotals.output === 0 ? (
                      <p className="text-xs text-zinc-500">
                        토큰 사용량 데이터가 없습니다. 재인덱싱하면 어시스턴트 응답의 usage에서 수집됩니다.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {(
                          [
                            ['입력', stats.tokenTotals.input, 'text-emerald-300'],
                            ['출력', stats.tokenTotals.output, 'text-sky-300'],
                            ['캐시 읽기', stats.tokenTotals.cacheRead, 'text-violet-300'],
                            ['캐시 생성', stats.tokenTotals.cacheCreation, 'text-amber-300'],
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
                      <h3 className="mb-2 text-xs font-medium uppercase text-zinc-500">모델별 사용</h3>
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
                                <div className="h-2 overflow-hidden rounded bg-zinc-800">
                                  <div
                                    className="h-full rounded bg-emerald-600/70"
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
                    <h3 className="mb-2 text-xs font-medium uppercase text-zinc-500">자주 등장한 단어</h3>
                    <div className="flex flex-wrap gap-2">
                      {stats.topTokens.map((t) => (
                        <span
                          key={t.token}
                          className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
                        >
                          {t.token}{' '}
                          <span className="text-zinc-500">×{t.count}</span>
                        </span>
                      ))}
                    </div>
                  </section>
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium uppercase text-zinc-500">
                      {stats.activityFromTimestamps ? '메시지 타임스탬프 기준 활동' : '세션 수정일 기준 활동'}
                    </h3>
                    {(() => {
                      const max = Math.max(1, ...stats.activityByDay.map((d) => d.count))
                      return (
                        <div className="max-h-56 space-y-1 overflow-auto pr-1 text-xs text-zinc-400">
                          {stats.activityByDay.map((d) => (
                            <div key={d.day} className="flex items-center gap-2">
                              <span className="w-20 shrink-0 font-mono text-[11px]">{d.day}</span>
                              <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-900">
                                <div
                                  className="h-full rounded bg-sky-700/70"
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
                className="min-h-0 flex-1 resize-none rounded-md border border-zinc-800 bg-black/50 p-3 font-mono text-xs text-zinc-200"
                value={exportText}
                placeholder="검색 탭에서 메시지를 선택한 뒤 Markdown/CSV를 누르면 여기에 표시됩니다."
              />
            </div>
          )}
        </main>
      </div>

      <footer className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
        <div className="flex flex-wrap items-center gap-3">
          <span>{status}</span>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="새 태그 이름"
              className="min-w-[120px] flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white"
            />
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200"
              onClick={() => void createTag()}
            >
              태그 생성
            </button>
          </div>
        </div>
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

  return (
    <article
      className={`rounded-lg border bg-violet-950/20 p-4 shadow-sm ${
        active ? 'border-emerald-500/60 ring-2 ring-emerald-500/40' : 'border-violet-900/50'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-zinc-500">
          <span className="font-medium text-violet-300">플랜</span>
          <span className="mx-1">·</span>
          <span className="text-zinc-300" title={h.filePath}>
            {h.title}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
            onClick={() => void copyFull()}
          >
            전체 복사
          </button>
          <button
            type="button"
            className="rounded-md border border-violet-700 px-2 py-1 text-xs text-violet-100 hover:bg-violet-950/80"
            onClick={() => void toggle()}
          >
            {expanded ? '접기' : '본문 보기'}
          </button>
        </div>
      </div>
      <p className="mb-1 font-mono text-[10px] text-zinc-600">{h.filePath}</p>
      <p className="mb-2 text-sm text-amber-100/90">« {h.snippet} »</p>
      {expanded && body !== null ? (
        <div className="max-h-64 overflow-auto rounded bg-black/40 p-3">
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-violet-800/60 bg-zinc-950 shadow-xl"
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
              className="rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              onClick={() => void window.vault.copyText(body)}
            >
              전체 복사
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
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
      (m) =>
        (showMeta || m.messageClass !== 'meta') &&
        (showToolResults || m.role !== 'tool'),
    )
  }, [rows, showMeta, showToolResults])

  const toolRowCount = useMemo(() => rows.filter((m) => m.role === 'tool').length, [rows])

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-xl"
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
                도구 결과 표시{toolRowCount > 0 ? ` (${toolRowCount})` : ''}
              </label>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              onClick={() => copyAll()}
            >
              전체 복사
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
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
              hiddenTools ? `도구 결과 ${hiddenTools}개` : '',
            ].filter(Boolean)
            return <p className="mb-2 text-[11px] text-zinc-500">{bits.join(' · ')} 숨김</p>
          })()}
          {visibleRows.map((m) => {
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
                          isUser ? 'bg-emerald-900/80 text-emerald-200' : 'bg-sky-900/60 text-sky-200'
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
                  {showMarkdown && m.messageClass === 'dialog' ? (
                    <div className="max-h-[min(70vh,32rem)] max-w-full overflow-auto">
                      <Markdown>{m.body}</Markdown>
                    </div>
                  ) : (
                    <pre className="max-h-[min(70vh,32rem)] max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-zinc-200 [overflow-wrap:anywhere]">
                      {m.body}
                    </pre>
                  )}
                </div>
              </div>
            )
          })}
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
    return <p className="mt-2 text-[11px] text-zinc-600">태그가 없습니다. 하단에서 생성하세요.</p>
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {tags.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => void toggle(t.id)}
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            selected.includes(t.id)
              ? 'bg-emerald-700 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
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
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
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
          본문 — <code className="text-violet-300">{'{{변수}}'}</code> 형태로 채울 자리를 표시하세요.
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'예) {{언어}}로 작성된 {{파일}}을 리뷰하고 개선점을 제안해줘.'}
          className="h-48 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-100"
        />
        {variables.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">변수 채우기</h3>
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
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-200">
            {rendered || '본문을 입력하면 여기에 미리보기가 표시됩니다.'}
          </pre>
        </section>
      </div>
    </div>
  )
}
