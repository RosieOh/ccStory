import type { DbHandle } from './db.js'
import type {
  MessageClass,
  MessageHit,
  PlanHit,
  SearchFilters,
  SearchHit,
  SortMode,
  UnifiedSearchHit,
} from '../shared/ipc.js'

export type MatchMode = 'any' | 'all' | 'phrase'

/**
 * Build an FTS5 query from a raw string.
 * - `phrase`: the whole query is matched as one exact phrase.
 * - `any` / `all`: `"quoted groups"` become exact phrases, bare words become
 *   prefix matches (`word*`), joined by OR (`any`) or AND (`all`).
 * Everything is wrapped in double quotes so FTS special characters stay literal;
 * internal double quotes are stripped to keep the phrase well-formed.
 */
export function buildFtsQuery(raw: string, mode: MatchMode = 'any'): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  if (mode === 'phrase') {
    const cleaned = trimmed.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()
    return cleaned ? `"${cleaned}"` : ''
  }

  const terms: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    if (m[1] != null) {
      const phrase = m[1].replace(/"/g, ' ').replace(/\s+/g, ' ').trim()
      if (phrase) terms.push(`"${phrase}"`)
    } else if (m[2] != null) {
      const tok = m[2].replace(/"/g, '').trim()
      if (tok) terms.push(`"${tok}"*`)
    }
  }
  if (terms.length === 0) return ''
  return terms.join(mode === 'all' ? ' AND ' : ' OR ')
}

function rowFilters(filters: SearchFilters): { sql: string; params: (string | number)[] } {
  const parts: string[] = []
  const params: (string | number)[] = []
  const excludeMeta = filters.excludeMeta !== false
  if (excludeMeta) {
    parts.push(`(COALESCE(m.message_class, 'dialog') != 'meta')`)
  }
  if (filters.excludeSubagents) {
    parts.push(`(s.rel_path NOT LIKE '%subagents%')`)
  }
  if (typeof filters.sinceMs === 'number' && Number.isFinite(filters.sinceMs)) {
    parts.push(`(m.ts_ms IS NOT NULL AND m.ts_ms >= ?)`)
    params.push(Math.trunc(filters.sinceMs))
  }
  if (typeof filters.untilMs === 'number' && Number.isFinite(filters.untilMs)) {
    parts.push(`(m.ts_ms IS NOT NULL AND m.ts_ms <= ?)`)
    params.push(Math.trunc(filters.untilMs))
  }
  if (!parts.length) return { sql: '', params: [] }
  return { sql: ` AND ${parts.join(' AND ')}`, params }
}

/** ORDER BY clause for a message search; NULL timestamps sort last for time sorts. */
function messageOrderBy(sort: SortMode | undefined): string {
  if (sort === 'newest') return 'ORDER BY (m.ts_ms IS NULL) ASC, m.ts_ms DESC, m.id DESC'
  if (sort === 'oldest') return 'ORDER BY (m.ts_ms IS NULL) ASC, m.ts_ms ASC, m.id ASC'
  return 'ORDER BY rank'
}

function mapRows(
  rows: {
    message_id: number
    session_id: number
    project_id: number
    project_slug: string
    project_name: string
    session_file: string
    line_index: number
    role: string
    body: string
    snippet: string
    rank: number
    message_class: string
    ts_ms: number | null
  }[],
): SearchHit[] {
  return rows.map((r) => ({
    messageId: r.message_id,
    sessionId: r.session_id,
    projectId: r.project_id,
    projectSlug: r.project_slug,
    projectName: r.project_name,
    sessionFile: r.session_file,
    lineIndex: r.line_index,
    role: r.role,
    body: r.body,
    snippet: r.snippet,
    rank: r.rank,
    messageClass: (r.message_class as MessageClass) || 'dialog',
    tsMs: r.ts_ms ?? null,
  }))
}

