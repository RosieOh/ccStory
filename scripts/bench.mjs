#!/usr/bin/env node
/** `npm run bench -- <path/to/vault.db>` — search latency on an existing vault DB. */
import { runWithSqlite } from './sqlite-runtime.mjs'

runWithSqlite(['--import', 'tsx', 'scripts/bench-search.ts', ...process.argv.slice(2)])
