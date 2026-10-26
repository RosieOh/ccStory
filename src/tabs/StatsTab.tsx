import { useEffect, useMemo, useState } from 'react'
import type { ModelTokenRow, StatsPayload } from '../../shared/ipc'
import { PRICES_AS_OF, costOf, formatUsd, type ModelPrice } from '../../shared/pricing'
import { BCP47 } from '../../shared/i18n'
import { useI18n, useT } from '../i18n'
import { GHOST_BTN } from '../ui'
import { formatCompact } from '../format'

type CostRow = { model: string; cost: number | null }

/** Per-model cost; zero-token placeholder ids (`<synthetic>`) are dropped first. */
function costRows(byModel: ModelTokenRow[], prices: ModelPrice[]): CostRow[] {
  return byModel
    .filter((m) => m.input + m.output + m.cacheRead + m.cacheCreation > 0)
    .map((m) => ({
      model: m.model,
      cost: costOf(
        m.model,
        { input: m.input, output: m.output, cacheRead: m.cacheRead, cacheCreation: m.cacheCreation, cacheCreation1h: m.cacheCreation1h },
        prices,
      ),
    }))
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1))
}

function StatTile({ label, value, unit, foot }: { label: string; value: string; unit?: string; foot: string }) {
  return (
    <div className="stat glass">
      <span className="stat-label">{label}</span>
      <div>
        <span className="stat-value">{value}</span>
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      <span className="stat-foot">{foot}</span>
    </div>
  )
}

