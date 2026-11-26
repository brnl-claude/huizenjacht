import { describe, expect, it } from 'vitest'
// The backend's source, to check that both sides agree on the version.
import backend from '../../backend/app/main.py?raw'
import { BOOKMARKLET_VERSION, bookmarkletCode, isFundaListing } from './Bookmarklet'

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

  it('sends the same version the server expects', () => {
    expect(backend).toContain(`BOOKMARKLET_VERSION = ${BOOKMARKLET_VERSION}\n`)
    expect(bookmarkletCode('https://huizen.example', 'sleutel')).toContain(`{v:${BOOKMARKLET_VERSION},token:k,`)
  })
})

/** Runs the bookmarklet on a fake Funda page and returns what it posts to the app. */
async function run(path: string): Promise<Record<string, string>> {
  const posted: Record<string, string>[] = []
  const location = {
    hostname: 'www.funda.nl',
    pathname: path,
    origin: 'https://www.funda.nl',
    href: 'https://www.funda.nl' + path,
  }
  const el = {
    style: {},
    append: () => undefined,
    remove: () => undefined,
    textContent: '',
  }
  const document = {
    documentElement: { outerHTML: '<html>deze pagina</html>' },
    createElement: () => ({ ...el }),
    body: { append: () => undefined },
  }
  const fetch = async (url: string, init?: { body?: string }) => {
    if (url.startsWith('https://huizen.example')) {
      posted.push(JSON.parse(init!.body!))
      return { ok: true, json: async () => ({ message: 'ok', house: 'h' }) }
    }
    return { ok: true, text: async () => `<html>opgehaald ${url}</html>` }
  }
  const code = bookmarkletCode('https://huizen.example', 'sleutel').replace(/^javascript:/, '')
  new Function('location', 'document', 'fetch', 'setTimeout', code)(location, document, fetch, () => 0)
  for (let i = 0; i < 20 && !posted.length; i++) await new Promise((r) => globalThis.setTimeout(r, 1))
  return posted[0]
}

describe('bookmarklet photos', () => {
  const base = '/detail/koop/velp-ge/huis-laan-45/44544340/'

  it('fetches the photo page along with the listing', async () => {
    const sent = await run(base)
    expect(sent.url).toBe('https://www.funda.nl' + base)
    expect(sent.html).toBe('<html>deze pagina</html>')
    expect(sent.photos).toBe(`<html>opgehaald https://www.funda.nl${base}media/fotos/</html>`)
  })

  it('fetches the listing when it runs on the photo page', async () => {
    const sent = await run(base + 'media/fotos/')
    expect(sent.url).toBe('https://www.funda.nl' + base)
    expect(sent.html).toBe(`<html>opgehaald https://www.funda.nl${base}</html>`)
    expect(sent.photos).toBe('<html>deze pagina</html>')
  })
})
