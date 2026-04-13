#!/usr/bin/env npx tsx
/**
 * PoC: scan ~/.claude/projects, parse agent-transcripts JSONL, print stats and content kinds.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseJsonlLine } from '../shared/jsonlParse.js'
import { listProjectDirs, listJsonlSessions } from '../electron/indexer.js'

const root = path.join(process.env.HOME ?? '', '.claude', 'projects')

function main() {
  console.log('Claude projects root:', root)
  if (!fs.existsSync(root)) {
    console.error('Directory not found. Nothing to parse.')
    process.exit(1)
  }

  const projects = listProjectDirs(root)
  let sessionFiles = 0
  let messageLines = 0
  const kindCounts = new Map<string, number>()
  const classCounts = new Map<string, number>()

  for (const p of projects) {
    const files = listJsonlSessions(p.root)
    sessionFiles += files.length
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      const lines = content.split(/\r?\n/)
      for (const line of lines) {
        const parsed = parseJsonlLine(line)
        if (!parsed) continue
        messageLines += 1
        for (const k of parsed.contentKinds) {
          kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1)
        }
        classCounts.set(
          parsed.messageClass,
          (classCounts.get(parsed.messageClass) ?? 0) + 1,
        )
      }
    }
  }

  console.log('\n--- Summary ---')
  console.log('Projects:', projects.length)
  console.log('Session JSONL files:', sessionFiles)
  console.log('Parsed message lines:', messageLines)
  console.log('\nContent kinds (top):')
  ;[...kindCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([k, c]) => console.log(`  ${k}: ${c}`))
  console.log('\nMessage class:')
  ;[...classCounts.entries()].forEach(([k, c]) => console.log(`  ${k}: ${c}`))
}

main()
