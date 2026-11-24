import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Images,
  MapPin,
  AlertTriangle,
  ExternalLink,
  HelpCircle,
  MessageSquare,
  Minus,
  Pencil,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react'
import { checklistFor, progress, reportChecklist, type ChecklistCategory } from './checklist'
import {
  displayAddress,
  formatEuro,
  formatNumber,
  mapsUrl,
  photoUrls,
  place,
  STATUSES,
  type CheckEntry,
  type CheckState,
  type House,
  type Status,
} from './house'
import { ListingOverlay } from './ListingOverlay'
import { Dialog, HouseForm } from './NewHouseDialog'
import { useStore } from './store'
import { EnergyLabel, FavoriteButton, Photo, ProgressBar, ScorePill } from './ui'

const TABS = [
  { id: 'overzicht', label: 'Overzicht' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'rapport', label: 'Rapport' },
  { id: 'notities', label: 'Mijn beoordeling' },
] as const

export function HousePage({ id, tab }: { id: string; tab: string | null }) {
  const { houses, loading, update, compare, toggleCompare, template, withStandard } = useStore()
  const house = houses.find((h) => h.id === id)
  const [editing, setEditing] = useState(false)
  const [overlayState, setOverlayState] = useState<{ house: string; tab: 'advertentie' | 'fotos'; photo: number } | null>(null)
  // Belongs to one house: going to another house (back button, link) leaves it closed.
  const overlay = overlayState?.house === id ? overlayState : null
  const setOverlay = (next: { tab: 'advertentie' | 'fotos'; photo: number } | null) =>
    setOverlayState(next && { ...next, house: id })
  const [heroPhoto, setHeroPhoto] = useState(0)
  // Once the hero has scrolled under the top bar, the sticky tab bar also shows the address.
  const [hero, setHero] = useState<HTMLElement | null>(null)
  const [heroGone, setHeroGone] = useState(false)
  useEffect(() => {
    if (!hero) return
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0
    const observer = new IntersectionObserver(([e]) => setHeroGone(!e.isIntersecting && e.boundingClientRect.top < top), {
      rootMargin: `-${Math.round(top)}px 0px 0px 0px`,
    })
    observer.observe(hero)
    return () => observer.disconnect()
  }, [hero])
  if (loading) return <div className="loading">Laden…</div>
  if (!house) {
    return (
      <div className="page">
        <a href="#/" className="back">
          <ArrowLeft size={18} /> Alle huizen
        </a>
        <p>Dit huis bestaat niet (meer).</p>
      </div>
    )
  }
  const active = TABS.find((t) => t.id === tab)?.id ?? 'overzicht'
  const categories = checklistFor(house, template, withStandard)
  const p = progress(categories, house.mine.checklist)
  const selected = compare.includes(house.id)

  return (
    <div className="page house-page">
      <a href="#/" className="back">
        <ArrowLeft size={18} /> Alle huizen
      </a>
      <section ref={setHero} className={`hero ${active === 'overzicht' ? '' : 'compact'}`}>
        <HeroPhoto
          house={house}
          index={heroPhoto}
          onIndex={setHeroPhoto}
          onOpen={() => house.url && setOverlay({ tab: 'fotos', photo: heroPhoto })}
        />
        <div className="hero-body">
          <div className="hero-top">
            <div>
              <h1>{displayAddress(house)}</h1>
              <p className="muted">{[place(house), house.wijk !== house.plaats ? house.wijk : undefined].filter(Boolean).join(' · ')}</p>
            </div>
            <FavoriteButton
              active={house.favoriet}
              onToggle={() => void update(house.id, { favoriet: house.favoriet ? null : true })}
            />
          </div>
          <p className="hero-price">
            {formatEuro(house.vraagprijs)}
            {house.prijsPerM2 && <small> {formatEuro(house.prijsPerM2)} per m²</small>}
          </p>
          <div className="hero-controls">
            <label className="select status-select">
              <span className="visually-hidden">Status</span>
              <select
                value={house.status}
                onChange={(e) => void update(house.id, { status: e.target.value as Status })}
              >
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </label>
            <button
              className={`btn btn-small ${selected ? 'btn-selected' : 'btn-ghost'}`}
              onClick={() => toggleCompare(house.id)}
              aria-pressed={selected}
            >
              {selected ? <Check size={16} /> : <Plus size={16} />} Vergelijk
            </button>
            {house.url && (
              <a
                className="btn btn-small btn-ghost"
                href={house.url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} /> Advertentie
              </a>
            )}
            {mapsUrl(house) && (
              <a className="btn btn-small btn-ghost" href={mapsUrl(house)!} target="_blank" rel="noreferrer">
                <MapPin size={16} /> Google Maps
              </a>
            )}
            {house.url && house.record.listing?.status !== 'ok' && (
              <a
                className={`btn btn-small btn-ghost${house.record.listing ? ' listing-failed' : ''}`}
                href="#/instellingen/bladwijzer"
                title={
                  house.record.listing?.message ??
                  'De advertentie en foto\'s zijn nog niet opgehaald. Gebruik de bladwijzer op Funda.'
                }
              >
                {house.record.listing ? <AlertTriangle size={16} /> : <Bookmark size={16} />} Ophalen met bladwijzer
              </a>
            )}
            <button className="btn btn-small btn-ghost" onClick={() => setEditing(true)}>
              <Pencil size={16} /> Gegevens
            </button>
          </div>
        </div>
      </section>

      <div className={`house-sticky${heroGone ? ' stuck' : ''}`}>
        <div className="house-sticky-title" aria-hidden={!heroGone}>
          <b>{displayAddress(house)}</b>
          <span className="muted">{[house.plaats, house.vraagprijs ? formatEuro(house.vraagprijs) : null].filter(Boolean).join(' · ')}</span>
        </div>
      <nav className="tabs" aria-label="Onderdelen van dit huis">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#/huis/${encodeURIComponent(house.id)}/${t.id}`}
            className={active === t.id ? 'active' : ''}
            aria-current={active === t.id ? 'page' : undefined}
          >
            {t.id === 'notities' ? (
              <>
                <span className="hide-small">{t.label}</span>
                <span className="show-small">Beoordeling</span>
              </>
            ) : (
              t.label
            )}
            {t.id === 'checklist' && p.done > 0 && (
              <span className="count">
                {p.done}/{p.total}
              </span>
            )}
          </a>
        ))}
      </nav>
      </div>

      {active === 'overzicht' && <Overview house={house} />}
      {active === 'checklist' && <Checklist house={house} categories={categories} />}
      {active === 'rapport' && <Report house={house} />}
      {active === 'notities' && <MyReview house={house} />}

      {overlay && (
        <ListingOverlay
          house={house}
          initialTab={overlay.tab}
          initialPhoto={overlay.photo}
          onClose={() => setOverlay(null)}
        />
      )}

      {editing && (
        <Dialog title="Gegevens aanpassen" onClose={() => setEditing(false)}>
          {house.record.source !== 'manual' && (
            <p className="muted small">
              Wat je hier invult gaat voor op het rapport. Maak een veld leeg om weer de waarde uit
              het rapport te tonen.
            </p>
          )}
          <HouseForm house={house} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
        </Dialog>
      )}
    </div>
  )
}

