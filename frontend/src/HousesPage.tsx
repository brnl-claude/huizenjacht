import { useMemo, useState } from 'react'
import { ArrowDownUp, Calendar, Columns3, ExternalLink, FileUp, Plus, Search } from 'lucide-react'
import { checklistFor, progress } from './checklist'
import {
  displayAddress,
  formatDateTime,
  formatEuro,
  formatNumber,
  place,
  SORTS,
  STATUSES,
  type House,
  type SortKey,
} from './house'
import { rememberedView, rememberView, visibleHouses, type Filter } from './houseList'
import { NewHouseDialog } from './NewHouseDialog'
import { useStore } from './store'
import { EnergyLabel, FavoriteButton, Photo, ProgressBar, ScorePill, StatusBadge } from './ui'

export function HousesPage() {
  const { houses, loading, error, refresh } = useStore()
  const [view, setView] = useState(rememberedView)
  const { query, filter, sort } = view
  const change = (next: Partial<typeof view>) => {
    setView((v) => ({ ...v, ...next }))
    rememberView(next)
  }
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

  const shown = useMemo(() => visibleHouses(houses, view), [houses, view])

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
                onChange={(e) => change({ query: e.target.value })}
              />
            </label>
            <label className="select sort" data-tip={`Sorteren: ${SORTS.find((s) => s.id === sort)?.label ?? ''}`}>
              <ArrowDownUp size={18} aria-hidden="true" />
              <span className="visually-hidden">Sorteren</span>
              <select
                value={sort}
                onChange={(e) => change({ sort: e.target.value as SortKey })}
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
                  onClick={() => change({ filter: c.id })}
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
  const scored = house.score != null || house.mine.cijfer != null

  return (
    <article className={`card house-card ${house.status === 'afgevallen' ? 'dimmed' : ''}`}>
      <a href={`#/huis/${encodeURIComponent(house.id)}`} className="card-link">
        <div className="card-photo">
          <Photo house={house} />
          <div className="card-photo-top">
            <StatusBadge status={house.status} />
          </div>
          {house.mine.bezichtiging && (
            <span className="card-when" data-tip="Bezichtiging">
              <Calendar size={14} aria-hidden="true" />
              <span className="visually-hidden">Bezichtiging </span>
              {formatDateTime(house.mine.bezichtiging)}
            </span>
          )}
        </div>
        <div className="card-body">
          <div>
            <h2 className="card-title">{displayAddress(house)}</h2>
            <p className="card-place">{place(house) || house.wijk || ' '}</p>
          </div>
          <div className="card-price-row">
            <p className="card-price">
              {formatEuro(house.vraagprijs)}
              {house.prijsPerM2 && <small> {formatEuro(house.prijsPerM2)}/m²</small>}
            </p>
            <EnergyLabel label={house.energielabel} />
          </div>
          {facts.length > 0 && (
            <div className="card-facts">
              <p>
                {facts.map((f, i) => (
                  <span key={i}>{f}</span>
                ))}
              </p>
            </div>
          )}
        </div>
      </a>
      <FavoriteButton
        active={house.favoriet}
        onPhoto
        onToggle={() => void update(house.id, { favoriet: house.favoriet ? null : true })}
      />
      <div className="card-foot">
        {scored && (
          <div className="card-scores">
            <ScorePill value={house.score} label="Rapport" />
            <ScorePill value={house.mine.cijfer} label="Mijn cijfer" />
          </div>
        )}
        {p.done > 0 && <ProgressBar done={p.done} total={p.total} problems={p.probleem} />}
        <div className="card-actions">
          <button
            type="button"
            className={`btn btn-small btn-icon ${selected ? 'btn-selected' : 'btn-ghost'}`}
            aria-label={selected ? 'Haal dit huis uit Vergelijken' : 'Zet dit huis bij Vergelijken'}
            aria-pressed={selected}
            data-tip={selected ? 'Haal dit huis uit Vergelijken' : 'Zet dit huis bij Vergelijken'}
            onClick={() => toggleCompare(house.id)}
          >
            <Columns3 size={18} />
          </button>
          {house.url && (
            <a
              className="btn btn-small btn-icon btn-ad"
              aria-label="Open de advertentie"
              href={house.url}
              target="_blank"
              rel="noreferrer"
              data-tip="Open de advertentie in een nieuw tabblad"
            >
              <ExternalLink size={18} />
            </a>
          )}
        </div>
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
