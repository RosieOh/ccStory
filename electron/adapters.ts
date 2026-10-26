import fs from 'node:fs'
import path from 'node:path'
import { claudeHomeDir, defaultClaudeProjectsRoot } from './claudeRoots.js'
import { listAllJsonlForProject, readProjectDisplayTitle, readProjectOriginalPath } from './claudeLayout.js'
import { readFirstLine } from './lineReader.js'
import { parseJsonlLine, type ParsedLine } from '../shared/jsonlParse.js'
import { codexSessionCwd, createCodexLineParser } from '../shared/codexParse.js'

/** A project discovered by a tool adapter, ready to be indexed. */
export type DiscoveredProject = {
  /** Globally-unique slug. Non-Claude tools namespace as `${tool}:${raw}`. */
  slug: string
  root: string
  displayName: string
  /**
   * True when `displayName` is only a guess from the directory slug (no
   * sessions-index.json). The indexer then replaces it with the `cwd` the transcripts
   * recorded — slugs are lossy (`/`, `.` and `-` all become `-`).
   */
  displayNameIsGuess?: boolean
}

export type LineParser = (line: string) => ParsedLine | null

/**
 * A source of conversation transcripts. Claude Code is the primary adapter;
 * others (Codex CLI, …) contribute extra projects when their data dir exists.
 */
export type ToolAdapter = {
  id: string
  label: string
  /** Root directory the adapter scans; used for existence checks and the watcher. */
  root: string
  /** True when this tool's data directory is present on disk. */
  isAvailable: () => boolean
  listProjects: () => DiscoveredProject[]
  listSessions: (project: DiscoveredProject) => string[]
  /** Which project a transcript file belongs to (for live updates); null if not ours. */
  projectForFile: (filePath: string) => DiscoveredProject | null
  /** A fresh parser for one file, read in order from its first line. */
  createParser: () => LineParser
  /**
   * True when lines parse independently, so a grown file can be resumed from its
   * last indexed byte. Stateful formats are re-read from the start instead.
   */
  appendable: boolean
}

function isUnder(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
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
  const project = (slug: string): DiscoveredProject => {
    const projectRoot = path.join(root, slug)
    return {
      slug,
      root: projectRoot,
      displayName: readProjectDisplayTitle(projectRoot, slug),
      displayNameIsGuess: readProjectOriginalPath(projectRoot) == null,
    }
  }
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
        .map((e) => project(e.name))
    },
    listSessions: (p) => listAllJsonlForProject(p.root),
    projectForFile: (filePath) => {
      if (!isUnder(root, filePath)) return null
      const slug = path.relative(root, filePath).split(path.sep).filter(Boolean)[0]
      if (!slug || !fs.existsSync(path.join(root, slug))) return null
      return project(slug)
    },
    createParser: () => parseJsonlLine,
    appendable: true,
  }
}

/**
 * Codex CLI stores rollout transcripts as JSONL under `~/.codex/sessions/YYYY/MM/DD/`.
 * The date folders say nothing about *what* was worked on, so sessions are grouped by
 * the working directory in each file's `session_meta` line — the Codex equivalent of a
 * Claude project. Inert when the directory is absent.
 */
export function codexAdapter(): ToolAdapter {
  const home = process.env.CODEX_HOME?.trim() || path.join(path.dirname(claudeHomeDir()), '.codex')
  const root = path.join(home, 'sessions')
  const cwdCache = new Map<string, string>()

  const cwdOf = (file: string): string => {
    let cwd = cwdCache.get(file)
    if (cwd === undefined) {
      const first = readFirstLine(file)
      cwd = (first && codexSessionCwd(first)) || ''
      cwdCache.set(file, cwd)
    }
    return cwd
  }
  const projectFor = (cwd: string): DiscoveredProject => ({
    slug: `codex:${cwd || 'unknown'}`,
    root,
    displayName: cwd || 'Codex',
  })
  const allFiles = (): string[] => {
    const out: string[] = []
    walkJsonl(root, 6, 0, out)
    return out
  }

  return {
    id: 'codex',
    label: 'Codex CLI',
    root,
    isAvailable: () => fs.existsSync(root),
    listProjects: () => {
      if (!fs.existsSync(root)) return []
      const seen = new Map<string, DiscoveredProject>()
      for (const f of allFiles()) {
        const p = projectFor(cwdOf(f))
        seen.set(p.slug, p)
      }
      return [...seen.values()]
    },
    listSessions: (p) => allFiles().filter((f) => projectFor(cwdOf(f)).slug === p.slug),
    projectForFile: (filePath) => (isUnder(root, filePath) ? projectFor(cwdOf(filePath)) : null),
    createParser: createCodexLineParser,
    appendable: false,
  }
}

/** All adapters whose data directory currently exists. Claude is always first. */
export function getAvailableAdapters(): ToolAdapter[] {
  return allAdapters().filter((a) => a.isAvailable())
}

/** Every known adapter, present or not — the watcher waits for missing roots to appear. */
export function allAdapters(): ToolAdapter[] {
  return [claudeAdapter(), codexAdapter()]
}
