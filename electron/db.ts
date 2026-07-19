import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export type DbHandle = Database.Database

const SCHEMA_VERSION = 6

export function openVaultDb(dbFile: string): DbHandle {
  const dir = path.dirname(dbFile)
  fs.mkdirSync(dir, { recursive: true })
  const db = new Database(dbFile)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: DbHandle) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      root_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      last_indexed_at INTEGER,
      last_modified INTEGER,
      tool TEXT NOT NULL DEFAULT 'claude'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rel_path TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      file_mtime_ms INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_id, rel_path)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      line_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      content_kinds TEXT,
      raw_preview TEXT,
      message_class TEXT NOT NULL DEFAULT 'dialog',
      ts_ms INTEGER,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      is_sidechain INTEGER NOT NULL DEFAULT 0,
      UNIQUE(session_id, line_index)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      body,
      content='messages',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body);
      INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
    END;

    CREATE TABLE IF NOT EXISTS plan_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      file_mtime_ms INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS plan_files_fts USING fts5(
      title,
      body,
      content='plan_files',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS plan_files_ai AFTER INSERT ON plan_files BEGIN
      INSERT INTO plan_files_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;

    CREATE TRIGGER IF NOT EXISTS plan_files_ad AFTER DELETE ON plan_files BEGIN
      INSERT INTO plan_files_fts(plan_files_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body);
    END;

    CREATE TRIGGER IF NOT EXISTS plan_files_au AFTER UPDATE ON plan_files BEGIN
      INSERT INTO plan_files_fts(plan_files_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body);
      INSERT INTO plan_files_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS message_tags (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (message_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
  `)

  const msgCols = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[]
  const hasCol = (name: string) => msgCols.some((c) => c.name === name)
  if (!hasCol('message_class')) {
    db.exec(`ALTER TABLE messages ADD COLUMN message_class TEXT NOT NULL DEFAULT 'dialog'`)
  }
  // Schema v4: per-message metadata (timestamp, model, token usage, sidechain flag).
  const v4Adds: [string, string][] = [
    ['ts_ms', `ALTER TABLE messages ADD COLUMN ts_ms INTEGER`],
    ['model', `ALTER TABLE messages ADD COLUMN model TEXT`],
    ['input_tokens', `ALTER TABLE messages ADD COLUMN input_tokens INTEGER`],
    ['output_tokens', `ALTER TABLE messages ADD COLUMN output_tokens INTEGER`],
    ['cache_read_tokens', `ALTER TABLE messages ADD COLUMN cache_read_tokens INTEGER`],
    ['cache_creation_tokens', `ALTER TABLE messages ADD COLUMN cache_creation_tokens INTEGER`],
    ['is_sidechain', `ALTER TABLE messages ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0`],
  ]
  for (const [name, sql] of v4Adds) {
    if (!hasCol(name)) db.exec(sql)
  }

  const projCols = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[]
  if (!projCols.some((c) => c.name === 'tool')) {
    db.exec(`ALTER TABLE projects ADD COLUMN tool TEXT NOT NULL DEFAULT 'claude'`)
  }

  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
  const v = row ? Number(row.value) : 0
  if (v > 0 && v < SCHEMA_VERSION) {
    // Any schema bump also changes what the parser stores (v4 added per-message
    // metadata; v5 relabels bookkeeping lines and tool calls). Clear sessions so
    // the next full reindex rewrites every row — mtime-skip would otherwise keep
    // stale bodies. Messages/FTS rows cascade via FK + triggers.
    db.exec(`DELETE FROM sessions`)
  }
  if (v < SCHEMA_VERSION) {
    db.prepare(`INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      String(SCHEMA_VERSION),
    )
  }
}
