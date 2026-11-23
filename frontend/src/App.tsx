import { useEffect, useState } from 'react'
import { Columns3, Home, Settings } from 'lucide-react'
import { api, type Health } from './api'
import { useUpdateReady, applyUpdate } from './appUpdate'
import { ComparePage } from './ComparePage'
import { HousePage } from './HousePage'
import { HousesPage } from './HousesPage'
import { Logo } from './Logo'
import { SettingsPage } from './SettingsPage'
import { useStore } from './store'

export type Route =
  | { page: 'houses' }
  | { page: 'house'; id: string; tab: string | null }
  | { page: 'compare' }
  | { page: 'settings'; section: string | null }

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'huis' && parts[1]) return { page: 'house', id: parts[1], tab: parts[2] ?? null }
  if (parts[0] === 'vergelijk') return { page: 'compare' }
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
  const { compare, toasts } = useStore()
  const updateReady = useUpdateReady()
  const [health, setHealth] = useState<Health | null>(null)
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
      <header className="topbar">
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
        </div>
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
        {route.page === 'house' && <HousePage id={route.id} tab={route.tab} />}
        {route.page === 'compare' && <ComparePage />}
        {route.page === 'settings' && <SettingsPage section={route.section} health={health} />}
      </main>
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
