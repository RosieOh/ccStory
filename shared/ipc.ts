export const IPC = {
  projectsList: 'vault:projectsList',
  search: 'vault:search',
  plansList: 'vault:plansList',
  planBody: 'vault:planBody',
  reindex: 'vault:reindex',
  copyText: 'vault:copyText',
  favoritesList: 'vault:favoritesList',
  favoriteAdd: 'vault:favoriteAdd',
  favoriteRemove: 'vault:favoriteRemove',
  tagsList: 'vault:tagsList',
  tagCreate: 'vault:tagCreate',
  messageTagsSet: 'vault:messageTagsSet',
  stats: 'vault:stats',
  exportMessages: 'vault:exportMessages',
  messageTagsGet: 'vault:messageTagsGet',
  sessionTranscript: 'vault:sessionTranscript',
  recentSessions: 'vault:recentSessions',
  templatesList: 'vault:templatesList',
  templateCreate: 'vault:templateCreate',
  templateUpdate: 'vault:templateUpdate',
  templateDelete: 'vault:templateDelete',
  onIndexUpdated: 'vault:onIndexUpdated',
  onIndexProgress: 'vault:onIndexProgress',
} as const

export type MessageClass = 'dialog' | 'meta' | 'other'

export type ExportOptions = {
  excludeMeta?: boolean
  excludeSubagents?: boolean
}

export type ProjectRow = {
  id: number
  slug: string
  displayName: string
  path: string
  sessionCount: number
  lastModified: number | null
  /** Source tool: 'claude' | 'codex' | … */
  tool: string
}

export type SessionMessageRow = {
  messageId: number
  lineIndex: number
  role: string
  body: string
  messageClass: MessageClass
}

export type SearchHit = {
  messageId: number
  sessionId: number
  projectId: number
  projectSlug: string
  projectName: string
  sessionFile: string
  lineIndex: number
  role: string
  body: string
  snippet: string
  rank: number
  messageClass: MessageClass
  /** Message timestamp (epoch ms) when available, else null. */
  tsMs: number | null
}

export type SearchScope = 'messages' | 'plans' | 'all'

export type PlanHit = {
  hitType: 'plan'
  planId: number
  filePath: string
  title: string
  snippet: string
  rank: number
  mtime: number
}

export type MessageHit = SearchHit & { hitType: 'message' }

export type UnifiedSearchHit = MessageHit | PlanHit

export type PlanListRow = {
  id: number
  filePath: string
  title: string
  mtime: number
}

export type MatchMode = 'any' | 'all' | 'phrase'
export type SortMode = 'relevance' | 'newest' | 'oldest'

export type SearchFilters = {
  query: string
  projectId?: number
  role?: 'user' | 'assistant' | ''
  limit?: number
  /** 기본 true: 메타(권한·제목 등) 줄 검색 결과에서 제외 */
  excludeMeta?: boolean
  /** true면 subagents 경로의 로그 제외 */
  excludeSubagents?: boolean
  /** 검색 대상: 대화(세션) / 플랜 Markdown / 둘 다. 기본 `messages`. */
  scope?: SearchScope
  /** 토큰 결합 방식: 아무거나(OR) / 모두(AND) / 구문(정확). 기본 `any`. */
  matchMode?: MatchMode
  /** 정렬: 관련도(FTS rank) / 최신 / 오래된. 기본 `relevance`. */
  sort?: SortMode
  /** 이 epoch(ms) 이후 메시지만 (메시지 timestamp 기준). */
  sinceMs?: number
  /** 이 epoch(ms) 이전 메시지만. */
  untilMs?: number
}

export type RecentSessionRow = {
  sessionId: number
  projectName: string
  sessionFile: string
  mtime: number
  preview: string | null
}

export type FavoriteRow = {
  id: number
  messageId: number
  sessionId: number
  body: string
  role: string
  projectSlug: string
  sessionFile: string
  createdAt: number
}

export type TagRow = {
  id: number
  name: string
  color: string | null
}

export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export type StatsPayload = {
  totalProjects: number
  totalSessions: number
  totalMessages: number
  messagesByRole: { role: string; count: number }[]
  topTokens: { token: string; count: number }[]
  activityByDay: { day: string; count: number }[]
  /** Real token usage summed from assistant `message.usage` (schema v4+). */
  tokenTotals: TokenTotals
  /** Per-model breakdown of assistant turns and their token usage. */
  tokensByModel: { model: string; messages: number; input: number; output: number }[]
  /** True when `activityByDay` is derived from real message timestamps rather than file mtime. */
  activityFromTimestamps: boolean
}

export type ReindexResult = {
  projects: number
  sessions: number
  planFiles: number
}

export type TemplateRow = {
  id: number
  name: string
  body: string
  createdAt: number
  updatedAt: number
}

export type IndexProgress = {
  phase: 'projects' | 'plans' | 'done'
  current: number
  total: number
  label?: string
}
