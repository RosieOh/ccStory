import type { DbHandle } from './db.js'
import { DEFAULT_PRICES, PRICES_SEED_VERSION, type ModelPrice } from '../shared/pricing.js'

/**
 * The `model_prices` table is a user-owned override list. It is seeded from the dated
 * defaults on first read. Later releases that add models bump `PRICES_SEED_VERSION`;
 * the new models are then inserted once, but an existing row is never overwritten —
 * otherwise an edit the user made would silently revert on upgrade.
 */

type Row = {
  model: string
  input_per_mtok: number
  output_per_mtok: number
  cache_read_per_mtok: number
  cache_write_per_mtok: number
  cache_write_1h_per_mtok: number | null
}

const toPrice = (r: Row): ModelPrice => ({
  model: r.model,
  inputPerMTok: r.input_per_mtok,
  outputPerMTok: r.output_per_mtok,
  cacheReadPerMTok: r.cache_read_per_mtok,
  cacheWritePerMTok: r.cache_write_per_mtok,
  // Rows from before the 1-hour column existed: derive from the published 2x ratio.
  cacheWrite1hPerMTok: r.cache_write_1h_per_mtok ?? Number((r.input_per_mtok * 2).toFixed(4)),
})

function writeAll(db: DbHandle, prices: ModelPrice[], opts: { overwrite: boolean }) {
  const now = Date.now()
  const conflict = opts.overwrite
    ? `ON CONFLICT(model) DO UPDATE SET
         input_per_mtok = excluded.input_per_mtok,
         output_per_mtok = excluded.output_per_mtok,
         cache_read_per_mtok = excluded.cache_read_per_mtok,
         cache_write_per_mtok = excluded.cache_write_per_mtok,
         cache_write_1h_per_mtok = excluded.cache_write_1h_per_mtok,
         updated_at = excluded.updated_at`
    : `ON CONFLICT(model) DO NOTHING`
  const stmt = db.prepare(
    `INSERT INTO model_prices(model, input_per_mtok, output_per_mtok, cache_read_per_mtok,
                              cache_write_per_mtok, cache_write_1h_per_mtok, updated_at)
     VALUES(@model, @input, @output, @cacheRead, @cacheWrite, @cacheWrite1h, @now)
     ${conflict}`,
  )
  db.transaction((rows: ModelPrice[]) => {
    for (const p of rows) {
      stmt.run({
        model: p.model.trim(),
        input: p.inputPerMTok,
        output: p.outputPerMTok,
        cacheRead: p.cacheReadPerMTok,
        cacheWrite: p.cacheWritePerMTok,
        cacheWrite1h: p.cacheWrite1hPerMTok,
        now,
      })
    }
  })(prices)
}

function seedVersion(db: DbHandle): number {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'prices_seed_version'`).get() as
    | { value: string }
    | undefined
  return row ? Number(row.value) : 0
}

function markSeeded(db: DbHandle) {
  db.prepare(
    `INSERT INTO meta(key, value) VALUES('prices_seed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(PRICES_SEED_VERSION))
}

/** Seeds defaults on a first-ever read (or adds newly published models), then returns the stored list. */
export function listPrices(db: DbHandle): ModelPrice[] {
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM model_prices`).get() as { c: number }).c
  if (count === 0 && seedVersion(db) === 0) {
    writeAll(db, DEFAULT_PRICES, { overwrite: true })
    markSeeded(db)
  } else if (seedVersion(db) < PRICES_SEED_VERSION) {
    writeAll(db, DEFAULT_PRICES, { overwrite: false })
    markSeeded(db)
  }
  const rows = db.prepare(`SELECT * FROM model_prices ORDER BY model`).all() as Row[]
  return rows.map(toPrice)
}

/** Replaces the whole table — the UI always submits the full edited list. */
export function savePrices(db: DbHandle, prices: ModelPrice[]): ModelPrice[] {
  const clean = prices.filter((p) => p.model.trim().length > 0)
  db.transaction(() => {
    db.prepare(`DELETE FROM model_prices`).run()
    writeAll(db, clean, { overwrite: true })
    markSeeded(db)
  })()
  return listPrices(db)
}

/** Drops user edits and restores the dated defaults. */
export function resetPrices(db: DbHandle): ModelPrice[] {
  db.transaction(() => {
    db.prepare(`DELETE FROM model_prices`).run()
    writeAll(db, DEFAULT_PRICES, { overwrite: true })
    markSeeded(db)
  })()
  return listPrices(db)
}
