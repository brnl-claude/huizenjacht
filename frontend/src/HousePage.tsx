import { navigate } from './nav'
import { useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  Images,
  MapPin,
  AlertTriangle,
  ExternalLink,
  Eye,
  FileText,
  HelpCircle,
  ChevronsDownUp,
  ChevronsUpDown,
  MessageSquare,
  MessageSquareText,
  Minus,
  Pencil,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react'
import { api } from './api'
import { checklistFor, prefilledCount, progress, reportChecklist, type ChecklistCategory } from './checklist'
import {
  displayAddress,
  formatEuro,
  formatNumber,
  mapsUrl,
  photoUrls,
  place,
  personInfo,
  ASPECTS,
  STATUSES,
  EARLIER,
  type CheckEntry,
  type Document,
  type Other,
  type Prefill,
  type CheckState,
  type House,
  type Status,
} from './house'
import { ListingOverlay, overlayClick } from './ListingOverlay'
import { DocumentViewer } from './DocumentViewer'
import { exportPdf } from './pdfExport'
import { GeneralMedia, MediaActions, MediaTiles } from './Media'
import { Dialog, HouseForm } from './NewHouseDialog'
import { useStore } from './store'
import { EnergyLabel, FavoriteButton, personColor, PersonDot, Photo, ProgressBar, ScorePill } from './ui'

const TABS = [
  { id: 'overzicht', label: 'Overzicht' },
  { id: 'rapport', label: 'Rapport' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'notities', label: 'Mijn beoordeling' },
  { id: 'documenten', label: 'Documenten' },
] as const

/** Swiping left or right on a house moves to the next or previous tab. */
function useTabSwipe(onSwipe: (step: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null)
  return {
    onTouchStart(e: TouchEvent) {
      start.current = e.touches.length === 1 && swipeAllowed(e.target, e.currentTarget)
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp }
        : null
    },
    onTouchEnd(e: TouchEvent) {
      const from = start.current
      start.current = null
      if (!from || e.changedTouches.length !== 1) return
      const dx = e.changedTouches[0].clientX - from.x
      const dy = e.changedTouches[0].clientY - from.y
      if (isTabSwipe(dx, dy, e.timeStamp - from.t)) onSwipe(dx < 0 ? 1 : -1)
    },
    onTouchCancel() {
      start.current = null
    },
  }
}

/** With a large font the tabs scroll sideways; keep the open one in sight. */
function showActiveTab(nav: HTMLElement | null) {
  const a = nav?.querySelector<HTMLElement>('a.active')
  if (nav && a && nav.scrollWidth > nav.clientWidth) {
    nav.scrollLeft = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2 - nav.offsetLeft
  }
}

/** A quick, mostly sideways stroke; scrolling down the page with a slight angle is not one. */
export function isTabSwipe(dx: number, dy: number, ms: number): boolean {
  return Math.abs(dx) >= 70 && Math.abs(dx) > 2 * Math.abs(dy) && ms < 800
}

/** Not on things that use a sideways stroke themselves: photos, sliders, fields, open
 * windows and anything that scrolls sideways (wide tables, the tab bar on a small phone). */
function swipeAllowed(target: EventTarget | null, root: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  if (!el || el.closest('dialog, input, textarea, select, .hero-photo-wrap, [data-no-swipe]')) return false
  if (window.getSelection()?.toString()) return false
  while (el && el !== root) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return false
    el = el.parentElement
  }
  return true
}

