import { useMemo, useState } from 'react'
import { Calendar, Check, FileUp, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { checklistFor, progress } from './checklist'
import {
  displayAddress,
  formatDateTime,
  formatEuro,
  formatNumber,
  matchesSearch,
  place,
  sortHouses,
  SORTS,
  STATUSES,
  type House,
  type SortKey,
  type Status,
} from './house'
import { NewHouseDialog } from './NewHouseDialog'
import { useStore } from './store'
import { EnergyLabel, FavoriteButton, Photo, ProgressBar, ScorePill, StatusBadge } from './ui'

type Filter = 'actief' | 'alle' | 'favoriet' | Status

const SORT_KEY = 'hj.sort'

function rememberedSort(): SortKey {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return SORTS.some((s) => s.id === v) ? (v as SortKey) : 'nieuwste'
  } catch {
    return 'nieuwste'
  }
}

export function HousesPage() {
  const { houses, loading, error, refresh } = useStore()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('actief')
  const [sort, setSort] = useState<SortKey>(rememberedSort)
  const [adding, setAdding] = useState(false)

  const counts = useMemo(() => {
    const c: Record<string, number> = { alle: houses.length, favoriet: 0, actief: 0 }
    for (const h of houses) {
      c[h.status] = (c[h.status] ?? 0) + 1
      if (h.favoriet) c.favoriet += 1
      if (h.status !== 'afgevallen') c.actief += 1
    }
    return c
  }, [houses])

  const shown = useMemo(() => {
    const filtered = houses.filter((h) => {
      if (!matchesSearch(h, query)) return false
      if (filter === 'alle') return true
      if (filter === 'actief') return h.status !== 'afgevallen'
      if (filter === 'favoriet') return h.favoriet
      return h.status === filter
    })
    return sortHouses(filtered, sort)
  }, [houses, query, filter, sort])

  const upcoming = useMemo(
    () =>
      houses
        .filter((h) => h.mine.bezichtiging && Date.parse(h.mine.bezichtiging) > Date.now() - 3600_000)
        .sort((a, b) => Date.parse(a.mine.bezichtiging!) - Date.parse(b.mine.bezichtiging!))
        .slice(0, 3),
    [houses],
  )

  const chips: { id: Filter; label: string }[] = [
    { id: 'actief', label: 'Actief' },
    { id: 'favoriet', label: 'Favorieten' },
    ...STATUSES.map((s) => ({ id: s.id as Filter, label: s.label })),
    { id: 'alle', label: 'Alle' },
  ]

  if (loading) return <div className="loading">Huizen laden…</div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Mijn huizen</h1>
          <p className="muted">
            {counts.actief} actief{counts.favoriet ? ` · ${counts.favoriet} favoriet` : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={18} /> Huis toevoegen
        </button>
      </div>

      {error && (
        <div className="notice notice-error">
          {error}{' '}
          <button className="link" onClick={() => void refresh()}>
            Opnieuw proberen
          </button>
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="upcoming" aria-label="Komende bezichtigingen">
          {upcoming.map((h) => (
            <a key={h.id} href={`#/huis/${encodeURIComponent(h.id)}/checklist`} className="upcoming-item">
              <Calendar size={18} />
              <span>
                <b>{formatDateTime(h.mine.bezichtiging)}</b>
                <span>{displayAddress(h)}</span>
              </span>
            </a>
          ))}
        </section>
      )}

      {houses.length === 0 ? (
        <EmptyState onAdd={() => setAdding(true)} />
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                placeholder="Zoek op adres, plaats of wijk"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="select">
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span className="visually-hidden">Sorteren</span>
              <select
                value={sort}
                onChange={(e) => {
                  const v = e.target.value as SortKey
                  setSort(v)
                  try {
                    localStorage.setItem(SORT_KEY, v)
                  } catch {
                    // not remembered
                  }
                }}
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="chips" role="tablist" aria-label="Filter op status">
            {chips
              .filter((c) => c.id === 'actief' || c.id === 'alle' || counts[c.id])
              .map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={filter === c.id}
                  className={`chip ${filter === c.id ? 'on' : ''}`}
                  onClick={() => setFilter(c.id)}
                >
                  {c.label}
                  <span className="chip-count">{counts[c.id] ?? 0}</span>
                </button>
              ))}
          </div>
          {shown.length === 0 ? (
            <p className="muted empty-filter">Geen huizen bij deze zoekopdracht of dit filter.</p>
          ) : (
            <div className="grid">
              {shown.map((h) => (
                <HouseCard key={h.id} house={h} />
              ))}
            </div>
          )}
        </>
      )}
      {adding && <NewHouseDialog onClose={() => setAdding(false)} />}
    </div>
  )
}

