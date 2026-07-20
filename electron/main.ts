import path from 'node:path'
import fs from 'node:fs'
import { app, BrowserWindow, clipboard, ipcMain } from 'electron'
import chokidar from 'chokidar'
import { openVaultDb } from './db.js'
import { defaultClaudePlansRoot, defaultClaudeProjectsRoot } from './claudeRoots.js'
import { indexAdapterProject, indexSinglePath, pruneMissingProjectsAndSessions } from './indexer.js'
import { getAvailableAdapters } from './adapters.js'
import { fullReindexPlans, indexPlanSinglePath, isPathUnderPlansRoot } from './plansIndexer.js'
import { unifiedSearch } from './search.js'
import { computeStats } from './stats.js'
import { IPC } from '../shared/ipc.js'
import type {
  IndexProgress,
  PlanListRow,
  RecentSessionRow,
  SessionMessageRow,
  TemplateRow,
} from '../shared/ipc.js'
import {
  sanitizeExportMessageIds,
  sanitizeExportOptions,
  sanitizeMessageId,
  sanitizePlanId,
  sanitizeSearchFilters,
  sanitizeSessionId,
  sanitizeTagIds,
  sanitizeTemplateBody,
  sanitizeTemplateId,
  sanitizeTemplateName,
} from './ipcGuards.js'

// The Electron main bundle is emitted as CommonJS (dist-electron/main.cjs), so
// __dirname is provided by Node's module wrapper — no import.meta.url shim needed.
declare const __dirname: string

let mainWindow: BrowserWindow | null = null
let db: ReturnType<typeof openVaultDb> | null = null
let claudeRoot = ''
let plansRoot = ''

function vaultDbPath(): string {
  return path.join(app.getPath('userData'), 'vault.db')
}

function broadcastIndexUpdated() {
  mainWindow?.webContents.send(IPC.onIndexUpdated)
}

function broadcastIndexProgress(p: IndexProgress) {
  mainWindow?.webContents.send(IPC.onIndexProgress, p)
}

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Index projects one directory per macrotask so the window paints first and the
 * event loop keeps flushing progress events instead of freezing on a big sync scan.
 */
