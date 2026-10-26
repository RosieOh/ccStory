import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TemplateRow } from '../../shared/ipc'
import { extractTemplateVariables, renderTemplate } from '../../shared/templates'
import { useT } from '../i18n'

export function TemplatesTab({ onStatus }: { onStatus: (s: string) => void }) {
  const t = useT()
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    const list = await window.vault.templatesList()
    setTemplates(list)
    return list
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const variables = useMemo(() => extractTemplateVariables(body), [body])
  const rendered = useMemo(() => renderTemplate(body, values), [body, values])

  const startNew = () => {
    setSelectedId(null)
    setName('')
    setBody('')
    setValues({})
  }

  const openTemplate = (t: TemplateRow) => {
    setSelectedId(t.id)
    setName(t.name)
    setBody(t.body)
    setValues({})
  }

  const save = async () => {
    if (!body.trim() && !name.trim()) return
    if (selectedId == null) {
      const id = await window.vault.templateCreate(name, body)
      onStatus(t('toast.templateCreated'))
      const list = await load()
      const created = list.find((t) => t.id === id)
      if (created) openTemplate(created)
    } else {
      await window.vault.templateUpdate(selectedId, name, body)
      onStatus(t('toast.templateSaved'))
      await load()
    }
  }

  // Deleting asks twice: the second click within a few seconds confirms.
  useEffect(() => {
    if (!confirmDelete) return
    const timer = setTimeout(() => setConfirmDelete(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmDelete])

  const remove = async () => {
    if (selectedId == null) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setConfirmDelete(false)
    await window.vault.templateDelete(selectedId)
    onStatus(t('toast.templateDeleted'))
    startNew()
    await load()
  }

  const copyRendered = () => {
    void window.vault.copyText(rendered)
    onStatus(t('toast.promptCopied'))
  }

  return (
    <div className="page page-fill">
      <div className="flex min-h-0 flex-1 gap-4">
        <section className="list glass flex w-72 shrink-0 flex-col">
          <div className="p-2">
            <button type="button" onClick={startNew} className="btn btn-primary w-full">
              {t('templates.new')}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {templates.length === 0 && <p className="px-3 py-4 text-[13px] leading-relaxed text-ink-3">{t('templates.empty')}</p>}
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => openTemplate(tpl)}
                className="row"
                aria-current={selectedId === tpl.id ? 'true' : undefined}
                title={tpl.name}
              >
                <span className={`block truncate font-semibold ${selectedId === tpl.id ? 'text-brand-ink' : 'text-ink-1'}`}>
                  {tpl.name || t('templates.untitled')}
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{tpl.body.replace(/\s+/g, ' ')}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="glass panel flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('templates.name')}
              aria-label={t('templates.name')}
              className="input min-w-[200px] flex-1 !text-[15px] font-semibold"
            />
            <button type="button" onClick={() => void save()} className="btn btn-primary">
              {t('templates.save')}
            </button>
            {selectedId != null && (
              <button type="button" onClick={() => void remove()} className="btn btn-danger">
                {confirmDelete ? t('templates.confirmDelete') : t('templates.delete')}
              </button>
            )}
          </div>
          <label className="flex flex-col gap-2">
            <span className="eyebrow">{t('templates.bodyLabel', { token: '{{…}}' })}</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('templates.bodyPlaceholder')}
              className="input mono h-48 resize-y !p-3 leading-relaxed"
            />
          </label>
          {variables.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="eyebrow">{t('templates.variables')}</span>
              <div className="grid gap-3 sm:grid-cols-2">
                {variables.map((v) => (
                  <label key={v} className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
                    {v}
                    <input
                      value={values[v] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                      className="input"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="eyebrow">{t('templates.preview')}</span>
              <button type="button" onClick={copyRendered} className="btn btn-secondary btn-xs" disabled={!rendered}>
                {t('templates.copyFilled')}
              </button>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-well p-4 font-sans text-[13.5px] leading-relaxed text-ink-1">
              {rendered || t('templates.previewEmpty')}
            </pre>
          </div>
        </section>
      </div>
    </div>
  )
}
