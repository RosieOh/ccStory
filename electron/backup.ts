import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getSetting, openVaultDb, readSchemaVersion, SCHEMA_VERSION, type DbHandle } from './db.js'
import { BACKUP_KEEP_CHOICES, DEFAULT_BACKUP_KEEP, type BackupFile, type BackupReason } from '../shared/ipc.js'

/**
 * Snapshots of the vault DB in `<userData>/backups`. In Keep mode the DB is the only
 * copy of transcripts Claude Code deleted, so it gets the protection a sole copy needs:
 * a daily snapshot, one before every destructive step, and recovery from the newest
 * snapshot when the DB cannot be opened. Nothing here imports Electron, so the logic is
 * tested directly against SQLite.
 */

/** A daily snapshot is due when the newest backup is older than this. */
export const DAILY_MS = 24 * 60 * 60 * 1000

const REASONS: BackupReason[] = ['daily', 'manual', 'pre-migration', 'pre-purge', 'pre-restore']
const NAME_RE = /^vault-(\d{8})-(\d{6})-([a-z-]+)\.db$/
/** Files SQLite keeps next to a DB. Only the WAL carries data; `-shm` is rebuilt on open. */
const SIDECARS = ['-wal', '-shm']

export class BackupError extends Error {
  constructor(
    readonly code: 'disk' | 'invalid' | 'newer-schema' | 'missing',
    message: string,
  ) {
    super(message)
  }
}

export function backupKeepOf(db: DbHandle): number {
  const raw = getSetting(db, 'backupKeep')
  // Unset must mean the default, not Number(null) === 0 ("off").
  const v = raw == null ? NaN : Number(raw)
  return (BACKUP_KEEP_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_BACKUP_KEEP
}

/** `vault-20261027-031500-daily.db` — UTC, so names sort by time and never collide across DST. */
export function backupName(at: Date, reason: BackupReason): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const d = `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}`
  const t = `${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}`
  return `vault-${d}-${t}-${reason}.db`
}

function parseName(name: string): { createdAt: number; reason: BackupReason } | null {
  const m = name.match(NAME_RE)
  if (!m || !REASONS.includes(m[3] as BackupReason)) return null
  const [y, mo, d] = [m[1].slice(0, 4), m[1].slice(4, 6), m[1].slice(6, 8)].map(Number)
  const [h, mi, s] = [m[2].slice(0, 2), m[2].slice(2, 4), m[2].slice(4, 6)].map(Number)
  return { createdAt: Date.UTC(y, mo - 1, d, h, mi, s), reason: m[3] as BackupReason }
}

/** Accepts only a bare backup file name, never a path (IPC input). */
export function isBackupName(name: unknown): name is string {
  return typeof name === 'string' && parseName(name) != null
}

