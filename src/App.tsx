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
import { BCP47, type MessageKey } from '../shared/i18n'
import {
  Field,
  GHOST_BTN,
  Icon,
  PageHeader,
  ProjectPicker,
  Rail,
  RailButton,
  RoleBadge,
  Segmented,
  Snippet,
  Toast,
  World,
  sidebarPrimaryLabel,
  toggleTheme,
  type RailItem,
} from './ui'
import { formatTs, messageClassKey, sinceMsFor, type DateRange } from './format'
import type { Command, PlanPreviewOpen, Tab, TranscriptOpen } from './types'
import { SessionTranscriptModal } from './components/SessionTranscriptModal'
import { PlanMarkdownModal, PlanSearchHitCard } from './components/PlanViews'
import { TagEditor } from './components/TagEditor'
import { CommandPalette } from './components/CommandPalette'
import { FilesTab } from './tabs/FilesTab'
import { TemplatesTab } from './tabs/TemplatesTab'
import { StatsTab } from './tabs/StatsTab'
import { PromptsTab } from './tabs/PromptsTab'
import { SettingsTab } from './tabs/SettingsTab'
import { FavoritesTab } from './tabs/FavoritesTab'
import { ExportTab } from './tabs/ExportTab'

/** Main rail, top to bottom. Settings and the theme switch sit in the rail footer. */
const RAIL: { key: Tab; labelKey: MessageKey; icon: RailItem<Tab>['icon'] }[] = [
  { key: 'search', labelKey: 'nav.search', icon: 'search' },
  { key: 'prompts', labelKey: 'nav.prompts', icon: 'prompt' },
  { key: 'files', labelKey: 'nav.files', icon: 'file' },
  { key: 'favorites', labelKey: 'nav.favorites', icon: 'star' },
  { key: 'templates', labelKey: 'nav.templates', icon: 'template' },
  { key: 'stats', labelKey: 'nav.stats', icon: 'chart' },
  { key: 'export', labelKey: 'nav.export', icon: 'export' },
]

const PAGE_SUB: Record<Exclude<Tab, 'search'>, MessageKey> = {
  prompts: 'prompts.subtitle',
  files: 'page.files.sub',
  favorites: 'page.favorites.sub',
  templates: 'page.templates.sub',
  stats: 'page.stats.sub',
  export: 'page.export.sub',
  settings: 'page.settings.sub',
}

/** Fuzzy re-ranking may only reorder the FTS results, never drop one. */
function fuzzyReorder<T>(items: T[], keys: string[], query: string): T[] {
  const fuse = new Fuse(items, { keys, threshold: 0.42, ignoreLocation: true })
  const matched = fuse.search(query).map((r) => r.item)
  if (!matched.length) return items
  const seen = new Set(matched)
  return [...matched, ...items.filter((h) => !seen.has(h))]
}

