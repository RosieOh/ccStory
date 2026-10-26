/**
 * Days the app was opened, as local calendar days. This is the dogfooding measure in
 * docs/roadmap.md ("opened it on at least three days a week"): only the date is kept,
 * never a time, a count or what was looked at, and it never leaves the machine.
 */

/** The bar a week has to reach in the roadmap's go/no-go check. */
export const TARGET_DAYS_PER_WEEK = 3

/** `YYYY-MM-DD` of `d` in local time. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export type OpenDay = { day: string; opened: boolean; future: boolean }
export type OpenWeek = { start: string; days: OpenDay[]; count: number }

/**
 * The last `weeks` Monday-to-Sunday weeks ending with the one containing `today`,
 * oldest first. Days after `today` are marked `future` so the current week can be read
 * as "so far".
 */
export function openWeeks(openDays: Iterable<string>, today: Date, weeks = 4): OpenWeek[] {
  const opened = new Set(openDays)
  const todayKey = localDay(today)
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const out: OpenWeek[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(monday)
    start.setDate(monday.getDate() - 7 * w)
    const days: OpenDay[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const day = localDay(d)
      days.push({ day, opened: opened.has(day), future: day > todayKey })
    }
    out.push({ start: localDay(start), days, count: days.filter((d) => d.opened).length })
  }
  return out
}