export function HousePage({ id, tab }: { id: string; tab: string | null }) {
  const { houses, loading, update, compare, toggleCompare, template, withStandard, people, me, notify } = useStore()
  const [exporting, setExporting] = useState(false)
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
    return () => {
      observer.disconnect()
      setHeroGone(false)
    }
  }, [hero])
  const [slide, setSlide] = useState<{ tab: string; from: 'left' | 'right' } | null>(null)
  const swipe = useTabSwipe((step) => {
    const at = TABS.findIndex((t) => t.id === (tab ?? 'overzicht'))
    const next = TABS[Math.max(0, at) + step]
    if (!next) return
    setSlide({ tab: next.id, from: step > 0 ? 'right' : 'left' })
    navigate(`#/huis/${encodeURIComponent(id)}/${next.id}`)
  })
  const documents = useDocuments(house)
  const [viewing, setViewing] = useState<Document | null>(null)
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
  const stuck = active !== 'overzicht' || heroGone

  return (
    <div className={`page house-page${active === 'overzicht' ? '' : ' tabbed'}`} {...swipe}>
      {/* Only the overview shows the big header; the other tabs start as if scrolled down. */}
      {active === 'overzicht' && (
      <>
      <a href="#/" className="back">
        <ArrowLeft size={18} /> Alle huizen
      </a>
      <section ref={setHero} className="hero">
        <HeroPhoto
          house={house}
          index={heroPhoto}
          onIndex={setHeroPhoto}
          onOpen={() => house.url && setOverlay({ tab: 'fotos', photo: heroPhoto })}
        />
        <div className="hero-body">
          <div className="hero-top">
            <div className="hero-title">
              <h1>{displayAddress(house)}</h1>
              <p className="muted">{[place(house), house.wijk !== house.plaats ? house.wijk : undefined].filter(Boolean).join(' · ')}</p>
            </div>
            <FavoriteButton
              active={house.favoriet}
              onToggle={() => void update(house.id, { favoriet: house.favoriet ? null : true })}
            />
          </div>
          <div className="hero-price-row">
            <p className="hero-price">
              {formatEuro(house.vraagprijs)}
              {house.prijsPerM2 && <small>{formatEuro(house.prijsPerM2)}/m²</small>}
            </p>
            <label className="status-select" data-tip="Status van dit huis">
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
              <ChevronDown size={14} aria-hidden="true" />
            </label>
          </div>
          <div className="hero-actions">
            <button
              className={selected ? 'on' : ''}
              onClick={() => toggleCompare(house.id)}
              aria-pressed={selected}
              data-tip={selected ? 'Haal dit huis uit Vergelijken' : 'Zet dit huis bij Vergelijken'}
            >
              {selected ? <Check size={20} /> : <Plus size={20} />}
              <span>Vergelijk</span>
            </button>
            {house.url && (
              <a href={house.url} target="_blank" rel="noreferrer" data-tip="Open de advertentie in een nieuw tabblad">
                <ExternalLink size={20} />
                <span>Advertentie</span>
              </a>
            )}
            {mapsUrl(house) && (
              <a href={mapsUrl(house)!} target="_blank" rel="noreferrer" data-tip="Bekijk de ligging in Google Maps">
                <MapPin size={20} />
                <span>Kaart</span>
              </a>
            )}
            <button data-tip="Adres, prijs en andere gegevens aanpassen" onClick={() => setEditing(true)}>
              <Pencil size={20} />
              <span>Gegevens</span>
            </button>
            <button
              data-tip="Beoordeling en checklist met alle notities als PDF"
              disabled={exporting}
              onClick={() => {
                setExporting(true)
                exportPdf(house, categories, people, me)
                  .catch((e) => notify(e instanceof Error ? e.message : 'PDF maken mislukt.', 'error'))
                  .finally(() => setExporting(false))
              }}
            >
              <FileDown size={20} />
              <span>{exporting ? 'Bezig…' : 'PDF'}</span>
            </button>
          </div>
          {house.url && house.record.listing?.status !== 'ok' && (
            <a
              className={`hero-notice${house.record.listing ? ' failed' : ''}`}
              href="#/instellingen/bladwijzer"
              data-tip={
                house.record.listing?.message ??
                'De advertentie en foto\'s zijn nog niet opgehaald. Gebruik de bladwijzer op Funda.'
              }
            >
              {house.record.listing ? <AlertTriangle size={15} /> : <Bookmark size={15} />}
              {house.record.listing ? 'Ophalen mislukt, gebruik de bladwijzer' : 'Advertentie ophalen met de bladwijzer'}
            </a>
          )}
        </div>
      </section>
      </>
      )}

      <div className={`house-sticky${stuck ? ' stuck' : ''}`}>
        <div className="house-sticky-title" aria-hidden={!stuck}>
          <b>{displayAddress(house)}</b>
          <span className="muted">{[house.plaats, house.vraagprijs ? formatEuro(house.vraagprijs) : null].filter(Boolean).join(' · ')}</span>
        </div>
      <nav className="tabs" aria-label="Onderdelen van dit huis" ref={(el) => showActiveTab(el)}>
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#/huis/${encodeURIComponent(house.id)}/${t.id}`}
            className={active === t.id ? 'active' : ''}
            aria-current={active === t.id ? 'page' : undefined}
          >
            {t.id === 'notities' || t.id === 'documenten' ? (
              <>
                <span className="hide-small">{t.label}</span>
                <span className="show-small">{t.id === 'notities' ? 'Beoordeling' : 'Docs'}</span>
              </>
            ) : (
              t.label
            )}
            {t.id === 'checklist' && p.done > 0 && (
              <span className="count hide-small">
                {p.done}/{p.total}
              </span>
            )}
            {t.id === 'documenten' && documents.length > 0 && <span className="count hide-small">{documents.length}</span>}
          </a>
        ))}
      </nav>
      </div>

      <div key={active} className={`house-tab${slide?.tab === active ? ` slide-from-${slide.from}` : ''}`}>
        {active === 'overzicht' && <Overview house={house} />}
        {active === 'checklist' && <Checklist house={house} categories={categories} documents={documents} onOpen={setViewing} />}
        {active === 'rapport' && <Report house={house} />}
        {active === 'notities' && <MyReview house={house} />}
        {active === 'documenten' && <Documents house={house} documents={documents} onOpen={setViewing} />}
      </div>

      {viewing && <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />}

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
          <HouseForm
            house={house}
            onCancel={() => setEditing(false)}
            onDone={() => setEditing(false)}
            extraAction={<DeleteHouse house={house} />}
          />
        </Dialog>
      )}
    </div>
  )
}

