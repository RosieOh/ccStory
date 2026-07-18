/**
 * Prompt templates: a stored body with `{{variable}}` placeholders that the user
 * fills in before copying. Pure helpers shared by main (validation) and renderer (UI).
 */

const VAR_RE = /\{\{\s*([a-zA-Z0-9_][a-zA-Z0-9_ -]*?)\s*\}\}/g

/** Unique variable names in first-seen order, e.g. `Hi {{name}}` → `['name']`. */
export function extractTemplateVariables(body: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of body.matchAll(VAR_RE)) {
    const name = m[1].trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/**
 * Substitute `{{var}}` occurrences with `values[var]`. Unknown/empty variables
 * are left as their original placeholder so nothing is silently dropped.
 */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(VAR_RE, (whole, rawName: string) => {
    const name = rawName.trim()
    const v = values[name]
    return v != null && v !== '' ? v : whole
  })
}
