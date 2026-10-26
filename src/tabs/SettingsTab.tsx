import { useCallback, useEffect, useState } from 'react'
import type { SettingsInfo, UpdateStatus } from '../../shared/ipc'
import type { MessageKey } from '../../shared/i18n'
import { useT } from '../i18n'
import { GHOST_BTN, Segmented } from '../ui'

function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`
  return `${n} B`
}

const UPDATE_STATE_KEY: Record<UpdateStatus['state'], MessageKey> = {
  idle: 'settings.update.state.idle',
  unsupported: 'settings.update.state.unsupported',
  disabled: 'settings.update.state.disabled',
  checking: 'settings.update.state.checking',
  downloading: 'settings.update.state.downloading',
  ready: 'settings.update.state.ready',
  error: 'settings.update.state.error',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="mb-2 text-[13px] font-semibold text-white">{title}</h3>
      <div className="space-y-2 text-[12px] text-zinc-400">{children}</div>
    </section>
  )
}

/**
 * Everything the user may want to decide about their data: what happens when Claude
 * Code deletes transcripts, whether the app may make its one network request, and
 * where the index lives.
 */
export function SettingsTab({
  update,
  archivedSessions,
  onStatus,
  onChanged,
}: {
  update: UpdateStatus
  archivedSessions: number
  onStatus: (s: string) => void
  onChanged: () => void
}) {
  const t = useT()
  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [reparsing, setReparsing] = useState(false)

  const load = useCallback(async () => setInfo(await window.vault.settingsGet()), [])
  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!confirmPurge) return
    const timer = setTimeout(() => setConfirmPurge(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmPurge])

  if (!info) return <p className="p-4 text-sm text-zinc-500">{t('common.loading')}</p>

  const set = async (patch: Partial<SettingsInfo>) => {
    await window.vault.settingsSet(patch)
    await load()
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">{t('nav.settings')}</h2>
      <div className="grid max-w-3xl gap-4">
        <Section title={t('settings.archive.title')}>
          <p className="leading-relaxed">{t('settings.archive.help')}</p>
          <Segmented
            value={info.archiveMode}
            onChange={(v) => void set({ archiveMode: v })}
            options={
              [
                ['keep', t('settings.archive.keep')],
                ['mirror', t('settings.archive.mirror')],
              ] as const
            }
          />
          {info.archiveMode === 'mirror' && (
            <p className="leading-relaxed text-zinc-500">{t('settings.archive.mirrorNote')}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="font-mono text-[11px] text-zinc-500">
              {t('settings.archive.count', { count: archivedSessions })}
            </span>
            {archivedSessions > 0 && (
              <button
                type="button"
                className={`${GHOST_BTN} ${confirmPurge ? 'border-red-700 text-red-500' : ''}`}
                onClick={async () => {
                  if (!confirmPurge) {
                    setConfirmPurge(true)
                    return
                  }
                  setConfirmPurge(false)
                  const n = await window.vault.archivePurge()
                  onStatus(t('toast.purged', { count: n }))
                  onChanged()
                  await load()
                }}
              >
                {confirmPurge ? t('settings.archive.purgeConfirm') : t('settings.archive.purge')}
              </button>
            )}
          </div>
        </Section>

        <Section title={t('settings.update.title')}>
          <p className="leading-relaxed">{t('settings.update.help')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={info.autoUpdate ? 'on' : 'off'}
              onChange={(v) => void set({ autoUpdate: v === 'on' })}
              options={
                [
                  ['on', t('settings.on')],
                  ['off', t('settings.off')],
                ] as const
              }
            />
            <button
              type="button"
              className={GHOST_BTN}
              disabled={!info.autoUpdate || update.state === 'unsupported' || update.state === 'checking'}
              onClick={() => void window.vault.updateCheck()}
            >
              {t('settings.update.check')}
            </button>
            <span className="text-[11px] text-zinc-500">
              {t(UPDATE_STATE_KEY[update.state], {
                percent: update.percent ?? 0,
                version: update.version ?? '',
                message: update.message ?? '',
              })}
            </span>
          </div>
        </Section>

        <Section title={t('settings.data.title')}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-zinc-500">{t('settings.data.db')}</dt>
            <dd className="break-all font-mono text-[11px] text-zinc-300">
              {info.dbPath} · {formatBytes(info.dbSizeBytes)}
            </dd>
            <dt className="text-zinc-500">{t('settings.data.source')}</dt>
            <dd className="break-all font-mono text-[11px] text-zinc-300">{info.claudeHome}</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className={GHOST_BTN}
              disabled={reparsing}
              onClick={async () => {
                setReparsing(true)
                try {
                  const r = await window.vault.reindex(true)
                  onStatus(t('toast.reindexed', { projects: r.projects, sessions: r.sessions, plans: r.planFiles }))
                  onChanged()
                } finally {
                  setReparsing(false)
                  await load()
                }
              }}
            >
              {reparsing ? t('settings.data.reparsing') : t('settings.data.reparse')}
            </button>
            <span className="text-[11px] text-zinc-500">{t('settings.data.reparseHelp')}</span>
          </div>
        </Section>
      </div>
    </div>
  )
}
