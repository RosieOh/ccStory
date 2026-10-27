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
    const target = path.join(root, 'ccStory')
    expect(migrateLegacyUserData(root, target)).toBe(path.join(root, 'Claude Vault'))
    expect(fs.readFileSync(path.join(target, 'vault.db'), 'utf8')).toBe('db')
    expect(fs.existsSync(path.join(target, 'backups', 'vault-20261027-000000-daily.db'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'Local Storage'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'Claude Vault'))).toBe(false)
  })

  it('moves only the vault files into a new folder that already exists without a DB', () => {
    const root = appData()
    put(path.join(root, 'claude-vault', 'vault.db'), 'dev-db')
    put(path.join(root, 'claude-vault', 'vault.db-wal'), 'wal')
    put(path.join(root, 'claude-vault', 'Preferences'))
    const target = path.join(root, 'ccStory')
    put(path.join(target, 'Preferences'), 'new')
    expect(migrateLegacyUserData(root, target)).toBe(path.join(root, 'claude-vault'))
    expect(fs.readFileSync(path.join(target, 'vault.db'), 'utf8')).toBe('dev-db')
    expect(fs.readFileSync(path.join(target, 'vault.db-wal'), 'utf8')).toBe('wal')
    expect(fs.readFileSync(path.join(target, 'Preferences'), 'utf8')).toBe('new')
  })

  it('never touches a new folder that already has a vault DB, and prefers the packaged name', () => {
    const root = appData()
    put(path.join(root, 'Claude Vault', 'vault.db'), 'old')
    put(path.join(root, 'ccStory', 'vault.db'), 'current')
    expect(migrateLegacyUserData(root, path.join(root, 'ccStory'))).toBeNull()
    expect(fs.readFileSync(path.join(root, 'ccStory', 'vault.db'), 'utf8')).toBe('current')

    const other = appData()
    put(path.join(other, 'Claude Vault', 'vault.db'), 'packaged')
    put(path.join(other, 'claude-vault', 'vault.db'), 'dev')
    migrateLegacyUserData(other, path.join(other, 'ccStory'))
    expect(fs.readFileSync(path.join(other, 'ccStory', 'vault.db'), 'utf8')).toBe('packaged')
  })

  it('returns null when there is nothing to move', () => {
    const root = appData()
    put(path.join(root, 'claude-vault', 'Preferences'))
    expect(migrateLegacyUserData(root, path.join(root, 'ccStory'))).toBeNull()
  })
})
