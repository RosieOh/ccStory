export const IPC = {
  projectsList: 'vault:projectsList',
  search: 'vault:search',
  plansList: 'vault:plansList',
  planBody: 'vault:planBody',
  reindex: 'vault:reindex',
  copyText: 'vault:copyText',
  messageBody: 'vault:messageBody',
  favoritesList: 'vault:favoritesList',
  favoriteAdd: 'vault:favoriteAdd',
  favoriteRemove: 'vault:favoriteRemove',
  tagsList: 'vault:tagsList',
  tagCreate: 'vault:tagCreate',
  tagRename: 'vault:tagRename',
  tagDelete: 'vault:tagDelete',
  messageTagsSet: 'vault:messageTagsSet',
  stats: 'vault:stats',
  exportMessages: 'vault:exportMessages',
  exportSave: 'vault:exportSave',
  sessionTranscript: 'vault:sessionTranscript',
  sessionInfo: 'vault:sessionInfo',
  recentSessions: 'vault:recentSessions',
  promptsList: 'vault:promptsList',
  templatesList: 'vault:templatesList',
  templateCreate: 'vault:templateCreate',
  templateUpdate: 'vault:templateUpdate',
  templateDelete: 'vault:templateDelete',
  filesList: 'vault:filesList',
  pricesList: 'vault:pricesList',
  pricesSave: 'vault:pricesSave',
  pricesReset: 'vault:pricesReset',
  fileTimeline: 'vault:fileTimeline',
  settingsGet: 'vault:settingsGet',
  settingsSet: 'vault:settingsSet',
  archivePurge: 'vault:archivePurge',
  backupsList: 'vault:backupsList',
  backupCreate: 'vault:backupCreate',
  backupRestore: 'vault:backupRestore',
  backupsReveal: 'vault:backupsReveal',
  updateCheck: 'vault:updateCheck',
  updateInstall: 'vault:updateInstall',
  updateStatus: 'vault:updateStatus',
  onIndexUpdated: 'vault:onIndexUpdated',
  onIndexProgress: 'vault:onIndexProgress',
  onUpdateStatus: 'vault:onUpdateStatus',
} as const

export type FileRow = {
  path: string
  basename: string
  /** How many messages touched it, and across how many sessions. */
  touches: number
  sessions: number
  lastTouched: number | null
  projectName: string
}

export type FileTouchRow = {
  messageId: number
  sessionId: number
  sessionFile: string
  projectName: string
  role: string
  tsMs: number | null
  gitBranch: string | null
  lineIndex: number
  preview: string
}

export type UpdateStatus = {
  /** `unsupported` = dev or unsigned build with no update feed; `disabled` = turned off in settings. */
  state: 'idle' | 'unsupported' | 'disabled' | 'checking' | 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
  message?: string
}

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
  /** Sessions kept after their source file was deleted. */
  archivedCount: number
  lastModified: number | null
  /** Source tool: 'claude' | 'codex' | … */
  tool: string
  /** Set when the project's source directory no longer exists. */
  archived: boolean
}

export type SessionMessageRow = {
  messageId: number
  msgKey: string
  lineIndex: number
  role: string
  body: string
  messageClass: MessageClass
  /** Parsed `content_kinds` (e.g. ['tool_use']) so the UI can tell tool activity from prose. */
  contentKinds: string[]
}

export type SessionInfo = {
  sessionId: number
  filePath: string
  /** Epoch ms when the source file was found missing; null while it exists. */
  archivedAt: number | null
}

export type SearchHit = {
  messageId: number
  /** Stable identity used by favorites and tags (survives re-indexing). */
  msgKey: string
  sessionId: number
  projectId: number
  projectSlug: string
  projectName: string
  sessionFile: string
  lineIndex: number
  role: string
  /** Body, clamped for transport; fetch the full text with `messageBody` when `bodyTruncated`. */
  body: string
  bodyTruncated: boolean
  snippet: string
  rank: number
  messageClass: MessageClass
  /** Message timestamp (epoch ms) when available, else null. */
  tsMs: number | null
  tagIds: number[]
  isFavorite: boolean
  /** The session's source file is gone; this hit lives only in the vault. */
  archived: boolean
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
  /** The plan file is gone; this copy lives only in the vault. */
  archived: boolean
}

export type MessageHit = SearchHit & { hitType: 'message' }

export type UnifiedSearchHit = MessageHit | PlanHit

