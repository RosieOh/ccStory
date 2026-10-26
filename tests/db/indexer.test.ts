import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexAdapterProject, indexSessionFile, reconcileMissing, handleSessionUnlink } from '../../electron/indexer'
import { setSetting } from '../../electron/db'
import {
  addFavorite,
  listFavorites,
  listPrompts,
  recentSessions,
  setMessageTags,
  createTag,
  sessionTranscript,
} from '../../electron/queries'
import { computeStats } from '../../electron/stats'
import { unifiedSearch } from '../../electron/search'
import { appendLines, assistantLine, metaLine, sandbox, toolResultLine, userLine, writeLines } from './helpers'

const idsOf = (db: ReturnType<ReturnType<typeof sandbox>['open']>, sessionFile: string) =>
  (
    db
      .prepare(`SELECT m.id FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.file_path = ? ORDER BY line_index`)
      .all(sessionFile) as { id: number }[]
  ).map((r) => r.id)

describe('append-only indexing', () => {
  it('resumes a grown file from the last offset and keeps existing rows', async () => {
    const sb = sandbox()
    const db = sb.open()
    const pid = sb.project(db)
    const file = path.join(sb.projectRoot, 's1.jsonl')
    writeLines(file, [userLine('u1', 'first prompt'), assistantLine('a1', 'first answer')])

    const first = await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    expect(first).toEqual({ added: 2, mode: 'full' })
    const before = idsOf(db, file)

    appendLines(file, [userLine('u2', 'second prompt')])
    const second = await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    expect(second).toEqual({ added: 1, mode: 'append' })
    const after = idsOf(db, file)
    expect(after.slice(0, 2)).toEqual(before)
    expect(after).toHaveLength(3)

    const unchanged = await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    expect(unchanged.mode).toBe('skip')
  })

  it('does not consume a half-written trailing line until it is complete', async () => {
    const sb = sandbox()
    const db = sb.open()
    const pid = sb.project(db)
    const file = path.join(sb.projectRoot, 's1.jsonl')
    const full = userLine('u2', 'second')
    fs.writeFileSync(file, `${userLine('u1', 'first')}\n${full.slice(0, 20)}`)
    await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    expect(idsOf(db, file)).toHaveLength(1)

    fs.appendFileSync(file, `${full.slice(20)}\n`)
    const t = new Date(Date.now() + 2000)
    fs.utimesSync(file, t, t)
    const res = await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    expect(res.mode).toBe('append')
    const rows = sessionTranscript(db, (db.prepare(`SELECT id FROM sessions`).get() as { id: number }).id)
    expect(rows.map((r) => r.body)).toEqual(['first', 'second'])
  })

  it('re-reads a rewritten file but keeps favorites and tags (keyed by uuid)', async () => {
    const sb = sandbox()
    const db = sb.open()
    const pid = sb.project(db)
    const file = path.join(sb.projectRoot, 's1.jsonl')
    writeLines(file, [userLine('u1', 'keep me'), assistantLine('a1', 'answer')])
    await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })

    const msgId = idsOf(db, file)[0]
    addFavorite(db, msgId)
    const tag = createTag(db, 'important', null)
    setMessageTags(db, 'u1', [tag])

    // Same lines, different bytes at the start → fingerprint mismatch → full re-read.
    writeLines(file, [metaLine('title'), userLine('u1', 'keep me'), assistantLine('a1', 'answer')])
    const res = await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    expect(res.mode).toBe('full')
    expect(idsOf(db, file)).not.toContain(msgId)

    const [fav] = listFavorites(db)
    expect(fav.msgKey).toBe('u1')
    expect(fav.messageId).not.toBeNull()
    expect(fav.archived).toBe(false)
    expect(fav.tagIds).toEqual([tag])
  })
})

