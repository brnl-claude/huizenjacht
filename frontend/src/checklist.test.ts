import { describe, expect, it } from 'vitest'
import { reportChecklist } from './checklist'

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
