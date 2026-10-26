import path from 'node:path'
import fs from 'node:fs'
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import { getSetting, openVaultDb, setSetting } from './db.js'
import { claudeHomeDir, defaultClaudePlansRoot } from './claudeRoots.js'
import { allAdapters } from './adapters.js'
import { archiveModeOf } from './indexer.js'
import { IndexService } from './indexService.js'
import { QueryService } from './queryService.js'
import { checkForUpdates, getUpdateStatus, initAutoUpdate, installUpdate, setAutoUpdateEnabled } from './updater.js'
import { listPrices, resetPrices, savePrices } from './prices.js'
import { EMPTY_STATS } from './stats.js'
import {
  addFavorite,
  createTag,
  deleteTag,
  listFavorites,
  listProjects,
  listTags,
  messageBody,
  purgeArchived,
  recentSessions,
  removeFavorite,
  renameTag,
  sessionInfo,
  setMessageTags,
} from './queries.js'
import { IPC } from '../shared/ipc.js'
import type {
  ExportSaveResult,
  FileRow,
  FileTouchRow,
  IndexProgress,
  PlanListRow,
  PromptRow,
  ReindexResult,
  SessionMessageRow,
  Settings,
  SettingsInfo,
  StatsPayload,
  TemplateRow,
  UnifiedSearchHit,
} from '../shared/ipc.js'
import type { WatchEventKind } from './workerProtocol.js'
import {
  sanitizeClipboardText,
  sanitizeExportFormat,
  sanitizeExportMessageIds,
  sanitizeFilePath,
  sanitizeFileQuery,
  sanitizeExportOptions,
  sanitizeMessageId,
  sanitizeMsgKey,
  sanitizePlanId,
  sanitizePromptQuery,
  sanitizeSearchFilters,
  sanitizeSessionId,
  sanitizeSettingsPatch,
  sanitizeTagColor,
  sanitizeTagIds,
  sanitizeTagName,
  sanitizeTemplateBody,
  sanitizeTemplateId,
  sanitizePrices,
  sanitizeTemplateName,
} from './ipcGuards.js'

// The Electron main bundle is emitted as CommonJS (dist-electron/main.cjs), so
// __dirname is provided by Node's module wrapper — no import.meta.url shim needed.
declare const __dirname: string

// Test/dev override: keep the vault DB somewhere disposable instead of the real profile.
const userDataOverride = process.env.VAULT_USER_DATA?.trim()
if (userDataOverride && path.isAbsolute(userDataOverride)) app.setPath('userData', userDataOverride)

let mainWindow: BrowserWindow | null = null
let db: ReturnType<typeof openVaultDb> | null = null
let indexService: IndexService | null = null
let queryService: QueryService | null = null
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

/**
 * The renderer displays text harvested from log files we do not control, so it
 * is treated as untrusted: links may only leave the app through the OS browser,
 * and the window itself must never navigate away from the app bundle.
 */
function applyNavigationPolicy(win: BrowserWindow) {
  const devOrigin = process.env.VITE_DEV_SERVER_URL

  const openExternally = (url: string) => {
    // Only ever hand well-known web schemes to the OS; file:/ javascript: etc. are dropped.
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const sameApp = devOrigin ? url.startsWith(devOrigin) : url.startsWith('file://')
    if (!sameApp) {
      event.preventDefault()
      openExternally(url)
    }
  })

  // Nothing in this app needs a webview, permissions, or remote content.
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Claude Vault',
    backgroundColor: '#fafafb',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only touches contextBridge/ipcRenderer, so the renderer can
      // run fully sandboxed.
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  applyNavigationPolicy(mainWindow)

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

function readSettings(): Settings {
  return {
    archiveMode: db ? archiveModeOf(db) : 'keep',
    autoUpdate: db ? getSetting(db, 'autoUpdate') !== 'off' : true,
  }
}

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