function HouseCard({ house }: { house: House }) {
  const { update, template, compare, toggleCompare, withStandard } = useStore()
  const p = progress(checklistFor(house, template, withStandard), house.mine.checklist)
  const selected = compare.includes(house.id)
  const facts = [
    house.woonoppervlakte && `${formatNumber(house.woonoppervlakte)} m²`,
    house.perceel && `${formatNumber(house.perceel)} m² perceel`,
    house.kamers && `${house.kamers} kamers`,
    house.bouwjaar && `${house.bouwjaar}`,
  ].filter(Boolean)

  return (
    <article className={`card house-card ${house.status === 'afgevallen' ? 'dimmed' : ''}`}>
      <a href={`#/huis/${encodeURIComponent(house.id)}`} className="card-link">
        <div className="card-photo">
          <Photo house={house} />
          <div className="card-photo-top">
            <StatusBadge status={house.status} />
          </div>
        </div>
        <div className="card-body">
          <h2 className="card-title">{displayAddress(house)}</h2>
          <p className="card-place">{place(house) || house.wijk || ' '}</p>
          <p className="card-price">
            {formatEuro(house.vraagprijs)}
            {house.prijsPerM2 && <small> · {formatEuro(house.prijsPerM2)}/m²</small>}
          </p>
          <p className="card-facts">
            {facts.map((f, i) => (
              <span key={i}>{f}</span>
            ))}
            <EnergyLabel label={house.energielabel} />
          </p>
          <div className="card-scores">
            <ScorePill value={house.score} label="Rapport" />
            <ScorePill value={house.mine.cijfer} label="Mijn cijfer" />
            {house.mine.bezichtiging && (
              <span className="when">
                <Calendar size={14} /> {formatDateTime(house.mine.bezichtiging)}
              </span>
            )}
          </div>
          {p.done > 0 && <ProgressBar done={p.done} total={p.total} problems={p.probleem} />}
        </div>
      </a>
      <div className="card-actions">
        <FavoriteButton
          active={house.favoriet}
          onToggle={() => void update(house.id, { favoriet: house.favoriet ? null : true })}
        />
        <button
          type="button"
          className={`btn btn-small ${selected ? 'btn-selected' : 'btn-ghost'}`}
          aria-pressed={selected}
          onClick={() => toggleCompare(house.id)}
        >
          {selected ? <Check size={16} /> : <Plus size={16} />} Vergelijk
        </button>
      </div>
    </article>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <FileUp size={40} />
      </div>
      <h2>Nog geen huizen</h2>
      <p>
        Huizen komen binnen uit je rapporten. Zet ze in de rapporten-repo, of upload ze bij{' '}
        <a href="#/instellingen/rapporten">Instellingen → Rapporten</a>. Je kunt ook zelf een huis
        toevoegen.
      </p>
      <div className="row">
        <a className="btn btn-primary" href="#/instellingen/rapporten">
          <FileUp size={18} /> Rapporten importeren
        </a>
        <button className="btn btn-ghost" onClick={onAdd}>
          <Plus size={18} /> Zelf toevoegen
        </button>
      </div>
    </div>
  )
}
