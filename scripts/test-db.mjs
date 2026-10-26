#!/usr/bin/env node
/** Runs the SQLite integration tests (tests/db) under the runtime matching better-sqlite3. */
import path from 'node:path'
import { root, runWithSqlite } from './sqlite-runtime.mjs'

const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
runWithSqlite([vitest, 'run', '-c', 'vitest.db.config.ts', ...process.argv.slice(2)])
