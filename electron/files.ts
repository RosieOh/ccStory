import type { DbHandle } from './db.js'
import type { FileRow, FileTouchRow } from '../shared/ipc.js'

/**
 * Queries over the `file_refs` reverse index: "which files have I worked on"
 * and "what happened around this file". Answers questions the message search
 * can't, because a file is usually mentioned inside a tool payload rather than
 * in the prose the user would think to search for.
 */

const LIKE_ESCAPE = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`)

/** Most-touched files, newest activity first; optional substring filter. */
export function listFiles(db: DbHandle, query: string, limit = 200): FileRow[] {
  const q = query.trim()
  const where = q ? `WHERE (fr.basename LIKE @like ESCAPE '\\' OR fr.path LIKE @like ESCAPE '\\')` : ''
  const rows = db
    .prepare(
      `SELECT fr.path AS path,
              fr.basename AS basename,
              COUNT(*) AS touches,
              COUNT(DISTINCT m.session_id) AS sessions,
              MAX(m.ts_ms) AS lastTouched,
              MAX(p.display_name) AS projectName
       FROM file_refs fr
       JOIN messages m ON m.id = fr.message_id
       JOIN sessions s ON s.id = m.session_id
       JOIN projects p ON p.id = s.project_id
       ${where}
       GROUP BY fr.path
       ORDER BY (lastTouched IS NULL) ASC, lastTouched DESC
       LIMIT @limit`,
    )
    .all({ like: `%${LIKE_ESCAPE(q)}%`, limit }) as FileRow[]
  return rows
}

/** Every message that touched one file, newest first. */
export function fileTimeline(db: DbHandle, filePath: string, limit = 300): FileTouchRow[] {
  return db
    .prepare(
      `SELECT m.id AS messageId,
              m.session_id AS sessionId,
              s.rel_path AS sessionFile,
              p.display_name AS projectName,
              m.role AS role,
              m.ts_ms AS tsMs,
              m.git_branch AS gitBranch,
              m.line_index AS lineIndex,
              substr(m.body, 1, 400) AS preview
       FROM file_refs fr
       JOIN messages m ON m.id = fr.message_id
       JOIN sessions s ON s.id = m.session_id
       JOIN projects p ON p.id = s.project_id
       WHERE fr.path = ?
       ORDER BY (m.ts_ms IS NULL) ASC, m.ts_ms DESC
       LIMIT ?`,
    )
    .all(filePath, limit) as FileTouchRow[]
}