/** Newest first. Unrelated files and half-written `.tmp` snapshots are ignored. */
export function listBackups(dir: string): BackupFile[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: BackupFile[] = []
  for (const name of names) {
    const meta = parseName(name)
    if (!meta) continue
    try {
      out.push({ name, ...meta, sizeBytes: fs.statSync(path.join(dir, name)).size })
    } catch {
      /* deleted while listing */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
}

function freeBytes(dir: string): number {
  try {
    const s = fs.statfsSync(dir)
    return s.bavail * s.bsize
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** A unique name even when two snapshots land in the same second. */
function freshName(dir: string, at: Date, reason: BackupReason): string {
  let ms = at.getTime()
  let name = backupName(new Date(ms), reason)
  while (fs.existsSync(path.join(dir, name))) {
    ms += 1000
    name = backupName(new Date(ms), reason)
  }
  return name
}

/**
 * Consistent snapshot of a live DB (`VACUUM INTO` reads one transaction, so concurrent
 * writers on other connections are fine). Written to `.tmp` and renamed, so a crash
 * mid-copy never leaves something that looks like a backup.
 */
export function snapshot(db: DbHandle, dir: string, reason: BackupReason, now = new Date()): BackupFile {
  fs.mkdirSync(dir, { recursive: true })
  const dbBytes = fs.statSync(db.name).size
  if (freeBytes(dir) < dbBytes * 1.2) {
    throw new BackupError('disk', `not enough free space for a ${Math.round(dbBytes / 1e6)} MB snapshot`)
  }
  const name = freshName(dir, now, reason)
  const tmp = path.join(dir, `${name}.tmp`)
  fs.rmSync(tmp, { force: true })
  try {
    db.prepare(`VACUUM INTO ?`).run(tmp)
    fs.renameSync(tmp, path.join(dir, name))
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
  return { name, createdAt: parseName(name)!.createdAt, reason, sizeBytes: fs.statSync(path.join(dir, name)).size }
}

/**
 * Copy of a DB that no connection has open (startup, before a migration): the file and
 * its WAL are copied as they are. On APFS/Btrfs/ReFS this is a clone and costs nothing.
 */
export function copyClosedDb(dbFile: string, dir: string, reason: BackupReason, now = new Date()): BackupFile {
  fs.mkdirSync(dir, { recursive: true })
  const name = freshName(dir, now, reason)
  const dest = path.join(dir, name)
  if (fs.existsSync(`${dbFile}-wal`)) fs.copyFileSync(`${dbFile}-wal`, `${dest}-wal`, fs.constants.COPYFILE_FICLONE)
  fs.copyFileSync(dbFile, `${dest}.tmp`, fs.constants.COPYFILE_FICLONE)
  fs.renameSync(`${dest}.tmp`, dest)
  return { name, createdAt: parseName(name)!.createdAt, reason, sizeBytes: fs.statSync(dest).size }
}

/** Puts a copy of `source` (and its WAL, if any) at `dbFile`, replacing whatever is there. */
function installCopy(source: string, dbFile: string) {
  for (const suffix of SIDECARS) fs.rmSync(dbFile + suffix, { force: true })
  if (fs.existsSync(`${source}-wal`)) fs.copyFileSync(`${source}-wal`, `${dbFile}-wal`, fs.constants.COPYFILE_FICLONE)
  fs.copyFileSync(source, `${dbFile}.restoring`, fs.constants.COPYFILE_FICLONE)
  fs.renameSync(`${dbFile}.restoring`, dbFile)
}

function removeBackup(dir: string, name: string) {
  for (const suffix of ['', ...SIDECARS]) fs.rmSync(path.join(dir, name + suffix), { force: true })
}

/** Keeps the newest `keep` backups; returns the names removed. `keep` 0 removes nothing. */
export function pruneBackups(dir: string, keep: number): string[] {
  if (keep <= 0) return []
  const removed: string[] = []
  for (const b of listBackups(dir).slice(keep)) {
    removeBackup(dir, b.name)
    removed.push(b.name)
  }
  return removed
}

export function dailyBackupDue(dir: string, keep: number, now = Date.now()): boolean {
  if (keep <= 0) return false
  const newest = listBackups(dir)[0]
  return !newest || now - newest.createdAt >= DAILY_MS
}

/** Opens a backup read-only and checks it is a vault DB this build can open. */
export function verifyBackup(file: string): void {
  if (!fs.existsSync(file)) throw new BackupError('missing', `backup not found: ${path.basename(file)}`)
  // Opening a WAL-mode file, even read-only, creates empty -wal/-shm next to it; remove
  // the ones this check created so the backup folder only holds backups.
  const created = SIDECARS.filter((s) => !fs.existsSync(file + s))
  let db: DbHandle | null = null
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    const check = db.pragma('quick_check', { simple: true })
    if (check !== 'ok') throw new BackupError('invalid', `integrity check failed: ${String(check)}`)
    const v = readSchemaVersion(db)
    if (v === 0) throw new BackupError('invalid', 'not a vault database')
    if (v > SCHEMA_VERSION) throw new BackupError('newer-schema', `backup is schema v${v}; this build reads up to v${SCHEMA_VERSION}`)
  } catch (err) {
    if (err instanceof BackupError) throw err
    throw new BackupError('invalid', err instanceof Error ? err.message : String(err))
  } finally {
    db?.close()
    for (const s of created) fs.rmSync(file + s, { force: true })
  }
}

/**
 * Swaps a backup in for the live DB. Every connection to `dbFile` must be closed. The
 * current DB is not deleted: it is moved into the backup folder as a `pre-restore`
 * snapshot (a rename, so it costs no disk and the restore can itself be undone).
 */
export function restoreBackup(dbFile: string, dir: string, name: string, now = new Date()): BackupFile | null {
  const source = path.join(dir, name)
  verifyBackup(source)
  let previous: BackupFile | null = null
  if (fs.existsSync(dbFile)) {
    const prevName = freshName(dir, now, 'pre-restore')
    for (const suffix of SIDECARS) {
      if (fs.existsSync(dbFile + suffix)) fs.renameSync(dbFile + suffix, path.join(dir, prevName + suffix))
    }
    fs.renameSync(dbFile, path.join(dir, prevName))
    previous = listBackups(dir).find((b) => b.name === prevName) ?? null
  }
  installCopy(source, dbFile)
  return previous
}

export type OpenOutcome =
  | { kind: 'ok' }
  | { kind: 'recovered'; from: string; quarantined: string }
  | { kind: 'rebuilt'; quarantined: string }

function quarantine(dbFile: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const target = `${dbFile}.corrupt-${stamp}`
  for (const suffix of ['', ...SIDECARS]) {
    const p = dbFile + suffix
    try {
      if (fs.existsSync(p)) fs.renameSync(p, target + suffix)
    } catch {
      fs.rmSync(p, { force: true })
    }
  }
  return target
}

/** Schema version and backup setting of a DB without migrating it; null when unreadable. */
function peek(dbFile: string): { version: number; keep: number } | null {
  let db: DbHandle | null = null
  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true })
    return { version: readSchemaVersion(db), keep: backupKeepOf(db) }
  } catch {
    return null
  } finally {
    db?.close()
  }
}

/**
 * Opens (and migrates) the vault DB at startup.
 * - Before a schema migration, the old file is copied to the backup folder.
 * - A DB that cannot be opened is quarantined (kept on disk) and the newest backup that
 *   opens takes its place; only when none does is an empty DB created for a fresh index.
 */
export function openVaultDbWithRecovery(
  dbFile: string,
  dir: string,
  now = new Date(),
): { db: DbHandle; outcome: OpenOutcome } {
  if (fs.existsSync(dbFile)) {
    const info = peek(dbFile)
    if (info && info.version > 0 && info.version < SCHEMA_VERSION && info.keep > 0) {
      try {
        copyClosedDb(dbFile, dir, 'pre-migration', now)
        pruneBackups(dir, info.keep)
      } catch (err) {
        console.error('[vault] pre-migration backup failed:', err)
      }
    }
  }
  try {
    return { db: openVaultDb(dbFile), outcome: { kind: 'ok' } }
  } catch (err) {
    console.error('[vault] failed to open database:', err)
  }
  const quarantined = quarantine(dbFile, now)
  for (const b of listBackups(dir)) {
    try {
      verifyBackup(path.join(dir, b.name))
      installCopy(path.join(dir, b.name), dbFile)
      return { db: openVaultDb(dbFile), outcome: { kind: 'recovered', from: b.name, quarantined } }
    } catch (err) {
      console.error(`[vault] backup ${b.name} unusable:`, err)
      for (const suffix of ['', ...SIDECARS]) fs.rmSync(dbFile + suffix, { force: true })
    }
  }
  return { db: openVaultDb(dbFile), outcome: { kind: 'rebuilt', quarantined } }
}
