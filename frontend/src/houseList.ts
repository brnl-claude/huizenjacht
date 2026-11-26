/**
 * The list of houses as the home page shows it: search, status filter and sort order. The
 * house page uses the same list for its previous and next buttons, so they follow what Bram
 * last saw on the home page. The sort order is remembered on this device; search and filter
 * last as long as the tab (sessionStorage), so they are still there when he comes back.
 */

import { matchesSearch, sortHouses, SORTS, type House, type SortKey, type Status } from './house'

export type Filter = 'actief' | 'alle' | 'favoriet' | Status

export type ListView = { query: string; filter: Filter; sort: SortKey }

const SORT_KEY = 'hj.sort'
const QUERY_KEY = 'hj.query'
const FILTER_KEY = 'hj.filter'

function read(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key)
  } catch {
    return null
  }
}

function write(store: () => Storage, key: string, value: string) {
  try {
    store().setItem(key, value)
  } catch {
    // not remembered
  }
}

export function rememberedView(): ListView {
  const sort = read(() => localStorage, SORT_KEY)
  return {
    query: read(() => sessionStorage, QUERY_KEY) ?? '',
    filter: (read(() => sessionStorage, FILTER_KEY) as Filter | null) || 'actief',
    sort: SORTS.some((s) => s.id === sort) ? (sort as SortKey) : 'nieuwste',
  }
}

export function rememberView(view: Partial<ListView>) {
  if (view.sort !== undefined) write(() => localStorage, SORT_KEY, view.sort)
  if (view.query !== undefined) write(() => sessionStorage, QUERY_KEY, view.query)
  if (view.filter !== undefined) write(() => sessionStorage, FILTER_KEY, view.filter)
}

export function matchesFilter(house: House, filter: Filter): boolean {
  if (filter === 'alle') return true
  if (filter === 'actief') return house.status !== 'afgevallen'
  if (filter === 'favoriet') return house.favoriet
  return house.status === filter
}

export function visibleHouses(houses: House[], view: ListView): House[] {
  return sortHouses(
    houses.filter((h) => matchesSearch(h, view.query) && matchesFilter(h, view.filter)),
    view.sort,
  )
}

/** The houses before and after this one on the home page. A house the search or filter hides
 * (one that just fell off, or one opened from a link) gets its neighbours among all houses. */
export function neighbours(houses: House[], view: ListView, id: string): { prev: House | null; next: House | null } {
  let list = visibleHouses(houses, view)
  if (!list.some((h) => h.id === id)) list = sortHouses(houses, view.sort)
  const at = list.findIndex((h) => h.id === id)
  if (at < 0) return { prev: null, next: null }
  return { prev: list[at - 1] ?? null, next: list[at + 1] ?? null }
}
