import { useEffect, useMemo, useState } from 'react'
import type { ModelTokenRow, StatsPayload } from '../../shared/ipc'
import { PRICES_AS_OF, costOf, formatUsd, type ModelPrice } from '../../shared/pricing'
import { useT } from '../i18n'
import { GHOST_BTN } from '../ui'
import { formatCompact } from '../format'

export function StatsTab({ stats }: { stats: StatsPayload | null }) {
  const t = useT()
  return (
            <div className="h-full overflow-y-auto p-4 text-sm">
              <h2 className="mb-3 text-sm font-semibold text-white">{t('stats.title')}</h2>
              {!stats && <p className="text-zinc-500">{t('stats.loading')}</p>}
              {stats && (
                <div className="grid gap-6 md:grid-cols-2">
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.summary')}</h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {(
                        [
                          [t('stats.prompts'), stats.totalPrompts],
                          [t('stats.sessions'), stats.totalSessions],
                          [t('stats.archived'), stats.archivedSessions],
                          [t('stats.projects'), stats.totalProjects],
                          [t('stats.messages'), stats.totalMessages],
                        ] as const
                      ).map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5 shadow-e1"
                        >
                          <div className="text-lg font-semibold tabular text-white">
                            {value.toLocaleString()}
                          </div>
                          <div className="text-[11px] text-zinc-500">{label}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.byRole')}</h3>
                    <div className="space-y-1.5">
                      {(() => {
                        const max = Math.max(1, ...stats.messagesByRole.map((r) => r.count))
                        const label: Record<string, string> = {
                          user: t('role.me'),
                          assistant: t('role.assistant'),
                          tool: t('role.tool'),
                        }
                        return stats.messagesByRole.map((r) => (
                          <div key={r.role} className="flex items-center gap-2 text-xs">
                            <span className="w-16 shrink-0 text-zinc-400">
                              {label[r.role] ?? r.role}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-brand"
                                style={{ width: `${(r.count / max) * 100}%` }}
                              />
                            </div>
                            <span className="w-16 shrink-0 text-right tabular text-zinc-500">
                              {r.count.toLocaleString()}
                            </span>
                          </div>
                        ))
                      })()}
                    </div>
                  </section>
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.tokens')}</h3>
                    {stats.tokenTotals.input + stats.tokenTotals.output === 0 ? (
                      <p className="text-xs text-zinc-500">
                        {t('stats.tokens.empty')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {(
                          [
                            [t('stats.tokens.input'), stats.tokenTotals.input, 'text-brand-text'],
                            [t('stats.tokens.output'), stats.tokenTotals.output, 'text-sky-600'],
                            [t('stats.tokens.cacheRead'), stats.tokenTotals.cacheRead, 'text-plan-text'],
                            [t('stats.tokens.cacheCreation'), stats.tokenTotals.cacheCreation, 'text-amber-600'],
                          ] as const
                        ).map(([label, value, cls]) => (
                          <div
                            key={label}
                            className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                          >
                            <div className={`text-lg font-semibold ${cls}`}>
                              {formatCompact(value)}
                            </div>
                            <div className="text-[11px] text-zinc-500">{label} {t('stats.tokens.suffix')}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  {stats.tokensByModel.length > 0 && (
                    <section className="md:col-span-2">
                      <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.byModel')}</h3>
                      <div className="space-y-2">
                        {(() => {
                          const max = Math.max(
                            1,
                            ...stats.tokensByModel.map((m) => m.input + m.output),
                          )
                          return stats.tokensByModel.map((m) => {
                            const total = m.input + m.output
                            return (
                              <div key={m.model}>
                                <div className="mb-0.5 flex justify-between text-xs text-zinc-300">
                                  <span className="font-mono">{m.model}</span>
                                  <span className="text-zinc-500">
                                    {t('stats.byModel.turns', { turns: m.messages, tokens: formatCompact(total) })}
                                  </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                                  <div
                                    className="h-full rounded-full bg-brand"
                                    style={{ width: `${(total / max) * 100}%` }}
                                  />
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </section>
                  )}
                  <CostPanel byModel={stats.tokensByModel} />
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('stats.topWords')}</h3>
                    <div className="flex flex-wrap gap-2">
                      {stats.topTokens.map((tok) => (
                        <span
                          key={tok.token}
                          className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300"
                        >
                          {tok.token}{' '}
                          <span className="text-zinc-500">×{tok.count}</span>
                        </span>
                      ))}
                    </div>
                  </section>
                  <section className="md:col-span-2">
                    <h3 className="mb-2 text-xs font-medium text-zinc-500">
                      {stats.activityFromTimestamps ? t('stats.activity.ts') : t('stats.activity.mtime')}
                    </h3>
                    {(() => {
                      const max = Math.max(1, ...stats.activityByDay.map((d) => d.count))
                      return (
                        <div className="max-h-56 space-y-1 overflow-auto pr-1 text-xs text-zinc-400">
                          {stats.activityByDay.map((d) => (
                            <div key={d.day} className="flex items-center gap-2">
                              <span className="w-20 shrink-0 font-mono text-[11px]">{d.day}</span>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                                <div
                                  className="h-full rounded-full bg-brand/70"
                                  style={{ width: `${(d.count / max) * 100}%` }}
                                />
                              </div>
                              <span className="w-10 shrink-0 text-right tabular-nums">{d.count}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </section>
                </div>
              )}
            </div>
  )
}

/**
 * Estimated spend from the token counts already in the index.
 *
 * Two deliberate choices: models with no price row are *excluded* from the total
 * and called out separately (a silent 0 would read as "this was free"), and the
 * price table is editable inline because published rates move and a baked-in
 * number would quietly drift wrong.
 */
function CostPanel({ byModel }: { byModel: ModelTokenRow[] }) {
  const t = useT()
  const [prices, setPrices] = useState<ModelPrice[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ModelPrice[]>([])
  const [newModel, setNewModel] = useState('')

  useEffect(() => {
    let alive = true
    window.vault
      .pricesList()
      .then((p) => {
        if (alive) setPrices(p)
      })
      .catch(() => {
        if (alive) setPrices([])
      })
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(() => {
    if (!prices) return []
    return byModel
      // Claude Code records placeholder ids like `<synthetic>` with no usage at
      // all. Costing them contributes nothing but would inflate the
      // "unpriced models" warning, so drop anything with zero tokens.
      .filter((m) => m.input + m.output + m.cacheRead + m.cacheCreation > 0)
      .map((m) => ({
        model: m.model,
        cost: costOf(
          m.model,
          {
            input: m.input,
            output: m.output,
            cacheRead: m.cacheRead,
            cacheCreation: m.cacheCreation,
            cacheCreation1h: m.cacheCreation1h,
          },
          prices,
        ),
      }))
      .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1))
  }, [byModel, prices])

  const priced = rows.filter((r) => r.cost != null)
  const unpricedModels = rows.filter((r) => r.cost == null).map((r) => r.model)
  const unpriced = unpricedModels.length
  const total = priced.reduce((sum, r) => sum + (r.cost ?? 0), 0)
  const max = Math.max(1e-9, ...priced.map((r) => r.cost ?? 0))

  if (!prices || byModel.length === 0) return null

  const startEdit = () => {
    setDraft(prices.map((p) => ({ ...p })))
    setEditing(true)
  }

  const commit = async () => {
    setPrices(await window.vault.pricesSave(draft))
    setEditing(false)
  }

  const patch = (i: number, field: keyof ModelPrice, value: string) => {
    setDraft((d) =>
      d.map((p, idx) =>
        idx === i ? { ...p, [field]: field === 'model' ? value : Number(value) } : p,
      ),
    )
  }

  return (
    <section className="md:col-span-2">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-medium text-zinc-500">{t('cost.title')}</h3>
        <button
          type="button"
          className={`${GHOST_BTN} ml-auto`}
          onClick={() => (editing ? void commit() : startEdit())}
        >
          {editing ? t('cost.donePrices') : t('cost.editPrices')}
        </button>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-zinc-500">{t('cost.total')}</span>
          <span className="tabular text-lg font-semibold text-white">{formatUsd(total)}</span>
          {unpriced > 0 && (
            <span
              className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700"
              title={t('cost.unpriced.hint')}
            >
              {unpriced === 1 ? t('cost.unpriced.one') : t('cost.unpriced', { count: unpriced })}
            </span>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {priced.map((r) => (
            <div key={r.model}>
              <div className="mb-0.5 flex justify-between text-xs text-zinc-300">
                <span className="font-mono">{r.model}</span>
                <span className="tabular text-zinc-500">{formatUsd(r.cost ?? 0)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${((r.cost ?? 0) / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {unpriced > 0 && (
          <p className="mt-3 break-words font-mono text-[11px] text-amber-700">
            {t('cost.unpriced.models', { models: unpricedModels.join(', ') })}
          </p>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">{t('cost.disclaimer')}</p>
      </div>

      {editing && (
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <h4 className="text-[11px] font-medium text-zinc-400">{t('cost.prices.title')}</h4>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            {t('cost.prices.note', { date: PRICES_AS_OF })}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[620px] text-[11px]">
              <thead>
                <tr className="text-left text-zinc-600">
                  <th className="py-1 pr-2 font-medium">{t('cost.prices.model')}</th>
                  <th className="py-1 pr-2 font-medium">{t('cost.prices.input')}</th>
                  <th className="py-1 pr-2 font-medium">{t('cost.prices.output')}</th>
                  <th className="py-1 pr-2 font-medium">{t('cost.prices.cacheRead')}</th>
                  <th className="py-1 pr-2 font-medium">{t('cost.prices.cacheWrite')}</th>
                  <th className="py-1 font-medium">{t('cost.prices.cacheWrite1h')}</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((p, i) => (
                  <tr key={p.model} className="border-t border-zinc-800">
                    <td className="py-1 pr-2 font-mono text-zinc-300">{p.model}</td>
                    {(
                      [
                        'inputPerMTok',
                        'outputPerMTok',
                        'cacheReadPerMTok',
                        'cacheWritePerMTok',
                        'cacheWrite1hPerMTok',
                      ] as const
                    ).map((field) => (
                      <td key={field} className="py-1 pr-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={p[field]}
                          onChange={(e) => patch(i, field, e.target.value)}
                          className="tabular w-20 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder={t('cost.prices.addPlaceholder')}
              className="w-56 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
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
                setPrices(restored)
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