function DeleteHouse({ house }: { house: House }) {
  const { remove } = useStore()
  return (
    <button
      type="button"
      className="btn btn-danger-ghost"
      aria-label="Huis verwijderen"
      title="Huis verwijderen"
      onClick={() => {
        const text =
          house.record.source === 'report-dir'
            ? 'Dit huis verwijderen? Je notities en checklist gaan verloren. Staat het rapport nog in de rapporten-repo, dan komt het huis bij de volgende synchronisatie terug. Wil je het alleen uit beeld, zet de status dan op Afgevallen.'
            : 'Dit huis en je notities en checklist verwijderen?'
        if (confirm(text)) {
          void remove(house.id)
          navigate('#/')
        }
      }}
    >
      <Trash2 size={16} /> <span className="hide-small">Huis verwijderen</span>
    </button>
  )
}

/** The photos of the house side by side: swipe (or scroll sideways) through them, or use the
 * arrows; a tap opens them all in the gallery at that photo. */
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
  const strip = useRef<HTMLDivElement>(null)
  const count = photoUrls(house).length
  const at = count ? index % count : 0

  // Where the strip should be: on mount (it is new after switching tabs), after it was hidden
  // (the compact header hides it on a phone) and when its width changes.
  const shown = useRef(at)
  useLayoutEffect(() => {
    shown.current = at
  })
  useLayoutEffect(() => {
    const el = strip.current
    if (!el) return
    const place = () => {
      if (el.clientWidth) el.scrollLeft = shown.current * el.clientWidth
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
  }, [count])

  function go(n: number) {
    const el = strip.current
    if (!el) return
    const next = (n + count) % count
    el.scrollTo({ left: next * el.clientWidth, behavior: Math.abs(next - at) > 1 ? 'instant' : 'smooth' })
  }

  function onScroll() {
    const el = strip.current
    if (!el || !el.clientWidth) return
    const n = Math.round(el.scrollLeft / el.clientWidth)
    if (n !== at && n >= 0 && n < count) onIndex(n)
  }

  if (count <= 1) {
    return (
      <div className="hero-photo-wrap">
        <button className="hero-photo-button" onClick={onOpen} disabled={!count || !house.url} aria-label="Foto's bekijken">
          <Photo house={house} index={0} className="hero-photo" />
        </button>
      </div>
    )
  }

  return (
    <div className="hero-photo-wrap">
      <div className="hero-strip" ref={strip} onScroll={onScroll}>
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            className="hero-photo-button hero-slide"
            onClick={onOpen}
            disabled={!house.url}
            tabIndex={i === at ? 0 : -1}
            aria-label={`Foto ${i + 1} van ${count} bekijken`}
          >
            <Photo house={house} index={i} className="hero-photo" />
          </button>
        ))}
      </div>
      <button className="hero-nav prev" aria-label="Vorige foto" onClick={() => go(at - 1)}>
        <ChevronLeft size={22} />
      </button>
      <button className="hero-nav next" aria-label="Volgende foto" onClick={() => go(at + 1)}>
        <ChevronRight size={22} />
      </button>
      <span className="hero-count">
        <Images size={14} /> {at + 1} / {count}
      </span>
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

