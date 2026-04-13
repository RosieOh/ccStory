import type { DbHandle } from './db.js'
import type {
  MessageClass,
  MessageHit,
  PlanHit,
  SearchFilters,
  SearchHit,
  UnifiedSearchHit,
} from '../shared/ipc.js'

function escapeFtsToken(t: string): string {
  return t.replace(/"/g, '""').replace(/'/g, "''")
}

/** Build FTS5 prefix query: each token becomes token* OR ... */
export function buildFtsQuery(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeFtsToken)
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return ''
  return tokens.map((t) => `"${t}"*`).join(' OR ')
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
  if (!parts.length) return { sql: '', params: [] }
  return { sql: ` AND ${parts.join(' AND ')}`, params }
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
  }))
}

export function searchMessages(db: DbHandle, filters: SearchFilters): SearchHit[] {
  if (!filters.query.trim()) {
    return []
  }
  const limit = Math.min(filters.limit ?? 80, 200)
  const fts = buildFtsQuery(filters.query)
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
      snippet(messages_fts, 0, '«', '»', '…', 32) AS snippet,
      bm25(messages_fts) AS rank
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    JOIN sessions s ON s.id = m.session_id
    JOIN projects p ON p.id = s.project_id
    WHERE ${ftsWhere}
    ORDER BY rank
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
      substr(m.body, 1, 120) AS snippet,
      0 AS rank
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    JOIN projects p ON p.id = s.project_id
    WHERE ${likeWhere}
    ORDER BY m.id DESC
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
  const fts = buildFtsQuery(filters.query)

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
      WHERE plan_files_fts MATCH ?
      ORDER BY rank
      LIMIT ${limit}
    `
    try {
      const rows = db.prepare(ftsSql).all(fts) as Parameters<typeof mapPlanRows>[0]
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

/** BM25 스케일이 메시지/플랜 FTS 간에 비교 불가 → 섹션 고정: 대화 전부(rank) 후 플랜 전부(rank) */
export function orderedAllScopeHits(messageHits: MessageHit[], planHits: PlanHit[]): UnifiedSearchHit[] {
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
    return orderedAllScopeHits(messages as MessageHit[], plans as PlanHit[])
  }
  if (scope === 'plans') return plans
  return messages
}