export type PlanListRow = {
  id: number
  filePath: string
  title: string
  mtime: number
  archived: boolean
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
  /** true면 도구 호출·도구 결과 줄 제외 (UI 기본값 true) */
  excludeTools?: boolean
  /** 이 태그가 붙은 메시지만. 검색어가 비어 있으면 태그된 메시지 전체를 최신순으로. */
  tagId?: number
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
  archived: boolean
}

export type PromptSort = 'recent' | 'frequent'

export type PromptQuery = {
  query: string
  projectId?: number
  sort?: PromptSort
  limit?: number
}

/** A distinct prompt the human typed, with how often and when it was used. */
export type PromptRow = {
  text: string
  uses: number
  lastTsMs: number | null
  firstTsMs: number | null
  /** The most recent occurrence — what "open session", favorite and tag act on. */
  messageId: number
  msgKey: string
  sessionId: number
  sessionFile: string
  lineIndex: number
  projectName: string
  archived: boolean
  isFavorite: boolean
}

export type FavoriteRow = {
  id: number
  msgKey: string
  body: string
  role: string
  projectLabel: string
  sessionFile: string
  createdAt: number
  /** Live location of the starred line; null when it is no longer in the index. */
  messageId: number | null
  sessionId: number | null
  lineIndex: number | null
  archived: boolean
  tagIds: number[]
}

export type TagRow = {
  id: number
  name: string
  color: string | null
  /** Messages carrying the tag. */
  count: number
}

export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

/** API responses and full token usage for one model — the input to cost estimation. */
export type ModelTokenRow = {
  model: string
  /** API responses (deduplicated), not transcript lines. */
  messages: number
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  /** Subset of `cacheCreation` written with the 1-hour TTL. */
  cacheCreation1h: number
}

export type StatsPayload = {
  totalProjects: number
  totalSessions: number
  archivedSessions: number
  /** Plans kept after their file was deleted. */
  archivedPlans: number
  totalMessages: number
  totalPrompts: number
  messagesByRole: { role: string; count: number }[]
  /** Words in my own prompts, counted as the number of prompts containing them. */
  topTokens: { token: string; count: number }[]
  activityByDay: { day: string; count: number }[]
  /** Token usage counted once per API response (schema v9+). */
  tokenTotals: TokenTotals
  /** Per-model breakdown of API responses and their token usage. */
  tokensByModel: ModelTokenRow[]
  /** True when `activityByDay` counts prompts by timestamp rather than session mtime. */
  activityFromTimestamps: boolean
  /** Local days (`YYYY-MM-DD`, oldest first) the app was opened in the last ~two months. */
  appOpenDays: string[]
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

export type ArchiveMode = 'keep' | 'mirror'

export type Settings = {
  /** What happens to indexed sessions when Claude Code deletes their files. */
  archiveMode: ArchiveMode
  /** Check GitHub Releases for updates (the app's only network request). */
  autoUpdate: boolean
  /** How many DB snapshots to keep (0 turns automatic backups off). */
  backupKeep: number
}

export type SettingsInfo = Settings & {
  dbPath: string
  dbSizeBytes: number
  claudeHome: string
  /** Plans kept after their file was deleted (sessions come with the project list). */
  archivedPlans: number
}

export type ExportSaveResult = { saved: boolean; path?: string; error?: string }

/** Allowed values for `Settings.backupKeep`; 0 turns automatic backups off. */
export const BACKUP_KEEP_CHOICES = [0, 1, 3, 7] as const
export const DEFAULT_BACKUP_KEEP = 3

/** Why a snapshot was taken: on schedule, by hand, or right before a destructive step. */
export type BackupReason = 'daily' | 'manual' | 'pre-migration' | 'pre-purge' | 'pre-restore'

export type BackupFile = {
  /** File name in the backup folder; also the id the renderer passes back. */
  name: string
  createdAt: number
  reason: BackupReason
  sizeBytes: number
}

export type BackupInfo = {
  dir: string
  keep: number
  items: BackupFile[]
  totalBytes: number
}

export type BackupResult =
  | { ok: true; file: BackupFile }
  | { ok: false; error: 'disk' | 'failed'; message?: string }

/** A successful restore relaunches the app, so only failures come back. */
export type RestoreResult = { ok: false; error: 'invalid' | 'newer-schema' | 'missing' | 'failed'; message?: string }
