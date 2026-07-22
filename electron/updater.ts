import { app, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc.js'
import type { UpdateStatus } from '../shared/ipc.js'

/**
 * Auto-update via electron-updater.
 *
 * Deliberately conservative: downloads happen in the background but installing
 * is always the user's call — this app is opened to look something up, and a
 * surprise restart mid-search would lose the user's place.
 *
 * Only meaningful in a packaged, code-signed build. In dev (or unsigned) the
 * updater is skipped entirely rather than logging errors on every launch.
 */

let status: UpdateStatus = { state: 'idle' }
let win: BrowserWindow | null = null

function push(next: UpdateStatus) {
  status = next
  win?.webContents.send(IPC.onUpdateStatus, next)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

/** True when an update feed can actually work (packaged build with a publish config). */
export function updatesSupported(): boolean {
  return app.isPackaged && !process.env.VAULT_DISABLE_UPDATER
}

type Updater = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  on: (event: string, cb: (...args: unknown[]) => void) => void
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (silent?: boolean, forceRunAfter?: boolean) => void
}

let updater: Updater | null = null

function load(): Updater | null {
  if (updater) return updater
  try {
    // Required lazily (the main bundle is CommonJS) so dev runs never pay for it
    // and a missing/failed module degrades to "updates unavailable" rather than
    // blocking startup. A static import would load it on every launch.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('electron-updater') as { autoUpdater: Updater }
    updater = mod.autoUpdater
    return updater
  } catch (err) {
    console.error('[vault] electron-updater unavailable:', err)
    return null
  }
}

export function initAutoUpdate(browserWindow: BrowserWindow): void {
  win = browserWindow
  if (!updatesSupported()) {
    push({ state: 'unsupported' })
    return
  }

  const au = load()
  if (!au) {
    push({ state: 'unsupported' })
    return
  }

  au.autoDownload = true
  au.autoInstallOnAppQuit = false

  au.on('checking-for-update', () => push({ state: 'checking' }))
  au.on('update-not-available', () => push({ state: 'idle' }))
  au.on('update-available', (info) => {
    const version = (info as { version?: string })?.version
    push({ state: 'downloading', version, percent: 0 })
  })
  au.on('download-progress', (p) => {
    const percent = Math.round((p as { percent?: number })?.percent ?? 0)
    push({ ...status, state: 'downloading', percent })
  })
  au.on('update-downloaded', (info) => {
    const version = (info as { version?: string })?.version
    push({ state: 'ready', version })
  })
  au.on('error', (err) => {
    push({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  })

  void checkForUpdates()
  // A long-lived window should still notice releases; daily is plenty here.
  setInterval(() => void checkForUpdates(), 24 * 60 * 60 * 1000)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!updatesSupported()) {
    push({ state: 'unsupported' })
    return status
  }
  const au = load()
  if (!au) return status
  try {
    await au.checkForUpdates()
  } catch (err) {
    push({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  return status
}

/** Restart into the downloaded update. No-op unless one is ready. */
export function installUpdate(): void {
  if (status.state !== 'ready') return
  load()?.quitAndInstall(false, true)
}
