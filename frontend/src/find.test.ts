import { describe, expect, it } from 'vitest'
import { findOffsets, fold, foldQuery } from './find'

describe('fold', () => {
  it('ignores case and accents and keeps the length', () => {
    expect(fold('Café ÉÉN')).toBe('cafe een')
    expect(fold('Café ÉÉN')).toHaveLength('Café ÉÉN'.length)
  })
})

describe('foldQuery', () => {
  it('trims and collapses white space', () => {
    expect(foldQuery('  Grote\n  Tuin ')).toBe('grote tuin')
  })
})

describe('findOffsets', () => {
  it('finds every match without overlap', () => {
    expect(findOffsets('aaaa', 'aa')).toEqual([0, 2])
    expect(findOffsets(fold('Dak, dakgoot en DAKKAPEL'), foldQuery('dak'))).toEqual([0, 5, 16])
  })

  it('finds nothing for an empty query', () => {
    expect(findOffsets('tuin', '')).toEqual([])
  })
})
