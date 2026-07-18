import fs from 'node:fs'
import path from 'node:path'
import { claudeHomeDir, defaultClaudeProjectsRoot } from './claudeRoots.js'
import { listAllJsonlForProject, readProjectDisplayTitle } from './claudeLayout.js'

/** A project discovered by a tool adapter, ready to be indexed. */
export type DiscoveredProject = {
  /** Globally-unique slug. Non-Claude tools namespace as `${tool}:${raw}`. */
  slug: string
  root: string
  displayName: string
}

/**
 * A source of conversation transcripts. Claude Code is the primary adapter;
 * others (Codex CLI, …) contribute extra projects when their data dir exists.
 * All adapters currently share the defensive JSONL parser in `shared/jsonlParse`.
 */
export type ToolAdapter = {
  id: string
  label: string
  /** Root directory the adapter scans; used for existence checks and the watcher. */
  root: string
  /** True when this tool's data directory is present on disk. */
  isAvailable: () => boolean
  listProjects: () => DiscoveredProject[]
  listSessions: (projectRoot: string) => string[]
}

function walkJsonl(dir: string, maxDepth: number, depth: number, out: string[]): void {
  if (depth > maxDepth) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkJsonl(p, maxDepth, depth + 1, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.jsonl')) out.push(path.normalize(p))
  }
}

export function claudeAdapter(): ToolAdapter {
  const root = defaultClaudeProjectsRoot()
  return {
    id: 'claude',
    label: 'Claude Code',
    root,
    isAvailable: () => fs.existsSync(root),
    listProjects: () => {
      if (!fs.existsSync(root)) return []
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const projectRoot = path.join(root, e.name)
          return {
            slug: e.name,
            root: projectRoot,
            displayName: readProjectDisplayTitle(projectRoot, e.name),
          }
        })
    },
    listSessions: (projectRoot: string) => listAllJsonlForProject(projectRoot),
  }
}

/**
 * Codex CLI stores rollout transcripts as JSONL under `~/.codex/sessions`.
 * Each immediate subdirectory (or the sessions root itself) is treated as a
 * project. Inert when the directory is absent, so it never breaks Claude-only setups.
 */
export function codexAdapter(): ToolAdapter {
  const home = process.env.CODEX_HOME?.trim() || path.join(path.dirname(claudeHomeDir()), '.codex')
  const root = path.join(home, 'sessions')
  return {
    id: 'codex',
    label: 'Codex CLI',
    root,
    isAvailable: () => fs.existsSync(root),
    listProjects: () => {
      if (!fs.existsSync(root)) return []
      const dirs = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(root, e.name))
      // If there are no subdirectories but loose JSONL files, index the root itself.
      const roots = dirs.length ? dirs : [root]
      return roots.map((r) => ({
        slug: `codex:${path.basename(r)}`,
        root: r,
        displayName: `Codex · ${path.basename(r)}`,
      }))
    },
    listSessions: (projectRoot: string) => {
      const out: string[] = []
      walkJsonl(projectRoot, 6, 0, out)
      return out
    },
  }
}

/** All adapters whose data directory currently exists. Claude is always first. */
export function getAvailableAdapters(): ToolAdapter[] {
  return [claudeAdapter(), codexAdapter()].filter((a) => a.isAvailable())
}
