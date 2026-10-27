import fs from 'node:fs'
import path from 'node:path'

/**
 * Names this app had before, as Electron derives the user data folder from them: the
 * packaged "Claude Vault" and the dev-mode package name. Renamed to ccStory because
 * Anthropic's guidelines bar "Claude" in third-party product names.
 */
export const LEGACY_APP_NAMES = ['Claude Vault', 'claude-vault']

const VAULT_ENTRIES = ['vault.db', 'vault.db-wal', 'vault.db-shm', 'backups']

/**
 * Moves an older name's user data (vault DB, its WAL, backups, Chromium state) into
 * `target`, once, before anything opens it — in Keep mode that DB is the only copy of
 * archived transcripts. Does nothing when `target` already has a vault DB. Returns the
 * folder the data came from, or null.
 */
export function migrateLegacyUserData(appData: string, target: string, legacyNames = LEGACY_APP_NAMES): string | null {
  if (fs.existsSync(path.join(target, 'vault.db'))) return null
  for (const name of legacyNames) {
    const from = path.join(appData, name)
    if (path.resolve(from) === path.resolve(target) || !fs.existsSync(path.join(from, 'vault.db'))) continue
    if (!fs.existsSync(target)) {
      fs.renameSync(from, target)
      return from
    }
    // The new folder exists without a DB (e.g. a first launch created it): move only the
    // vault files and leave the rest of the old folder for the user to delete.
    for (const entry of VAULT_ENTRIES) {
      const src = path.join(from, entry)
      if (fs.existsSync(src)) fs.renameSync(src, path.join(target, entry))
    }
    return from
  }
  return null
}
