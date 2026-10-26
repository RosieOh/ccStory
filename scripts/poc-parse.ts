#!/usr/bin/env npx tsx
/**
 * PoC: scan every available source (Claude Code projects, Codex sessions) with the
 * same adapters and parsers the app uses, and print what the index would contain.
 * Reads only; never touches the vault DB.
 */
import { getAvailableAdapters } from '../electron/adapters.js'
import { readLines } from '../electron/lineReader.js'

function main() {
  const adapters = getAvailableAdapters()
  if (!adapters.length) {
    console.error('No transcript directories found (~/.claude/projects, ~/.codex/sessions).')
    process.exit(1)
  }

  let projects = 0
  let sessionFiles = 0
  let lines = 0
  let prompts = 0
  const kindCounts = new Map<string, number>()
  const classCounts = new Map<string, number>()
  const responses = new Set<string>()
  let usageLines = 0

  for (const adapter of adapters) {
    console.log(`${adapter.label}: ${adapter.root}`)
    for (const project of adapter.listProjects()) {
      projects += 1
      for (const file of adapter.listSessions(project)) {
        sessionFiles += 1
        const parse = adapter.createParser()
        for (const line of readLines(file)) {
          const parsed = parse(line.text)
          if (!parsed) continue
          lines += 1
          if (parsed.isPrompt) prompts += 1
          if (parsed.usage) {
            usageLines += 1
            responses.add(parsed.apiMessageId ? `${parsed.apiMessageId}:${parsed.requestId ?? ''}` : `${file}#${lines}`)
          }
          for (const k of parsed.contentKinds) kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1)
          classCounts.set(parsed.messageClass, (classCounts.get(parsed.messageClass) ?? 0) + 1)
        }
      }
    }
  }

  console.log('\n--- Summary ---')
  console.log('Projects:', projects)
  console.log('Session JSONL files:', sessionFiles)
  console.log('Parsed lines:', lines)
  console.log('Human prompts:', prompts)
  console.log(`Lines with usage: ${usageLines} → API responses: ${responses.size}`)
  console.log('\nContent kinds (top):')
  ;[...kindCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([k, c]) => console.log(`  ${k}: ${c}`))
  console.log('\nMessage class:')
  ;[...classCounts.entries()].forEach(([k, c]) => console.log(`  ${k}: ${c}`))
}

main()
