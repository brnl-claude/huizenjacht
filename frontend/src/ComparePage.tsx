import { Check, Columns3, Plus, X } from 'lucide-react'
import { checklistFor, progress } from './checklist'
import { displayAddress, formatEuro, formatNumber, place, sortHouses, type House } from './house'
import { MAX_COMPARE, useStore } from './store'
import { EnergyLabel, Photo, StatusBadge } from './ui'

type Row = {
  label: string
  value: (h: House) => number | undefined
  show?: (h: House) => React.ReactNode
  // Which value wins: the lowest or the highest. Undefined: no winner.
  best?: 'low' | 'high'
}

const LABEL_ORDER = ['A+++++', 'A++++', 'A+++', 'A++', 'A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G']

export function ComparePage() {
  const { houses, compare, toggleCompare, clearCompare, template, withStandard } = useStore()
  const chosen = compare.map((id) => houses.find((h) => h.id === id)).filter(Boolean) as House[]

  const rows: Row[] = [
    { label: 'Vraagprijs', value: (h) => h.vraagprijs, show: (h) => formatEuro(h.vraagprijs), best: 'low' },
    { label: 'Prijs per m²', value: (h) => h.prijsPerM2, show: (h) => formatEuro(h.prijsPerM2), best: 'low' },
    { label: 'Woonoppervlakte', value: (h) => h.woonoppervlakte, show: (h) => formatNumber(h.woonoppervlakte, 'm²'), best: 'high' },
    { label: 'Perceel', value: (h) => h.perceel, show: (h) => formatNumber(h.perceel, 'm²'), best: 'high' },
    { label: 'Kamers', value: (h) => h.kamers, best: 'high' },
    { label: 'Slaapkamers', value: (h) => h.slaapkamers, best: 'high' },
    { label: 'Bouwjaar', value: (h) => h.bouwjaar, show: (h) => (h.bouwjaar ? String(h.bouwjaar) : '–'), best: 'high' },
    {
      label: 'Energielabel',
      value: (h) => {
        const i = LABEL_ORDER.indexOf((h.energielabel ?? '').toUpperCase())
        return i === -1 ? undefined : i
      },
      show: (h) => (h.energielabel ? <EnergyLabel label={h.energielabel} /> : '–'),
      best: 'low',
    },
    { label: 'Servicekosten', value: (h) => h.servicekosten, show: (h) => (h.servicekosten ? formatEuro(h.servicekosten) : '–'), best: 'low' },
    { label: 'Score rapport', value: (h) => h.score, show: (h) => formatNumber(h.score), best: 'high' },
    { label: 'Mijn cijfer', value: (h) => h.mine.cijfer, show: (h) => formatNumber(h.mine.cijfer), best: 'high' },
    {
      label: 'Checklist: problemen',
      value: (h) => {
        const p = progress(checklistFor(h, template, withStandard), h.mine.checklist)
        return p.done ? p.probleem : undefined
      },
      show: (h) => {
        const p = progress(checklistFor(h, template, withStandard), h.mine.checklist)
        return p.done ? `${p.probleem} van ${p.done} bekeken` : 'Nog niet ingevuld'
      },
      best: 'low',
    },
  ]

  function winners(row: Row): Set<string> {
    if (!row.best) return new Set()
    const values = chosen.map((h) => [h.id, row.value(h)] as const).filter(([, v]) => v !== undefined)
    if (values.length < 2) return new Set()
    const target = row.best === 'low' ? Math.min(...values.map(([, v]) => v!)) : Math.max(...values.map(([, v]) => v!))
    if (values.every(([, v]) => v === target)) return new Set()
    return new Set(values.filter(([, v]) => v === target).map(([id]) => id))
  }

  const others = sortHouses(
    houses.filter((h) => !compare.includes(h.id) && h.status !== 'afgevallen'),
    'nieuwste',
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Vergelijken</h1>
          <p className="muted">Kies tot {MAX_COMPARE} huizen. Groen is de beste waarde per regel.</p>
        </div>
        {chosen.length > 0 && (
          <button className="btn btn-ghost btn-small" onClick={clearCompare}>
            Alles wissen
          </button>
        )}
      </div>

      {chosen.length < 2 && (
        <div className="notice">
          <Columns3 size={18} /> Kies {chosen.length === 0 ? 'minstens twee huizen' : 'nog een huis'} om te
          vergelijken.
        </div>
      )}

      {chosen.length > 0 && (
        <div className="compare-scroll">
          <table className="compare" style={{ ['--cols' as string]: chosen.length }}>
            <thead>
              <tr>
                <th scope="col" className="row-label">
                  <span className="visually-hidden">Kenmerk</span>
                </th>
                {chosen.map((h) => (
                  <th key={h.id} scope="col">
                    <div className="compare-head">
                      <a href={`#/huis/${encodeURIComponent(h.id)}`}>
                        <Photo house={h} className="compare-photo" />
                        <b>{displayAddress(h)}</b>
                        <span className="muted small">{place(h)}</span>
                      </a>
                      <StatusBadge status={h.status} />
                      <button
                        className="icon-btn compare-remove"
                        aria-label={`${displayAddress(h)} uit de vergelijking halen`}
                        onClick={() => toggleCompare(h.id)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const win = winners(row)
                if (chosen.every((h) => row.value(h) === undefined) && row.label !== 'Mijn cijfer') return null
                return (
                  <tr key={row.label}>
                    <th scope="row" className="row-label">
                      {row.label}
                    </th>
                    {chosen.map((h) => (
                      <td key={h.id} className={win.has(h.id) ? 'best' : ''}>
                        {row.show ? row.show(h) : formatNumber(row.value(h))}
                        {win.has(h.id) && <Check size={14} className="best-icon" aria-label="beste" />}
                      </td>
                    ))}
                  </tr>
                )
              })}
              <tr>
                <th scope="row" className="row-label">
                  Pluspunten
                </th>
                {chosen.map((h) => (
                  <td key={h.id} className="list-cell">
                    <ul>{(h.pluspunten ?? []).slice(0, 5).map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="row-label">
                  Minpunten
                </th>
                {chosen.map((h) => (
                  <td key={h.id} className="list-cell cons">
                    <ul>{(h.minpunten ?? []).slice(0, 5).map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {chosen.length < MAX_COMPARE && others.length > 0 && (
        <section className="picker">
          <h2>Huis toevoegen aan de vergelijking</h2>
          <ul>
            {others.map((h) => (
              <li key={h.id}>
                <button className="picker-item" onClick={() => toggleCompare(h.id)}>
                  <Photo house={h} className="picker-photo" />
                  <span>
                    <b>{displayAddress(h)}</b>
                    <span className="muted small">
                      {formatEuro(h.vraagprijs)} · {formatNumber(h.woonoppervlakte, 'm²')}
                    </span>
                  </span>
                  <Plus size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