async function runInitialIndex() {
  if (!db) return
  const jobs = getAvailableAdapters().flatMap((adapter) =>
    adapter.listProjects().map((project) => ({ adapter, project })),
  )
  const total = jobs.length
  for (let i = 0; i < jobs.length; i += 1) {
    indexAdapterProject(db, jobs[i].adapter, jobs[i].project)
    broadcastIndexProgress({ phase: 'projects', current: i + 1, total, label: jobs[i].project.displayName })
    broadcastIndexUpdated()
    await nextTick()
  }
  pruneMissingProjectsAndSessions(db)
  broadcastIndexProgress({ phase: 'plans', current: 0, total: 1 })
  await nextTick()
  fullReindexPlans(db, plansRoot)
  broadcastIndexProgress({ phase: 'done', current: total, total })
  broadcastIndexUpdated()
  startWatcher()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Claude Vault',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    // DevTools는 Electron/Chromium 버전 차이로 콘솔에 무해한 오류가 잔뜩 찍힐 수 있어 기본은 끕니다.
    // 필요 시: VAULT_OPEN_DEVTOOLS=1 npm run dev
    if (process.env.VAULT_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function registerIpc() {
  ipcMain.handle(IPC.projectsList, async () => {
    if (!db) return []
    const rows = db
      .prepare(
        `SELECT p.id, p.slug, p.display_name AS displayName, p.root_path AS path, p.tool AS tool,
                COUNT(DISTINCT s.id) AS sessionCount,
                MAX(s.file_mtime_ms) AS lastModified
         FROM projects p
         LEFT JOIN sessions s ON s.project_id = p.id
         GROUP BY p.id
         ORDER BY (lastModified IS NULL) ASC, lastModified DESC, p.slug`,
      )
      .all() as {
        id: number
        slug: string
        displayName: string
        path: string
        tool: string
        sessionCount: number
        lastModified: number | null
      }[]
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      displayName: r.displayName,
      path: r.path,
      tool: r.tool ?? 'claude',
      sessionCount: r.sessionCount,
      lastModified: r.lastModified,
    }))
  })

  ipcMain.handle(IPC.search, async (_e, raw: unknown) => {
    if (!db) return []
    return unifiedSearch(db, sanitizeSearchFilters(raw))
  })

  ipcMain.handle(IPC.plansList, async () => {
    if (!db) return []
    return db
      .prepare(
        `SELECT id, file_path AS filePath, title, file_mtime_ms AS mtime
         FROM plan_files
         ORDER BY file_mtime_ms DESC
         LIMIT 40`,
      )
      .all() as PlanListRow[]
  })

  ipcMain.handle(IPC.planBody, async (_e, raw: unknown) => {
    if (!db) return ''
    const planId = sanitizePlanId(raw)
    if (planId == null) return ''
    const row = db.prepare(`SELECT body FROM plan_files WHERE id = ?`).get(planId) as { body: string } | undefined
    return row?.body ?? ''
  })

  ipcMain.handle(IPC.sessionTranscript, async (_e, raw: unknown) => {
    if (!db) return []
    const sessionId = sanitizeSessionId(raw)
    if (sessionId == null) return []
    const rows = db
      .prepare(
        `SELECT m.id AS messageId, m.line_index AS lineIndex, m.role, m.body,
                COALESCE(m.message_class, 'dialog') AS messageClass,
                m.content_kinds AS contentKinds
         FROM messages m
         WHERE m.session_id = ?
         ORDER BY m.line_index ASC
         LIMIT 25000`,
      )
      .all(sessionId) as (Omit<SessionMessageRow, 'contentKinds'> & {
        contentKinds: string | null
      })[]
    return rows.map((r): SessionMessageRow => {
      let kinds: string[] = []
      try {
        const parsed = r.contentKinds ? JSON.parse(r.contentKinds) : []
        if (Array.isArray(parsed)) kinds = parsed.filter((k): k is string => typeof k === 'string')
      } catch {
        /* stored value is not valid JSON — treat as no kinds */
      }
      return { ...r, contentKinds: kinds }
    })
  })

  ipcMain.handle(IPC.recentSessions, async (_e, projectId: number | null | undefined) => {
    if (!db) return []
    const pid = typeof projectId === 'number' && Number.isFinite(projectId) ? projectId : null
    const baseSql = `SELECT s.id AS sessionId,
                p.display_name AS projectName,
                s.rel_path AS sessionFile,
                s.file_mtime_ms AS mtime,
                (SELECT substr(m2.body, 1, 140) FROM messages m2 WHERE m2.session_id = s.id ORDER BY m2.line_index ASC LIMIT 1) AS preview
         FROM sessions s
         JOIN projects p ON p.id = s.project_id`
    if (pid != null) {
      return db
        .prepare(
          `${baseSql}
         WHERE p.id = ?
         ORDER BY s.file_mtime_ms DESC
         LIMIT 18`,
        )
        .all(pid) as RecentSessionRow[]
    }
    return db
      .prepare(
        `${baseSql}
         ORDER BY s.file_mtime_ms DESC
         LIMIT 18`,
      )
      .all() as RecentSessionRow[]
  })

  ipcMain.handle(IPC.templatesList, async () => {
    if (!db) return []
    return db
      .prepare(
        `SELECT id, name, body, created_at AS createdAt, updated_at AS updatedAt
         FROM templates ORDER BY updated_at DESC`,
      )
      .all() as TemplateRow[]
  })

  ipcMain.handle(IPC.templateCreate, async (_e, rawName: unknown, rawBody: unknown) => {
    if (!db) return 0
    const name = sanitizeTemplateName(rawName) || '무제 템플릿'
    const body = sanitizeTemplateBody(rawBody)
    const now = Date.now()
    const r = db
      .prepare(`INSERT INTO templates (name, body, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(name, body, now, now)
    return Number(r.lastInsertRowid)
  })

  ipcMain.handle(IPC.templateUpdate, async (_e, rawId: unknown, rawName: unknown, rawBody: unknown) => {
    if (!db) return
    const id = sanitizeTemplateId(rawId)
    if (id == null) return
    const name = sanitizeTemplateName(rawName) || '무제 템플릿'
    const body = sanitizeTemplateBody(rawBody)
    db.prepare(`UPDATE templates SET name = ?, body = ?, updated_at = ? WHERE id = ?`).run(
      name,
      body,
      Date.now(),
      id,
    )
  })

  ipcMain.handle(IPC.templateDelete, async (_e, rawId: unknown) => {
    if (!db) return
    const id = sanitizeTemplateId(rawId)
    if (id == null) return
    db.prepare(`DELETE FROM templates WHERE id = ?`).run(id)
  })

  ipcMain.handle(IPC.reindex, async () => {
    if (!db) return { projects: 0, sessions: 0, planFiles: 0 }
    let projects = 0
    let sessions = 0
    for (const adapter of getAvailableAdapters()) {
      for (const project of adapter.listProjects()) {
        sessions += indexAdapterProject(db, adapter, project)
        projects += 1
      }
    }
    pruneMissingProjectsAndSessions(db)
    const plansRes = fullReindexPlans(db, plansRoot)
    broadcastIndexUpdated()
    return { projects, sessions, planFiles: plansRes.planFiles }
  })

  ipcMain.handle(IPC.copyText, async (_e, text: string) => {
    const s = String(text ?? '')
    const max = 5_000_000
    clipboard.writeText(s.length > max ? `${s.slice(0, max)}\n…(truncated)` : s)
  })

  ipcMain.handle(IPC.favoritesList, async () => {
    if (!db) return []
    return db
      .prepare(
        `SELECT f.id, f.message_id AS messageId, s.id AS sessionId, m.body, m.role, p.slug AS projectSlug,
                s.rel_path AS sessionFile, f.created_at AS createdAt
         FROM favorites f
         JOIN messages m ON m.id = f.message_id
         JOIN sessions s ON s.id = m.session_id
         JOIN projects p ON p.id = s.project_id
         ORDER BY f.created_at DESC`,
      )
      .all()
  })

  ipcMain.handle(IPC.favoriteAdd, async (_e, raw: unknown) => {
    if (!db) return
    const messageId = sanitizeMessageId(raw)
    if (messageId == null) return
    db.prepare(`INSERT OR IGNORE INTO favorites (message_id, created_at) VALUES (?, ?)`).run(messageId, Date.now())
  })

  ipcMain.handle(IPC.favoriteRemove, async (_e, raw: unknown) => {
    if (!db) return
    const messageId = sanitizeMessageId(raw)
    if (messageId == null) return
    db.prepare(`DELETE FROM favorites WHERE message_id = ?`).run(messageId)
  })

  ipcMain.handle(IPC.tagsList, async () => {
    if (!db) return []
    return db.prepare(`SELECT id, name, color FROM tags ORDER BY name`).all()
  })

  ipcMain.handle(IPC.tagCreate, async (_e, name: string, color: string | null) => {
    if (!db) return 0
    const trimmed = String(name ?? '')
      .trim()
      .slice(0, 200)
    if (!trimmed) return 0
    try {
      const r = db.prepare(`INSERT INTO tags (name, color) VALUES (?, ?)`).run(trimmed, color)
      return Number(r.lastInsertRowid)
    } catch {
      const row = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(trimmed) as { id: number }
      return row?.id ?? 0
    }
  })

  ipcMain.handle(IPC.messageTagsGet, async (_e, raw: unknown) => {
    if (!db) return []
    const messageId = sanitizeMessageId(raw)
    if (messageId == null) return []
    const rows = db
      .prepare(`SELECT tag_id AS tagId FROM message_tags WHERE message_id = ?`)
      .all(messageId) as { tagId: number }[]
    return rows.map((r) => r.tagId)
  })

  ipcMain.handle(IPC.messageTagsSet, async (_e, rawMsg: unknown, rawTagIds: unknown) => {
    if (!db) return
    const database = db
    const messageId = sanitizeMessageId(rawMsg)
    if (messageId == null) return
    const tagIds = sanitizeTagIds(rawTagIds)
    const tx = database.transaction(() => {
      database.prepare(`DELETE FROM message_tags WHERE message_id = ?`).run(messageId)
      const ins = database.prepare(`INSERT OR IGNORE INTO message_tags (message_id, tag_id) VALUES (?, ?)`)
      for (const tid of tagIds) {
        ins.run(messageId, tid)
      }
    })
    tx()
  })

  ipcMain.handle(IPC.stats, async () => {
    if (!db) {
      return {
        totalProjects: 0,
        totalSessions: 0,
        totalMessages: 0,
        messagesByRole: [],
        topTokens: [],
        activityByDay: [],
        tokenTotals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        tokensByModel: [],
        activityFromTimestamps: false,
      }
    }
    return computeStats(db)
  })

  ipcMain.handle(
    IPC.exportMessages,
    async (_e, rawIds: unknown, format: unknown, rawOpts?: unknown) => {
    if (!db) return ''
    const messageIds = sanitizeExportMessageIds(rawIds)
    if (!messageIds.length) return ''
    const fmt = format === 'csv' ? 'csv' : 'md'
    const opts = sanitizeExportOptions(rawOpts)
    const placeholders = messageIds.map(() => '?').join(',')
    let rows = db
      .prepare(
        `SELECT m.id, m.role, m.body, m.line_index, m.message_class AS messageClass, s.rel_path, p.slug
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         JOIN projects p ON p.id = s.project_id
         WHERE m.id IN (${placeholders})
         ORDER BY m.id`,
      )
      .all(...messageIds) as {
        id: number
        role: string
        body: string
        line_index: number
        messageClass: string
        rel_path: string
        slug: string
      }[]

    const exM = opts?.excludeMeta !== false
    const exS = opts?.excludeSubagents === true
    if (exM) {
      rows = rows.filter((r) => r.messageClass !== 'meta')
    }
    if (exS) {
      rows = rows.filter((r) => !r.rel_path.includes('subagents'))
    }

    if (fmt === 'csv') {
      const header = 'id,project,session_file,line,role,body\n'
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
      const lines = rows.map((r) =>
        [r.id, r.slug, r.rel_path, r.line_index, r.role, esc(r.body)].join(','),
      )
      return header + lines.join('\n')
    }
    const parts = rows.map(
      (r) => `### ${r.slug} / ${r.rel_path} (line ${r.line_index}, ${r.role})\n\n${r.body}\n`,
    )
    return parts.join('\n---\n\n')
  })
}

