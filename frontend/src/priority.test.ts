import { describe, expect, it } from 'vitest'
import {
  checklistFor,
  DEFAULT_CHECKLIST,
  priorityTag,
  quickPlan,
  rank,
  reportChecklist,
  withPriorities,
  type ChecklistCategory,
} from './checklist'
import { toHouse, type Fields, type HouseRecord } from './house'
import { timeLeft } from './quickViewing'

const body = `## Open punten

- Hoe oud is het dak?

## Afvinklijst bezichtiging

**Bij de bezichtiging**

- [ ] Kozijnen: houtrot
- [ ] (optioneel) Tuinhuis bekijken
- [ ] (!) Scheur boven de voordeur

**Vóór het bieden**

- [ ] Verzekeraar bellen
`

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

describe('priorities', () => {
  it('gives every standard point a priority', () => {
    const all = DEFAULT_CHECKLIST.flatMap((c) => c.items)
    expect(all.every((i) => i.prio)).toBe(true)
    expect(all.filter((i) => i.prio === 'moet').length).toBeGreaterThan(3)
  })

  it('reads report points: belangrijk, later before bidding, tags win', () => {
    const items = reportChecklist(body).flatMap((c) => c.items)
    const prio = Object.fromEntries(items.map((i) => [i.tekst, i.prio]))
    expect(prio).toEqual({
      'Hoe oud is het dak?': 'belangrijk',
      'Kozijnen: houtrot': 'belangrijk',
      'Tuinhuis bekijken': 'optioneel',
      'Scheur boven de voordeur': 'moet',
      'Verzekeraar bellen': 'later',
    })
  })

  it('keeps the id of a point when a tag is added', () => {
    const plainId = reportChecklist('- [ ] Tuinhuis bekijken').flatMap((c) => c.items)[0].id
    const tagged = reportChecklist('- [ ] [Later] Tuinhuis bekijken').flatMap((c) => c.items)[0]
    expect(tagged.id).toBe(plainId)
    expect(tagged.prio).toBe('later')
    expect(priorityTag('Geen tag (moet)')).toEqual({ tekst: 'Geen tag (moet)' })
  })

  it('fills priorities in an older saved template', () => {
    const old: ChecklistCategory[] = [
      { id: 'x', titel: 'X', items: [{ id: 'x-1', tekst: 'Opbergruimte' }, { id: 'x-2', tekst: 'Eigen punt' }] },
    ]
    expect(withPriorities(old)[0].items.map((i) => i.prio)).toEqual(['optioneel', 'belangrijk'])
  })

  it('moves points by what the documents say, unless set at the house', () => {
    const item = { id: 'a', tekst: 'A', prio: 'moet' as const }
    expect(rank({ ...item, vooraf: { punt: 'A', oordeel: 'ok' } }).prio).toBe('belangrijk')
    expect(rank({ ...item, prio: 'optioneel', vooraf: { punt: 'A', oordeel: 'probleem' } }).prio).toBe('moet')
    expect(rank({ ...item, prio: 'optioneel', vooraf: { punt: 'A', oordeel: 'twijfel' } }).prio).toBe('belangrijk')
    expect(rank({ ...item, vooraf: { punt: 'A', oordeel: 'ok' } }, { a: 'moet' })).toEqual({ prio: 'moet', own: true })
  })
})

describe('quickPlan', () => {
  const cats = checklistFor(houseWith({}, body), DEFAULT_CHECKLIST)

  it('fits the most important points in the time, moet first', () => {
    const plan = quickPlan(cats, 15)
    expect(plan.now).toHaveLength(15)
    const order = plan.now.map((p) => p.prio)
    expect(order.indexOf('belangrijk')).toBeGreaterThan(order.lastIndexOf('moet'))
    expect(plan.now.map((p) => p.item.tekst).slice(0, 2)).toEqual(['Scheur boven de voordeur', 'Scheuren in gevel of metselwerk'])
    // Within a priority the house's own points come before the standard list.
    expect(plan.now.find((p) => p.prio === 'belangrijk')?.item.tekst).toBe('Hoe oud is het dak?')
    expect(plan.later.map((p) => p.item.tekst)).toContain('Verzekeraar bellen')
    expect(plan.now.length + plan.spare.length + plan.later.length).toBe(cats.flatMap((c) => c.items).length)
    expect(plan.tooMany).toBe(0)
  })

  it('keeps every moet-point and says how many do not fit', () => {
    const plan = quickPlan(cats, 5)
    const must = cats.flatMap((c) => c.items).filter((i) => rank(i).prio === 'moet').length
    expect(plan.now).toHaveLength(must)
    expect(plan.tooMany).toBe(must - 5)
  })
})

describe('timeLeft', () => {
  it('counts down and then over time', () => {
    expect(timeLeft(0, 30, 60_000 * 12.5)).toEqual({ text: 'nog 18 min', over: false })
    expect(timeLeft(0, 30, 60_000 * 33)).toEqual({ text: '3 min over tijd', over: true })
  })
})
