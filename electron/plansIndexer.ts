import fs from 'node:fs'
import path from 'node:path'
import type { DbHandle } from './db.js'

const MAX_DEPTH = 8

/** Recursively collect `*.md` under `root` up to `MAX_DEPTH` directory levels from `root`. */
export function walkMarkdownFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []

  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(full)
      }
    }
  }

  walk(root, 0)
  return out
}

export function derivePlanTitle(body: string, basename: string): string {
  const firstHeading = body.match(/^#\s+(.+)$/m)
  if (firstHeading) return firstHeading[1].trim()
  return basename.replace(/\.md$/i, '')
}

export function indexPlanFileSync(db: DbHandle, filePath: string): void {
  const stat = fs.statSync(filePath)
  const mtime = Math.trunc(stat.mtimeMs)
  const existing = db
    .prepare(`SELECT id, file_mtime_ms FROM plan_files WHERE file_path = ?`)
    .get(filePath) as { id: number; file_mtime_ms: number } | undefined

  if (existing && existing.file_mtime_ms === mtime) {
    return
  }

  const body = fs.readFileSync(filePath, 'utf8')
  const title = derivePlanTitle(body, path.basename(filePath))

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM plan_files WHERE file_path = ?`).run(filePath)
    db.prepare(`INSERT INTO plan_files (file_path, file_mtime_ms, title, body) VALUES (?, ?, ?, ?)`).run(
      filePath,
      mtime,
      title,
      body,
    )
  })
  tx()
}

function pruneMissingPlanRows(db: DbHandle, plansRoot: string): void {
  const normRoot = path.normalize(plansRoot)
  const rows = db.prepare(`SELECT id, file_path FROM plan_files`).all() as { id: number; file_path: string }[]
  for (const r of rows) {
    const fp = path.normalize(r.file_path)
    const rel = path.relative(normRoot, fp)
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
    if (!fs.existsSync(fp)) {
      db.prepare(`DELETE FROM plan_files WHERE id = ?`).run(r.id)
    }
  }
}

export function fullReindexPlans(db: DbHandle, plansRoot: string): { planFiles: number } {
  if (!fs.existsSync(plansRoot)) {
    pruneMissingPlanRows(db, plansRoot)
    return { planFiles: 0 }
  }
  const files = walkMarkdownFiles(plansRoot)
  for (const f of files) {
    indexPlanFileSync(db, f)
  }
  pruneMissingPlanRows(db, plansRoot)
  return { planFiles: files.length }
}

export function indexPlanSinglePath(db: DbHandle, plansRoot: string, absoluteFilePath: string): void {
  const normalized = path.normalize(absoluteFilePath)
  const normRoot = path.normalize(plansRoot)
  const rel = path.relative(normRoot, normalized)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return
  if (!normalized.toLowerCase().endsWith('.md')) return

  if (!fs.existsSync(normalized)) {
    db.prepare(`DELETE FROM plan_files WHERE file_path = ?`).run(normalized)
    return
  }

  indexPlanFileSync(db, normalized)
}

export function isPathUnderPlansRoot(plansRoot: string, absoluteFilePath: string): boolean {
  const normalized = path.normalize(absoluteFilePath)
  const normRoot = path.normalize(plansRoot)
  const rel = path.relative(normRoot, normalized)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}