/** Never write under ~/.claude — not even an export the user points there by accident. */
function isInsideClaudeHome(target: string): boolean {
  const rel = path.relative(claudeHomeDir(), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function registerIpc() {
  const query = <T>(method: string, ...args: unknown[]) => queryService!.call<T>(method, ...args)

  ipcMain.handle(IPC.projectsList, async () => (db ? listProjects(db) : []))

  // `null` = superseded by a newer search while waiting (see QueryService.search).
  ipcMain.handle(IPC.search, async (_e, raw: unknown) =>
    db ? queryService!.search<UnifiedSearchHit[]>(sanitizeSearchFilters(raw)) : [],
  )

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
    const sessionId = sanitizeSessionId(raw)
    if (!db || sessionId == null) return []
    return query<SessionMessageRow[]>('transcript', sessionId)
  })

  ipcMain.handle(IPC.sessionInfo, async (_e, raw: unknown) => {
    const sessionId = sanitizeSessionId(raw)
    return db && sessionId != null ? sessionInfo(db, sessionId) : null
  })

  ipcMain.handle(IPC.messageBody, async (_e, raw: unknown) => {
    const id = sanitizeMessageId(raw)
    return db && id != null ? messageBody(db, id) : ''
  })

  ipcMain.handle(IPC.recentSessions, async (_e, raw: unknown) =>
    db ? recentSessions(db, sanitizeSessionId(raw)) : [],
  )

  ipcMain.handle(IPC.promptsList, async (_e, raw: unknown) =>
    db ? query<PromptRow[]>('prompts', sanitizePromptQuery(raw)) : [],
  )

  ipcMain.handle(IPC.pricesList, async () => (db ? listPrices(db) : []))

  ipcMain.handle(IPC.pricesSave, async (_e, raw: unknown) => {
    if (!db) return []
    return savePrices(db, sanitizePrices(raw))
  })

  ipcMain.handle(IPC.pricesReset, async () => (db ? resetPrices(db) : []))

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
    const name = sanitizeTemplateName(rawName)
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
    const name = sanitizeTemplateName(rawName)
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

  ipcMain.handle(IPC.filesList, async (_e, raw: unknown) =>
    db ? query<FileRow[]>('filesList', sanitizeFileQuery(raw)) : [],
  )

  ipcMain.handle(IPC.fileTimeline, async (_e, raw: unknown) => {
    const p = sanitizeFilePath(raw)
    if (!db || !p) return []
    return query<FileTouchRow[]>('fileTimeline', p)
  })

  ipcMain.handle(IPC.updateStatus, async () => getUpdateStatus())
  ipcMain.handle(IPC.updateCheck, async () => checkForUpdates())
  ipcMain.handle(IPC.updateInstall, async () => installUpdate())

  ipcMain.handle(IPC.reindex, async (_e, rawReparse: unknown): Promise<ReindexResult> => {
    if (!indexService) return { projects: 0, sessions: 0, planFiles: 0 }
    return indexService.scan(rawReparse === true)
  })

  ipcMain.handle(IPC.copyText, async (_e, raw: unknown) => {
    clipboard.writeText(sanitizeClipboardText(raw))
  })

  ipcMain.handle(IPC.favoritesList, async () => (db ? listFavorites(db) : []))

  ipcMain.handle(IPC.favoriteAdd, async (_e, raw: unknown) => {
    const messageId = sanitizeMessageId(raw)
    if (db && messageId != null) addFavorite(db, messageId)
  })

  ipcMain.handle(IPC.favoriteRemove, async (_e, raw: unknown) => {
    const key = sanitizeMsgKey(raw)
    if (db && key) removeFavorite(db, key)
  })

  ipcMain.handle(IPC.tagsList, async () => (db ? listTags(db) : []))

  ipcMain.handle(IPC.tagCreate, async (_e, rawName: unknown, rawColor: unknown) => {
    const name = sanitizeTagName(rawName)
    if (!db || !name) return 0
    return createTag(db, name, sanitizeTagColor(rawColor))
  })

  ipcMain.handle(IPC.tagRename, async (_e, rawId: unknown, rawName: unknown) => {
    const id = sanitizeTemplateId(rawId)
    const name = sanitizeTagName(rawName)
    if (!db || id == null || !name) return false
    return renameTag(db, id, name)
  })

  ipcMain.handle(IPC.tagDelete, async (_e, rawId: unknown) => {
    const id = sanitizeTemplateId(rawId)
    if (db && id != null) deleteTag(db, id)
  })

  ipcMain.handle(IPC.messageTagsSet, async (_e, rawKey: unknown, rawTagIds: unknown) => {
    const key = sanitizeMsgKey(rawKey)
    if (db && key) setMessageTags(db, key, sanitizeTagIds(rawTagIds))
  })

  ipcMain.handle(IPC.stats, async () => (db ? query<StatsPayload>('stats') : EMPTY_STATS))

  ipcMain.handle(IPC.settingsGet, async (): Promise<SettingsInfo> => {
    const dbPath = vaultDbPath()
    return {
      ...readSettings(),
      dbPath,
      dbSizeBytes: fileSize(dbPath) + fileSize(`${dbPath}-wal`),
      claudeHome: claudeHomeDir(),
    }
  })

  ipcMain.handle(IPC.settingsSet, async (_e, raw: unknown): Promise<Settings> => {
    const patch = sanitizeSettingsPatch(raw)
    if (db) {
      if (patch.archiveMode) setSetting(db, 'archiveMode', patch.archiveMode)
      if (patch.autoUpdate != null) {
        setSetting(db, 'autoUpdate', patch.autoUpdate ? 'on' : 'off')
        setAutoUpdateEnabled(patch.autoUpdate)
      }
    }
    return readSettings()
  })

  ipcMain.handle(IPC.archivePurge, async () => {
    if (!db) return 0
    const n = purgeArchived(db)
    broadcastIndexUpdated()
    return n
  })

  ipcMain.handle(
    IPC.exportMessages,
    async (_e, rawIds: unknown, format: unknown, rawOpts?: unknown) => {
    if (!db) return ''
    const messageIds = sanitizeExportMessageIds(rawIds)
    if (!messageIds.length) return ''
    const fmt = sanitizeExportFormat(format)
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

  ipcMain.handle(IPC.exportSave, async (_e, rawText: unknown, rawFormat: unknown): Promise<ExportSaveResult> => {
    const text = String(rawText ?? '')
    if (!text) return { saved: false }
    const ext = sanitizeExportFormat(rawFormat)
    const stamp = new Date().toISOString().slice(0, 10)
    const opts = {
      defaultPath: path.join(app.getPath('documents'), `claude-vault-export-${stamp}.${ext}`),
      filters: [ext === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'Markdown', extensions: ['md'] }],
    }
    const res = mainWindow ? await dialog.showSaveDialog(mainWindow, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { saved: false }
    if (isInsideClaudeHome(res.filePath)) {
      return { saved: false, error: 'claude-home' }
    }
    try {
      fs.writeFileSync(res.filePath, text, 'utf8')
      return { saved: true, path: res.filePath }
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/**
 * Content-Security-Policy applied to every response. The renderer never loads
 * remote code or makes network requests, so everything but same-origin assets is
 * denied. Vite's dev server needs inline/eval for HMR, so the dev policy is
 * loosened only for scripts while still blocking remote origins.
 */
function applyContentSecurityPolicy() {
  const dev = Boolean(process.env.VITE_DEV_SERVER_URL)
  const scriptSrc = dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'"
  const connectSrc = dev ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'none'"
  const policy = [
    "default-src 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    connectSrc,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ')

  const { session } = mainWindow!.webContents
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

let watcher: FSWatcher | null = null

/**
 * Watch every source root (Claude projects, plans, other tools). chokidar v4 removed
 * glob support, so roots are watched directly and filtered by extension. A root that
 * does not exist yet (Claude Code not run yet, Codex not installed) is polled until it
 * appears — the app never creates directories under ~/.claude itself.
 */
function startWatcher() {
  const IGNORE_DIRS = new Set(['node_modules', '.git', '__pycache__'])
  const roots = [...new Set([...allAdapters().map((a) => a.root), plansRoot])]
  watcher = chokidar.watch([], {
    ignoreInitial: true,
    ignored: (p: string) => p.split(/[\\/]/).some((seg) => IGNORE_DIRS.has(seg)),
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  })

  // Claude Code appends to the active session constantly; batch events per flush.
  const pending = new Map<string, WatchEventKind>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const enqueue = (p: string, kind: WatchEventKind) => {
    const np = path.normalize(p)
    const lower = np.toLowerCase()
    if (!lower.endsWith('.jsonl') && !lower.endsWith('.md')) return
    pending.set(np, kind)
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null
        const events = [...pending].map(([path, kind]) => ({ path, kind }))
        pending.clear()
        indexService?.notify(events)
      }, 300)
    }
  }
  watcher.on('add', (p) => enqueue(p, 'add'))
  watcher.on('change', (p) => enqueue(p, 'change'))
  watcher.on('unlink', (p) => enqueue(p, 'unlink'))

  const waiting = new Set<string>()
  for (const root of roots) {
    if (fs.existsSync(root)) watcher.add(root)
    else waiting.add(root)
  }
  if (waiting.size) {
    const poll = setInterval(() => {
      for (const root of [...waiting]) {
        if (!fs.existsSync(root)) continue
        waiting.delete(root)
        watcher?.add(root)
        void indexService?.scan().catch((err) => console.error('[vault] scan after root appeared failed', err))
      }
      if (!waiting.size) clearInterval(poll)
    }, 30_000)
  }
}

/**
 * The vault DB is mostly a rebuildable cache of ~/.claude, so a corrupt or unreadable
 * file must never block startup: quarantine it (kept on disk, so user data can still
 * be recovered by hand) and index again from scratch.
 */
function openVaultDbResilient(): ReturnType<typeof openVaultDb> {
  const file = vaultDbPath()
  try {
    return openVaultDb(file)
  } catch (err) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    console.error('[vault] failed to open database, rebuilding:', err)
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${file}${suffix}`
      try {
        if (fs.existsSync(p)) fs.renameSync(p, `${p}.corrupt-${stamp}`)
      } catch {
        try {
          fs.rmSync(p, { force: true })
        } catch {
          /* nothing else we can do; the retry below will surface it */
        }
      }
    }
    return openVaultDb(file)
  }
}

/**
 * Main-process dialogs can fire before any window exists, so they cannot reach
 * the renderer's locale. Fall back to the OS locale — the only signal available
 * this early.
 */
function mainLocale(): 'ko' | 'en' {
  return app.getLocale().toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

const MAIN_STRINGS = {
  ko: { fatal: '예기치 못한 오류가 발생했습니다.', continue: '계속', initialIndex: '초기 인덱싱' },
  en: { fatal: 'Something went wrong.', continue: 'Continue', initialIndex: 'initial indexing' },
} as const

function reportFatal(scope: string, err: unknown) {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(`[vault] ${scope}:`, message)
  if (app.isReady()) {
    const s = MAIN_STRINGS[mainLocale()]
    dialog.showMessageBox({
      type: 'error',
      title: 'Claude Vault',
      message: s.fatal,
      detail: `${scope}\n\n${message.slice(0, 1500)}`,
      buttons: [s.continue],
    })
  }
}

// A background indexing failure must not take the whole app down.
process.on('uncaughtException', (err) => reportFatal('uncaughtException', err))
process.on('unhandledRejection', (err) => reportFatal('unhandledRejection', err))

// Two instances writing one SQLite file is a corruption risk — focus the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    plansRoot = defaultClaudePlansRoot()
    db = openVaultDbResilient()
    const dbFile = vaultDbPath()
    queryService = new QueryService(dbFile)
    indexService = new IndexService({
      dbFile,
      plansRoot,
      onProgress: broadcastIndexProgress,
      onUpdated: broadcastIndexUpdated,
      onError: (message) => reportFatal(MAIN_STRINGS[mainLocale()].initialIndex, message),
    })
    registerIpc()
    // Show the window first, then index on the worker so a large ~/.claude never
    // delays first paint. The watcher starts once the initial pass finishes.
    createWindow()
    applyContentSecurityPolicy()
    mainWindow?.webContents.once('did-finish-load', () => {
      indexService!.start()
      void indexService!
        .scan()
        .then(() => startWatcher())
        .catch((err) => reportFatal(MAIN_STRINGS[mainLocale()].initialIndex, err))
      if (mainWindow) initAutoUpdate(mainWindow, readSettings().autoUpdate)
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown) return
  // Let both workers close their DB handles cleanly before the process exits.
  shuttingDown = true
  event.preventDefault()
  void (async () => {
    try {
      await watcher?.close()
      await Promise.all([indexService?.stop(), queryService?.stop()])
      db?.close()
    } catch {
      /* closing an already-closed handle is fine */
    }
    app.quit()
  })()
})
