import type { DbHandle } from './db.js'
import { DEFAULT_PRICES, type ModelPrice } from '../shared/pricing.js'

/**
 * The `model_prices` table is a user-owned override list. On first read it is
 * seeded from the dated defaults, but a seed is never re-applied afterwards —
 * otherwise an edit the user made would silently revert on the next launch.
 */

type Row = {
  model: string
  input_per_mtok: number
  output_per_mtok: number
  cache_read_per_mtok: number
  cache_write_per_mtok: number
}

const toPrice = (r: Row): ModelPrice => ({
  model: r.model,
  inputPerMTok: r.input_per_mtok,
  outputPerMTok: r.output_per_mtok,
  cacheReadPerMTok: r.cache_read_per_mtok,
  cacheWritePerMTok: r.cache_write_per_mtok,
})

function writeAll(db: DbHandle, prices: ModelPrice[]) {
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO model_prices(model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, updated_at)
     VALUES(@model, @input, @output, @cacheRead, @cacheWrite, @now)
     ON CONFLICT(model) DO UPDATE SET
       input_per_mtok = excluded.input_per_mtok,
       output_per_mtok = excluded.output_per_mtok,
       cache_read_per_mtok = excluded.cache_read_per_mtok,
       cache_write_per_mtok = excluded.cache_write_per_mtok,
       updated_at = excluded.updated_at`,
  )
  const run = db.transaction((rows: ModelPrice[]) => {
    for (const p of rows) {
      stmt.run({
        model: p.model.trim(),
        input: p.inputPerMTok,
        output: p.outputPerMTok,
        cacheRead: p.cacheReadPerMTok,
        cacheWrite: p.cacheWritePerMTok,
        now,
      })
    }
  })
  run(prices)
}

/** Seeds defaults on a first-ever read, then returns the stored list. */
export function listPrices(db: DbHandle): ModelPrice[] {
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM model_prices`).get() as { c: number }).c
  if (count === 0) writeAll(db, DEFAULT_PRICES)
  const rows = db
    .prepare(`SELECT * FROM model_prices ORDER BY model`)
    .all() as Row[]
  return rows.map(toPrice)
}

/** Replaces the whole table — the UI always submits the full edited list. */
export function savePrices(db: DbHandle, prices: ModelPrice[]): ModelPrice[] {
  const clean = prices.filter((p) => p.model.trim().length > 0)
  db.transaction(() => {
    db.prepare(`DELETE FROM model_prices`).run()
  })()
  if (clean.length > 0) writeAll(db, clean)
  return listPrices(db)
}

/** Drops user edits and restores the dated defaults. */
export function resetPrices(db: DbHandle): ModelPrice[] {
  db.prepare(`DELETE FROM model_prices`).run()
  writeAll(db, DEFAULT_PRICES)
  return listPrices(db)
}
