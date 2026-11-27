/** The viewing checklist: one template for every house, plus points from the house's report. */

import type { CheckEntry, House, Prefill } from './house'

/**
 * How much a point matters at a short viewing: moet (always look), belangrijk (when there is
 * time), optioneel (only with time to spare) or later (not on the spot: before bidding, at home).
 */
export type Priority = 'moet' | 'belangrijk' | 'optioneel' | 'later'
export const PRIORITIES: { id: Priority; label: string; hint: string }[] = [
  { id: 'moet', label: 'Moet', hint: 'Altijd bekijken, ook bij een korte bezichtiging' },
  { id: 'belangrijk', label: 'Belangrijk', hint: 'Bekijken als er tijd is' },
  { id: 'optioneel', label: 'Optioneel', hint: 'Alleen als er tijd over is' },
  { id: 'later', label: 'Later', hint: 'Niet ter plekke: thuis of vóór het bieden' },
]
const RANK: Record<Priority, number> = { moet: 0, belangrijk: 1, optioneel: 2, later: 3 }

export type ChecklistItem = { id: string; tekst: string; vooraf?: Prefill; prio?: Priority }
export type ChecklistCategory = {
  id: string
  titel: string
  items: ChecklistItem[]
  fromReport?: boolean
  /** New points from the documents of the house. */
  fromDocuments?: boolean
}

const c = (id: string, titel: string, items: [string, Priority][]): ChecklistCategory => ({
  id,
  titel,
  items: items.map(([tekst, prio], i) => ({ id: `${id}-${i + 1}`, tekst, prio })),
})

export const DEFAULT_CHECKLIST: ChecklistCategory[] = [
  c('omgeving', 'Buurt en omgeving', [
    ['Geluid van verkeer, spoor of buren', 'belangrijk'],
    ['Parkeren voor de deur en in de straat', 'optioneel'],
    ['Winkels, scholen en OV op loopafstand', 'later'],
    ['Uitzicht en privacy', 'belangrijk'],
    ['Ligging van de tuin (zon)', 'belangrijk'],
  ]),
  c('buiten', 'Buitenkant en constructie', [
    ['Scheuren in gevel of metselwerk', 'moet'],
    ['Staat van het dak, de dakgoten en het lood', 'belangrijk'],
    ['Kozijnen: houtrot en schilderwerk', 'belangrijk'],
    ['Fundering: scheve deuren, scheuren, funderingsrapport', 'moet'],
    ['Kruipruimte: droog en geventileerd', 'belangrijk'],
  ]),
  c('binnen', 'Binnen', [
    ['Vochtplekken, schimmel of muffe geur', 'moet'],
    ['Indeling en lichtinval per kamer', 'moet'],
    ['Plafondhoogte en zolder', 'optioneel'],
    ['Opbergruimte', 'optioneel'],
    ['Vloeren en trappen', 'optioneel'],
  ]),
  c('installaties', 'Installaties', [
    ['Leeftijd en type cv-ketel of warmtepomp', 'belangrijk'],
    ['Meterkast: aantal groepen, aardlekschakelaar', 'optioneel'],
    ['Waterdruk en warm water', 'optioneel'],
    ['Ventilatie (mechanisch of natuurlijk)', 'optioneel'],
    ['Internet en glasvezel', 'later'],
  ]),
  c('keuken', 'Keuken en sanitair', [
    ['Staat en leeftijd van de keuken', 'belangrijk'],
    ['Inbouwapparatuur die blijft', 'optioneel'],
    ['Badkamer: tegels, kitranden, afvoer', 'belangrijk'],
    ['Tweede toilet', 'optioneel'],
  ]),
  c('energie', 'Isolatie en energie', [
    ['Dubbel of HR++-glas', 'optioneel'],
    ['Dak-, vloer- en spouwmuurisolatie', 'optioneel'],
    ['Zonnepanelen', 'optioneel'],
    ['Energielabel klopt met wat je ziet', 'optioneel'],
  ]),
  c('vragen', 'Vragen aan de makelaar', [
    ['Waarom wordt het huis verkocht?', 'belangrijk'],
    ['Hoeveel bezichtigingen en biedingen zijn er?', 'moet'],
    ['Opleverdatum en roerende zaken', 'belangrijk'],
    ['Bekende gebreken en VvE-stukken', 'moet'],
  ]),
]

export const REPORT_CATEGORY_ID = 'rapport'

/** Inline Markdown to plain text: no bold, italics, code or link syntax. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The house's own checklist from the report body: every task item (`- [ ] ...`), grouped by
 * the bold line or heading above it, and the open questions under a heading such as
 * "Open punten" or "Vragen".
 */