function HeroPhoto({
  house,
  index,
  onIndex,
  onOpen,
}: {
  house: House
  index: number
  onIndex: (n: number) => void
  onOpen: () => void
}) {
  const count = photoUrls(house).length
  const at = count ? index % count : 0
  return (
    <div className="hero-photo-wrap">
      <button className="hero-photo-button" onClick={onOpen} disabled={!count || !house.url} aria-label="Foto's bekijken">
        <Photo house={house} index={at} className="hero-photo" />
      </button>
      {count > 1 && (
        <>
          <button className="hero-nav prev" aria-label="Vorige foto" onClick={() => onIndex((at - 1 + count) % count)}>
            <ChevronLeft size={22} />
          </button>
          <button className="hero-nav next" aria-label="Volgende foto" onClick={() => onIndex((at + 1) % count)}>
            <ChevronRight size={22} />
          </button>
          <span className="hero-count">
            <Images size={14} /> {at + 1} / {count}
          </span>
        </>
      )}
    </div>
  )
}

function Overview({ house }: { house: House }) {
  const facts: [string, React.ReactNode][] = [
    ['Vraagprijs', formatEuro(house.vraagprijs)],
    ['Prijs per m²', formatEuro(house.prijsPerM2)],
    ['Woonoppervlakte', formatNumber(house.woonoppervlakte, 'm²')],
    ['Perceel', formatNumber(house.perceel, 'm²')],
    ['Inhoud', formatNumber(house.inhoud, 'm³')],
    ['Kamers', formatNumber(house.kamers)],
    ['Slaapkamers', formatNumber(house.slaapkamers)],
    ['Badkamers', formatNumber(house.badkamers)],
    ['Bouwjaar', house.bouwjaar ? String(house.bouwjaar) : '–'],
    ['Energielabel', house.energielabel ? <EnergyLabel label={house.energielabel} /> : '–'],
    ['Soort woning', house.woningtype || '–'],
    ['Tuin', house.tuin || '–'],
    ['Parkeren', house.parkeren || '–'],
    ['Servicekosten', house.servicekosten ? `${formatEuro(house.servicekosten)} p/m` : '–'],
    ['Eigendom', house.erfpacht || '–'],
    ['Makelaar', house.makelaar || '–'],
  ]
  const shownFacts = facts.filter(([, v]) => v !== '–')
  const extra = Object.entries(house.extra ?? {})
  return (
    <div className="overview">
      {(house.samenvatting || house.advies || house.score !== undefined) && (
        <section className="panel verdict">
          <div className="verdict-head">
            <h2>Uit het rapport</h2>
            <ScorePill value={house.score} label="Score" />
          </div>
          {house.advies && (
            <p className="advice">
              Advies: <b>{house.advies}</b>
            </p>
          )}
          {house.samenvatting && <p>{house.samenvatting}</p>}
        </section>
      )}
      {(house.pluspunten?.length || house.minpunten?.length) && (
        <div className="proscons">
          {house.pluspunten?.length ? (
            <section className="panel pros">
              <h2>
                <ThumbsUp size={18} /> Pluspunten
              </h2>
              <ul>
                {house.pluspunten.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {house.minpunten?.length ? (
            <section className="panel cons">
              <h2>
                <ThumbsDown size={18} /> Minpunten
              </h2>
              <ul>
                {house.minpunten.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
      <section className="panel">
        <h2>Kenmerken</h2>
        {shownFacts.length ? (
          <dl className="facts">
            {shownFacts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">Nog geen kenmerken. Vul ze in via Gegevens.</p>
        )}
      </section>
      {extra.length > 0 && (
        <section className="panel">
          <h2>Overige gegevens</h2>
          <dl className="facts">
            {extra.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  )
}

const STATES: { id: CheckState; label: string; icon: typeof Check }[] = [
  { id: 'ok', label: 'In orde', icon: Check },
  { id: 'twijfel', label: 'Twijfel', icon: HelpCircle },
  { id: 'probleem', label: 'Probleem', icon: X },
]

function Checklist({ house, categories }: { house: House; categories: ChecklistCategory[] }) {
  const { update, withStandard, setWithStandard } = useStore()
  const ownList = reportChecklist(house.record.reportBody ?? '').length > 0
  const answers = house.mine.checklist ?? {}
  const [onlyOpen, setOnlyOpen] = useState(false)
  const p = progress(categories, answers)

  function set(itemId: string, entry: CheckEntry | null) {
    const next = { ...answers }
    if (!entry || (!entry.s && !entry.n)) delete next[itemId]
    else next[itemId] = entry
    void update(house.id, { checklist: next })
  }

  return (
    <div className="checklist">
      <div className="checklist-head panel">
        <ProgressBar done={p.done} total={p.total} problems={p.probleem} />
        <div className="checklist-summary">
          <span className="sum-ok">{p.ok} in orde</span>
          <span className="sum-twijfel">{p.twijfel} twijfel</span>
          <span className="sum-probleem">{p.probleem} probleem</span>
        </div>
        <label className="switch">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Alleen open punten
        </label>
        {ownList && (
          <label className="switch">
            <input type="checkbox" checked={withStandard} onChange={(e) => setWithStandard(e.target.checked)} />
            Ook de standaardlijst
          </label>
        )}
      </div>
      {ownList && (
        <p className="muted small checklist-source">
          De eerste onderdelen komen uit de afvinklijst en open punten van het rapport van dit huis.
        </p>
      )}
      {categories.map((category) => {
        const items = category.items.filter((i) => !onlyOpen || !answers[i.id]?.s)
        if (!items.length) return null
        const cp = progress([category], answers)
        return (
          <section key={category.id} className="panel check-category">
            <h2>
              {category.titel}
              {category.fromReport && <span className="badge badge-report">Rapport</span>}
              <small>
                {cp.done}/{cp.total}
              </small>
            </h2>
            <ul>
              {items.map((item) => (
                <CheckRow
                  key={item.id}
                  text={item.tekst}
                  entry={answers[item.id]}
                  onChange={(entry) => set(item.id, entry)}
                />
              ))}
            </ul>
          </section>
        )
      })}
      <p className="muted small">
        Punten toevoegen of aanpassen voor alle huizen doe je bij{' '}
        <a href="#/instellingen/checklist">Instellingen → Checklist</a>.
      </p>
    </div>
  )
}

function CheckRow({
  text,
  entry,
  onChange,
}: {
  text: string
  entry?: CheckEntry
  onChange: (entry: CheckEntry | null) => void
}) {
  const [noteOpen, setNoteOpen] = useState(Boolean(entry?.n))
  const [note, setNote] = useState(entry?.n ?? '')
  useEffect(() => setNote(entry?.n ?? ''), [entry?.n])
  return (
    <li className={`check-row ${entry?.s ? `is-${entry.s}` : ''}`}>
      <div className="check-main">
        <span className="check-text">{text}</span>
        <div className="check-buttons" role="group" aria-label={text}>
          {STATES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`check-btn ${s.id} ${entry?.s === s.id ? 'on' : ''}`}
              aria-pressed={entry?.s === s.id}
              title={s.label}
              aria-label={s.label}
              onClick={() => onChange({ ...entry, s: entry?.s === s.id ? undefined : s.id })}
            >
              <s.icon size={18} />
            </button>
          ))}
          <button
            type="button"
            className={`check-btn note ${entry?.n ? 'on' : ''}`}
            aria-expanded={noteOpen}
            aria-label="Notitie"
            title="Notitie"
            onClick={() => setNoteOpen(!noteOpen)}
          >
            <MessageSquare size={18} />
          </button>
        </div>
      </div>
      {noteOpen && (
        <textarea
          className="check-note"
          rows={2}
          placeholder="Wat zag je?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (entry?.n ?? '') && onChange({ ...entry, n: note || undefined })}
        />
      )}
    </li>
  )
}

function Report({ house }: { house: House }) {
  const body = house.record.reportBody
  if (!body) {
    return (
      <div className="panel">
        <p className="muted">
          Bij dit huis hoort geen rapport. Upload er een bij{' '}
          <a href="#/instellingen/rapporten">Instellingen → Rapporten</a> met dezelfde bestandsnaam
          als dit huis ({house.id}.md).
        </p>
      </div>
    )
  }
  return (
    <article className="panel report markdown">
      <p className="muted small report-source">
        Bron: {house.record.source === 'upload' ? 'geüpload' : 'rapporten-repo'} ·{' '}
        {house.record.sourcePath} · bijgewerkt{' '}
        {new Date(house.record.updatedAt).toLocaleDateString('nl-NL')}
      </p>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {body}
      </Markdown>
    </article>
  )
}

export const ASPECTS = ['Locatie', 'Ruimte en indeling', 'Staat van onderhoud', 'Licht', 'Buitenruimte', 'Prijs/kwaliteit']

function MyReview({ house }: { house: House }) {
  const { update, remove } = useStore()
  const [notes, setNotes] = useState(house.mine.notities ?? '')
  const [offer, setOffer] = useState(house.mine.bod ? String(house.mine.bod) : '')
  useEffect(() => setNotes(house.mine.notities ?? ''), [house.mine.notities])
  const aspects = house.mine.aspecten ?? {}
  const aspectValues = Object.values(aspects)
  const average = aspectValues.length
    ? aspectValues.reduce((a, b) => a + b, 0) / aspectValues.length
    : undefined

  return (
    <div className="review">
      <section className="panel">
        <h2>Mijn cijfer</h2>
        <div className="grade" role="radiogroup" aria-label="Mijn cijfer">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={house.mine.cijfer === n}
              className={`grade-btn ${house.mine.cijfer === n ? 'on' : ''} ${n >= 8 ? 'good' : n >= 6 ? 'ok' : 'bad'}`}
              onClick={() => void update(house.id, { cijfer: house.mine.cijfer === n ? null : n })}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>
          Per onderdeel
          {average !== undefined && (
            <small>gemiddeld {average.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} / 5</small>
          )}
        </h2>
        <ul className="aspects">
          {ASPECTS.map((a) => (
            <li key={a}>
              <span>{a}</span>
              <span className="stars" role="radiogroup" aria-label={a}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={aspects[a] === n}
                    aria-label={`${n} van 5`}
                    className={`star ${(aspects[a] ?? 0) >= n ? 'on' : ''}`}
                    onClick={() => {
                      const next = { ...aspects }
                      if (next[a] === n) delete next[a]
                      else next[a] = n
                      void update(house.id, { aspecten: next })
                    }}
                  >
                    ★
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Bezichtiging en bod</h2>
        <div className="form-grid">
          <label>
            <span>Bezichtiging</span>
            <input
              type="datetime-local"
              value={house.mine.bezichtiging ?? ''}
              onChange={(e) =>
                void update(house.id, {
                  bezichtiging: e.target.value || null,
                  ...(e.target.value && house.status === 'nieuw' ? { status: 'gepland' } : {}),
                })
              }
            />
          </label>
          <label>
            <span>
              Mijn bod <small>(€)</small>
            </span>
            <input
              inputMode="numeric"
              value={offer}
              placeholder={house.vraagprijs ? `Vraagprijs ${formatEuro(house.vraagprijs)}` : ''}
              onChange={(e) => setOffer(e.target.value)}
              onBlur={() => {
                const n = Number(offer.replace(/[^\d]/g, ''))
                void update(house.id, { bod: n > 0 ? n : null })
              }}
            />
          </label>
        </div>
        {house.mine.bod && house.vraagprijs ? (
          <p className="muted small">
            {house.mine.bod >= house.vraagprijs ? (
              <>
                <Plus size={12} /> {formatEuro(house.mine.bod - house.vraagprijs)} boven de vraagprijs
              </>
            ) : (
              <>
                <Minus size={12} /> {formatEuro(house.vraagprijs - house.mine.bod)} onder de vraagprijs
              </>
            )}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <h2>Notities</h2>
        <textarea
          className="notes"
          rows={8}
          placeholder="Indruk, gesprek met de makelaar, wat je wilt navragen…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (house.mine.notities ?? '') && void update(house.id, { notities: notes || null })}
        />
        <p className="muted small">Wordt opgeslagen zodra je het veld verlaat.</p>
      </section>

      <section className="danger-zone">
        <button
          className="btn btn-danger-ghost"
          onClick={() => {
            const text =
              house.record.source === 'report-dir'
                ? 'Dit huis verwijderen? Je notities en checklist gaan verloren. Staat het rapport nog in de rapporten-repo, dan komt het huis bij de volgende synchronisatie terug. Wil je het alleen uit beeld, zet de status dan op Afgevallen.'
                : 'Dit huis en je notities en checklist verwijderen?'
            if (confirm(text)) {
              void remove(house.id)
              location.hash = '#/'
            }
          }}
        >
          <Trash2 size={16} /> Huis verwijderen
        </button>
      </section>
    </div>
  )
}
