import { describe, expect, it } from 'vitest'
import { bookmarkletCode, isFundaListing } from './Bookmarklet'

describe('bookmarklet', () => {
  it('only accepts house pages on funda.nl', () => {
    expect(isFundaListing('https://www.funda.nl/detail/koop/lathum/huis-laan-1/80985930/')).toBe(true)
    expect(isFundaListing('https://www.funda.nl/koop/lathum/huis-42123456-laan-1/')).toBe(true)
    expect(isFundaListing('https://example.com/detail/koop/lathum/huis-laan-1/80985930/')).toBe(false)
    expect(isFundaListing('https://www.funda.nl.example.com/detail/koop/x/huis-y/1/')).toBe(false)
    expect(isFundaListing('https://www.funda.nl/zoeken/koop?selected_area=lathum')).toBe(false)
    expect(isFundaListing('javascript:alert(1)')).toBe(false)
  })

  it('checks the site before it sends anything', () => {
    const code = bookmarkletCode('https://huizen.example', 'sleutel')
    expect(code.indexOf('funda')).toBeLessThan(code.indexOf('fetch('))
    // The code must be valid JavaScript, regular expressions included.
    expect(() => new Function(code.replace(/^javascript:/, ''))).not.toThrow()
    expect(code).toContain(String.raw`(^|\.)funda\.nl$`)
  })
})
