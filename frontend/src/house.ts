/** Houses: what the report says, merged with what Bram adds in the app. */

import type { Media } from './media'

export type CheckState = 'ok' | 'twijfel' | 'probleem'
/** One person's answer to a checklist point; `v` when it was taken over from the documents. */
export type CheckEntry = { s?: CheckState; n?: string; v?: boolean }

/** An answer to a checklist point that "Huizen beoordelen" found in the documents of a house. */
export type Prefill = { punt: string; groep?: string; oordeel?: CheckState; antwoord?: string; bron?: string }
/** A document of a house: its title from the report, the original file and where to open it. */
export type Document = {
  naam: string
  datum?: string
  omschrijving?: string
  /** The original file name, in documenten/<id>/ of the reports repository. */
  bestand?: string
  grootte?: number
  url?: string
  /** A file the report does not name; its title is the file name. */
  zonderTitel?: boolean
}

export type Fields = {
  titel?: string
  adres?: string
  postcode?: string
  plaats?: string
  wijk?: string
  vraagprijs?: number
  woonoppervlakte?: number
  perceel?: number
  inhoud?: number
  kamers?: number
  slaapkamers?: number
  badkamers?: number
  bouwjaar?: number
  energielabel?: string
  woningtype?: string
  tuin?: string
  parkeren?: string
  servicekosten?: number
  erfpacht?: string
  url?: string
  foto?: string
  makelaar?: string
  score?: number
  advies?: string
  samenvatting?: string
  pluspunten?: string[]
  minpunten?: string[]
  bezichtigingspunten?: string[]
  /** Prefilled checklist answers and new points from the documents (`vooraf_ingevuld`). */
  vooraf?: Prefill[]
  /** The documents the prefilled answers come from. */
  documenten?: Document[]
  extra?: Record<string, unknown>
}

export type Status =
  | 'nieuw'
  | 'interessant'
  | 'gepland'
  | 'bezichtigd'
  | 'bod'
  | 'gekocht'
  | 'afgevallen'

export type Mine = Partial<Fields> & {
  status?: Status
  favoriet?: boolean
  cijfer?: number
  aspecten?: Record<string, number>
  notities?: string
  bezichtiging?: string
  bod?: number
  checklist?: Record<string, CheckEntry>
  /** Each person's own grade, ratings, notes and checklist, by person key. */
  personen?: Record<string, Personal>
}

/** Fields that belong to one person; the rest of `mine` is shared. */
export const PERSONAL = ['cijfer', 'aspecten', 'notities', 'checklist'] as const
export type Personal = Pick<Mine, (typeof PERSONAL)[number]>

export type Person = { key: string; naam: string; kleur: number }
/** Someone else's answers at a house. */
export type Other = Person & { data: Personal }

/** Answers from before 0.6.0 whose owner the app could not tell. */
export const EARLIER = 'eerder'

export type Listing = {
  url: string
  status: 'ok' | 'blocked' | 'error'
  message: string | null
  photos: number
  hasPage: boolean
  fetchedAt: string
}

export type HouseRecord = {
  id: string
  source: 'report-dir' | 'upload' | 'manual'
  sourcePath: string | null
  report: Fields
  reportBody: string
  mine: Mine
  createdAt: string
  updatedAt: string
  listing?: Listing | null
  /** Photos, videos and voice memos, shared by everyone. */
  media?: Media[]
}

export type House = Fields & {
  id: string
  record: HouseRecord
  status: Status
  favoriet: boolean
  /** Shared fields plus your own answers. */
  mine: Mine
  /** Answers of the other people, in a fixed order. */
  others: Other[]
  prijsPerM2?: number
}

/** The parts of a house each person rates from 1 to 5 stars. */
export const ASPECTS = ['Locatie', 'Ruimte en indeling', 'Staat van onderhoud', 'Licht', 'Buitenruimte', 'Prijs/kwaliteit']

export const STATUSES: { id: Status; label: string; tone: string }[] = [
  { id: 'nieuw', label: 'Nieuw', tone: 'neutral' },
  { id: 'interessant', label: 'Interessant', tone: 'blue' },
  { id: 'gepland', label: 'Bezichtiging gepland', tone: 'orange' },
  { id: 'bezichtigd', label: 'Bezichtigd', tone: 'purple' },
  { id: 'bod', label: 'Bod uitgebracht', tone: 'green' },
  { id: 'gekocht', label: 'Gekocht', tone: 'green' },
  { id: 'afgevallen', label: 'Afgevallen', tone: 'muted' },
]

export function statusInfo(status: Status) {
  return STATUSES.find((s) => s.id === status) ?? STATUSES[0]
}

// Fields Bram may correct in the app. The report's value stays underneath.
const EDITABLE: (keyof Fields)[] = [
  'adres', 'postcode', 'plaats', 'wijk', 'vraagprijs', 'woonoppervlakte', 'perceel', 'kamers',
  'slaapkamers', 'badkamers', 'bouwjaar', 'energielabel', 'woningtype', 'url', 'foto',
]
export { EDITABLE as EDITABLE_FIELDS }