function startWatcher() {
  // chokidar v4 removed glob support: watch the roots directly (recursive by default)
  // and filter by extension in the dispatch handler. Skip heavy/irrelevant subtrees.
  const IGNORE_DIRS = new Set(['node_modules', '.git', '__pycache__'])
  const watcher = chokidar.watch([claudeRoot, plansRoot], {
    ignoreInitial: true,
    ignored: (p: string) => p.split(/[\\/]/).some((seg) => IGNORE_DIRS.has(seg)),
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  })

  const dispatch = (p: string, kind: 'add' | 'change' | 'unlink') => {
    if (!db) return
    const np = path.normalize(p)
    if (isPathUnderPlansRoot(plansRoot, np) && np.toLowerCase().endsWith('.md')) {
      if (kind === 'unlink') {
        db.prepare(`DELETE FROM plan_files WHERE file_path = ?`).run(np)
      } else {
        indexPlanSinglePath(db, plansRoot, np)
      }
    } else if (np.toLowerCase().endsWith('.jsonl') && kind !== 'unlink') {
      indexSinglePath(db, claudeRoot, np)
    }
    broadcastIndexUpdated()
  }

  watcher.on('add', (p) => dispatch(p, 'add'))
  watcher.on('change', (p) => dispatch(p, 'change'))
  watcher.on('unlink', (p) => dispatch(p, 'unlink'))
}

app.whenReady().then(() => {
  claudeRoot = defaultClaudeProjectsRoot()
  plansRoot = defaultClaudePlansRoot()
  if (!fs.existsSync(claudeRoot)) {
    fs.mkdirSync(claudeRoot, { recursive: true })
  }
  if (!fs.existsSync(plansRoot)) {
    fs.mkdirSync(plansRoot, { recursive: true })
  }
  db = openVaultDb(vaultDbPath())
  registerIpc()
  // Show the window first, then index in the background so a large ~/.claude
  // does not delay first paint. The watcher starts once the initial pass finishes.
  createWindow()
  mainWindow?.webContents.once('did-finish-load', () => {
    void runInitialIndex()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