export function reportChecklist(body: string): ChecklistCategory[] {
  const groups = new Map<string, { tekst: string; prio: Priority }[]>()
  let heading = ''
  let sub = ''
  let questions = false
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const h = line.match(/^#{1,6}\s+(.*)$/)
    if (h) {
      heading = plain(h[1])
      sub = ''
      questions = /open punten|open vragen|^vragen|vragen aan|vragen voor/i.test(heading)
      continue
    }
    const bold = line.match(/^(\*\*|__)(.+?)\1:?$/)
    if (bold) {
      sub = plain(bold[2]).replace(/:$/, '')
      continue
    }
    const task = line.match(/^[-*+]\s+\[[ xX]\]\s+(.+)$/)
    const bullet = questions && !task ? line.match(/^[-*+]\s+(.+)$/) : null
    const text = task?.[1] ?? bullet?.[1]
    if (!text) continue
    const group = task ? sub || heading || 'Uit het rapport' : 'Open vragen uit het rapport'
    const { tekst, prio } = priorityTag(plain(text))
    const fallback: Priority = task && LATER_GROUP.test(group) ? 'later' : 'belangrijk'
    groups.set(group, [...(groups.get(group) ?? []), { tekst, prio: prio ?? fallback }])
  }
  const used = new Set<string>()
  return [...groups].map(([titel, points]) => ({
    id: `${REPORT_CATEGORY_ID}-${slug(titel)}`,
    titel,
    fromReport: true,
    items: points.map(({ tekst, prio }) => {
      const base = `${REPORT_CATEGORY_ID}-${slug(tekst, 60)}`
      let id = base
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`
      used.add(id)
      return { id, tekst, prio }
    }),
  }))
}

/** Groups in a report that are not for the viewing itself, such as "Vóór het bieden". */
const LATER_GROUP = /v[oó][oó]r het (bieden|bod)|v[oó][oó]r (een|het) bod|na de bezichtiging|achteraf|thuis|later/i

/**
 * A priority at the start of a report point: "(moet)", "[belangrijk]", "(optioneel)", "(later)"
 * or "(!)" for moet. The tag is left out of the text, so adding one keeps the answers.
 */
export function priorityTag(text: string): { tekst: string; prio?: Priority } {
  const m = text.match(/^[([](moet|belangrijk|optioneel|later|!)[)\]]:?\s*/i)
  if (!m) return { tekst: text }
  const word = m[1].toLowerCase()
  return { tekst: text.slice(m[0].length), prio: word === '!' ? 'moet' : (word as Priority) }
}

/**
 * The template with a priority at every point. A template saved before priorities existed
 * takes them from the standard list by text; other points are belangrijk.
 */
export function withPriorities(template: ChecklistCategory[]): ChecklistCategory[] {
  const known = new Map<string, Priority>()
  for (const category of DEFAULT_CHECKLIST)
    for (const item of category.items) if (item.prio) known.set(sameText(item.tekst), item.prio)
  return template.map((category) => ({
    ...category,
    items: category.items.map((item) =>
      item.prio ? item : { ...item, prio: known.get(sameText(item.tekst)) ?? 'belangrijk' },
    ),
  }))
}

/** The priority a point has at this house, and why it differs from its usual one. */
export type Ranked = { prio: Priority; reason?: string; own: boolean }

/**
 * A priority set at the house wins. Otherwise the documents move a point: a problem in them
 * makes it a moet to see for yourself, a doubt at least belangrijk, and in orde one step lower,
 * since you only need to check it.
 */
export function rank(item: ChecklistItem, overrides: Record<string, Priority> = {}): Ranked {
  const own = overrides[item.id]
  if (own) return { prio: own, own: true }
  const base = item.prio ?? 'belangrijk'
  const oordeel = item.vooraf?.oordeel
  if (!oordeel || base === 'later') return { prio: base, own: false }
  if (oordeel === 'probleem' && base !== 'moet')
    return { prio: 'moet', reason: 'hoger: probleem in de documenten', own: false }
  if (oordeel === 'twijfel' && RANK[base] > RANK.belangrijk)
    return { prio: 'belangrijk', reason: 'hoger: twijfel in de documenten', own: false }
  if (oordeel === 'ok' && base !== 'optioneel') {
    const lower: Priority = base === 'moet' ? 'belangrijk' : 'optioneel'
    return { prio: lower, reason: 'lager: in orde volgens de documenten', own: false }
  }
  return { prio: base, own: false }
}

/** About one minute per point: look, tick, maybe a photo. */
export const MINUTES_PER_POINT = 1
export const QUICK_MINUTES = [15, 20, 30, 45, 60]

export type PlannedPoint = { item: ChecklistItem; category: ChecklistCategory } & Ranked
export type QuickPlan = {
  /** The points that fit in the time, moet first: the order to walk them in. */
  now: PlannedPoint[]
  /** Points that do not fit, for when there is time left. */
  spare: PlannedPoint[]
  /** Points for after the viewing. */
  later: PlannedPoint[]
  /** Moet-points that do not fit in the time. */
  tooMany: number
}

/**
 * A short viewing: every point by priority, keeping the order of the list within a priority.
 * Answered points keep their place, so ticking one does not move the others.
 */
export function quickPlan(
  categories: ChecklistCategory[],
  minutes: number,
  overrides: Record<string, Priority> = {},
): QuickPlan {
  const all: PlannedPoint[] = categories.flatMap((category) =>
    category.items.map((item) => ({ item, category, ...rank(item, overrides) })),
  )
  const sorted = all.filter((p) => p.prio !== 'later').sort((a, b) => RANK[a.prio] - RANK[b.prio])
  const fits = Math.max(1, Math.floor(minutes / MINUTES_PER_POINT))
  const mustCount = sorted.filter((p) => p.prio === 'moet').length
  // All moet-points stay in, even when they do not fit; the plan then says so.
  const take = Math.max(fits, mustCount)
  return {
    now: sorted.slice(0, take),
    spare: sorted.slice(take),
    later: all.filter((p) => p.prio === 'later'),
    tooMany: Math.max(0, mustCount - fits),
  }
}

/**
 * The checklist for one house. A report with its own checklist comes first, with the
 * standard template after it unless `withStandard` is off. Without one, the short
 * aandachtspunten from the front matter come first. Prefilled answers from the documents
 * (`vooraf_ingevuld`) attach to the point with the same text; the others become new points.
 */
export function checklistFor(
  house: House,
  template: ChecklistCategory[],
  withStandard = true,
): ChecklistCategory[] {
  const report = house.record.report
  let own = reportChecklist(house.record.reportBody ?? '')
  const showStandard = withStandard || !own.length
  if (!own.length && report.bezichtigingspunten?.length) {
    own = [
      {
        id: REPORT_CATEGORY_ID,
        titel: 'Uit het rapport',
        fromReport: true,
        items: report.bezichtigingspunten.map((point) => {
          const { tekst, prio } = priorityTag(point)
          return { id: `${REPORT_CATEGORY_ID}-${slug(tekst)}`, tekst, prio: prio ?? 'belangrijk' }
        }),
      },
    ]
  }
  return withPrefill(own, withPriorities(template), showStandard, report.vooraf ?? [])
}

export const DOCUMENTS_CATEGORY = 'Uit de documenten'

/** Comparable text: no case, accents or punctuation. */
export function sameText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function withPrefill(
  own: ChecklistCategory[],
  template: ChecklistCategory[],
  showStandard: boolean,
  prefills: Prefill[],
): ChecklistCategory[] {
  if (!prefills.length) return showStandard ? [...own, ...template] : own
  const copy = (cs: ChecklistCategory[]) => cs.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i })) }))
  const first = copy(own)
  const standard = copy(template)
  const added: ChecklistCategory[] = []
  const byText = new Map<string, ChecklistItem>()
  const byTitle = new Map<string, ChecklistCategory>()
  for (const category of [...first, ...standard]) {
    if (!byTitle.has(sameText(category.titel))) byTitle.set(sameText(category.titel), category)
    for (const item of category.items) if (!byText.has(sameText(item.tekst))) byText.set(sameText(item.tekst), item)
  }
  const used = new Set<string>()
  for (const prefill of prefills) {
    const key = sameText(prefill.punt)
    if (!key) continue
    const found = byText.get(key)
    if (found) {
      found.vooraf ??= prefill
      continue
    }
    const titel = prefill.groep?.trim() || DOCUMENTS_CATEGORY
    let category = byTitle.get(sameText(titel))
    // A new point in a group of the standard list is only seen with the standard list on.
    if (!category || (!showStandard && standard.includes(category))) {
      category = { id: `vooraf-${slug(titel)}`, titel, items: [], fromDocuments: true }
      added.push(category)
      byTitle.set(sameText(titel), category)
    }
    const base = `vooraf-${slug(prefill.punt, 60)}`
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    const item = { id, tekst: prefill.punt, vooraf: prefill }
    category.items.push(item)
    byText.set(key, item)
  }
  // Without the standard list, its points that the documents answer still show.
  const rest = showStandard
    ? standard
    : standard
        .map((c) => ({ ...c, items: c.items.filter((i) => i.vooraf) }))
        .filter((c) => c.items.length)
  return [...first, ...added, ...rest]
}

/**
 * A fixed number for every point: its place in the whole list of the house, so filters such
 * as Korte bezichtiging, Alleen open punten or the standard list switched off never change it.
 * Points of a later list that the first does not have get the numbers after it.
 */
export function pointNumbers(...lists: ChecklistCategory[][]): Record<string, number> {
  const numbers: Record<string, number> = {}
  let n = 0
  for (const list of lists)
    for (const category of list) for (const item of category.items) numbers[item.id] ??= ++n
  return numbers
}

/** How many points have a prefilled answer. */
export function prefilledCount(categories: ChecklistCategory[]): number {
  return categories.reduce((n, c) => n + c.items.filter((i) => i.vooraf).length, 0)
}

function slug(text: string, length = 40): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, length)
}

export type Progress = { total: number; done: number; ok: number; twijfel: number; probleem: number }

export function progress(
  categories: ChecklistCategory[],
  answers: Record<string, CheckEntry> = {},
): Progress {
  const result: Progress = { total: 0, done: 0, ok: 0, twijfel: 0, probleem: 0 }
  for (const category of categories) {
    for (const item of category.items) {
      result.total += 1
      const state = answers[item.id]?.s
      if (state) {
        result.done += 1
        result[state] += 1
      }
    }
  }
  return result
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}
