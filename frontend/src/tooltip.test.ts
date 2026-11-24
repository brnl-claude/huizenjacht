import { describe, expect, it } from 'vitest'
import { placeTip } from './tooltip'

const viewport = { width: 400, height: 800 }
const tip = { width: 120, height: 30 }

describe('placeTip', () => {
  it('centres the tip above its element', () => {
    const place = placeTip({ left: 150, top: 300, right: 250, bottom: 340 }, tip, viewport)
    expect(place).toEqual({ left: 140, top: 262, side: 'above', arrow: 60 })
  })

  it('goes below an element at the top of the screen', () => {
    const place = placeTip({ left: 150, top: 10, right: 250, bottom: 50 }, tip, viewport)
    expect(place.side).toBe('below')
    expect(place.top).toBe(58)
  })

  it('stays above when there is no room below either', () => {
    const place = placeTip({ left: 150, top: 10, right: 250, bottom: 790 }, tip, viewport)
    expect(place.side).toBe('above')
    expect(place.top).toBe(8)
  })

  it('stays on screen next to an edge, with the arrow still on the element', () => {
    const right = placeTip({ left: 360, top: 300, right: 400, bottom: 340 }, tip, viewport)
    expect(right.left).toBe(272)
    expect(right.arrow).toBe(106)
    const left = placeTip({ left: 0, top: 300, right: 40, bottom: 340 }, tip, viewport)
    expect(left.left).toBe(8)
    expect(left.arrow).toBe(14)
  })

  it('keeps a tip wider than the screen at the left margin', () => {
    const place = placeTip(
      { left: 150, top: 300, right: 250, bottom: 340 },
      { width: 500, height: 30 },
      viewport,
    )
    expect(place.left).toBe(8)
  })
})
