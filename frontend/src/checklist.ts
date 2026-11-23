/** The viewing checklist: one template for every house, plus points from the house's report. */

import type { CheckEntry, House } from './house'

export type ChecklistItem = { id: string; tekst: string }
export type ChecklistCategory = { id: string; titel: string; items: ChecklistItem[] }

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

/** The template plus a category with the points the report asks to check at this house. */
export function checklistFor(house: House, template: ChecklistCategory[]): ChecklistCategory[] {
  const points = house.record.report.bezichtigingspunten ?? []
  if (!points.length) return template
  return [
    {
      id: REPORT_CATEGORY_ID,
      titel: 'Uit het rapport',
      items: points.map((tekst) => ({ id: `${REPORT_CATEGORY_ID}-${slug(tekst)}`, tekst })),
    },
    ...template,
  ]
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
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
