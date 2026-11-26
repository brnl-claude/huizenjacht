/** A short viewing: whether the quick list is on, how long the viewing is and its timer. */

import { QUICK_MINUTES } from './checklist'

const QUICK = 'huizenjacht.snel'
const MINUTES = 'huizenjacht.snelMinuten'
const started = (houseId: string) => `huizenjacht.bezichtiging.${houseId}`

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode: the choice lasts until the page reloads.
  }
}

export const quickOn = () => read(QUICK) === '1'
export const setQuickOn = (on: boolean) => write(QUICK, on ? '1' : null)

export function quickMinutes(): number {
  const n = Number(read(MINUTES))
  return QUICK_MINUTES.includes(n) ? n : 30
}
export const setQuickMinutes = (minutes: number) => write(MINUTES, String(minutes))

/** When the viewing of this house started on this device, in ms, or null. */
export function viewingStart(houseId: string): number | null {
  const n = Number(read(started(houseId)))
  return n > 0 ? n : null
}
export const setViewingStart = (houseId: string, at: number | null) =>
  write(started(houseId), at === null ? null : String(at))

/** "nog 12 min", "nog 1 min" or "3 min over tijd". */
export function timeLeft(start: number, minutes: number, now: number): { text: string; over: boolean } {
  const left = start + minutes * 60_000 - now
  if (left >= 0) return { text: `nog ${Math.max(1, Math.ceil(left / 60_000))} min`, over: false }
  return { text: `${Math.max(1, Math.floor(-left / 60_000))} min over tijd`, over: true }
}