export function toHouse(record: HouseRecord, me = 'lokaal', people: Person[] = []): House {
  const merged: Fields = { ...record.report }
  for (const key of EDITABLE) {
    const value = record.mine[key]
    if (value !== undefined && value !== null && value !== '') {
      ;(merged as Record<string, unknown>)[key] = value
    }
  }
  const prijsPerM2 =
    merged.vraagprijs && merged.woonoppervlakte
      ? Math.round(merged.vraagprijs / merged.woonoppervlakte)
      : undefined
  return {
    ...merged,
    id: record.id,
    record,
    mine: { ...record.mine, ...(record.mine.personen?.[me] ?? {}) },
    others: Object.entries(record.mine.personen ?? {})
      .filter(([key, data]) => key !== me && PERSONAL.some((k) => data[k] !== undefined))
      .map(([key, data]) => ({ ...personInfo(people, key), data }))
      .sort((a, b) => a.kleur - b.kleur),
    status: record.mine.status ?? 'nieuw',
    favoriet: Boolean(record.mine.favoriet),
    prijsPerM2,
  }
}

export function displayAddress(house: Fields): string {
  return house.adres || house.titel || 'Naamloos huis'
}

export function place(house: Fields): string {
  return [house.postcode, house.plaats].filter(Boolean).join(' ')
}

const euro = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const number = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 })

export function formatEuro(value?: number): string {
  return value === undefined || value === null ? '–' : euro.format(value)
}

export function formatNumber(value?: number, unit = ''): string {
  if (value === undefined || value === null) return '–'
  return `${number.format(value)}${unit ? ` ${unit}` : ''}`
}

export function formatDateTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('nl-NL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export type SortKey = 'nieuwste' | 'prijs' | 'prijsm2' | 'oppervlakte' | 'score' | 'cijfer' | 'bezichtiging'

export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'nieuwste', label: 'Nieuwste eerst' },
  { id: 'prijs', label: 'Prijs (laag → hoog)' },
  { id: 'prijsm2', label: 'Prijs per m²' },
  { id: 'oppervlakte', label: 'Woonoppervlakte' },
  { id: 'score', label: 'Score rapport' },
  { id: 'cijfer', label: 'Mijn cijfer' },
  { id: 'bezichtiging', label: 'Eerstvolgende bezichtiging' },
]

function missingLast(a: number | undefined, b: number | undefined, dir: 1 | -1) {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return (a - b) * dir
}

export function sortHouses(houses: House[], key: SortKey): House[] {
  const list = [...houses]
  const by: Record<SortKey, (a: House, b: House) => number> = {
    nieuwste: (a, b) => b.record.createdAt.localeCompare(a.record.createdAt),
    prijs: (a, b) => missingLast(a.vraagprijs, b.vraagprijs, 1),
    prijsm2: (a, b) => missingLast(a.prijsPerM2, b.prijsPerM2, 1),
    oppervlakte: (a, b) => missingLast(a.woonoppervlakte, b.woonoppervlakte, -1),
    score: (a, b) => missingLast(a.score, b.score, -1),
    cijfer: (a, b) => missingLast(a.mine.cijfer, b.mine.cijfer, -1),
    bezichtiging: (a, b) =>
      missingLast(
        a.mine.bezichtiging ? Date.parse(a.mine.bezichtiging) : undefined,
        b.mine.bezichtiging ? Date.parse(b.mine.bezichtiging) : undefined,
        1,
      ),
  }
  // Only the chosen order counts: favourites are not pinned on top (they have their own filter).
  // Equal houses keep the newest first.
  return list.sort((a, b) => by[key](a, b) || by.nieuwste(a, b))
}

export function matchesSearch(house: House, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [house.adres, house.titel, house.plaats, house.wijk, house.postcode, house.woningtype]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q))
}

/** Addresses of the photos the app fetched from the listing, newest fetch first in the cache. */
export function photoUrls(house: House): string[] {
  const listing = house.record.listing
  if (!listing?.photos) return house.foto ? [house.foto] : []
  const v = encodeURIComponent(listing.fetchedAt)
  return Array.from(
    { length: listing.photos },
    (_, i) => `/api/houses/${encodeURIComponent(house.id)}/photos/${i}?v=${v}`,
  )
}

export function mapsUrl(house: Fields): string | null {
  const where = [house.adres, [house.postcode, house.plaats].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  if (!house.adres) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`
}

/** Funda's photo gallery for a listing (…/80887309/media/fotos/), or the listing itself elsewhere. */
export function photoGalleryUrl(url: string): string {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/^(\/detail\/.*\/\d{6,10})(?:\/|$)/)
    if (!/(^|\.)funda\.nl$/.test(u.hostname) || !m) return url
    return `${u.origin}${m[1]}/media/fotos/`
  } catch {
    return url
  }
}

export function personInfo(people: Person[], key: string): Person {
  return (
    people.find((p) => p.key === key) ??
    (key === EARLIER ? { key, naam: 'Eerder ingevuld', kleur: -1 } : { key, naam: 'Iemand', kleur: 9 })
  )
}
