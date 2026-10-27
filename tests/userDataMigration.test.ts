import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyUserData } from '../electron/userDataMigration'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

function appData() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-appdata-'))
  dirs.push(d)
  return d
}
const put = (file: string, text = 'x') => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

describe('migrateLegacyUserData', () => {
  it('moves the old packaged folder to the new name when the new one does not exist', () => {
    const root = appData()
    put(path.join(root, 'Claude Vault', 'vault.db'), 'db')
    put(path.join(root, 'Claude Vault', 'backups', 'vault-20261027-000000-daily.db'))
    put(path.join(root, 'Claude Vault', 'Local Storage', 'leveldb', 'x'))
    const target = path.join(root, 'Trove')
    expect(migrateLegacyUserData(root, target)).toBe(path.join(root, 'Claude Vault'))
    expect(fs.readFileSync(path.join(target, 'vault.db'), 'utf8')).toBe('db')
    expect(fs.existsSync(path.join(target, 'backups', 'vault-20261027-000000-daily.db'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'Local Storage'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'Claude Vault'))).toBe(false)
  })

  it('fills a new folder that already exists without a DB, keeping what it has', () => {
    const root = appData()
    put(path.join(root, 'claude-vault', 'vault.db'), 'dev-db')
    put(path.join(root, 'claude-vault', 'vault.db-wal'), 'wal')
    put(path.join(root, 'claude-vault', 'Local Storage', 'leveldb', '000003.log'), 'locale=en')
    put(path.join(root, 'claude-vault', 'DevToolsActivePort'), 'old')
    const target = path.join(root, 'Trove')
    // Chromium created this before the app's code ran (seen with remote debugging).
    put(path.join(target, 'DevToolsActivePort'), 'new')
    expect(migrateLegacyUserData(root, target)).toBe(path.join(root, 'claude-vault'))
    expect(fs.readFileSync(path.join(target, 'vault.db'), 'utf8')).toBe('dev-db')
    expect(fs.readFileSync(path.join(target, 'vault.db-wal'), 'utf8')).toBe('wal')
    // Language and theme live in Local Storage: they come along too.
    expect(fs.readFileSync(path.join(target, 'Local Storage', 'leveldb', '000003.log'), 'utf8')).toBe('locale=en')
    expect(fs.readFileSync(path.join(target, 'DevToolsActivePort'), 'utf8')).toBe('new')
    // Only the colliding entry is left behind, so the old folder stays (not deleted).
    expect(fs.readdirSync(path.join(root, 'claude-vault'))).toEqual(['DevToolsActivePort'])
  })

  it('removes the old folder once everything has moved into an existing new one', () => {
    const root = appData()
    put(path.join(root, 'Claude Vault', 'vault.db'), 'db')
    const target = path.join(root, 'Trove')
    fs.mkdirSync(target)
    migrateLegacyUserData(root, target)
    expect(fs.existsSync(path.join(root, 'Claude Vault'))).toBe(false)
    expect(fs.readFileSync(path.join(target, 'vault.db'), 'utf8')).toBe('db')
  })

  it('never touches a new folder that already has a vault DB, and prefers the packaged name', () => {
    const root = appData()
    put(path.join(root, 'Claude Vault', 'vault.db'), 'old')
    put(path.join(root, 'Trove', 'vault.db'), 'current')
    expect(migrateLegacyUserData(root, path.join(root, 'Trove'))).toBeNull()
    expect(fs.readFileSync(path.join(root, 'Trove', 'vault.db'), 'utf8')).toBe('current')

    const other = appData()
    put(path.join(other, 'Claude Vault', 'vault.db'), 'packaged')
    put(path.join(other, 'claude-vault', 'vault.db'), 'dev')
    migrateLegacyUserData(other, path.join(other, 'Trove'))
    expect(fs.readFileSync(path.join(other, 'Trove', 'vault.db'), 'utf8')).toBe('packaged')
  })

  it('takes the newest old name first: ccStory over Claude Vault', () => {
    const root = appData()
    put(path.join(root, 'ccStory', 'vault.db'), 'beta2')
    put(path.join(root, 'Claude Vault', 'vault.db'), 'beta1')
    expect(migrateLegacyUserData(root, path.join(root, 'Trove'))).toBe(path.join(root, 'ccStory'))
    expect(fs.readFileSync(path.join(root, 'Trove', 'vault.db'), 'utf8')).toBe('beta2')
    // The older folder is left alone; nothing overwrites the data that just moved.
    expect(fs.readFileSync(path.join(root, 'Claude Vault', 'vault.db'), 'utf8')).toBe('beta1')
  })

  it('returns null when there is nothing to move', () => {
    const root = appData()
    put(path.join(root, 'claude-vault', 'Preferences'))
    expect(migrateLegacyUserData(root, path.join(root, 'Trove'))).toBeNull()
  })
})
