import { useEffect, useRef, useState } from 'react'
import { Columns3, Home, Search, Settings } from 'lucide-react'
import { api, type Health } from './api'
import { useUpdateReady, applyUpdate } from './appUpdate'
import { ReceivePage } from './Bookmarklet'
import { ComparePage } from './ComparePage'
import { FindBar } from './FindBar'
import { HousePage } from './HousePage'
import { HousesPage } from './HousesPage'
import { Logo } from './Logo'
import { SettingsPage } from './SettingsPage'
import { PairPage } from './Pairing'
import { SharePage } from './SharePage'
import { useStore } from './store'
import { WhatsNew } from './WhatsNew'

export type Route =
  | { page: 'houses' }
  | { page: 'house'; id: string; tab: string | null }
  | { page: 'compare' }
  | { page: 'settings'; section: string | null }
  | { page: 'receive' }
  | { page: 'share'; id: string }
  | { page: 'pair'; id: string }

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'huis' && parts[1]) return { page: 'house', id: parts[1], tab: parts[2] ?? null }
  if (parts[0] === 'vergelijk') return { page: 'compare' }
  if (parts[0] === 'ontvang') return { page: 'receive' }
  if (parts[0] === 'delen' && parts[1]) return { page: 'share', id: parts[1] }
  if (parts[0] === 'koppel' && parts[1]) return { page: 'pair', id: parts[1] }
  if (parts[0] === 'instellingen') return { page: 'settings', section: parts[1] ?? null }
  return { page: 'houses' }
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

export function App() {
  const route = useRoute()
  const topbar = useRef<HTMLElement>(null)
  // Sticky bars below the top bar (such as the tabs of a house) start at its height.
  useEffect(() => {
    const el = topbar.current
    if (!el) return
    const set = () =>
      document.documentElement.style.setProperty('--topbar-h', `${el.getBoundingClientRect().height}px`)
    set()
    const observer = new ResizeObserver(set)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const { compare, toasts } = useStore()
  const updateReady = useUpdateReady()
  const [health, setHealth] = useState<Health | null>(null)
  const [finding, setFinding] = useState(false)
  // In the installed app there is no browser to catch Ctrl+F, so it opens our own search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && matchMedia('(display-mode: standalone)').matches) {
        e.preventDefault()
        setFinding(true)
        document.querySelector<HTMLInputElement>('.findbar-input')?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    api.health().then(setHealth).catch(() => undefined)
  }, [])

  const nav = [
    { href: '#/', label: 'Huizen', icon: Home, active: route.page === 'houses' || route.page === 'house' },
    {
      href: '#/vergelijk',
      label: 'Vergelijken',
      icon: Columns3,
      active: route.page === 'compare',
      badge: compare.length || undefined,
    },
    { href: '#/instellingen', label: 'Instellingen', icon: Settings, active: route.page === 'settings' },
  ]

  const env = health?.environment
  return (
    <>
      {env?.label && (
        <div className="env-band" style={{ background: env.color }}>
          {env.label}
        </div>
      )}
      <header className="topbar" ref={topbar}>
        <div className="topbar-inner">
          <a href="#/" className="brand" aria-label="Huizenjacht, naar het overzicht">
            <Logo />
          </a>
          <nav className="topnav" aria-label="Hoofdmenu">
            {nav.map((item) => (
              <a key={item.href} href={item.href} className={item.active ? 'active' : ''}>
                <item.icon size={18} aria-hidden="true" />
                {item.label}
                {item.badge && <span className="count">{item.badge}</span>}
              </a>
            ))}
          </nav>
          <button
            className={`icon-btn find-toggle${finding ? ' on' : ''}`}
            aria-label="Zoeken op deze pagina"
            aria-pressed={finding}
            data-tip="Zoeken op deze pagina"
            onClick={() => setFinding((f) => !f)}
          >
            <Search size={20} aria-hidden="true" />
          </button>
        </div>
        {finding && <FindBar onClose={() => setFinding(false)} />}
      </header>
      {updateReady && (
        <div className="update-banner" role="status">
          Er is een nieuwe versie van Huizenjacht.
          <button className="btn btn-small" onClick={applyUpdate}>
            Vernieuwen
          </button>
        </div>
      )}
      <main className="main">
        {route.page === 'houses' && <HousesPage />}
        {route.page === 'house' && <HousePage key={route.id} id={route.id} tab={route.tab} />}
        {route.page === 'compare' && <ComparePage />}
        {route.page === 'settings' && <SettingsPage section={route.section} health={health} />}
        {route.page === 'receive' && <ReceivePage />}
        {route.page === 'share' && <SharePage id={route.id} />}
        {route.page === 'pair' && <PairPage id={route.id} />}
      </main>
      {route.page !== 'receive' && route.page !== 'share' && route.page !== 'pair' && <WhatsNew />}
      <nav className="tabbar" aria-label="Hoofdmenu">
        {nav.map((item) => (
          <a key={item.href} href={item.href} className={item.active ? 'active' : ''}>
            <span className="tabbar-icon">
              <item.icon size={22} aria-hidden="true" />
              {item.badge && <span className="count">{item.badge}</span>}
            </span>
            {item.label}
          </a>
        ))}
      </nav>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  )
}
