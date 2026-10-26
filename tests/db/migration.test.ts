import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { readSchemaVersion, SCHEMA_VERSION } from '../../electron/db'
import { indexSessionFile } from '../../electron/indexer'
import { listFavorites } from '../../electron/queries'
import { listPrices } from '../../electron/prices'
import { assistantLine, sandbox, userLine, writeLines } from './helpers'

/** The v8 schema as shipped: user data referenced messages.id with ON DELETE CASCADE. */
function createLegacyDb(dbFile: string, sessionFile: string, projectRoot: string) {
  const db = new Database(dbFile)
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO meta VALUES ('schema_version', '8');
    CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, root_path TEXT NOT NULL,
      display_name TEXT NOT NULL, last_indexed_at INTEGER, last_modified INTEGER, tool TEXT NOT NULL DEFAULT 'claude');
    CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rel_path TEXT NOT NULL, file_path TEXT NOT NULL UNIQUE, file_mtime_ms INTEGER NOT NULL, message_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_id, rel_path));
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      line_index INTEGER NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, content_kinds TEXT, raw_preview TEXT,
      message_class TEXT NOT NULL DEFAULT 'dialog', ts_ms INTEGER, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
      cache_read_tokens INTEGER, cache_creation_tokens INTEGER, is_sidechain INTEGER NOT NULL DEFAULT 0, cwd TEXT, git_branch TEXT,
      UNIQUE(session_id, line_index));
    CREATE VIRTUAL TABLE messages_fts USING fts5(body, content='messages', content_rowid='id');
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body); END;
    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body); END;
    CREATE TABLE favorites (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL);
    CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT);
    CREATE TABLE message_tags (message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (message_id, tag_id));
    CREATE TABLE file_refs (message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, path TEXT NOT NULL,
      basename TEXT NOT NULL, PRIMARY KEY (message_id, path));
    CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, body TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE model_prices (model TEXT PRIMARY KEY, input_per_mtok REAL NOT NULL, output_per_mtok REAL NOT NULL,
      cache_read_per_mtok REAL NOT NULL, cache_write_per_mtok REAL NOT NULL, updated_at INTEGER NOT NULL);
  `)
  db.prepare(`INSERT INTO projects (slug, root_path, display_name) VALUES ('-work-app', ?, '/work/app')`).run(projectRoot)
  db.prepare(`INSERT INTO sessions (project_id, rel_path, file_path, file_mtime_ms, message_count) VALUES (1, 's.jsonl', ?, 1, 2)`).run(
    sessionFile,
  )
  const ins = db.prepare(`INSERT INTO messages (session_id, line_index, role, body) VALUES (1, ?, ?, ?)`)
  ins.run(0, 'user', 'starred prompt')
  ins.run(1, 'assistant', 'tagged answer')
  db.prepare(`INSERT INTO favorites (message_id, created_at) VALUES (1, 1234)`).run()
  db.prepare(`INSERT INTO tags (name) VALUES ('keep')`).run()
  db.prepare(`INSERT INTO message_tags (message_id, tag_id) VALUES (2, 1)`).run()
  db.prepare(`INSERT INTO templates (name, body, created_at, updated_at) VALUES ('t', 'b', 1, 1)`).run()
  // A user-edited price from the old seed, plus no row for newer models.
  db.prepare(`INSERT INTO model_prices VALUES ('claude-opus-4-8', 7, 25, 0.5, 6.25, 1)`).run()
  db.close()
}

describe('migration from the v8 schema', () => {
  it('moves favorites and tags to stable keys before rebuilding the index', async () => {
    const sb = sandbox()
    const file = path.join(sb.projectRoot, 's.jsonl')
    writeLines(file, [userLine('uuid-user', 'starred prompt'), assistantLine('uuid-asst', 'tagged answer')])
    createLegacyDb(sb.dbFile, file, sb.projectRoot)

    const db = sb.open()
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)

    const fav = db.prepare(`SELECT msg_key, body, role, created_at FROM favorites`).all()
    expect(fav).toEqual([{ msg_key: 'uuid-user', body: 'starred prompt', role: 'user', created_at: 1234 }])
    expect(db.prepare(`SELECT msg_key, tag_id FROM message_tags`).all()).toEqual([{ msg_key: 'uuid-asst', tag_id: 1 }])
    expect(db.prepare(`SELECT COUNT(*) AS c FROM templates`).get()).toEqual({ c: 1 })

    // Re-indexing reconnects the favorite to the live line.
    const pid = (db.prepare(`SELECT id FROM projects`).get() as { id: number }).id
    await indexSessionFile(db, { projectId: pid, projectRoot: sb.projectRoot, filePath: file })
    const [live] = listFavorites(db)
    expect(live.messageId).not.toBeNull()
    expect(live.archived).toBe(false)
  })

  it('keeps user price edits and adds newly published models', () => {
    const sb = sandbox()
    const file = path.join(sb.projectRoot, 's.jsonl')
    writeLines(file, [userLine('u', 'x')])
    createLegacyDb(sb.dbFile, file, sb.projectRoot)
    const db = sb.open()
    const prices = listPrices(db)
    const edited = prices.find((p) => p.model === 'claude-opus-4-8')!
    expect(edited.inputPerMTok).toBe(7)
    expect(edited.cacheWrite1hPerMTok).toBe(14)
    expect(prices.some((p) => p.model === 'claude-opus-5-5')).toBe(true)
    // Seed v3 added the OpenAI models Codex sessions use, without touching the edit above.
    expect(prices.find((p) => p.model === 'gpt-5.6-sol')?.inputPerMTok).toBe(4)
  })

  it('falls back to file#line keys when the source line is gone', () => {
    const sb = sandbox()
    const file = path.join(sb.projectRoot, 'gone.jsonl')
    createLegacyDb(sb.dbFile, file, sb.projectRoot)
    const db = sb.open()
    const fav = db.prepare(`SELECT msg_key, body FROM favorites`).get()
    expect(fav).toEqual({ msg_key: `${file}#0`, body: 'starred prompt' })
  })
})
