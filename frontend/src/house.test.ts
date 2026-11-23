import { describe, expect, it } from 'vitest'
import { checklistFor, DEFAULT_CHECKLIST, progress } from './checklist'
import { sortHouses, toHouse, type HouseRecord } from './house'
import { CHANGELOG } from './changelog'

const record = (id: string, report: HouseRecord['report'], mine: HouseRecord['mine'] = {}): HouseRecord => ({
  id, source: 'report-dir', sourcePath: `${id}.md`, report, reportBody: '', mine,
  createdAt: `2026-11-0${id.length}T00:00:00Z`, updatedAt: '2026-11-01T00:00:00Z',
})

describe('houses', () => {
  it('lets my corrections win over the report and computes price per m²', () => {
    const h = toHouse(record('a', { vraagprijs: 400000, woonoppervlakte: 100 }, { vraagprijs: 380000 }))
    expect(h.vraagprijs).toBe(380000)
    expect(h.prijsPerM2).toBe(3800)
    expect(h.status).toBe('nieuw')
  })
  it('sorts favourites first and missing values last', () => {
    const list = [
      toHouse(record('a', { vraagprijs: 500000 })),
      toHouse(record('bb', {})),
      toHouse(record('ccc', { vraagprijs: 300000 })),
      toHouse(record('dddd', { vraagprijs: 900000 }, { favoriet: true })),
    ]
    expect(sortHouses(list, 'prijs').map((h) => h.id)).toEqual(['dddd', 'ccc', 'a', 'bb'])
  })
})

describe('checklist', () => {
  it('adds the report points and counts answers', () => {
    const h = toHouse(record('a', { bezichtigingspunten: ['Kelder'] }, {}))
    const cats = checklistFor(h, DEFAULT_CHECKLIST)
    expect(cats[0].titel).toBe('Uit het rapport')
    const p = progress(cats, { [cats[0].items[0].id]: { s: 'probleem' } })
    expect(p.done).toBe(1)
    expect(p.probleem).toBe(1)
  })
})

describe('changelog', () => {
  it('lists versions newest first as semver', () => {
    for (const r of CHANGELOG) expect(r.version).toMatch(/^\d+\.\d+\.\d+$/)
    const nums = CHANGELOG.map((r) => r.version.split('.').map(Number))
    for (let i = 1; i < nums.length; i++) {
      const [a, b] = [nums[i - 1], nums[i]]
      expect(a[0] * 1e6 + a[1] * 1e3 + a[2]).toBeGreaterThan(b[0] * 1e6 + b[1] * 1e3 + b[2])
    }
  })
})
