import type { StorageCategory, StorageUsage } from './api'

/** The categories in the order the bar and the list show them. */
export const STORAGE_CATEGORIES: { id: StorageCategory; label: string; unit: [string, string] }[] = [
  { id: 'fotos', label: "Foto's", unit: ['foto', "foto's"] },
  { id: 'videos', label: "Video's", unit: ['video', "video's"] },
  { id: 'memos', label: 'Spraakmemo’s', unit: ['memo', 'memo’s'] },
  { id: 'documenten', label: 'Documenten', unit: ['document', 'documenten'] },
  { id: 'advertenties', label: 'Advertenties', unit: ['foto', "foto's"] },
  { id: 'gegevens', label: 'Gegevens', unit: ['huis', 'huizen'] },
]

/** 0 B, 812 kB, 4,2 MB, 1,25 GB: decimal units, as phones and file managers show them. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  const shown = value.toLocaleString('nl-NL', { maximumFractionDigits: digits })
  return `${shown} ${units[unit]}`
}

export function countText(count: number, [one, many]: [string, string]): string {
  return `${count.toLocaleString('nl-NL')} ${count === 1 ? one : many}`
}

/** Share of the total per category, in percent, for the bar. Tiny but present ones get a sliver. */
export function storageShares(usage: StorageUsage): { id: StorageCategory; percent: number }[] {
  if (usage.total <= 0) return []
  return STORAGE_CATEGORIES.filter((c) => usage.categories[c.id].bytes > 0).map((c) => ({
    id: c.id,
    percent: Math.max(0.8, (usage.categories[c.id].bytes / usage.total) * 100),
  }))
}

/** What the media and documents add to a backup: everything but the database itself. */
export function filesBytes(usage: StorageUsage): number {
  return usage.total - usage.categories.gegevens.bytes
}