describe('archive vs mirror when Claude Code deletes a transcript', () => {
  it('keeps rows as archived by default, and the favorite stays reachable', async () => {
    const sb = sandbox()
    const db = sb.open()
    const pid = sb.project(db)
    const file = path.join(sb.projectRoot, 'old.jsonl')
    writeLines(file, [userLine('u1', 'an old conversation about vaults')])
    await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    addFavorite(db, idsOf(db, file)[0])

    fs.rmSync(file)
    expect(reconcileMissing(db, sb.adapter, 'keep')).toBe(1)
    const s = db.prepare(`SELECT archived_at FROM sessions`).get() as { archived_at: number | null }
    expect(s.archived_at).not.toBeNull()
    const hits = unifiedSearch(db, { query: 'vaults' })
    expect(hits).toHaveLength(1)
    expect(hits[0].hitType === 'message' && hits[0].archived).toBe(true)
    expect(listFavorites(db)[0].archived).toBe(true)
  })

  it('mirror mode deletes the rows but the favorite keeps its snapshot', async () => {
    const sb = sandbox()
    const db = sb.open()
    setSetting(db, 'archiveMode', 'mirror')
    const pid = sb.project(db)
    const file = path.join(sb.projectRoot, 'old.jsonl')
    writeLines(file, [userLine('u1', 'snapshot body')])
    await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    addFavorite(db, idsOf(db, file)[0])

    fs.rmSync(file)
    expect(handleSessionUnlink(db, file, 'mirror')).toBe(true)
    expect(db.prepare(`SELECT COUNT(*) AS c FROM sessions`).get()).toEqual({ c: 0 })
    const [fav] = listFavorites(db)
    expect(fav.body).toBe('snapshot body')
    expect(fav.messageId).toBeNull()
  })

  it('treats a missing source root as "unavailable", never as "everything was deleted"', async () => {
    const sb = sandbox()
    const db = sb.open()
    const pid = sb.project(db)
    const file = path.join(sb.projectRoot, 's.jsonl')
    writeLines(file, [userLine('u1', 'x')])
    await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    fs.rmSync(sb.projectsRoot, { recursive: true })
    expect(reconcileMissing(db, sb.adapter, 'mirror')).toBe(0)
    expect(db.prepare(`SELECT COUNT(*) AS c FROM sessions`).get()).toEqual({ c: 1 })
  })
})

describe('stats', () => {
  it('counts a response once even though usage repeats on each of its lines', async () => {
    const sb = sandbox()
    const db = sb.open()
    const pid = sb.project(db)
    const file = path.join(sb.projectRoot, 's.jsonl')
    writeLines(file, [
      userLine('u1', 'go'),
      // One API response split over three lines; output grows as it streams.
      assistantLine('a1', 'thinking…', { msgId: 'msg_1', output: 1 }),
      assistantLine('a2', 'part one', { msgId: 'msg_1', output: 3 }),
      assistantLine('a3', 'part two', { msgId: 'msg_1', output: 7 }),
      assistantLine('a4', 'next turn', { msgId: 'msg_2', requestId: 'req_2', output: 2 }),
    ])
    await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    const stats = computeStats(db)
    expect(stats.tokensByModel).toHaveLength(1)
    const m = stats.tokensByModel[0]
    expect(m.messages).toBe(2)
    expect(m.output).toBe(7 + 2)
    expect(m.input).toBe(20)
    expect(m.cacheCreation1h).toBe(40)
    expect(stats.totalPrompts).toBe(1)
  })
})

describe('search', () => {
  async function seeded() {
    const sb = sandbox()
    const db = sb.open()
    const pid = sb.project(db)
    const file = path.join(sb.projectRoot, 's.jsonl')
    writeLines(file, [
      userLine('u1', '재색인 버그를 고쳐줘'),
      assistantLine('a1', 'reindex fixed'),
      toolResultLine('t1', 'reindex log output'),
      metaLine('reindex title'),
    ])
    await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    return { sb, db, file }
  }

  it('keeps bookkeeping lines out of the full-text index', async () => {
    const { db } = await seeded()
    const ftsRows = db.prepare(`SELECT COUNT(*) AS c FROM messages_fts`).get() as { c: number }
    const nonMeta = db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE message_class != 'meta'`).get() as { c: number }
    expect(ftsRows.c).toBe(nonMeta.c)
    db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')`)
    const hits = unifiedSearch(db, { query: 'reindex' })
    expect(hits.every((h) => h.hitType === 'message' && h.messageClass !== 'meta')).toBe(true)
    const withMeta = unifiedSearch(db, { query: 'reindex', excludeMeta: false })
    expect(withMeta.length).toBe(hits.length + 1)
  })

  it('finds a word inside a longer word via the substring fallback', async () => {
    const { db } = await seeded()
    const hits = unifiedSearch(db, { query: '색인' })
    expect(hits).toHaveLength(1)
  })

  it('filters by tag (and lists everything tagged when the query is empty) and can exclude tool output', async () => {
    const { db } = await seeded()
    const tag = createTag(db, 't', null)
    setMessageTags(db, 'a1', [tag])
    expect(unifiedSearch(db, { query: 'reindex', tagId: tag })).toHaveLength(1)
    expect(unifiedSearch(db, { query: '', tagId: tag })).toHaveLength(1)
    const all = unifiedSearch(db, { query: 'reindex' })
    const noTools = unifiedSearch(db, { query: 'reindex', excludeTools: true })
    expect(noTools.length).toBe(all.length - 1)
  })

  it('stays consistent through repeated re-reads (FTS integrity)', async () => {
    const { sb, db, file } = await seeded()
    const pid = sb.project(db)
    for (let i = 0; i < 3; i += 1) {
      writeLines(file, [metaLine(`t${i}`), userLine('u1', `round ${i}`), assistantLine('a1', 'reindex')])
      await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    }
    db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')`)
    expect(unifiedSearch(db, { query: 'reindex' })).toHaveLength(1)
  })
})

