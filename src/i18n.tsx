import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DICTIONARIES,
  LOCALES,
  translate,
  type Locale,
  type MessageKey,
} from '../shared/i18n'

type T = (key: MessageKey, params?: Record<string, string | number>) => string

type Ctx = { locale: Locale; setLocale: (l: Locale) => void; t: T }

const I18nContext = createContext<Ctx | null>(null)

const STORAGE_KEY = 'vault-locale'

function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/** Stored choice wins; otherwise follow the OS/browser language, defaulting to English. */
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    /* storage unavailable — fall through to language detection */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  return nav.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  useEffect(() => {
    document.documentElement.lang = locale
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      /* ignore storage errors */
    }
  }, [locale])

  const setLocale = useCallback((l: Locale) => setLocaleState(l), [])

  const t = useCallback<T>(
    (key, params) => translate(DICTIONARIES[locale], key, params),
    [locale],
  )

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}

/** Convenience for components that only need the translate function. */
export function useT(): T {
  return useI18n().t
}