export default function App() {
  const { locale, t } = useI18n()
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
  // On by default: tool output is ~40% of conversation rows and outranks the prose
  // people actually look for. Untick to search command output and file dumps.
  const [excludeTools, setExcludeTools] = useState(true)
  const [tagFilter, setTagFilter] = useState<number | undefined>(undefined)
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<number | null>(null)
  const [exportFormat, setExportFormat] = useState<'md' | 'csv'>('md')
  /** Bumped on every index change so self-loading tabs (prompts) refresh. */
  const [refreshKey, setRefreshKey] = useState(0)
  const [recentSessions, setRecentSessions] = useState<RecentSessionRow[]>([])
  const [recentPlans, setRecentPlans] = useState<PlanListRow[]>([])
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [activeResult, setActiveResult] = useState(-1)
  // public/theme-init.js applied the saved (or OS) theme before first paint.
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
  const clearStatus = useCallback(() => setStatus(''), [])

  /** Sequence number of the latest search request; older responses are ignored. */
  const searchSeq = useRef(0)
  const searchParamsRef = useRef({
    query,
    projectId,
    role,
    excludeMeta,
    excludeSubagents,
    excludeTools,
    tagFilter,
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
    excludeTools,
    tagFilter,
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
    const seq = ++searchSeq.current
    if (!query.trim() && tagFilter == null) {
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
        excludeTools,
        tagId: tagFilter,
        scope: searchScope,
        matchMode,
        sort: sortMode,
        sinceMs: sinceMsFor(dateRange),
      })
      // Only the newest request may touch the list; older ones may resolve later or as
      // `null` (superseded while queued behind a slow search).
      if (seq === searchSeq.current && raw) setHits(raw)
    } finally {
      if (seq === searchSeq.current) setLoading(false)
    }
  }, [query, projectId, role, excludeMeta, excludeSubagents, excludeTools, tagFilter, searchScope, matchMode, sortMode, dateRange])

  // Fuse only refines relevance order; a time sort must stay a time sort.
  const fuzzyHits = useMemo(() => {
    const q = query.trim()
    if (!q || hits.length === 0 || sortMode !== 'relevance') return hits
    if (hits.every(isPlanHit)) return fuzzyReorder(hits, ['title', 'snippet', 'filePath'], q)
    if (!hits.every(isMessageHit)) return hits
    return fuzzyReorder(hits, ['body', 'snippet', 'projectSlug', 'projectName'], q)
  }, [hits, query, sortMode])

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
    if (!excludeTools) n += 1
    if (tagFilter != null) n += 1
    return n
  }, [role, matchMode, sortMode, dateRange, excludeMeta, excludeSubagents, excludeTools, tagFilter])

  const resetFilters = useCallback(() => {
    setRole('')
    setMatchMode('any')
    setSortMode('relevance')
    setDateRange('all')
    setExcludeMeta(true)
    setExcludeSubagents(false)
    setExcludeTools(true)
    setTagFilter(undefined)
  }, [])

  useEffect(() => {
    setActiveResult(-1)
  }, [query, searchScope, projectId, tagFilter, hits])

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
        ['prompts', 'nav.prompts'],
        ['files', 'nav.files'],
        ['favorites', 'nav.favorites'],
        ['templates', 'nav.templates'],
        ['stats', 'nav.stats'],
        ['export', 'nav.export'],
        ['settings', 'nav.settings'],
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
      setRefreshKey((k) => k + 1)
      void (async () => {
        const p = searchParamsRef.current
        const seq = ++searchSeq.current
        if (!p.query.trim() && p.tagFilter == null) {
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
          excludeTools: p.excludeTools,
          tagId: p.tagFilter,
          scope: p.searchScope,
          matchMode: p.matchMode,
          sort: p.sortMode,
          sinceMs: sinceMsFor(p.dateRange),
        })
        if (seq === searchSeq.current && raw) setHits(raw)
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
    setExportFormat(format)
    setExportText(text)
    setTab('export')
    setStatus(t('toast.exported'))
  }

  const deleteTag = async (id: number) => {
    if (confirmDeleteTag !== id) {
      setConfirmDeleteTag(id)
      return
    }
    setConfirmDeleteTag(null)
    await window.vault.tagDelete(id)
    if (tagFilter === id) setTagFilter(undefined)
    setStatus(t('toast.tagDeleted'))
    await loadTags()
    await runSearch()
  }

  /** Large bodies arrive clamped; copy and template actions fetch the full text. */
  const fullBody = async (h: { messageId: number; body: string; bodyTruncated: boolean }) =>
    h.bodyTruncated ? window.vault.messageBody(h.messageId) : h.body

  const toggleFavorite = async (h: { messageId: number; msgKey: string; isFavorite: boolean }) => {
    if (h.isFavorite) {
      await window.vault.favoriteRemove(h.msgKey)
      setStatus(t('toast.unfavorited'))
    } else {
      await window.vault.favoriteAdd(h.messageId)
      setStatus(t('toast.favorited'))
    }
    setHits((prev) =>
      prev.map((x) => (isMessageHit(x) && x.msgKey === h.msgKey ? { ...x, isFavorite: !h.isFavorite } : x)),
    )
  }

  const archivedSessions = useMemo(() => projects.reduce((n, p) => n + p.archivedCount, 0), [projects])

  const createTag = async () => {
    const name = newTag.trim()
    if (!name) return
    await window.vault.tagCreate(name, null)
    setNewTag('')
    await loadTags()
  }


  const totalSessions = useMemo(() => projects.reduce((n, p) => n + p.sessionCount, 0), [projects])
  const railItems = useMemo(() => RAIL.map((r) => ({ key: r.key, label: t(r.labelKey), icon: r.icon })), [t])
  const searching = query.trim() !== '' || tagFilter != null

  const openHit = (h: UnifiedSearchHit) => {
    if (isPlanHit(h)) setPlanPreview({ planId: h.planId, title: h.title, filePath: h.filePath })
    else
      setTranscriptOpen({
        sessionId: h.sessionId,
        sessionFile: h.sessionFile,
        projectLabel: h.projectName || h.projectSlug,
        highlightLine: h.lineIndex,
      })
  }

  /** Index and update state, one glance in the header. */
  const statusPill = (
    <div className="pill glass" role="status" aria-live="polite">
      {indexProgress ? (
        <>
          <span className="dot tone-amber pulse" aria-hidden />
          <span className="font-semibold text-ink-2">
            {indexProgress.phase === 'plans'
              ? t('app.indexing.plans')
              : t('app.indexing', { current: indexProgress.current, total: indexProgress.total })}
          </span>
        </>
      ) : (
        <>
          <span className="dot tone-green" aria-hidden />
          <span className="font-semibold text-ink-2">{t('app.status.live')}</span>
        </>
      )}
      {update.state === 'downloading' && (
        <span className="badge tone-blue tabular">{t('app.update.downloading', { percent: update.percent ?? 0 })}</span>
      )}
      <span className="h-4 w-px bg-line-strong" aria-hidden />
      <button type="button" className="icon-btn" onClick={() => setPaletteOpen(true)} title={t('app.palette')} aria-label={t('app.palette')}>
        <span className="kbd">⌘K</span>
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t('app.reindex')}
        aria-label={t('app.reindex')}
        onClick={async () => {
          const r = await window.vault.reindex()
          setStatus(t('toast.reindexed', { projects: r.projects, sessions: r.sessions, plans: r.planFiles }))
          await loadProjects()
          await loadRecentSessions()
          await loadRecentPlans()
          await runSearch()
        }}
      >
        <Icon name="refresh" />
      </button>
    </div>
  )

  const headerRight = (
    <>
      {update.state === 'ready' && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void window.vault.updateInstall()}
          title={t('app.update.restart', { version: update.version ?? '' })}
        >
          {t('app.update.install')}
          {update.version ? ` ${update.version}` : ''}
        </button>
      )}
      {statusPill}
    </>
  )

  const pageSub =
    tab === 'search'
      ? t('page.search.sub', { projects: projects.length.toLocaleString(), sessions: totalSessions.toLocaleString() })
      : t(PAGE_SUB[tab])

  const searchView = (
    <div className="page page-fill">
      <div className="flex shrink-0 flex-wrap items-center gap-2.5">
        <label className="search-field glass">
          <Icon name="search" className="h-[18px] w-[18px] text-ink-3" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.label')}
          />
          {query && (
            <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label={t('search.clear')}>
              <Icon name="close" />
            </button>
          )}
        </label>
        <Segmented
          label={t('search.scope')}
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
        <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
        <button
          type="button"
          onClick={() => setInspectorOpen((v) => !v)}
          aria-expanded={inspectorOpen}
          className={`btn ${inspectorOpen || activeFilterCount > 0 ? 'btn-secondary' : 'btn-tertiary'}`}
        >
          <Icon name="filter" />
          {t('search.filters')}
          {activeFilterCount > 0 && <span className="badge tone-blue tabular">{activeFilterCount}</span>}
        </button>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 items-start gap-4">
        <div className="scroll-area flex h-full min-w-0 flex-1 flex-col gap-5">
          {searching && (
            <div className="flex min-h-[2rem] flex-wrap items-center gap-2 text-[13px] text-ink-3">
              <span className="tabular">
                {t('search.resultCount', { count: fuzzyHits.length })}
                {loading ? t('search.searching') : ''}
              </span>
              {tagFilter != null && (
                <button
                  type="button"
                  className="badge tone-blue"
                  onClick={() => setTagFilter(undefined)}
                  title={t('search.tagFilter.clear')}
                >
                  {t('search.tagFilter', { name: tags.find((x) => x.id === tagFilter)?.name ?? '' })} ×
                </button>
              )}
              {selected.size > 0 && (
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="font-semibold text-ink-2">{t('search.selected', { count: selected.size })}</span>
                  <button type="button" className={GHOST_BTN} onClick={() => setTab('export')}>
                    {t('search.exportSelected')}
                  </button>
                  <button type="button" className={GHOST_BTN} onClick={() => setSelected(new Set())}>
                    {t('search.clearSelection')}
                  </button>
                </span>
              )}
            </div>
          )}

          {!searching && searchScope !== 'plans' && recentSessions.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">{t('search.recentSessions')}</h2>
                <span className="section-desc">{t('search.emptyHint')}</span>
              </div>
              <div className="list glass">
                {recentSessions.map((s) => (
                  <button
                    key={s.sessionId}
                    type="button"
                    className="row"
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
                      <span className="min-w-0 truncate font-semibold text-ink-1">{sidebarPrimaryLabel(s.projectName)}</span>
                      {s.archived && (
                        <span className="badge tone-amber" title={t('badge.archived.hint')}>
                          {t('badge.archived')}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-[12.5px] text-ink-3 tabular">
                        {new Date(s.mtime).toLocaleDateString(BCP47[locale])}
                      </span>
                    </span>
                    {s.preview ? <span className="mt-1 block truncate text-[13.5px] text-ink-2">{s.preview}</span> : null}
                    <span className="mono mt-1 block truncate text-ink-3">{s.sessionFile}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {!searching && searchScope !== 'messages' && recentPlans.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">{t('search.recentPlans')}</h2>
              </div>
              <div className="list glass">
                {recentPlans.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    className="row"
                    onClick={() => setPlanPreview({ planId: pl.id, title: pl.title, filePath: pl.filePath })}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="badge tone-violet">{t('plan.badge')}</span>
                      <span className="min-w-0 truncate font-semibold text-ink-1">{pl.title}</span>
                      <span className="ml-auto shrink-0 text-[12.5px] text-ink-3 tabular">
                        {new Date(pl.mtime).toLocaleDateString(BCP47[locale])}
                      </span>
                    </span>
                    <span className="mono mt-1 block truncate text-ink-3">{pl.filePath}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {searching && !loading && fuzzyHits.length === 0 && (
            <div className="list glass">
              <div className="empty">
                <p className="text-[15px] font-semibold text-ink-1">
                  {query.trim() ? t('search.noResults') : t('search.tagged.empty')}
                </p>
                <p className="mt-1">{t('search.noResults.hint')}</p>
                {activeFilterCount > 0 && (
                  <button type="button" onClick={resetFilters} className="btn btn-tertiary mt-4">
                    {t('search.resetFilters')}
                  </button>
                )}
              </div>
            </div>
          )}

          {searching && fuzzyHits.length > 0 && (
            <div className="list glass" aria-busy={loading}>
              {fuzzyHits.map((h, i) =>
                isPlanHit(h) ? (
                  <PlanSearchHitCard key={`plan-${h.planId}`} h={h} active={i === activeResult} onStatus={setStatus} />
                ) : (
                  <article
                    key={h.messageId}
                    className="row group"
                    data-active={i === activeResult || undefined}
                    onDoubleClick={() => openHit(h)}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="check row-check mt-0.5"
                        checked={selected.has(h.messageId)}
                        onChange={() => toggleSelect(h.messageId)}
                        aria-label={t('action.select')}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <div className="row-meta flex-1">
                            <RoleBadge role={h.role} />
                            <span className="truncate font-semibold text-ink-2" title={h.projectSlug}>
                              {sidebarPrimaryLabel(h.projectName || h.projectSlug)}
                            </span>
                            {h.tsMs ? <span className="tabular">{formatTs(h.tsMs, locale)}</span> : null}
                            {messageClassKey(h.messageClass) ? (
                              <span className="badge tone-gray">{t(messageClassKey(h.messageClass)!)}</span>
                            ) : null}
                            {h.archived && (
                              <span className="badge tone-amber" title={t('badge.archived.hint')}>
                                {t('badge.archived')}
                              </span>
                            )}
                            {h.isFavorite && (
                              <span className="text-brand-ink" title={t('nav.favorites')} aria-label={t('nav.favorites')}>
                                <Icon name="star" className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </div>
                          <div className="row-actions">
                            <button
                              type="button"
                              className={GHOST_BTN}
                              onClick={async () => {
                                await window.vault.copyText(await fullBody(h))
                                setStatus(t('toast.copied'))
                              }}
                            >
                              {t('action.copy')}
                            </button>
                            <button type="button" className={GHOST_BTN} onClick={() => openHit(h)}>
                              {t('action.session')}
                            </button>
                            <button type="button" className={GHOST_BTN} onClick={() => void toggleFavorite(h)}>
                              {h.isFavorite ? t('action.unfavorite') : t('action.favorite')}
                            </button>
                            <button
                              type="button"
                              className={GHOST_BTN}
                              onClick={async () => {
                                const body = await fullBody(h)
                                const name = body.slice(0, 40).replace(/\s+/g, ' ').trim() || t('nav.templates')
                                await window.vault.templateCreate(name, body)
                                setStatus(t('toast.templated'))
                              }}
                            >
                              {t('action.template')}
                            </button>
                          </div>
                        </div>
                        <p className="mt-1.5 line-clamp-2 break-words text-[14px] leading-relaxed text-ink-1 [overflow-wrap:anywhere]">
                          <Snippet text={h.snippet} />
                        </p>
                        <p className="mono mt-1 truncate text-ink-3">
                          {h.sessionFile}:{h.lineIndex}
                        </p>
                        <TagEditor msgKey={h.msgKey} tagIds={h.tagIds} tags={tags} onChange={loadTags} />
                      </div>
                    </div>
                  </article>
                ),
              )}
            </div>
          )}
        </div>

        {inspectorOpen && (
          <aside
            className="glass panel flex max-h-full w-[296px] shrink-0 flex-col gap-5 overflow-y-auto p-4"
            aria-label={t('inspector.title')}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-ink-1">{t('inspector.title')}</h2>
                <p className="text-[12.5px] text-ink-3">
                  {activeFilterCount > 0 ? t('inspector.applied', { count: activeFilterCount }) : t('inspector.default')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {activeFilterCount > 0 && (
                  <button type="button" onClick={resetFilters} className={GHOST_BTN}>
                    {t('inspector.reset')}
                  </button>
                )}
                <button type="button" onClick={() => setInspectorOpen(false)} aria-label={t('inspector.close')} className="icon-btn">
                  <Icon name="close" />
                </button>
              </div>
            </div>

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
              <p className="text-[12.5px] leading-relaxed text-ink-3">
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
              <div className="flex flex-col gap-2.5">
                {(
                  [
                    [excludeMeta, setExcludeMeta, 'inspector.exclude.meta', 'inspector.exclude.metaHelp'],
                    [excludeTools, setExcludeTools, 'inspector.exclude.tools', 'inspector.exclude.toolsHelp'],
                    [excludeSubagents, setExcludeSubagents, 'inspector.exclude.subagents', 'inspector.exclude.subagentsHelp'],
                  ] as const
                ).map(([on, set, label, help]) => (
                  <label key={label} className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-ink-1">
                    <input
                      type="checkbox"
                      className="check mt-0.5"
                      checked={on}
                      disabled={searchScope === 'plans'}
                      onChange={(e) => set(e.target.checked)}
                    />
                    <span>
                      {t(label)}
                      <span className="block text-[12.5px] text-ink-3">{t(help)}</span>
                    </span>
                  </label>
                ))}
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
                  aria-label={t('inspector.tags.placeholder')}
                  className="input min-w-0 flex-1"
                />
                <button type="button" onClick={() => void createTag()} disabled={!newTag.trim()} className="btn btn-tertiary">
                  {t('inspector.tags.add')}
                </button>
              </div>
              {tags.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => {
                      const on = tagFilter === tag.id
                      return (
                        <span
                          key={tag.id}
                          className={`inline-flex items-center rounded-full text-[12.5px] ${
                            on ? 'bg-well font-semibold text-brand-ink ring-1 ring-brand' : 'bg-well text-ink-2'
                          }`}
                        >
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => setTagFilter(on ? undefined : tag.id)}
                            className="py-1 pl-2.5 pr-1"
                          >
                            {tag.name} <span className="tabular text-ink-3">{tag.count}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteTag(tag.id)}
                            aria-label={t('inspector.tags.delete')}
                            title={t('inspector.tags.delete')}
                            className={`py-1 pl-0.5 pr-2.5 ${confirmDeleteTag === tag.id ? 'font-semibold text-tone-rose' : 'text-ink-3 hover:text-ink-1'}`}
                          >
                            {confirmDeleteTag === tag.id ? t('inspector.tags.confirmDelete') : '×'}
                          </button>
                        </span>
                      )
                    })}
                  </div>
                  <p className="text-[12.5px] text-ink-3">{t('inspector.tags.filterHint')}</p>
                </>
              )}
            </Field>

            {searchScope !== 'messages' && (
              <p className="alert tone-amber">{t('inspector.plansNote', { path: '~/.claude/plans' })}</p>
            )}
            {searchScope === 'all' && <p className="text-[12.5px] leading-relaxed text-ink-3">{t('inspector.allScopeNote')}</p>}
          </aside>
        )}
      </div>
    </div>
  )

  return (
    <div className="app">
      <World />
      <Rail
        items={railItems}
        active={tab}
        onSelect={setTab}
        brandLabel={t('app.nav')}
        footer={
          <>
            <div className="rail-sep" />
            <RailButton icon="settings" label={t('nav.settings')} current={tab === 'settings'} onClick={() => setTab('settings')} />
            <RailButton
              label={t('app.theme.toggle')}
              onClick={(e) => toggleTheme(e, (dark) => setTheme(dark ? 'dark' : 'light'))}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </RailButton>
          </>
        }
      />
      <div className="content">
        <PageHeader title={t(tab === 'search' ? 'nav.search' : RAIL.find((r) => r.key === tab)?.labelKey ?? 'nav.settings')} sub={pageSub} right={headerRight} />
        <main className="main">
          {tab === 'search' && searchView}
          {tab === 'prompts' && (
            <PromptsTab
              projects={projects}
              projectId={projectId}
              onProjectChange={setProjectId}
              onOpenSession={setTranscriptOpen}
              onStatus={setStatus}
              refreshKey={refreshKey}
            />
          )}
          {tab === 'files' && <FilesTab onOpenSession={setTranscriptOpen} />}
          {tab === 'favorites' && (
            <FavoritesTab
              favorites={favorites}
              tags={tags}
              onOpenSession={setTranscriptOpen}
              onRemoved={() => void loadFavorites()}
              onTagsChanged={() => {
                void loadTags()
                void loadFavorites()
              }}
              onStatus={setStatus}
            />
          )}
          {tab === 'templates' && <TemplatesTab onStatus={setStatus} />}
          {tab === 'stats' && <StatsTab stats={stats} />}
          {tab === 'export' && (
            <ExportTab
              selectedCount={selected.size}
              excludeMeta={excludeMeta}
              excludeSubagents={excludeSubagents}
              onExcludeMeta={setExcludeMeta}
              onExcludeSubagents={setExcludeSubagents}
              exportText={exportText}
              exportFormat={exportFormat}
              onExport={(f) => void doExport(f)}
              onClearSelection={() => setSelected(new Set())}
              onStatus={setStatus}
            />
          )}
          {tab === 'settings' && (
            <SettingsTab
              update={update}
              archivedSessions={archivedSessions}
              onStatus={setStatus}
              onChanged={() => void loadProjects()}
            />
          )}
        </main>
      </div>

      <Toast message={status} onDone={clearStatus} />
      {transcriptOpen && <SessionTranscriptModal open={transcriptOpen} onClose={() => setTranscriptOpen(null)} />}
      {planPreview && <PlanMarkdownModal open={planPreview} onClose={() => setPlanPreview(null)} />}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
