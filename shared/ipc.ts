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
  onIndexUpdated: 'vault:onIndexUpdated',
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

export type StatsPayload = {
  totalProjects: number
  totalSessions: number
  totalMessages: number
  messagesByRole: { role: string; count: number }[]
  topTokens: { token: string; count: number }[]
  activityByDay: { day: string; count: number }[]
}

export type ReindexResult = {
  projects: number
  sessions: number
  planFiles: number
}
