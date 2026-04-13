import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, clipboard, ipcMain } from 'electron'
import chokidar from 'chokidar'
import { openVaultDb } from './db.js'
import { defaultClaudePlansRoot, defaultClaudeProjectsRoot } from './claudeRoots.js'
import { fullReindex, indexSinglePath } from './indexer.js'
import { fullReindexPlans, indexPlanSinglePath, isPathUnderPlansRoot } from './plansIndexer.js'
import { unifiedSearch } from './search.js'
import { computeStats } from './stats.js'
import { IPC } from '../shared/ipc.js'
import type { PlanListRow, RecentSessionRow, SessionMessageRow } from '../shared/ipc.js'
import {
  sanitizeExportMessageIds,
  sanitizeExportOptions,
  sanitizeMessageId,
  sanitizePlanId,
  sanitizeSearchFilters,
  sanitizeSessionId,
  sanitizeTagIds,
} from './ipcGuards.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Claude Vault',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
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
        `SELECT p.id, p.slug, p.display_name AS displayName, p.root_path AS path,
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
        sessionCount: number
        lastModified: number | null
      }[]
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      displayName: r.displayName,
      path: r.path,
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
                COALESCE(m.message_class, 'dialog') AS messageClass
         FROM messages m
         WHERE m.session_id = ?
         ORDER BY m.line_index ASC
         LIMIT 25000`,
      )
      .all(sessionId) as SessionMessageRow[]
    return rows
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

  ipcMain.handle(IPC.reindex, async () => {
    if (!db) return { projects: 0, sessions: 0, planFiles: 0 }
    const res = fullReindex(db, claudeRoot)
    const plansRes = fullReindexPlans(db, plansRoot)
    broadcastIndexUpdated()
    return { ...res, planFiles: plansRes.planFiles }
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
    const messageId = sanitizeMessageId(rawMsg)
    if (messageId == null) return
    const tagIds = sanitizeTagIds(rawTagIds)
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM message_tags WHERE message_id = ?`).run(messageId)
      const ins = db.prepare(`INSERT OR IGNORE INTO message_tags (message_id, tag_id) VALUES (?, ?)`)
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
  const patterns = [path.join(claudeRoot, '**', '*.jsonl'), path.join(plansRoot, '**', '*.md')]
  const watcher = chokidar.watch(patterns, {
    ignoreInitial: true,
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
  fullReindex(db, claudeRoot)
  fullReindexPlans(db, plansRoot)
  registerIpc()
  startWatcher()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