export function searchMessages(db: DbHandle, filters: SearchFilters): SearchHit[] {
  if (!filters.query.trim()) {
    return []
  }
  const limit = Math.min(filters.limit ?? 80, 200)
  const fts = buildFtsQuery(filters.query, filters.matchMode)
  const { sql: extraWhere, params: extraParams } = rowFilters(filters)

  const ftsParams: (string | number)[] = []
  let ftsWhere = '1=1'
  if (fts) {
    ftsWhere = `messages_fts MATCH ?`
    ftsParams.push(fts)
  }
  if (filters.projectId != null) {
    ftsWhere += ` AND p.id = ?`
    ftsParams.push(filters.projectId)
  }
  if (filters.role === 'user' || filters.role === 'assistant') {
    ftsWhere += ` AND m.role = ?`
    ftsParams.push(filters.role)
  }
  ftsWhere += extraWhere
  ftsParams.push(...extraParams)

  if (fts) {
    const ftsSql = `
    SELECT
      m.id AS message_id,
      s.id AS session_id,
      p.id AS project_id,
      p.slug AS project_slug,
      p.display_name AS project_name,
      s.rel_path AS session_file,
      m.line_index,
      m.role,
      m.body,
      m.message_class AS message_class,
      m.ts_ms AS ts_ms,
      snippet(messages_fts, 0, '«', '»', '…', 32) AS snippet,
      bm25(messages_fts) AS rank
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    JOIN sessions s ON s.id = m.session_id
    JOIN projects p ON p.id = s.project_id
    WHERE ${ftsWhere}
    ${messageOrderBy(filters.sort)}
    LIMIT ${limit}
  `
    try {
      const stmt = db.prepare(ftsSql)
      const rows = stmt.all(...ftsParams) as Parameters<typeof mapRows>[0]
      return mapRows(rows)
    } catch {
      /* LIKE fallback */
    }
  }

  const likeParams: (string | number)[] = []
  let likeWhere = '1=1'
  const q = filters.query.trim()
  if (q.length > 0) {
    likeWhere = `m.body LIKE ?`
    const safe = q.replace(/%/g, '').replace(/_/g, '')
    likeParams.push(`%${safe}%`)
  }
  if (filters.projectId != null) {
    likeWhere += ` AND p.id = ?`
    likeParams.push(filters.projectId)
  }
  if (filters.role === 'user' || filters.role === 'assistant') {
    likeWhere += ` AND m.role = ?`
    likeParams.push(filters.role)
  }
  likeWhere += extraWhere
  likeParams.push(...extraParams)

  const likeSql = `
    SELECT
      m.id AS message_id,
      s.id AS session_id,
      p.id AS project_id,
      p.slug AS project_slug,
      p.display_name AS project_name,
      s.rel_path AS session_file,
      m.line_index,
      m.role,
      m.body,
      m.message_class AS message_class,
      m.ts_ms AS ts_ms,
      substr(m.body, 1, 120) AS snippet,
      0 AS rank
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    JOIN projects p ON p.id = s.project_id
    WHERE ${likeWhere}
    ${filters.sort === 'newest'
      ? 'ORDER BY (m.ts_ms IS NULL) ASC, m.ts_ms DESC, m.id DESC'
      : filters.sort === 'oldest'
        ? 'ORDER BY (m.ts_ms IS NULL) ASC, m.ts_ms ASC, m.id ASC'
        : 'ORDER BY m.id DESC'}
    LIMIT ${limit}
  `

  const stmt = db.prepare(likeSql)
  const rows = stmt.all(...likeParams) as Parameters<typeof mapRows>[0]
  return mapRows(rows)
}

function mapPlanRows(
  rows: {
    plan_id: number
    file_path: string
    title: string
    snippet: string
    rank: number
    mtime: number
  }[],
): PlanHit[] {
  return rows.map((r) => ({
    hitType: 'plan' as const,
    planId: r.plan_id,
    filePath: r.file_path,
    title: r.title,
    snippet: r.snippet,
    rank: r.rank,
    mtime: r.mtime,
  }))
}

