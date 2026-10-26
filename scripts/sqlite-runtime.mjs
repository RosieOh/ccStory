/**
 * Picks the runtime that matches the native better-sqlite3 build. After `npm install`
 * it is built for Electron's ABI (postinstall), so scripts run inside Electron in Node
 * mode; in CI it can be rebuilt for plain Node and runs there instead.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))

function loadsInNode() {
  try {
    const Database = require('better-sqlite3')
    new Database(':memory:').close()
    return true
  } catch {
    return false
  }
}

/** Runs `args` (node CLI arguments) with the matching runtime and exits with its status. */
export function runWithSqlite(args) {
  let cmd = process.execPath
  let env = process.env
  if (!loadsInNode()) {
    cmd = require('electron')
    env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
  const res = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit' })
  process.exit(res.status ?? 1)
}
