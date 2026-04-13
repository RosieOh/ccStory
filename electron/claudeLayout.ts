import fs from 'node:fs'
import path from 'node:path'

type SessionsIndex = {
  version?: number
  originalPath?: string
  entries?: { projectPath?: string; fullPath?: string }[]
}

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__'])

/** Human title: real cwd from Claude metadata when present. */
export function readProjectDisplayTitle(projectRoot: string, slugFallback: string): string {
  const idxPath = path.join(projectRoot, 'sessions-index.json')
  if (fs.existsSync(idxPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(idxPath, 'utf8')) as SessionsIndex
      if (typeof j.originalPath === 'string' && j.originalPath.trim()) {
        return j.originalPath.trim()
      }
      const ep = j.entries?.find((e) => typeof e.projectPath === 'string' && e.projectPath.trim())
      if (ep?.projectPath) return ep.projectPath.trim()
    } catch {
      /* ignore corrupt index */
    }
  }
  return fallbackTitleFromSlug(slugFallback)
}

/** When metadata is missing: show path tail after Desktop (common macOS layout). */
function fallbackTitleFromSlug(slug: string): string {
  const marker = '-Desktop-'
  const i = slug.indexOf(marker)
  if (i >= 0) {
    return slug.slice(i + marker.length)
  }
  if (slug.startsWith('-Users-')) {
    const rest = slug.slice('-Users-'.length)
    const j = rest.indexOf('-')
    if (j > 0) {
      return rest.slice(j + 1)
    }
  }
  return slug
}

function walkJsonlFiles(dir: string, maxDepth: number, depth: number, out: string[]): void {
  if (depth > maxDepth) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walkJsonlFiles(p, maxDepth, depth + 1, out)
    } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
      out.push(p)
    }
  }
}

/**
 * Claude Code stores transcripts in multiple places:
 * - legacy: agent-transcripts/*.jsonl
 * - common: {uuid}.jsonl at project root
 * - nested: {uuid}/subagents/*.jsonl
 * sessions-index.json may list fullPath entries that still exist.
 */
export function listAllJsonlForProject(projectRoot: string, maxDepth = 8): string[] {
  const found = new Set<string>()
  const walked: string[] = []
  walkJsonlFiles(projectRoot, maxDepth, 0, walked)
  for (const p of walked) {
    found.add(path.normalize(p))
  }

  const idxPath = path.join(projectRoot, 'sessions-index.json')
  if (fs.existsSync(idxPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(idxPath, 'utf8')) as SessionsIndex
      for (const e of j.entries ?? []) {
        if (e.fullPath && fs.existsSync(e.fullPath) && e.fullPath.endsWith('.jsonl')) {
          found.add(path.normalize(e.fullPath))
        }
      }
    } catch {
      /* ignore */
    }
  }

  return [...found]
}
