import type { DbHandle } from './db.js'
import type { StatsPayload } from '../shared/ipc.js'

const STOP = new Set([
  'the',
  'a',
  'an',
  'to',
  'of',
  'and',
  'is',
  'it',
  'in',
  'for',
  'on',
  'with',
  '가',
  '을',
  '를',
  '이',
  '은',
  '는',
  '에',
  '의',
  '로',
  '하고',
  '해줘',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9가-힣_]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP.has(t))
}

export function computeStats(db: DbHandle): StatsPayload {
  const totalProjects = (db.prepare(`SELECT COUNT(*) AS c FROM projects`).get() as { c: number }).c
  const totalSessions = (db.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number }).c
  const totalMessages = (db.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number }).c

  const messagesByRole = db
    .prepare(`SELECT role, COUNT(*) AS count FROM messages GROUP BY role ORDER BY count DESC`)
    .all() as { role: string; count: number }[]

  const bodies = db
    .prepare(
      `SELECT body FROM messages WHERE COALESCE(message_class, 'dialog') != 'meta'`,
    )
    .all() as { body: string }[]
  const freq = new Map<string, number>()
  for (const { body } of bodies) {
    for (const t of tokenize(body)) {
      freq.set(t, (freq.get(t) ?? 0) + 1)
    }
  }
  const topTokens = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([token, count]) => ({ token, count }))

  const activityByDay = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', datetime(s.file_mtime_ms / 1000, 'unixepoch')) AS day, COUNT(*) AS count
       FROM sessions s
       GROUP BY day
       ORDER BY day DESC
       LIMIT 120`,
    )
    .all() as { day: string; count: number }[]

  return {
    totalProjects,
    totalSessions,
    totalMessages,
    messagesByRole,
    topTokens,
    activityByDay: activityByDay.reverse(),
  }
}
