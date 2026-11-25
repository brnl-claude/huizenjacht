import { describe, expect, it } from 'vitest'
import { checklistFor, DEFAULT_CHECKLIST, prefilledCount, reportChecklist } from './checklist'
import { toHouse, type Fields, type HouseRecord } from './house'

const body = `# Laan 1

## Open punten

- Hoe oud is het **platte dak**?
- Is er een [meetrapport](https://example.org)?

## Afvinklijst bezichtiging

**Bij de bezichtiging**

- [ ] Kozijnen: houtrot
- [x] Kozijnen: houtrot

**Vóór het bieden:**

- [ ] Verzekeraar bellen
`

describe('reportChecklist', () => {
  it('groups task items by the bold line above them and keeps the open questions', () => {
    const cats = reportChecklist(body)
    expect(cats.map((c) => c.titel)).toEqual(['Open vragen uit het rapport', 'Bij de bezichtiging', 'Vóór het bieden'])
    expect(cats[0].items.map((i) => i.tekst)).toEqual(['Hoe oud is het platte dak?', 'Is er een meetrapport?'])
    const ids = cats[1].items.map((i) => i.id)
    expect(new Set(ids).size).toBe(2)
    expect(cats.every((c) => c.fromReport)).toBe(true)
  })

  it('is empty for a report without a checklist', () => {
    expect(reportChecklist('## Samenvatting\n\n- Mooi huis\n')).toEqual([])
  })
})

function houseWith(report: Fields, reportBody = '') {
  const record: HouseRecord = {
    id: 'laan-1',
    source: 'report-dir',
    sourcePath: 'huizen/laan-1.md',
    report,
    reportBody,
    mine: {},
    createdAt: '2026-11-25T00:00:00Z',
    updatedAt: '2026-11-25T00:00:00Z',
  }
  return toHouse(record)
}

describe('prefilled answers from the documents', () => {
  const vooraf = [
    { punt: 'fundering: scheve deuren, scheuren, funderingsrapport', oordeel: 'ok' as const, antwoord: 'Palen in orde', bron: 'Funderingsrapport' },
    { punt: 'Kozijnen: houtrot', oordeel: 'probleem' as const },
    { punt: 'Asbest in de schuur?', bron: 'Vragenlijst' },
    { punt: 'Lekkage dakkapel', groep: 'Bij de bezichtiging' },
  ]

  it('attaches answers to matching points and adds the rest as new points', () => {
    const cats = checklistFor(houseWith({ vooraf }, body), DEFAULT_CHECKLIST)
    const items = cats.flatMap((c) => c.items)
    const fundering = items.find((i) => i.tekst.startsWith('Fundering'))
    expect(fundering?.id).toBe('buiten-4')
    expect(fundering?.vooraf?.antwoord).toBe('Palen in orde')
    expect(items.filter((i) => i.tekst === 'Kozijnen: houtrot')[0].vooraf?.oordeel).toBe('probleem')
    const docs = cats.find((c) => c.fromDocuments)
    expect(docs?.titel).toBe('Uit de documenten')
    expect(docs?.items.map((i) => i.tekst)).toEqual(['Asbest in de schuur?'])
    expect(cats.find((c) => c.titel === 'Bij de bezichtiging')?.items.map((i) => i.tekst)).toContain('Lekkage dakkapel')
    expect(prefilledCount(cats)).toBe(4)
  })

  it('keeps answered standard points when the standard list is off', () => {
    const cats = checklistFor(houseWith({ vooraf }, body), DEFAULT_CHECKLIST, false)
    expect(cats.find((c) => c.id === 'buiten')?.items.map((i) => i.id)).toEqual(['buiten-4'])
    expect(cats.some((c) => c.id === 'omgeving')).toBe(false)
  })

  it('leaves the checklist alone without prefilled answers', () => {
    expect(checklistFor(houseWith({}), DEFAULT_CHECKLIST)).toEqual(DEFAULT_CHECKLIST)
  })
})
