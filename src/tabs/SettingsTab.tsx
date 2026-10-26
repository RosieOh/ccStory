import { useCallback, useEffect, useState } from 'react'
import type { SettingsInfo, UpdateStatus } from '../../shared/ipc'
import { LOCALES, LOCALE_LABEL, type MessageKey } from '../../shared/i18n'
import { useI18n } from '../i18n'
import { Segmented } from '../ui'

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

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="glass panel flex flex-col gap-4 p-5">
      <div>
        <h2 className="section-title">{title}</h2>
        {desc ? <p className="section-desc mt-1 leading-relaxed">{desc}</p> : null}
      </div>
      {children}
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
  const { locale, setLocale, t } = useI18n()
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

  if (!info) return <p className="empty">{t('common.loading')}</p>

  const set = async (patch: Partial<SettingsInfo>) => {
    await window.vault.settingsSet(patch)
    await load()
  }

  return (
    <div className="page">
      <div className="grid max-w-4xl gap-4">
        <Section title={t('settings.archive.title')} desc={t('settings.archive.help')}>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label={t('settings.archive.title')}
              value={info.archiveMode}
              onChange={(v) => void set({ archiveMode: v })}
              options={
                [
                  ['keep', t('settings.archive.keep')],
                  ['mirror', t('settings.archive.mirror')],
                ] as const
              }
            />
            <span className="text-[13px] text-ink-3 tabular">{t('settings.archive.count', { count: archivedSessions })}</span>
            {archivedSessions > 0 && (
              <button
                type="button"
                className={`btn btn-xs ${confirmPurge ? 'btn-danger' : 'btn-tertiary'}`}
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
          {info.archiveMode === 'mirror' && <p className="alert tone-amber">{t('settings.archive.mirrorNote')}</p>}
        </Section>

        <Section title={t('settings.update.title')} desc={t('settings.update.help')}>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label={t('settings.update.title')}
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
              className="btn btn-tertiary btn-xs"
              disabled={!info.autoUpdate || update.state === 'unsupported' || update.state === 'checking'}
              onClick={() => void window.vault.updateCheck()}
            >
              {t('settings.update.check')}
            </button>
            <span className="text-[13px] text-ink-3">
              {t(UPDATE_STATE_KEY[update.state], {
                percent: update.percent ?? 0,
                version: update.version ?? '',
                message: update.message ?? '',
              })}
            </span>
          </div>
        </Section>

        <Section title={t('settings.language.title')}>
          <Segmented
            label={t('settings.language.title')}
            value={locale}
            onChange={setLocale}
            options={LOCALES.map((l) => [l, LOCALE_LABEL[l]] as const)}
          />
        </Section>

        <Section title={t('settings.data.title')} desc={t('settings.data.reparseHelp')}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-[13.5px]">
            <dt className="text-ink-3">{t('settings.data.db')}</dt>
            <dd className="mono break-all !text-[12.5px] text-ink-1">
              {info.dbPath} · {formatBytes(info.dbSizeBytes)}
            </dd>
            <dt className="text-ink-3">{t('settings.data.source')}</dt>
            <dd className="mono break-all !text-[12.5px] text-ink-1">{info.claudeHome}</dd>
          </dl>
          <div>
            <button
              type="button"
              className="btn btn-tertiary"
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
          </div>
        </Section>
      </div>
    </div>
  )
}
