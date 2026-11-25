/** The viewing checklist: one template for every house, plus points from the house's report. */

import type { CheckEntry, House, Prefill } from './house'

export type ChecklistItem = { id: string; tekst: string; vooraf?: Prefill }
export type ChecklistCategory = {
  id: string
  titel: string
  items: ChecklistItem[]
  fromReport?: boolean
  /** New points from the documents of the house. */
  fromDocuments?: boolean
}

const c = (id: string, titel: string, items: string[]): ChecklistCategory => ({
  id,
  titel,
  items: items.map((tekst, i) => ({ id: `${id}-${i + 1}`, tekst })),
})

export const DEFAULT_CHECKLIST: ChecklistCategory[] = [
  c('omgeving', 'Buurt en omgeving', [
    'Geluid van verkeer, spoor of buren',
    'Parkeren voor de deur en in de straat',
    'Winkels, scholen en OV op loopafstand',
    'Uitzicht en privacy',
    'Ligging van de tuin (zon)',
  ]),
  c('buiten', 'Buitenkant en constructie', [
    'Scheuren in gevel of metselwerk',
    'Staat van het dak, de dakgoten en het lood',
    'Kozijnen: houtrot en schilderwerk',
    'Fundering: scheve deuren, scheuren, funderingsrapport',
    'Kruipruimte: droog en geventileerd',
  ]),
  c('binnen', 'Binnen', [
    'Vochtplekken, schimmel of muffe geur',
    'Indeling en lichtinval per kamer',
    'Plafondhoogte en zolder',
    'Opbergruimte',
    'Vloeren en trappen',
  ]),
  c('installaties', 'Installaties', [
    'Leeftijd en type cv-ketel of warmtepomp',
    'Meterkast: aantal groepen, aardlekschakelaar',
    'Waterdruk en warm water',
    'Ventilatie (mechanisch of natuurlijk)',
    'Internet en glasvezel',
  ]),
  c('keuken', 'Keuken en sanitair', [
    'Staat en leeftijd van de keuken',
    'Inbouwapparatuur die blijft',
    'Badkamer: tegels, kitranden, afvoer',
    'Tweede toilet',
  ]),
  c('energie', 'Isolatie en energie', [
    'Dubbel of HR++-glas',
    'Dak-, vloer- en spouwmuurisolatie',
    'Zonnepanelen',
    'Energielabel klopt met wat je ziet',
  ]),
  c('vragen', 'Vragen aan de makelaar', [
    'Waarom wordt het huis verkocht?',
    'Hoeveel bezichtigingen en biedingen zijn er?',
    'Opleverdatum en roerende zaken',
    'Bekende gebreken en VvE-stukken',
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
  const groups = new Map<string, string[]>()
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
    groups.set(group, [...(groups.get(group) ?? []), plain(text)])
  }
  const used = new Set<string>()
  return [...groups].map(([titel, texts]) => ({
    id: `${REPORT_CATEGORY_ID}-${slug(titel)}`,
    titel,
    fromReport: true,
    items: texts.map((tekst) => {
      const base = `${REPORT_CATEGORY_ID}-${slug(tekst, 60)}`
      let id = base
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`
      used.add(id)
      return { id, tekst }
    }),
  }))
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
        items: report.bezichtigingspunten.map((tekst) => ({ id: `${REPORT_CATEGORY_ID}-${slug(tekst)}`, tekst })),
      },
    ]
  }
  return withPrefill(own, template, showStandard, report.vooraf ?? [])
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
