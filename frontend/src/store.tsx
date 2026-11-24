import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, CLIENT_ID } from './api'
import { DEFAULT_CHECKLIST, type ChecklistCategory } from './checklist'
import { PERSONAL, toHouse, type House, type HouseRecord, type Mine, type Person } from './house'

type Toast = { id: number; text: string; tone: 'info' | 'error' }

type Store = {
  houses: House[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  update: (id: string, changes: Partial<Record<keyof Mine, unknown>>) => Promise<void>
  replace: (record: HouseRecord) => void
  remove: (id: string) => Promise<void>
  template: ChecklistCategory[]
  saveTemplate: (template: ChecklistCategory[]) => Promise<void>
  /** Show the standard checklist also at houses whose report has its own checklist. */
  withStandard: boolean
  setWithStandard: (on: boolean) => void
  compare: string[]
  toggleCompare: (id: string) => void
  clearCompare: () => void
  toasts: Toast[]
  notify: (text: string, tone?: Toast['tone']) => void
  /** Your person key and everyone who has answers, each with a colour. */
  me: string
  people: Person[]
  claimAnswers: () => Promise<void>
}

const StoreContext = createContext<Store | null>(null)
export const MAX_COMPARE = 4
const COMPARE_KEY = 'hj.compare'

function readCompare(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(COMPARE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Er ging iets mis.'
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<HouseRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [template, setTemplate] = useState<ChecklistCategory[]>(DEFAULT_CHECKLIST)
  const [withStandard, setWithStandardState] = useState(true)
  const [compare, setCompare] = useState<string[]>(readCompare)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [me, setMe] = useState('lokaal')
  const [people, setPeople] = useState<Person[]>([])
  const peopleRef = useRef(people)
  useEffect(() => {
    peopleRef.current = people
  }, [people])

  const loadPeople = useCallback(async () => {
    try {
      const r = await api.people()
      setMe(r.me)
      setPeople(r.people)
    } catch {
      // keep what we had
    }
  }, [])

  const notify = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setRecords(await api.houses())
      setError(null)
    } catch (e) {
      setError(message(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    void loadPeople()
    api
      .getSetting<ChecklistCategory[]>('checklist')
      .then((r) => r.value && setTemplate(r.value))
      .catch(() => undefined)
    api
      .getSetting<boolean>('checklistStandaard')
      .then((r) => typeof r.value === 'boolean' && setWithStandardState(r.value))
      .catch(() => undefined)
    const onFocus = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [refresh, loadPeople])

  useEffect(() => {
    try {
      localStorage.setItem(COMPARE_KEY, JSON.stringify(compare))
    } catch {
      // not remembered
    }
  }, [compare])

  const replace = useCallback((record: HouseRecord) => {
    setRecords((list) =>
      list.some((r) => r.id === record.id)
        ? list.map((r) => (r.id === record.id ? record : r))
        : [...list, record],
    )
  }, [])

  // Live updates: another person or device changed something, so fetch it again.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource('/api/events')
    source.onmessage = (e) => {
      let event: { type: string; id?: string; from?: string | null }
      try {
        event = JSON.parse(e.data)
      } catch {
        return
      }
      if (event.from === CLIENT_ID) return
      if (event.type === 'houses') {
        void refresh()
        void loadPeople()
      } else if (event.type === 'removed' && event.id) {
        setRecords((list) => list.filter((r) => r.id !== event.id))
      } else if (event.type === 'house' && event.id) {
        api
          .house(event.id)
          .then((record) => {
            replace(record)
            // Someone new answered: fetch their name and colour.
            const keys = Object.keys(record.mine.personen ?? {})
            if (keys.some((k) => !peopleRef.current.some((p) => p.key === k))) void loadPeople()
          })
          .catch(() => undefined)
      }
    }
    return () => source.close()
  }, [refresh, loadPeople, replace])

  const update = useCallback(
    async (id: string, changes: Partial<Record<keyof Mine, unknown>>) => {
      // Show the change at once; the server's answer replaces it. Your own answers sit under
      // your person key, the rest is shared.
      setRecords((list) =>
        list.map((r) => {
          if (r.id !== id) return r
          const mine = { ...r.mine } as Record<string, unknown>
          const own = { ...(r.mine.personen?.[me] ?? {}) } as Record<string, unknown>
          for (const [k, v] of Object.entries(changes)) {
            const target = (PERSONAL as readonly string[]).includes(k) ? own : mine
            if (v === null) delete target[k]
            else target[k] = v
          }
          mine.personen = { ...r.mine.personen, [me]: own }
          return { ...r, mine: mine as Mine }
        }),
      )
      try {
        replace(await api.updateHouse(id, changes))
      } catch (e) {
        notify(`Niet opgeslagen: ${message(e)}`, 'error')
        void refresh()
      }
    },
    [notify, refresh, replace, me],
  )

  const claimAnswers = useCallback(async () => {
    try {
      await api.claimAnswers()
      await Promise.all([refresh(), loadPeople()])
    } catch (e) {
      notify(message(e), 'error')
    }
  }, [notify, refresh, loadPeople])

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.deleteHouse(id)
        setRecords((list) => list.filter((r) => r.id !== id))
        setCompare((c) => c.filter((x) => x !== id))
      } catch (e) {
        notify(message(e), 'error')
      }
    },
    [notify],
  )

  const saveTemplate = useCallback(
    async (next: ChecklistCategory[]) => {
      setTemplate(next)
      try {
        await api.putSetting('checklist', next)
      } catch (e) {
        notify(`Checklist niet opgeslagen: ${message(e)}`, 'error')
      }
    },
    [notify],
  )

  const toggleCompare = useCallback(
    (id: string) => {
      setCompare((list) => {
        if (list.includes(id)) return list.filter((x) => x !== id)
        if (list.length >= MAX_COMPARE) {
          notify(`Je kunt maximaal ${MAX_COMPARE} huizen vergelijken.`)
          return list
        }
        return [...list, id]
      })
    },
    [notify],
  )

  const setWithStandard = useCallback(
    (on: boolean) => {
      setWithStandardState(on)
      api.putSetting('checklistStandaard', on).catch((e) => notify(`Niet opgeslagen: ${message(e)}`, 'error'))
    },
    [notify],
  )

  const houses = useMemo(() => records.map((r) => toHouse(r, me, people)), [records, me, people])
  const value: Store = {
    houses,
    loading,
    error,
    refresh,
    update,
    replace,
    remove,
    template,
    saveTemplate,
    withStandard,
    setWithStandard,
    compare: compare.filter((id) => loading || records.some((r) => r.id === id)),
    toggleCompare,
    clearCompare: () => setCompare([]),
    toasts,
    notify,
    me,
    people,
    claimAnswers,
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore outside StoreProvider')
  return store
}

export { message as errorText }
