import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  backupName,
  dailyBackupDue,
  DAILY_MS,
  isBackupName,
  listBackups,
  openVaultDbWithRecovery,
  pruneBackups,
  restoreBackup,
  snapshot,
  verifyBackup,
} from '../../electron/backup'
import { readSchemaVersion, SCHEMA_VERSION, setSetting, type DbHandle } from '../../electron/db'
import { indexSessionFile } from '../../electron/indexer'
import { addFavorite, listFavorites, removeFavorite } from '../../electron/queries'
import { assistantLine, sandbox, userLine, writeLines } from './helpers'

async function seeded() {
  const sb = sandbox()
  const db = sb.open()
  const pid = sb.project(db)
  const file = path.join(sb.projectRoot, 's1.jsonl')
  writeLines(file, [userLine('u1', 'keep this prompt'), assistantLine('a1', 'an answer')])
  await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
  const { id } = db.prepare(`SELECT id FROM messages WHERE msg_key = 'u1'`).get() as { id: number }
  addFavorite(db, id)
  const backups = path.join(sb.dir, 'backups')
  return { ...sb, db, backups }
}

const count = (db: DbHandle, table: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c

function readOnly(file: string) {
  return new Database(file, { readonly: true, fileMustExist: true })
}

describe('snapshots', () => {
  it('writes a complete, openable copy of a live DB and leaves no temp file', async () => {
    const { db, backups } = await seeded()
    const b = snapshot(db, backups, 'manual', new Date(Date.UTC(2026, 9, 27, 3, 15, 0)))
    expect(b.name).toBe('vault-20261027-031500-manual.db')
    expect(fs.readdirSync(backups)).toEqual([b.name])
    const copy = readOnly(path.join(backups, b.name))
    expect(count(copy, 'messages')).toBe(count(db, 'messages'))
    expect(count(copy, 'favorites')).toBe(1)
    expect(readSchemaVersion(copy)).toBe(SCHEMA_VERSION)
    copy.close()
  })

  it('never reuses a name taken in the same second', async () => {
    const { db, backups } = await seeded()
    const at = new Date(Date.UTC(2026, 9, 27, 3, 15, 0))
    const a = snapshot(db, backups, 'manual', at)
    const b = snapshot(db, backups, 'manual', at)
    expect(a.name).not.toBe(b.name)
    expect(listBackups(backups)).toHaveLength(2)
  })

  it('lists newest first, ignores other files, prunes with sidecars', async () => {
    const { db, backups } = await seeded()
    for (let d = 1; d <= 4; d++) snapshot(db, backups, 'daily', new Date(Date.UTC(2026, 9, d)))
    fs.writeFileSync(path.join(backups, 'notes.txt'), 'x')
    fs.writeFileSync(path.join(backups, `${backupName(new Date(Date.UTC(2026, 9, 9)), 'daily')}.tmp`), 'partial')
    const oldest = listBackups(backups).at(-1)!.name
    fs.writeFileSync(path.join(backups, `${oldest}-wal`), 'wal')

    expect(listBackups(backups).map((b) => b.createdAt)).toEqual(
      [4, 3, 2, 1].map((d) => Date.UTC(2026, 9, d)),
    )
    expect(pruneBackups(backups, 3)).toEqual([oldest])
    expect(fs.existsSync(path.join(backups, `${oldest}-wal`))).toBe(false)
    expect(listBackups(backups)).toHaveLength(3)
    // 0 means "off": it stops new backups but never deletes existing ones.
    expect(pruneBackups(backups, 0)).toEqual([])
  })

  it('knows when the daily snapshot is due', async () => {
    const { db, backups } = await seeded()
    const now = Date.UTC(2026, 9, 27, 12)
    expect(dailyBackupDue(backups, 3, now)).toBe(true)
    snapshot(db, backups, 'manual', new Date(now - 60_000))
    expect(dailyBackupDue(backups, 3, now)).toBe(false)
    expect(dailyBackupDue(backups, 3, now + DAILY_MS)).toBe(true)
    expect(dailyBackupDue(backups, 0, now + DAILY_MS)).toBe(false)
  })

  it('accepts only bare backup names from IPC', () => {
    expect(isBackupName('vault-20261027-031500-daily.db')).toBe(true)
    expect(isBackupName('../vault.db')).toBe(false)
    expect(isBackupName('/tmp/vault-20261027-031500-daily.db')).toBe(false)
    expect(isBackupName('vault-20261027-031500-evil.db')).toBe(false)
    expect(isBackupName(42)).toBe(false)
  })
})

describe('restore', () => {
  it('swaps the backup in and keeps the replaced DB as a pre-restore backup', async () => {
    const { db, dbFile, backups } = await seeded()
    const good = snapshot(db, backups, 'manual', new Date(Date.UTC(2026, 9, 1)))
    removeFavorite(db, 'u1')
    expect(listFavorites(db)).toHaveLength(0)
    db.close()

    const previous = restoreBackup(dbFile, backups, good.name, new Date(Date.UTC(2026, 9, 2)))
    expect(previous?.reason).toBe('pre-restore')
    // The pre-restore file is the live DB, still in WAL mode: checking it must not leave
    // the -wal/-shm that a read-only open creates (checked before anything else opens it).
    verifyBackup(path.join(backups, previous!.name))
    expect(fs.readdirSync(backups).filter((f) => f.startsWith(previous!.name))).toEqual([previous!.name])
    const restored = readOnly(dbFile)
    expect(listFavorites(restored)).toHaveLength(1)
    restored.close()
    const before = readOnly(path.join(backups, previous!.name))
    expect(count(before, 'favorites')).toBe(0)
    before.close()
    // The chosen backup itself is untouched.
    expect(listBackups(backups).map((b) => b.name)).toContain(good.name)
  })

  it('refuses files that are not vault DBs or come from a newer schema', async () => {
    const { db, backups } = await seeded()
    const b = snapshot(db, backups, 'manual')
    const newer = path.join(backups, backupName(new Date(Date.UTC(2030, 0, 1)), 'manual'))
    fs.copyFileSync(path.join(backups, b.name), newer)
    const w = new Database(newer)
    w.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run(String(SCHEMA_VERSION + 1))
    w.close()
    expect(() => verifyBackup(newer)).toThrow(/schema/)

    const junk = path.join(backups, backupName(new Date(Date.UTC(2031, 0, 1)), 'manual'))
    fs.writeFileSync(junk, 'not sqlite at all, just text that is long enough to look like a header')
    expect(() => verifyBackup(junk)).toThrow()
    expect(() => verifyBackup(path.join(backups, 'vault-20200101-000000-daily.db'))).toThrow(/not found/)
  })
})

describe('startup recovery', () => {
  it('replaces a DB that cannot be opened with the newest usable backup', async () => {
    const { db, dbFile, backups } = await seeded()
    snapshot(db, backups, 'daily', new Date(Date.UTC(2026, 9, 1)))
    const newest = snapshot(db, backups, 'daily', new Date(Date.UTC(2026, 9, 2)))
    db.close()
    // The newest backup is damaged too: recovery must fall back to the next one.
    fs.writeFileSync(path.join(backups, newest.name), 'garbage'.repeat(200))
    fs.writeFileSync(dbFile, 'garbage'.repeat(200))

    const { db: opened, outcome } = openVaultDbWithRecovery(dbFile, backups)
    expect(outcome.kind).toBe('recovered')
    if (outcome.kind !== 'recovered') throw new Error('unreachable')
    expect(outcome.from).toBe('vault-20261001-000000-daily.db')
    expect(listFavorites(opened)).toHaveLength(1)
    // The broken file is kept for manual recovery, not deleted.
    expect(fs.readFileSync(outcome.quarantined, 'utf8')).toMatch(/^garbage/)
    opened.close()
  })

  it('rebuilds an empty DB only when no backup is usable', async () => {
    const { db, dbFile, backups } = await seeded()
    db.close()
    fs.writeFileSync(dbFile, 'garbage'.repeat(200))
    const { db: opened, outcome } = openVaultDbWithRecovery(dbFile, backups)
    expect(outcome.kind).toBe('rebuilt')
    expect(count(opened, 'messages')).toBe(0)
    opened.close()
  })

  it('copies the old file before a schema migration (unless backups are off)', async () => {
    const sb = sandbox()
    const backups = path.join(sb.dir, 'backups')
    const legacy = new Database(sb.dbFile)
    legacy.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '8');`)
    legacy.close()

    const { db, outcome } = openVaultDbWithRecovery(sb.dbFile, backups)
    expect(outcome.kind).toBe('ok')
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)
    const [pre] = listBackups(backups)
    expect(pre.reason).toBe('pre-migration')
    const copy = readOnly(path.join(backups, pre.name))
    expect(readSchemaVersion(copy)).toBe(8)
    copy.close()

    // Same upgrade with backups turned off: no copy.
    db.prepare(`UPDATE meta SET value = '8' WHERE key = 'schema_version'`).run()
    setSetting(db, 'backupKeep', '0')
    db.close()
    fs.rmSync(backups, { recursive: true })
    const again = openVaultDbWithRecovery(sb.dbFile, backups)
    expect(listBackups(backups)).toHaveLength(0)
    again.db.close()
  })
})
