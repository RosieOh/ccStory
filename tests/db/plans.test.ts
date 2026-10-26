import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { listBackups, openVaultDbWithRecovery } from '../../electron/backup'
import { readSchemaVersion, SCHEMA_VERSION, type DbHandle } from '../../electron/db'
import { fullReindexPlans, indexPlanSinglePath } from '../../electron/plansIndexer'
import { purgeArchived } from '../../electron/queries'
import { unifiedSearch } from '../../electron/search'
import { sandbox } from './helpers'

function withPlans() {
  const sb = sandbox()
  const plansRoot = path.join(sb.dir, 'plans')
  fs.mkdirSync(plansRoot)
  const plan = path.join(plansRoot, 'rollout.md')
  fs.writeFileSync(plan, '# Rollout\n\nShip the quokkamarker flag first.\n')
  const db = sb.open()
  return { ...sb, db, plansRoot, plan }
}

const rows = (db: DbHandle) =>
  db.prepare(`SELECT file_path AS file, archived_at IS NOT NULL AS archived FROM plan_files`).all() as {
    file: string
    archived: number
  }[]
const search = (db: DbHandle) => unifiedSearch(db, { query: 'quokkamarker', scope: 'plans', limit: 10 })

describe('plans follow archive mode', () => {
  it('keeps a deleted plan searchable, badged as archived (Keep)', () => {
    const { db, plansRoot, plan } = withPlans()
    fullReindexPlans(db, plansRoot, 'keep')
    expect(search(db)).toMatchObject([{ hitType: 'plan', archived: false }])

    fs.rmSync(plan)
    fullReindexPlans(db, plansRoot, 'keep')
    expect(rows(db)).toEqual([{ file: plan, archived: 1 }])
    expect(search(db)).toMatchObject([{ hitType: 'plan', archived: true }])
  })

  it('deletes it with the file in Mirror mode, from a scan or a watcher event', () => {
    const { db, plansRoot, plan } = withPlans()
    const other = path.join(plansRoot, 'other.md')
    fs.writeFileSync(other, '# Other\n')
    fullReindexPlans(db, plansRoot, 'mirror')
    fs.rmSync(plan)
    fullReindexPlans(db, plansRoot, 'mirror')
    fs.rmSync(other)
    indexPlanSinglePath(db, plansRoot, other, 'mirror')
    expect(rows(db)).toEqual([])
  })

  it('changes nothing when the plans root itself is missing (unmounted volume)', () => {
    const { db, plansRoot } = withPlans()
    fullReindexPlans(db, plansRoot, 'mirror')
    fs.rmSync(plansRoot, { recursive: true })
    fullReindexPlans(db, plansRoot, 'mirror')
    indexPlanSinglePath(db, plansRoot, path.join(plansRoot, 'rollout.md'), 'mirror')
    expect(rows(db)).toHaveLength(1)
    expect(rows(db)[0].archived).toBe(0)
  })

  it('un-archives a plan whose file comes back unchanged', () => {
    const { db, plansRoot, plan } = withPlans()
    fullReindexPlans(db, plansRoot, 'keep')
    const saved = fs.readFileSync(plan)
    const { mtime } = fs.statSync(plan)
    fs.rmSync(plan)
    indexPlanSinglePath(db, plansRoot, plan, 'keep')
    expect(rows(db)[0].archived).toBe(1)
    fs.writeFileSync(plan, saved)
    fs.utimesSync(plan, mtime, mtime)
    indexPlanSinglePath(db, plansRoot, plan, 'keep')
    expect(rows(db)[0].archived).toBe(0)
  })

  it('"Delete all archived" removes archived plans too', () => {
    const { db, plansRoot, plan } = withPlans()
    fullReindexPlans(db, plansRoot, 'keep')
    fs.rmSync(plan)
    fullReindexPlans(db, plansRoot, 'keep')
    expect(purgeArchived(db)).toBe(1)
    expect(rows(db)).toEqual([])
  })
})

describe('schema v9 → v10', () => {
  it('adds plan_files.archived_at in place, after a pre-migration copy', () => {
    const { db, dbFile, dir, plansRoot } = withPlans()
    fullReindexPlans(db, plansRoot, 'keep')
    db.exec(`ALTER TABLE plan_files DROP COLUMN archived_at`)
    db.prepare(`UPDATE meta SET value = '9' WHERE key = 'schema_version'`).run()
    db.close()

    const backups = path.join(dir, 'backups')
    const { db: migrated } = openVaultDbWithRecovery(dbFile, backups)
    expect(readSchemaVersion(migrated)).toBe(SCHEMA_VERSION)
    // The plan row survives: the column is added, nothing is rebuilt.
    expect(rows(migrated)).toHaveLength(1)
    const [pre] = listBackups(backups)
    expect(pre.reason).toBe('pre-migration')
    const old = new Database(path.join(backups, pre.name), { readonly: true })
    expect(readSchemaVersion(old)).toBe(9)
    old.close()
    migrated.close()
  })
})