/** One labelled thin bar: name left, value at the right, bar grows from the left baseline. */
function BarRow({ label, value, fraction, title }: { label: string; value: string; fraction: number; title?: string }) {
  return (
    <div className="flex flex-col gap-1.5" title={title}>
      <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
        <span className="min-w-0 truncate text-ink-1">{label}</span>
        <span className="shrink-0 text-[12.5px] text-ink-3 tabular">{value}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${Math.max(fraction > 0 ? 1.5 : 0, fraction * 100)}%` }} />
      </div>
    </div>
  )
}

/** Round up to 1/2/5 × 10^k so gridlines land on clean numbers. */
function niceMax(n: number): number {
  if (n <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(n))
  for (const m of [1, 2, 5, 10]) if (n <= m * p) return m * p
  return 10 * p
}

/** Fill missing days with zero so the time axis is continuous. */
function continuousDays(days: { day: string; count: number }[]): { day: string; count: number }[] {
  if (days.length < 2) return days
  const byDay = new Map(days.map((d) => [d.day, d.count]))
  const out: { day: string; count: number }[] = []
  const cur = new Date(`${days[0].day}T00:00:00`)
  const end = new Date(`${days[days.length - 1].day}T00:00:00`)
  while (cur <= end && out.length < 400) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    out.push({ day: key, count: byDay.get(key) ?? 0 })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/**
 * Prompts per day as thin columns from a shared baseline, with hairline gridlines at
 * clean values, a hover tooltip, and a table view so no value is hover-only.
 */
function ActivityChart({ days }: { days: { day: string; count: number }[] }) {
  const { locale, t } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const series = useMemo(() => continuousDays(days), [days])
  const top = niceMax(Math.max(1, ...series.map((d) => d.count)))
  const fmtDay = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(BCP47[locale], { month: 'short', day: 'numeric' })
  const total = series.reduce((n, d) => n + d.count, 0)
  const h = hover != null ? series[hover] : null

  return (
    <section className="glass panel flex flex-col gap-4 p-5">
      <div className="section-head">
        <div>
          <h2 className="section-title">{t('stats.activity.ts')}</h2>
          <p className="section-desc">
            {t('stats.activity.summary', { days: series.length, total: total.toLocaleString() })}
          </p>
        </div>
        <button type="button" className={GHOST_BTN} onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? t('stats.chartView') : t('stats.tableView')}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('stats.table.day')}</th>
                <th className="text-right">{t('stats.table.prompts')}</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="tabular">{d.day}</td>
                  <td className="text-right tabular">{d.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" onMouseLeave={() => setHover(null)}>
          {/* Plot (160px) + x-axis band (22px) — the container includes the axis. */}
          <div className="relative h-[160px]">
            {[top, top / 2, 0].map((v) => (
              <div
                key={v}
                className="absolute left-0 right-0 flex items-center gap-2"
                style={{ bottom: `${(v / top) * 100}%`, transform: 'translateY(50%)' }}
              >
                <span className="w-8 shrink-0 text-right text-[11px] text-ink-3 tabular">{formatCompact(v)}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            ))}
            <div className="absolute bottom-0 left-10 right-0 top-0 flex items-end gap-[2px]">
              {series.map((d, i) => (
                <div
                  key={d.day}
                  className="relative flex h-full min-w-0 flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                >
                  <div
                    className="w-full rounded-t-[4px] transition-opacity duration-150"
                    style={{
                      height: `${(d.count / top) * 100}%`,
                      minHeight: d.count > 0 ? 2 : 0,
                      background: 'var(--brand)',
                      opacity: hover == null || hover === i ? 1 : 0.45,
                    }}
                  />
                </div>
              ))}
            </div>
            {h && hover != null && (
              <div
                className="menu pointer-events-none !absolute whitespace-nowrap !px-3 !py-2 text-[12.5px]"
                style={{
                  left: `calc(2.5rem + (100% - 2.5rem) * ${(hover + 0.5) / series.length})`,
                  bottom: `calc(${(h.count / top) * 100}% + 10px)`,
                  transform: `translateX(${hover > series.length * 0.75 ? '-100%' : hover < series.length * 0.25 ? '0' : '-50%'})`,
                }}
                role="tooltip"
              >
                <span className="text-ink-3">{fmtDay(h.day)}</span>{' '}
                <span className="font-semibold text-ink-1 tabular">{t('stats.prompts.n', { count: h.count })}</span>
              </div>
            )}
          </div>
          <div className="ml-10 flex h-[22px] items-end justify-between text-[11px] text-ink-3 tabular">
            <span>{series[0] ? fmtDay(series[0].day) : ''}</span>
            <span>{series.length > 2 ? fmtDay(series[Math.floor(series.length / 2)].day) : ''}</span>
            <span>{series.length > 1 ? fmtDay(series[series.length - 1].day) : ''}</span>
          </div>
        </div>
      )}
    </section>
  )
}

export function StatsTab({ stats }: { stats: StatsPayload | null }) {
  const { t } = useI18n()
  const [prices, setPrices] = useState<ModelPrice[] | null>(null)

  useEffect(() => {
    let alive = true
    window.vault
      .pricesList()
      .then((p) => alive && setPrices(p))
      .catch(() => alive && setPrices([]))
    return () => {
      alive = false
    }
  }, [])

  const costs = useMemo(() => (stats && prices ? costRows(stats.tokensByModel, prices) : []), [stats, prices])
  const priced = costs.filter((r) => r.cost != null)
  const total = priced.reduce((sum, r) => sum + (r.cost ?? 0), 0)

  if (!stats) return <p className="empty">{t('common.loading')}</p>

  const days = stats.activityByDay.length
  const perDay = days ? Math.round(stats.totalPrompts / days) : 0
  const maxModel = Math.max(1, ...stats.tokensByModel.map((m) => m.input + m.output))
  const maxRole = Math.max(1, ...stats.messagesByRole.map((r) => r.count))
  const roleLabel: Record<string, string> = { user: t('role.me'), assistant: t('role.assistant'), tool: t('role.tool') }
  const models = stats.tokensByModel.filter((m) => m.input + m.output > 0)

  return (
    <div className="page">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('stats.prompts')}
          value={stats.totalPrompts.toLocaleString()}
          unit={t('unit.count')}
          foot={stats.activityFromTimestamps ? t('stats.prompts.perDay', { count: perDay }) : t('stats.prompts.foot')}
        />
        <StatTile
          label={t('stats.sessions')}
          value={stats.totalSessions.toLocaleString()}
          unit={t('unit.count')}
          foot={t('stats.sessions.foot', { projects: stats.totalProjects, archived: stats.archivedSessions })}
        />
        <StatTile
          label={t('stats.messages')}
          value={formatCompact(stats.totalMessages)}
          unit={t('unit.rows')}
          foot={t('stats.messages.foot')}
        />
        <StatTile
          label={t('cost.total')}
          value={prices ? formatUsd(total) : '…'}
          foot={costs.length - priced.length > 0 ? t('cost.unpriced', { count: costs.length - priced.length }) : t('cost.footnote')}
        />
      </div>

      {stats.activityByDay.length > 0 && <ActivityChart days={stats.activityByDay} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="glass panel flex flex-col gap-4 p-5">
          <div>
            <h2 className="section-title">{t('stats.byModel')}</h2>
            <p className="section-desc">{t('stats.byModel.desc')}</p>
          </div>
          {models.length === 0 && <p className="text-[13.5px] text-ink-3">{t('stats.tokens.empty')}</p>}
          {models.map((m) => (
            <BarRow
              key={m.model}
              label={m.model}
              value={t('stats.byModel.turns', { turns: m.messages.toLocaleString(), tokens: formatCompact(m.input + m.output) })}
              fraction={(m.input + m.output) / maxModel}
            />
          ))}
        </section>
        <section className="glass panel flex flex-col gap-4 p-5">
          <div>
            <h2 className="section-title">{t('stats.byRole')}</h2>
            <p className="section-desc">{t('stats.byRole.desc')}</p>
          </div>
          {stats.messagesByRole.map((r) => (
            <BarRow
              key={r.role}
              label={roleLabel[r.role] ?? r.role}
              value={r.count.toLocaleString()}
              fraction={r.count / maxRole}
            />
          ))}
        </section>
      </div>

      <section className="glass panel flex flex-col gap-4 p-5">
        <div>
          <h2 className="section-title">{t('stats.tokens')}</h2>
          <p className="section-desc">{t('stats.tokens.desc')}</p>
        </div>
        {stats.tokenTotals.input + stats.tokenTotals.output === 0 ? (
          <p className="text-[13.5px] text-ink-3">{t('stats.tokens.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
            {(
              [
                [t('stats.tokens.input'), stats.tokenTotals.input],
                [t('stats.tokens.output'), stats.tokenTotals.output],
                [t('stats.tokens.cacheRead'), stats.tokenTotals.cacheRead],
                [t('stats.tokens.cacheCreation'), stats.tokenTotals.cacheCreation],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <div className="text-[28px] font-light leading-tight tracking-[-0.04em] text-ink-1">{formatCompact(value)}</div>
                <div className="text-[12.5px] text-ink-3">
                  {label} {t('stats.tokens.suffix')}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {prices && stats.tokensByModel.length > 0 && (
        <CostPanel costs={costs} total={total} prices={prices} onPrices={setPrices} />
      )}

      {stats.topTokens.length > 0 && (
        <section className="glass panel flex flex-col gap-3 p-5">
          <div>
            <h2 className="section-title">{t('stats.topWords')}</h2>
            <p className="section-desc">{t('stats.topWords.desc')}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {stats.topTokens.map((tok) => (
              <span key={tok.token} className="rounded-full bg-well px-2.5 py-1 text-[13px] text-ink-1">
                {tok.token} <span className="text-ink-3 tabular">{tok.count.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/**
 * Estimated spend from the token counts already in the index.
 *
 * Two deliberate choices: models with no price row are *excluded* from the total
 * and called out by name (a silent 0 would read as "this was free"), and the price
 * table is editable inline because published rates move and a baked-in number would
 * quietly drift wrong.
 */
function CostPanel({
  costs,
  total,
  prices,
  onPrices,
}: {
  costs: CostRow[]
  total: number
  prices: ModelPrice[]
  onPrices: (p: ModelPrice[]) => void
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ModelPrice[]>([])
  const [newModel, setNewModel] = useState('')

  const priced = costs.filter((r) => r.cost != null)
  const unpricedModels = costs.filter((r) => r.cost == null).map((r) => r.model)
  const max = Math.max(1e-9, ...priced.map((r) => r.cost ?? 0))

  const startEdit = () => {
    setDraft(prices.map((p) => ({ ...p })))
    setEditing(true)
  }

  const commit = async () => {
    onPrices(await window.vault.pricesSave(draft))
    setEditing(false)
  }

  const patch = (i: number, field: keyof ModelPrice, value: string) => {
    setDraft((d) => d.map((p, idx) => (idx === i ? { ...p, [field]: field === 'model' ? value : Number(value) } : p)))
  }

  return (
    <section className="glass panel flex flex-col gap-4 p-5">
      <div className="section-head">
        <div>
          <h2 className="section-title">{t('cost.title')}</h2>
          <p className="section-desc">{t('cost.disclaimer')}</p>
        </div>
        <button type="button" className={GHOST_BTN} onClick={() => (editing ? void commit() : startEdit())}>
          {editing ? t('cost.donePrices') : t('cost.editPrices')}
        </button>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="stat-value">{formatUsd(total)}</span>
        {unpricedModels.length > 0 && (
          <span className="badge tone-amber" title={t('cost.unpriced.hint')}>
            {unpricedModels.length === 1 ? t('cost.unpriced.one') : t('cost.unpriced', { count: unpricedModels.length })}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {priced.map((r) => (
          <BarRow key={r.model} label={r.model} value={formatUsd(r.cost ?? 0)} fraction={(r.cost ?? 0) / max} />
        ))}
      </div>

      {unpricedModels.length > 0 && (
        <p className="alert tone-amber break-words">
          {t('cost.unpriced.models', { models: unpricedModels.join(', ') })}
        </p>
      )}

      {editing && (
        <div className="flex flex-col gap-3 rounded-2xl bg-well p-4">
          <div>
            <h3 className="text-[14px] font-semibold text-ink-1">{t('cost.prices.title')}</h3>
            <p className="text-[12.5px] text-ink-3">{t('cost.prices.note', { date: PRICES_AS_OF })}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="table min-w-[680px]">
              <thead>
                <tr>
                  <th>{t('cost.prices.model')}</th>
                  <th>{t('cost.prices.input')}</th>
                  <th>{t('cost.prices.output')}</th>
                  <th>{t('cost.prices.cacheRead')}</th>
                  <th>{t('cost.prices.cacheWrite')}</th>
                  <th>{t('cost.prices.cacheWrite1h')}</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((p, i) => (
                  <tr key={p.model}>
                    <td className="mono text-ink-1">{p.model}</td>
                    {(['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok', 'cacheWrite1hPerMTok'] as const).map(
                      (field) => (
                        <td key={field}>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={p[field]}
                            onChange={(e) => patch(i, field, e.target.value)}
                            aria-label={`${p.model} ${field}`}
                            className="input tabular w-24 !px-2 !py-1"
                          />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder={t('cost.prices.addPlaceholder')}
              aria-label={t('cost.prices.addPlaceholder')}
              className="input mono w-64"
            />
            <button
              type="button"
              className={GHOST_BTN}
              disabled={!newModel.trim() || draft.some((p) => p.model === newModel.trim())}
              onClick={() => {
                setDraft((d) => [
                  ...d,
                  {
                    model: newModel.trim(),
                    inputPerMTok: 0,
                    outputPerMTok: 0,
                    cacheReadPerMTok: 0,
                    cacheWritePerMTok: 0,
                    cacheWrite1hPerMTok: 0,
                  },
                ])
                setNewModel('')
              }}
            >
              {t('cost.prices.add')}
            </button>
            <button
              type="button"
              className={`${GHOST_BTN} ml-auto`}
              onClick={async () => {
                const restored = await window.vault.pricesReset()
                onPrices(restored)
                setDraft(restored.map((p) => ({ ...p })))
              }}
            >
              {t('cost.prices.reset')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
