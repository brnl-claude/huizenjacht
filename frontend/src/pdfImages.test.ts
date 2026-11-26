import { describe, expect, it } from 'vitest'
import { tilesAround, worldPixel } from './pdfImages'

describe('map tiles', () => {
  it('puts a point where OpenStreetMap has it', () => {
    // Delft, zoom 15: tile 16779/10821 (see openstreetmap.org/#map=15/52.0136/4.3481).
    const p = worldPixel(52.0136, 4.3481, 15)
    expect(Math.floor(p.x / 256)).toBe(16779)
    expect(Math.floor(p.y / 256)).toBe(10821)
  })

  it('covers the whole map with tiles', () => {
    const tiles = tilesAround(52.0136, 4.3481, 15, 300, 200)
    for (const corner of [[0, 0], [299, 0], [0, 199], [299, 199]]) {
      expect(tiles.some((t) => t.dx <= corner[0] && corner[0] < t.dx + 256 && t.dy <= corner[1] && corner[1] < t.dy + 256)).toBe(true)
    }
    expect(tiles.length).toBeLessThanOrEqual(6)
  })
})
