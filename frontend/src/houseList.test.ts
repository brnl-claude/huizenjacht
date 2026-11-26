import { describe, expect, it } from 'vitest'
import { toHouse, type HouseRecord } from './house'
import { neighbours, visibleHouses, type ListView } from './houseList'

const house = (id: string, day: number, plaats: string, mine: HouseRecord['mine'] = {}) =>
  toHouse({
    id, source: 'report-dir', sourcePath: `${id}.md`, report: { plaats, vraagprijs: 300000 + day }, reportBody: '', mine,
    createdAt: `2026-11-0${day}T00:00:00Z`, updatedAt: '2026-11-01T00:00:00Z',
  })

const houses = [
  house('a', 1, 'Utrecht'),
  house('b', 2, 'Zeist'),
  house('c', 3, 'Utrecht', { status: 'afgevallen' }),
  house('d', 4, 'Utrecht'),
]
const view: ListView = { query: '', filter: 'actief', sort: 'nieuwste' }
const ids = (v: ListView) => visibleHouses(houses, v).map((h) => h.id)

describe('the list of the home page', () => {
  it('searches, filters and sorts', () => {
    expect(ids(view)).toEqual(['d', 'b', 'a'])
    expect(ids({ ...view, filter: 'alle', sort: 'prijs' })).toEqual(['a', 'b', 'c', 'd'])
    expect(ids({ ...view, query: 'utrecht' })).toEqual(['d', 'a'])
  })
  it('gives the previous and next house in that list', () => {
    expect(neighbours(houses, view, 'b')).toMatchObject({ prev: { id: 'd' }, next: { id: 'a' } })
    expect(neighbours(houses, view, 'd')).toMatchObject({ prev: null, next: { id: 'b' } })
    expect(neighbours(houses, { ...view, query: 'utrecht' }, 'a')).toMatchObject({ prev: { id: 'd' }, next: null })
  })
  it('falls back to all houses for a house the filter hides', () => {
    expect(neighbours(houses, view, 'c')).toMatchObject({ prev: { id: 'd' }, next: { id: 'b' } })
    expect(neighbours(houses, view, 'x')).toEqual({ prev: null, next: null })
  })
})
