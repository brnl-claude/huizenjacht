import { describe, expect, it } from 'vitest'
import { documentKind } from './DocumentViewer'
import { isTabSwipe } from './HousePage'

describe('documentKind', () => {
  it('knows what the viewer can show', () => {
    expect(documentKind('Meetrapport.PDF')).toBe('pdf')
    expect(documentKind('plattegrond.jpeg')).toBe('image')
    expect(documentKind('notities.txt')).toBe('text')
    expect(documentKind('vragenlijst.docx')).toBe('other')
    // SVG only downloads: the server never serves it inline.
    expect(documentKind('tekening.svg')).toBe('other')
    expect(documentKind(undefined)).toBe('other')
  })
})

describe('isTabSwipe', () => {
  it('takes a quick sideways stroke', () => {
    expect(isTabSwipe(-120, 10, 200)).toBe(true)
    expect(isTabSwipe(120, -30, 300)).toBe(true)
  })
  it('ignores scrolling, short strokes and slow drags', () => {
    expect(isTabSwipe(-80, 200, 200)).toBe(false)
    expect(isTabSwipe(-40, 0, 100)).toBe(false)
    expect(isTabSwipe(-150, 0, 1500)).toBe(false)
  })
})
