import { describe, expect, it } from 'vitest'
import type { StorageUsage } from './api'
import { countText, filesBytes, formatBytes, storageShares } from './storage'

const usage = (bytes: Partial<Record<keyof StorageUsage['categories'], number>>): StorageUsage => {
  const categories = Object.fromEntries(
    ['fotos', 'videos', 'memos', 'documenten', 'advertenties', 'gegevens'].map((k) => [
      k,
      { bytes: bytes[k as keyof typeof bytes] ?? 0, count: 1 },
    ]),
  ) as StorageUsage['categories']
  return { categories, total: Object.values(bytes).reduce((a, b) => a + (b ?? 0), 0), disk: null }
}

describe('storage', () => {
  it('formats bytes the Dutch way', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(812_000)).toBe('812 kB')
    expect(formatBytes(4_200_000)).toBe('4,2 MB')
    expect(formatBytes(1_250_000_000)).toBe('1,25 GB')
  })

  it('counts one or many', () => {
    expect(countText(1, ['foto', "foto's"])).toBe('1 foto')
    expect(countText(1200, ['foto', "foto's"])).toBe("1.200 foto's")
  })

  it('splits the bar and leaves out empty categories', () => {
    const shares = storageShares(usage({ fotos: 750, videos: 250, gegevens: 0 }))
    expect(shares).toEqual([
      { id: 'fotos', percent: 75 },
      { id: 'videos', percent: 25 },
    ])
    expect(storageShares(usage({ fotos: 100_000, gegevens: 1 }))[1].percent).toBe(0.8)
    expect(storageShares(usage({}))).toEqual([])
  })

  it('knows what the files add to a backup', () => {
    expect(filesBytes(usage({ fotos: 10, gegevens: 5 }))).toBe(10)
  })
})