/** Who is who, shown when someone else has answered too. */
function People({ house }: { house: House }) {
  const { me, people, claimAnswers } = useStore()
  if (!house.others.length) return null
  const earlier = house.others.some((o) => o.key === EARLIER)
  return (
    <div className="people-legend">
      <span className="person-tag">
        <PersonDot person={personInfo(people, me)} you /> Jij
      </span>
      {house.others.map((o) => (
        <span key={o.key} className="person-tag">
          <PersonDot person={o} /> {o.naam}
        </span>
      ))}
      {earlier && (
        <button
          className="btn btn-small btn-ghost"
          onClick={() => {
            if (confirm('Zijn de antwoorden van vóór deze versie van jou? Ze worden dan bij alle huizen jouw antwoorden.'))
              void claimAnswers()
          }}
        >
          Eerder ingevuld is van mij
        </button>
      )}
    </div>
  )
}

function Checklist({
  house,
  categories,
  documents,
  onOpen,
}: {
  house: House
  categories: ChecklistCategory[]
  documents: Document[]
  onOpen: (doc: Document) => void
}) {
  const { update, withStandard, setWithStandard } = useStore()
  const ownList = reportChecklist(house.record.reportBody ?? '').length > 0
  const answers = house.mine.checklist ?? {}
  const [onlyOpen, setOnlyOpen] = useState(false)
  // Notes start folded; the button folds or unfolds them at every point at once.
  const [notes, setNotes] = useState({ open: false, turn: 0 })
  const p = progress(categories, answers)
  const prefilled = prefilledCount(categories)

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
        <div className="checklist-tools">
          <div className="checklist-switches">
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
          <button
            type="button"
            className="btn btn-small btn-ghost notes-toggle"
            aria-pressed={notes.open}
            onClick={() => setNotes((n) => ({ open: !n.open, turn: n.turn + 1 }))}
            data-tip={notes.open ? 'Klap de notities bij alle punten in' : 'Klap alle notities uit'}
            aria-label={notes.open ? 'Alle notities inklappen' : 'Alle notities uitklappen'}
          >
            {notes.open ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
            <span className="hide-small">Notities</span>
            <span className="show-small">Alles</span> {notes.open ? 'inklappen' : 'uitklappen'}
          </button>
        </div>
      </div>
      <People house={house} />
      <GeneralMedia house={house} categories={categories} />
      {ownList && (
        <p className="muted small checklist-source">
          De eerste onderdelen komen uit de afvinklijst en open punten van het rapport van dit huis.
        </p>
      )}
      {prefilled > 0 && (
        <div className="panel prefill-summary">
          <FileText size={18} />
          <div>
            <strong>
              {prefilled} {prefilled === 1 ? 'punt' : 'punten'} vooraf ingevuld uit de documenten
            </strong>
            <p className="muted small">
              Grijs gestippeld staat wat de documenten zeggen. Dat telt niet als jullie antwoord: kijk
              het na en neem het over, of vul zelf in.
            </p>
            {documents.length > 0 && (
              <p className="muted small prefill-documents">
                {documents.map((d, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" onClick={overlayClick(() => onOpen(d))}>
                        {d.naam}
                      </a>
                    ) : (
                      d.naam
                    )}
                    {d.datum && ` (${formatDate(d.datum)})`}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
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
              {category.fromDocuments && <span className="badge badge-documents">Documenten</span>}
              <small>
                {cp.done}/{cp.total}
              </small>
            </h2>
            <ul>
              {items.map((item) => (
                <CheckRow
                  key={item.id}
                  house={house}
                  categories={categories}
                  text={item.tekst}
                  entry={answers[item.id]}
                  others={house.others}
                  itemId={item.id}
                  prefill={item.vooraf}
                  notes={notes}
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
  house,
  categories,
  text,
  entry,
  others,
  itemId,
  prefill,
  notes,
  onChange,
}: {
  house: House
  categories: ChecklistCategory[]
  text: string
  entry?: CheckEntry
  others: Other[]
  itemId: string
  prefill?: Prefill
  notes: { open: boolean; turn: number }
  onChange: (entry: CheckEntry | null) => void
}) {
  const { me, people } = useStore()
  const theirs = others
    .map((o) => ({ person: o, entry: o.data.checklist?.[itemId] }))
    .filter((t): t is { person: Other; entry: CheckEntry } => Boolean(t.entry?.s || t.entry?.n))
  const hasNotes = Boolean(entry?.n) || theirs.some((t) => t.entry.n)
  // Unfolding all opens the points that have a note; folding all closes every point.
  const [noteOpen, setNoteOpen] = useState(notes.open && hasNotes)
  const [turn, setTurn] = useState(notes.turn)
  if (turn !== notes.turn) {
    setTurn(notes.turn)
    setNoteOpen(notes.open && hasNotes)
  }
  const [note, setNote] = useState(entry?.n ?? '')
  useEffect(() => setNote(entry?.n ?? ''), [entry?.n])
  const noteRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => fitHeight(noteRef.current), [note, noteOpen])
  return (
    <li className={`check-row ${entry?.s ? `is-${entry.s}` : ''}`}>
      <div className="check-main">
        <span className="check-text">{text}</span>
        <div className="check-buttons" role="group" aria-label={text}>
          {others.length > 0 && <PersonDot person={personInfo(people, me)} you />}
          {STATES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`check-btn ${s.id} ${entry?.s === s.id ? 'on' : ''}`}
              aria-pressed={entry?.s === s.id}
              aria-label={s.label}
              onClick={() => onChange({ ...entry, s: entry?.s === s.id ? undefined : s.id })}
            >
              <s.icon size={18} />
            </button>
          ))}
          <MediaActions houseId={house.id} item={itemId} compact show={['foto', 'memo']} />
          <button
            type="button"
            className={`check-btn note ${hasNotes ? 'on' : ''}`}
            aria-expanded={noteOpen}
            aria-label={hasNotes ? 'Notities tonen of verbergen' : 'Notitie, video of upload'}
            onClick={() => setNoteOpen(!noteOpen)}
          >
            {hasNotes ? <MessageSquareText size={18} /> : <MessageSquare size={18} />}
          </button>
        </div>
      </div>
      {prefill && !entry?.v && (prefill.oordeel || prefill.antwoord || prefill.bron) && (
        <PrefillNote
          prefill={prefill}
          taken={Boolean(entry?.s)}
          onTake={() => {
            const fromDocs = [prefill.antwoord, prefill.bron && `Bron: ${prefill.bron}`].filter(Boolean).join(' ')
            const n = [entry?.n, fromDocs].filter(Boolean).join('\n')
            onChange({ s: prefill.oordeel ?? entry?.s, n: n || undefined, v: true })
            if (n) setNoteOpen(true)
          }}
        />
      )}
      {theirs.length > 0 && (
        <ul className="check-others">
          {theirs.map(({ person, entry: e }) => {
            const state = STATES.find((s) => s.id === e.s)
            return (
              <li key={person.key} style={{ borderColor: personColor(person) }}>
                <PersonDot person={person} />
                {state && (
                  <span className={`other-state ${state.id}`}>
                    <state.icon size={14} /> {state.label}
                  </span>
                )}
                {e.n && noteOpen && <span className="other-note">{e.n}</span>}
                {e.n && !noteOpen && (
                  <button type="button" className="other-note-folded" onClick={() => setNoteOpen(true)}>
                    <MessageSquareText size={14} /> notitie
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <MediaTiles house={house} item={itemId} categories={categories} />
      {noteOpen && (
        <>
          <textarea
            ref={noteRef}
            className="check-note"
            rows={1}
            placeholder="Wat zag je?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (entry?.n ?? '') && onChange({ ...entry, n: note || undefined })}
          />
          <div className="check-more">
            <MediaActions houseId={house.id} item={itemId} show={['video', 'upload']} />
          </div>
        </>
      )}
    </li>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

/**
 * Date and time as YYYY-MM-DDTHH:MM, always with a 24-hour clock. A datetime-local field shows
 * AM/PM when the browser or phone is set to English, whatever the page's language.
 */
function DateTime24({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [date = '', time = ''] = value.split('T')
  const [hour = '10', minute = '00'] = time.slice(0, 5).split(':')
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort()
  const set = (d: string, h: string, m: string) => onChange(d ? `${d}T${h}:${m}` : '')
  return (
    <span className="datetime24">
      <input type="date" value={date} aria-label="Datum" onChange={(e) => set(e.target.value, hour, minute)} />
      <select value={hour} aria-label="Uur" disabled={!date} onChange={(e) => set(date, e.target.value, minute)}>
        {HOURS.map((h) => (
          <option key={h}>{h}</option>
        ))}
      </select>
      <span aria-hidden>:</span>
      <select value={minute} aria-label="Minuten" disabled={!date} onChange={(e) => set(date, hour, e.target.value)}>
        {minutes.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
    </span>
  )
}

/** A note field as high as its text: no empty lines, no scrolling inside it. */
function fitHeight(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  const border = el.offsetHeight - el.clientHeight
  el.style.height = `${el.scrollHeight + border}px`
}

/** What the documents say about a point: not anyone's answer until someone takes it over. */
function PrefillNote({ prefill, taken, onTake }: { prefill: Prefill; taken: boolean; onTake: () => void }) {
  const state = STATES.find((s) => s.id === prefill.oordeel)
  return (
    <div className="check-prefill">
      <span className="prefill-label">
        <FileText size={14} /> Uit de documenten
      </span>
      {state && (
        <span className={`other-state ${state.id}`}>
          <state.icon size={14} /> {state.label}
        </span>
      )}
      {prefill.antwoord && <span className="other-note">{prefill.antwoord}</span>}
      {prefill.bron && <span className="prefill-source">Bron: {prefill.bron}</span>}
      {!taken && (
        <button type="button" className="btn btn-small btn-ghost prefill-take" onClick={onTake}>
          Overnemen
        </button>
      )}
    </div>
  )
}

/** The house's documents: the report's list joined with the files in the reports repository. */
function useDocuments(house: House | undefined): Document[] {
  const listed = house?.record.report.documenten
  const [docs, setDocs] = useState<{ id: string; list: Document[] } | null>(null)
  const id = house?.id
  const stamp = house?.record.updatedAt
  useEffect(() => {
    if (!id) return
    let current = true
    api
      .documents(id)
      .then((found) => current && setDocs({ id, list: found }))
      .catch(() => current && setDocs(null))
    return () => {
      current = false
    }
  }, [id, stamp])
  return (docs?.id === id ? docs?.list : undefined) ?? listed ?? []
}

function fileSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`
  return `${(bytes / 1024 / 1024).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} MB`
}

function Documents({ house, documents, onOpen }: { house: House; documents: Document[]; onOpen: (doc: Document) => void }) {
  if (!documents.length) {
    return (
      <div className="panel">
        <p className="muted">
          Bij dit huis zijn nog geen documenten. Huizen beoordelen zet ze in de rapporten-repo, in
          documenten/{house.id}/.
        </p>
      </div>
    )
  }
  return (
    <section className="panel documents">
      <h2>
        <FileText size={18} /> Documenten <small>{documents.length}</small>
      </h2>
      <ul>
        {documents.map((d, i) => {
          const details = [d.zonderTitel ? 'zonder titel' : d.bestand, fileSize(d.grootte), d.datum && formatDate(d.datum)]
            .filter(Boolean)
            .join(' · ')
          return (
            <li key={i} className={d.url ? '' : 'is-missing'}>
              <FileText size={20} className="doc-icon" />
              <div className="doc-text">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="doc-title" onClick={overlayClick(() => onOpen(d))}>
                    {d.naam}
                  </a>
                ) : (
                  <span className="doc-title">{d.naam}</span>
                )}
                {details && <span className="muted small doc-file">{details}</span>}
                {d.omschrijving && <span className="small doc-note">{d.omschrijving}</span>}
                {!d.url && <span className="muted small">Bestand niet aangeleverd</span>}
              </div>
              {d.url && (
                <div className="doc-actions">
                  <a
                    href={`${d.url}?download=1`}
                    className="btn btn-small btn-ghost"
                    aria-label={`${d.naam} downloaden`}
                    title="Downloaden"
                  >
                    <Download size={16} />
                  </a>
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    aria-label={`${d.naam} bekijken`}
                    title="Bekijken"
                    onClick={() => onOpen(d)}
                  >
                    <Eye size={16} />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
    : value
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


/** Other people's value for one thing, as small badges in their colour. */
function TheirValues({ house, value }: { house: House; value: (o: Other) => string | undefined }) {
  const shown = house.others.map((o) => ({ o, v: value(o) })).filter((x) => x.v !== undefined)
  if (!shown.length) return null
  return (
    <span className="their-values">
      {shown.map(({ o, v }) => (
        <span key={o.key} className="their-value" style={{ borderColor: personColor(o) }}>
          <PersonDot person={o} /> {v}
        </span>
      ))}
    </span>
  )
}

function MyReview({ house }: { house: House }) {
  const { update } = useStore()
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
      <People house={house} />
      <section className="panel">
        <h2>
          Mijn cijfer
          <TheirValues house={house} value={(o) => (o.data.cijfer ? String(o.data.cijfer) : undefined)} />
        </h2>
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
              {house.others.length > 0 && (
                <span className="their-slot">
                  <TheirValues house={house} value={(o) => (o.data.aspecten?.[a] ? `${o.data.aspecten[a]}★` : undefined)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>
          Bezichtiging en bod
          {house.others.length > 0 && <small>samen</small>}
        </h2>
        <div className="form-grid">
          <label>
            <span>Bezichtiging</span>
            <DateTime24
              value={house.mine.bezichtiging ?? ''}
              onChange={(value) =>
                void update(house.id, {
                  bezichtiging: value || null,
                  ...(value && house.status === 'nieuw' ? { status: 'gepland' } : {}),
                })
              }
            />
          </label>
          <label>
            <span>
              Bod <small>(€)</small>
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
        {house.others
          .filter((o) => o.data.notities)
          .map((o) => (
            <div key={o.key} className="their-notes" style={{ borderColor: personColor(o) }}>
              <div className="their-notes-head">
                <PersonDot person={o} /> <b>{o.naam}</b>
              </div>
              <p>{o.data.notities}</p>
            </div>
          ))}
      </section>

    </div>
  )
}
