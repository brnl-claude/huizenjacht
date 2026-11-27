import { describe, expect, it } from 'vitest'
import { checklistFor, DEFAULT_CHECKLIST, pointNumbers, quickPlan } from './checklist'
import { toHouse, type HouseRecord } from './house'
import { pdfDocument } from './pdfExport'

const body = `## Afvinklijst bezichtiging

**Bij de bezichtiging**

- [ ] Kozijnen: houtrot
- [ ] (!) Scheur boven de voordeur
`

const house = toHouse({
  id: 'laan-1',
  source: 'report-dir',
  sourcePath: 'huizen/laan-1.md',
  report: { vooraf_ingevuld: [{ punt: 'Asbest in de schuur', oordeel: 'twijfel' }] },
  reportBody: body,
  mine: {},
  createdAt: '2026-11-25T00:00:00Z',
  updatedAt: '2026-11-25T00:00:00Z',
} as HouseRecord)

describe('pointNumbers', () => {
  const full = checklistFor(house, DEFAULT_CHECKLIST, true)
  const numbers = pointNumbers(full)

  it('numbers every point in list order, from 1', () => {
    const ids = full.flatMap((c) => c.items.map((i) => i.id))
    expect(ids.map((id) => numbers[id])).toEqual(ids.map((_, i) => i + 1))
  })

  it('keeps the numbers in the short viewing', () => {
    const plan = quickPlan(full, 15)
    const scheur = plan.now.find((p) => p.item.tekst.startsWith('Scheur boven'))!
    expect(plan.now[0]).toBe(scheur)
    expect(numbers[scheur.item.id]).toBe(2)
  })

  it('keeps the numbers without the standard list', () => {
    const own = checklistFor(house, DEFAULT_CHECKLIST, false)
    const both = pointNumbers(full, own)
    for (const c of own) for (const i of c.items) expect(both[i.id]).toBeDefined()
    for (const id of Object.keys(numbers)) expect(both[id]).toBe(numbers[id])
  })

  it('shows the numbers in the PDF', () => {
    const doc = JSON.stringify(pdfDocument(house, full, [], 'lokaal', new Date('2026-11-27'), {}, numbers))
    expect(doc).toContain('"2. "')
  })
})
