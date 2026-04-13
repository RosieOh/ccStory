import path from 'node:path'

/** Optional override for tests or non-default installs (must be absolute). */
export function claudeHomeDir(): string {
  const override = process.env.CLAUDE_HOME?.trim()
  if (override && path.isAbsolute(override)) {
    return path.normalize(override)
  }
  return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.claude')
}

export function defaultClaudeProjectsRoot(): string {
  return path.join(claudeHomeDir(), 'projects')
}

export function defaultClaudePlansRoot(): string {
  return path.join(claudeHomeDir(), 'plans')
}