describe('prompts', () => {
  it('groups identical prompts and counts distinct uses', async () => {
    const sb = sandbox()
    const db = sb.open()
    const pid = sb.project(db)
    writeLines(path.join(sb.projectRoot, 'a.jsonl'), [userLine('u1', 'run the tests', '2026-10-01T00:00:00Z')])
    writeLines(path.join(sb.projectRoot, 'b.jsonl'), [
      userLine('u2', 'run the tests', '2026-10-02T00:00:00Z'),
      userLine('u3', 'ship it', '2026-10-03T00:00:00Z'),
      // A forked session copies an earlier line with the same uuid: not a new use.
      userLine('u2', 'run the tests', '2026-10-02T00:00:00Z'),
    ])
    for (const f of ['a.jsonl', 'b.jsonl']) {
      await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: path.join(sb.projectRoot, f) })
    }
    const recent = listPrompts(db, { query: '', sort: 'recent' })
    expect(recent.map((p) => p.text)).toEqual(['ship it', 'run the tests'])
    const frequent = listPrompts(db, { query: '', sort: 'frequent' })
    expect(frequent[0]).toMatchObject({ text: 'run the tests', uses: 2 })
    expect(listPrompts(db, { query: 'tests' })).toHaveLength(1)
  })
})

describe('project titles', () => {
  it('replaces a slug guess with the cwd the transcripts recorded, and keeps it on later scans', async () => {
    const sb = sandbox()
    const db = sb.open()
    writeLines(path.join(sb.projectRoot, 's.jsonl'), [
      JSON.stringify({ type: 'user', uuid: 'u1', cwd: '/Volumes/disk/my-app', message: { role: 'user', content: 'hi' } }),
    ])
    const project = { slug: '-Volumes-disk-my-app', root: sb.projectRoot, displayName: '-Volumes-disk-my-app', displayNameIsGuess: true }
    const title = () => (db.prepare(`SELECT display_name FROM projects`).get() as { display_name: string }).display_name
    await indexAdapterProject(db, sb.adapter, project)
    expect(title()).toBe('/Volumes/disk/my-app')
    await indexAdapterProject(db, sb.adapter, project)
    expect(title()).toBe('/Volumes/disk/my-app')
  })
})

describe('recent sessions', () => {
  it('lists sessions people opened, not their subagent transcripts', async () => {
    const sb = sandbox()
    const db = sb.open()
    const pid = sb.project(db)
    const main = path.join(sb.projectRoot, 'main.jsonl')
    const sub = path.join(sb.projectRoot, 'main', 'subagents', 'agent-1.jsonl')
    fs.mkdirSync(path.dirname(sub), { recursive: true })
    writeLines(main, [userLine('u1', 'top-level prompt')])
    writeLines(sub, [userLine('s1', 'subagent task', '2026-10-02T00:00:00Z')])
    for (const f of [main, sub]) await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: f })
    const rows = recentSessions(db, null)
    expect(rows.map((r) => r.sessionFile)).toEqual(['main.jsonl'])
    expect(rows[0].preview).toBe('top-level prompt')
  })
})