export function searchPlans(db: DbHandle, filters: SearchFilters): PlanHit[] {
  if (!filters.query.trim()) {
    return []
  }
  const limit = Math.min(filters.limit ?? 80, 200)
  const fts = buildFtsQuery(filters.query, filters.matchMode)
  const planDate: string[] = []
  const planDateParams: number[] = []
  if (typeof filters.sinceMs === 'number' && Number.isFinite(filters.sinceMs)) {
    planDate.push(`pf.file_mtime_ms >= ?`)
    planDateParams.push(Math.trunc(filters.sinceMs))
  }
  if (typeof filters.untilMs === 'number' && Number.isFinite(filters.untilMs)) {
    planDate.push(`pf.file_mtime_ms <= ?`)
    planDateParams.push(Math.trunc(filters.untilMs))
  }
  const planDateSql = planDate.length ? ` AND ${planDate.join(' AND ')}` : ''
  const planOrder =
    filters.sort === 'newest' || filters.sort === 'oldest'
      ? `ORDER BY pf.file_mtime_ms ${filters.sort === 'newest' ? 'DESC' : 'ASC'}`
      : 'ORDER BY rank'

  if (fts) {
    const ftsSql = `
      SELECT
        pf.id AS plan_id,
        pf.file_path,
        pf.title,
        pf.file_mtime_ms AS mtime,
        snippet(plan_files_fts, 1, '«', '»', '…', 48) AS snippet,
        bm25(plan_files_fts) AS rank
      FROM plan_files_fts
      JOIN plan_files pf ON pf.id = plan_files_fts.rowid
      WHERE plan_files_fts MATCH ?${planDateSql}
      ${planOrder}
      LIMIT ${limit}
    `
    try {
      const rows = db.prepare(ftsSql).all(fts, ...planDateParams) as Parameters<typeof mapPlanRows>[0]
      return mapPlanRows(rows)
    } catch {
      /* LIKE fallback */
    }
  }

  const q = filters.query.trim()
  const safe = q.replace(/%/g, '').replace(/_/g, '')
  const likeSql = `
    SELECT
      pf.id AS plan_id,
      pf.file_path,
      pf.title,
      pf.file_mtime_ms AS mtime,
      substr(pf.body, 1, 160) AS snippet,
      0 AS rank
    FROM plan_files pf
    WHERE pf.title LIKE ? OR pf.body LIKE ?
    ORDER BY pf.file_mtime_ms DESC
    LIMIT ${limit}
  `
  const pat = `%${safe}%`
  const rows = db.prepare(likeSql).all(pat, pat) as Parameters<typeof mapPlanRows>[0]
  return mapPlanRows(rows)
}

/**
 * `relevance` (default): BM25 scales aren't comparable across the message/plan
 * FTS tables, so results stay sectioned — all messages (by rank) then all plans
 * (by rank). For time sorts both scopes share an epoch-ms clock (message `tsMs`,
 * plan `mtime`), so hits are interleaved by time; missing times sort last.
 */
export function orderedAllScopeHits(
  messageHits: MessageHit[],
  planHits: PlanHit[],
  sort: SortMode = 'relevance',
): UnifiedSearchHit[] {
  if (sort === 'newest' || sort === 'oldest') {
    const timeOf = (h: UnifiedSearchHit): number | null =>
      h.hitType === 'plan' ? h.mtime : h.tsMs
    const dir = sort === 'newest' ? -1 : 1
    return [...messageHits, ...planHits].sort((a, b) => {
      const ta = timeOf(a)
      const tb = timeOf(b)
      if (ta == null && tb == null) return 0
      if (ta == null) return 1
      if (tb == null) return -1
      return (ta - tb) * dir
    })
  }
  const byMsgRank = (a: MessageHit, b: MessageHit) =>
    a.rank !== b.rank ? a.rank - b.rank : b.messageId - a.messageId
  const byPlanRank = (a: PlanHit, b: PlanHit) =>
    a.rank !== b.rank ? a.rank - b.rank : b.mtime - a.mtime
  return [...[...messageHits].sort(byMsgRank), ...[...planHits].sort(byPlanRank)]
}

export function unifiedSearch(db: DbHandle, filters: SearchFilters): UnifiedSearchHit[] {
  const scope = filters.scope ?? 'messages'
  /** `plan_files`에 project_id 없음 — `전체` 검색에서만 플랜을 합치고, 프로젝트가 선택되면 대화만 필터 */
  const projectScoped = filters.projectId != null
  const messages =
    scope === 'messages' || scope === 'all'
      ? searchMessages(db, filters).map((h): UnifiedSearchHit => ({ ...h, hitType: 'message' }))
      : []
  const wantPlans = scope === 'plans' || (scope === 'all' && !projectScoped)
  const plans = wantPlans ? searchPlans(db, filters) : []

  if (scope === 'all') {
    return orderedAllScopeHits(messages as MessageHit[], plans as PlanHit[], filters.sort)
  }
  if (scope === 'plans') return plans
  return messages
}
