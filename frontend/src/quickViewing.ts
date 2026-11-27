/** A short viewing: whether the quick list is on and how long the viewing is. */

import { QUICK_MINUTES } from './checklist'

const QUICK = 'huizenjacht.snel'
const MINUTES = 'huizenjacht.snelMinuten'

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
