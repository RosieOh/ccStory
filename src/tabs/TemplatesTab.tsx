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

  const remove = async () => {
    if (selectedId == null) return
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
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-zinc-800 p-3">
        <button
          type="button"
          onClick={startNew}
          className="mb-3 w-full rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
        >
          {t('templates.new')}
        </button>
        {templates.length === 0 && (
          <p className="text-xs text-zinc-500">
            {t('templates.empty')}
          </p>
        )}
        <ul className="space-y-1">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <button
                type="button"
                onClick={() => openTemplate(tpl)}
                className={`w-full truncate rounded px-2 py-1.5 text-left text-xs ${
                  selectedId === tpl.id
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-300 hover:bg-zinc-900'
                }`}
                title={tpl.name}
              >
                {tpl.name || t('templates.untitled')}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('templates.name')}
            className="min-w-[200px] flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            {t('templates.save')}
          </button>
          {selectedId != null && (
            <button
              type="button"
              onClick={() => void remove()}
              className="rounded-md border border-red-800/70 px-3 py-2 text-sm text-red-200 hover:bg-red-950/40"
            >
              {t('templates.delete')}
            </button>
          )}
        </div>
        <label className="mb-1 block text-xs text-zinc-500">
          {t('templates.bodyLabel', { token: '{{…}}' })}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('templates.bodyPlaceholder')}
          className="h-48 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-100"
        />
        {variables.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-2 text-xs font-medium text-zinc-500">{t('templates.variables')}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {variables.map((v) => (
                <label key={v} className="flex flex-col gap-1 text-xs text-zinc-400">
                  {v}
                  <input
                    value={values[v] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                  />
                </label>
              ))}
            </div>
          </section>
        )}
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('templates.preview')}</h3>
            <button
              type="button"
              onClick={copyRendered}
              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
            >
              {t('templates.copyFilled')}
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-200">
            {rendered || t('templates.previewEmpty')}
          </pre>
        </section>
      </div>
    </div>
  )
}
