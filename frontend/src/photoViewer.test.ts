import { describe, expect, it } from 'vitest'
import { clampView, fitBox, MAX_SCALE, zoomAt } from './PhotoViewer'

describe('photo viewer', () => {
  const box = fitBox(400, 800, 1600, 800)

  it('fits the photo inside the screen, centred', () => {
    expect(box).toEqual({ x: 0, y: 300, w: 400, h: 200 })
  })

  it('keeps the spot under the fingers in place when zooming', () => {
    const v = zoomAt({ s: 1, x: 0, y: 0 }, box, 2, 100, 400)
    // The photo point that was at (100, 400) is still there.
    expect(box.x + v.x + ((100 - box.x) / 1) * 2).toBe(100)
    expect(box.y + v.y + (400 - box.y) * 2).toBe(400)
  })

  it('never shows an empty edge beside a zoomed photo, and centres a small one', () => {
    const v = clampView({ s: 2, x: 500, y: 0 }, box, 400, 800)
    expect(v.x + 0).toBe(0)
    // 400 high now, still smaller than the screen: centred.
    expect(box.y + v.y).toBe(200)
    expect(clampView({ s: 9, x: 0, y: 0 }, box, 400, 800).s).toBe(MAX_SCALE)
    expect(clampView({ s: 0.5, x: 30, y: 30 }, box, 400, 800)).toMatchObject({ s: 1 })
  })
})
