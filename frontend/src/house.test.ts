import { describe, expect, it } from 'vitest'
import { checklistFor, DEFAULT_CHECKLIST, progress } from './checklist'
import { photoGalleryUrl, sortHouses, toHouse, type HouseRecord } from './house'
import { CHANGELOG, latestAndroidRelease, releasesSince } from './changelog'

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

describe('photoGalleryUrl', () => {
  it('points a Funda listing at its photo gallery', () => {
    const base = 'https://www.funda.nl/detail/koop/giesbeek/huis-de-geer-16/80887309'
    expect(photoGalleryUrl(`${base}/`)).toBe(`${base}/media/fotos/`)
    expect(photoGalleryUrl(`${base}?ref=x`)).toBe(`${base}/media/fotos/`)
    expect(photoGalleryUrl(`${base}/media/fotos/`)).toBe(`${base}/media/fotos/`)
  })
  it('leaves other sites alone', () => {
    expect(photoGalleryUrl('https://example.org/huis/12345678/')).toBe('https://example.org/huis/12345678/')
  })
})

describe('answers per person', () => {
  it('shows your own answers in mine and the others apart', () => {
    const r = record('a', {}, {
      status: 'bezichtigd',
      personen: { me: { cijfer: 8 }, ander: { cijfer: 6, notities: 'Te klein' }, leeg: {} },
    })
    const people = [
      { key: 'me', naam: 'Bram', kleur: 0 },
      { key: 'ander', naam: 'Partner', kleur: 1 },
    ]
    const h = toHouse(r, 'me', people)
    expect(h.mine.cijfer).toBe(8)
    expect(h.status).toBe('bezichtigd')
    expect(h.others).toEqual([{ key: 'ander', naam: 'Partner', kleur: 1, data: { cijfer: 6, notities: 'Te klein' } }])
  })
})

describe('news after an update', () => {
  const log = [
    { version: '0.3.0', date: '2026-01-03', title: 'c', changes: [] },
    { version: '0.2.0', date: '2026-01-02', title: 'b', changes: [], android: ['x'] },
    { version: '0.1.0', date: '2026-01-01', title: 'a', changes: [] },
  ]
  it('shows nothing when the newest version was seen', () => {
    expect(releasesSince('0.3.0', log)).toEqual([])
  })
  it('shows every version since the one seen last', () => {
    expect(releasesSince('0.1.0', log).map((r) => r.version)).toEqual(['0.3.0', '0.2.0'])
  })
  it('shows only the newest for someone who never saw one', () => {
    expect(releasesSince(null, log).map((r) => r.version)).toEqual(['0.3.0'])
    expect(releasesSince('9.9.9', log).map((r) => r.version)).toEqual(['0.3.0'])
  })
  it('knows the newest version with a new Android app', () => {
    expect(latestAndroidRelease()?.android?.length).toBeGreaterThan(0)
  })
})
