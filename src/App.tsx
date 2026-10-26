import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import type {
  FavoriteRow,
  IndexProgress,
  UpdateStatus,
  MatchMode,
  PlanListRow,
  ProjectRow,
  RecentSessionRow,
  SearchScope,
  SortMode,
  StatsPayload,
  TagRow,
  UnifiedSearchHit,
} from '../shared/ipc'
import { isMessageHit, isPlanHit } from './chatBubbleLayout'
import { useI18n } from './i18n'
import { BCP47, LOCALES, LOCALE_LABEL, type MessageKey } from '../shared/i18n'
import { Field, GHOST_BTN, Icon, Segmented, sidebarPrimaryLabel, type TabIcon } from './ui'
import { formatTs, messageClassKey, sinceMsFor, type DateRange } from './format'
import type { Command, PlanPreviewOpen, Tab, TranscriptOpen } from './types'
import { SessionTranscriptModal } from './components/SessionTranscriptModal'
import { PlanMarkdownModal, PlanSearchHitCard } from './components/PlanViews'
import { TagEditor } from './components/TagEditor'
import { CommandPalette } from './components/CommandPalette'
import { FilesTab } from './tabs/FilesTab'
import { TemplatesTab } from './tabs/TemplatesTab'
import { StatsTab } from './tabs/StatsTab'

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
            <StatsTab stats={stats} />
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
