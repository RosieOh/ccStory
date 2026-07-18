import fs from 'node:fs'
import path from 'node:path'
import type { DbHandle } from './db.js'
import type { DiscoveredProject, ToolAdapter } from './adapters.js'
import { listAllJsonlForProject, readProjectDisplayTitle } from './claudeLayout.js'
import { parseJsonlLine } from '../shared/jsonlParse.js'

export { defaultClaudeProjectsRoot } from './claudeRoots.js'

/** All JSONL transcripts for a Claude project (root UUID files, subagents, agent-transcripts, index). */
export function listJsonlSessions(projectRoot: string): string[] {
  return listAllJsonlForProject(projectRoot)
}

export function listProjectDirs(claudeProjectsRoot: string): { slug: string; root: string }[] {
  if (!fs.existsSync(claudeProjectsRoot)) return []
  const entries = fs.readdirSync(claudeProjectsRoot, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      slug: e.name,
      root: path.join(claudeProjectsRoot, e.name),
    }))
}

export function upsertProject(
  db: DbHandle,
  slug: string,
  root: string,
  opts?: { tool?: string; displayName?: string },
): number {
  const tool = opts?.tool ?? 'claude'
  const displayName = opts?.displayName ?? readProjectDisplayTitle(root, slug)
  const mtime = fs.statSync(root).mtimeMs
  db.prepare(
    `INSERT INTO projects (slug, root_path, display_name, last_modified, tool)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       root_path = excluded.root_path,
       display_name = excluded.display_name,
       last_modified = excluded.last_modified,
       tool = excluded.tool`,
  ).run(slug, root, displayName, Math.trunc(mtime), tool)
  const row = db.prepare(`SELECT id FROM projects WHERE slug = ?`).get(slug) as { id: number }
  return row.id
}

export function indexSessionFileSync(db: DbHandle, projectId: number, projectRoot: string, filePath: string): void {
  const stat = fs.statSync(filePath)
  const mtime = Math.trunc(stat.mtimeMs)
  const rel = path.relative(projectRoot, filePath)

  const existing = db
    .prepare(`SELECT id, file_mtime_ms FROM sessions WHERE file_path = ?`)
    .get(filePath) as { id: number; file_mtime_ms: number } | undefined

  if (existing && existing.file_mtime_ms === mtime) {
    return
  }

  const delSession = db.prepare(`DELETE FROM sessions WHERE file_path = ?`)
  const insSession = db.prepare(
    `INSERT INTO sessions (project_id, rel_path, file_path, file_mtime_ms, message_count)
     VALUES (?, ?, ?, ?, 0)`,
  )
  const insMsg = db.prepare(
    `INSERT INTO messages
       (session_id, line_index, role, body, content_kinds, raw_preview, message_class,
        ts_ms, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, is_sidechain)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const tx = db.transaction(() => {
    delSession.run(filePath)
    const info = insSession.run(projectId, rel, filePath, mtime)
    const sessionId = Number(info.lastInsertRowid)
    const content = fs.readFileSync(filePath, 'utf8')
    const syncLines = content.split(/\r?\n/)
    let idx = 0
    for (const line of syncLines) {
      const parsed = parseJsonlLine(line)
      if (!parsed) continue
      const body = parsed.text || parsed.rawPreview || ''
      const kinds = JSON.stringify(parsed.contentKinds)
      const u = parsed.usage
      insMsg.run(
        sessionId,
        idx,
        parsed.role,
        body,
        kinds,
        parsed.rawPreview,
        parsed.messageClass,
        parsed.tsMs,
        parsed.model,
        u?.inputTokens ?? null,
        u?.outputTokens ?? null,
        u?.cacheReadTokens ?? null,
        u?.cacheCreationTokens ?? null,
        parsed.isSidechain ? 1 : 0,
      )
      idx += 1
    }
    db.prepare(`UPDATE sessions SET message_count = ? WHERE id = ?`).run(idx, sessionId)
  })

  tx()
}

/**
 * Drop DB rows whose backing files/dirs no longer exist on disk. Session and
 * message/FTS rows cascade via FK + triggers, so removing a stale project or
 * session cleans up its descendants automatically.
 */
export function pruneMissingProjectsAndSessions(db: DbHandle): number {
  let removed = 0
  const sessions = db.prepare(`SELECT id, file_path FROM sessions`).all() as {
    id: number
    file_path: string
  }[]
  const delSession = db.prepare(`DELETE FROM sessions WHERE id = ?`)
  for (const s of sessions) {
    if (!fs.existsSync(s.file_path)) {
      delSession.run(s.id)
      removed += 1
    }
  }

  const projects = db.prepare(`SELECT id, root_path FROM projects`).all() as {
    id: number
    root_path: string
  }[]
  const delProject = db.prepare(`DELETE FROM projects WHERE id = ?`)
  for (const p of projects) {
    if (!fs.existsSync(p.root_path)) {
      delProject.run(p.id)
      removed += 1
    }
  }
  return removed
}

/** Index a single project directory; returns how many session files it holds. */
export function indexProjectDir(db: DbHandle, dir: { slug: string; root: string }): number {
  const pid = upsertProject(db, dir.slug, dir.root)
  const files = listJsonlSessions(dir.root)
  for (const f of files) {
    indexSessionFileSync(db, pid, dir.root, f)
  }
  db.prepare(`UPDATE projects SET last_indexed_at = ? WHERE id = ?`).run(Date.now(), pid)
  return files.length
}

/**
 * Index one project discovered by a tool adapter (Claude, Codex, …). Sessions are
 * parsed with the shared JSONL parser; the project row is tagged with the tool id.
 */
export function indexAdapterProject(
  db: DbHandle,
  adapter: ToolAdapter,
  discovered: DiscoveredProject,
): number {
  const pid = upsertProject(db, discovered.slug, discovered.root, {
    tool: adapter.id,
    displayName: discovered.displayName,
  })
  const files = adapter.listSessions(discovered.root)
  for (const f of files) {
    indexSessionFileSync(db, pid, discovered.root, f)
  }
  db.prepare(`UPDATE projects SET last_indexed_at = ? WHERE id = ?`).run(Date.now(), pid)
  return files.length
}

export function fullReindex(db: DbHandle, claudeRoot: string): { projects: number; sessions: number } {
  const projects = listProjectDirs(claudeRoot)
  let sessionCount = 0
  for (const p of projects) {
    sessionCount += indexProjectDir(db, p)
  }
  pruneMissingProjectsAndSessions(db)
  return { projects: projects.length, sessions: sessionCount }
}

export function indexSinglePath(db: DbHandle, claudeRoot: string, absoluteFilePath: string): void {
  const normalized = path.normalize(absoluteFilePath)
  if (!normalized.toLowerCase().endsWith('.jsonl')) return
  if (!normalized.includes(`${path.sep}.claude${path.sep}projects${path.sep}`)) return
  const relFromRoot = path.relative(claudeRoot, normalized)
  const parts = relFromRoot.split(path.sep).filter(Boolean)
  const slug = parts[0]
  if (!slug) return
  const projectRoot = path.join(claudeRoot, slug)
  if (!fs.existsSync(projectRoot)) return
  const pid = upsertProject(db, slug, projectRoot)
  indexSessionFileSync(db, pid, projectRoot, normalized)
  db.prepare(`UPDATE projects SET last_indexed_at = ? WHERE id = ?`).run(Date.now(), pid)
}
