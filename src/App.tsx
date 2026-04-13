import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import type {
  FavoriteRow,
  MessageClass,
  PlanHit,
  PlanListRow,
  ProjectRow,
  RecentSessionRow,
  SearchScope,
  SessionMessageRow,
  StatsPayload,
  TagRow,
  UnifiedSearchHit,
} from '../shared/ipc'
import {
  chatAlignForDialog,
  chatBubbleShellClass,
  chatRowFlex,
  isMessageHit,
  isPlanHit,
} from './chatBubbleLayout'

type Tab = 'search' | 'favorites' | 'stats' | 'export'

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

  const searchParamsRef = useRef({
    query,
    projectId,
    role,
    excludeMeta,
    excludeSubagents,
    searchScope,
  })
  searchParamsRef.current = { query, projectId, role, excludeMeta, excludeSubagents, searchScope }

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
      })
      setHits(raw)
    } finally {
      setLoading(false)
    }
  }, [query, projectId, role, excludeMeta, excludeSubagents, searchScope])

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
                <span className="block truncate">{sidebarPrimaryLabel(p.displayName)}</span>
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
                {fuzzyHits.map((h) =>
                  isPlanHit(h) ? (
                    <PlanSearchHitCard key={`plan-${h.planId}`} h={h} onStatus={setStatus} />
                  ) : (
                    <article
                      key={h.messageId}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 shadow-sm"
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
                    <h3 className="mb-2 text-xs font-medium uppercase text-zinc-500">자주 등장한 토큰</h3>
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
                    <h3 className="mb-2 text-xs font-medium uppercase text-zinc-500">세션 수정일 기준 활동</h3>
                    <div className="max-h-48 overflow-auto text-xs text-zinc-400">
                      {stats.activityByDay.map((d) => (
                        <div key={d.day} className="flex justify-between border-b border-zinc-900 py-1">
                          <span>{d.day}</span>
                          <span>{d.count}</span>
                        </div>
                      ))}
                    </div>
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
    </div>
  )
}

function PlanSearchHitCard({
  h,
  onStatus,
}: {
  h: PlanHit
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
    <article className="rounded-lg border border-violet-900/50 bg-violet-950/20 p-4 shadow-sm">
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
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-3 text-xs text-zinc-200">
          {body}
        </pre>
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
          {!err && body ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-zinc-200">
              {body}
            </pre>
          ) : null}
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
  const highlightRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  const visibleRows = useMemo(() => {
    if (showMeta) return rows
    return rows.filter((m) => m.messageClass !== 'meta')
  }, [rows, showMeta])

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
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} />
              메타 줄 표시 (권한·제목 등)
            </label>
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
          {!showMeta && rows.some((m) => m.messageClass === 'meta') && (
            <p className="mb-2 text-[11px] text-zinc-500">
              메타 줄 {rows.filter((m) => m.messageClass === 'meta').length}개 숨김
            </p>
          )}
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
                  <pre className="max-h-[min(70vh,32rem)] max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-zinc-200 [overflow-wrap:anywhere]">
                    {m.body}
                  </pre>
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
