/**
 * Changes to houses (checklist, grade, notes, status, ...) that the server does not have yet.
 * They wait in this browser (localStorage) until a request gets through, so answers given
 * during a viewing without signal are not lost, and go out one at a time, in order, so a
 * later change never loses to an earlier one that arrived late.
 */

import { PERSONAL, type HouseRecord, type Mine } from './house'

export type Changes = Record<string, unknown>
/** House id → field → value; null removes the field. */
export type PendingChanges = Record<string, Changes>

const KEY = 'hj.pendingChanges'

export function loadPending(): PendingChanges {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function savePending(all: PendingChanges): void {
  try {
    if (Object.keys(all).length) localStorage.setItem(KEY, JSON.stringify(all))
    else localStorage.removeItem(KEY)
  } catch {
    // only kept in memory
  }
}

/** Adds changes to what already waits for this house; the newest value of a field wins. */
export function addPending(all: PendingChanges, id: string, changes: Changes): PendingChanges {
  return { ...all, [id]: { ...all[id], ...changes } }
}

/** Removes what the server now has: the fields still holding the values that were `sent`. */
export function settlePending(all: PendingChanges, id: string, sent: Changes): PendingChanges {
  const left = { ...all[id] }
  for (const [key, value] of Object.entries(sent)) {
    if (key in left && JSON.stringify(left[key]) === JSON.stringify(value)) delete left[key]
  }
  const next = { ...all }
  if (Object.keys(left).length) next[id] = left
  else delete next[id]
  return next
}

export function dropPending(all: PendingChanges, id: string): PendingChanges {
  if (!(id in all)) return all
  const next = { ...all }
  delete next[id]
  return next
}

/** The house as it will be once the server has the changes: your own answers under `me`. */
export function withPending(record: HouseRecord, changes: Changes | undefined, me: string): HouseRecord {
  if (!changes || !Object.keys(changes).length) return record
  const mine = { ...record.mine } as Record<string, unknown>
  const own = { ...(record.mine.personen?.[me] ?? {}) } as Record<string, unknown>
  for (const [k, v] of Object.entries(changes)) {
    const target = (PERSONAL as readonly string[]).includes(k) ? own : mine
    if (v === null) delete target[k]
    else target[k] = v
  }
  mine.personen = { ...record.mine.personen, [me]: own }
  return { ...record, mine: mine as Mine }
}
