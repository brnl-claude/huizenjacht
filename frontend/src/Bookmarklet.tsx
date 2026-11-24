import { useEffect, useRef, useState } from 'react'
import { Bookmark, Check, Copy, Download, Plus } from 'lucide-react'
import { api, ApiError } from './api'
import { displayAddress, type House } from './house'
import { errorText, useStore } from './store'

/*
 * Funda shows servers a captcha, so the app cannot fetch a listing itself. The bookmarklet
 * takes the page as Bram's browser shows it: it opens #/ontvang in this app and hands the page
 * over with postMessage. The app saves it only after Bram confirms, so another site cannot
 * slip a page in.
 */

type Page = { type: 'huizenjacht-page'; url: string; html: string }

export function bookmarkletCode(origin: string): string {
  const app = JSON.stringify(origin)
  return (
    `javascript:(()=>{const a=${app};const w=window.open(a+'/#/ontvang','huizenjacht');` +
    `if(!w){alert('Sta pop-ups toe voor deze site om naar Huizenjacht te sturen.');return}` +
    `const d={type:'huizenjacht-page',url:location.href,html:document.documentElement.outerHTML};` +
    `const f=e=>{if(e.source===w&&e.origin===a&&e.data&&e.data.type==='huizenjacht-ready'){` +
    `w.postMessage(d,a);removeEventListener('message',f)}};addEventListener('message',f)})()`
  )
}

/** The Funda number in an address such as /detail/koop/lathum/huis-x/80985930/. */
function listingKey(url: string): string {
  const id = url.match(/\/(\d{6,10})(?:\/|$|\?)/)
  if (id) return id[1]
  try {
    const u = new URL(url)
    return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/+$/, '').toLowerCase()
  } catch {
    return url
  }
}

export function findHouse(houses: House[], url: string): House | undefined {
  const key = listingKey(url)
  return houses.find((h) => h.url && listingKey(h.url) === key)
}

function pageTitle(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
  return (og || doc.title || '').trim()
}

export function ReceivePage() {
  const { houses, loading, replace, notify } = useStore()
  const [page, setPage] = useState<Page | null>(null)
  const [noOpener] = useState(() => !window.opener)
  const [choice, setChoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const opener = window.opener as Window | null
    if (!opener) return
    const onMessage = (e: MessageEvent) => {
      const d = e.data as Partial<Page> | null
      if (e.source !== opener || !d || d.type !== 'huizenjacht-page') return
      if (typeof d.url !== 'string' || typeof d.html !== 'string' || !/^https?:\/\//.test(d.url)) return
      setPage({ type: d.type, url: d.url, html: d.html })
    }
    window.addEventListener('message', onMessage)
    // Nothing secret in this message, and the opener's address is not known in advance.
    const ready = () => opener.postMessage({ type: 'huizenjacht-ready' }, '*')
    ready()
    const timer = window.setInterval(ready, 500)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(timer)
    }
  }, [])

  const match = page ? findHouse(houses, page.url) : undefined
  const target = choice ?? match?.id ?? ''

  async function save() {
    if (!page) return
    setBusy(true)
    setError(null)
    try {
      let id = target
      if (id === 'nieuw') {
        const created = await api.createHouse({ adres: pageTitle(page.html) || 'Nieuw huis', url: page.url })
        replace(created)
        id = created.id
      }
      const record = await api.importListing(id, page.url, page.html)
      replace(record)
      if (record.listing?.status !== 'ok') {
        setError(record.listing?.message ?? 'De pagina kon niet worden opgeslagen.')
        return
      }
      notify('Advertentie opgeslagen.', 'info')
      location.hash = `#/huis/${encodeURIComponent(id)}`
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (noOpener && !page) {
    return (
      <div className="page narrow">
        <h1>Advertentie ontvangen</h1>
        <section className="panel">
          <p>Deze pagina ontvangt een advertentie van de bladwijzer "Naar Huizenjacht".</p>
          <p className="muted">
            Zet de bladwijzer eerst in je browser via <a href="#/instellingen/bladwijzer">Instellingen → Bladwijzer</a>, open
            dan een huis op Funda en klik erop.
          </p>
        </section>
      </div>
    )
  }

  if (!page || loading) {
    return (
      <div className="page narrow">
        <h1>Advertentie ontvangen</h1>
        <p className="muted">Wachten op de pagina…</p>
      </div>
    )
  }

  let host = page.url
  try {
    host = new URL(page.url).hostname.replace(/^www\./, '')
  } catch {
    // keep the address
  }
  const title = pageTitle(page.html)

  return (
    <div className="page narrow">
      <h1>Advertentie ontvangen</h1>
      <section className="panel receive">
        <p className="muted small">Van {host}</p>
        <h2>{title || page.url}</h2>
        <label className="field">
          <span>Opslaan bij</span>
          <select value={target} onChange={(e) => setChoice(e.target.value)}>
            {!match && <option value="">Kies een huis…</option>}
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {displayAddress(h)}
                {h.plaats ? `, ${h.plaats}` : ''}
                {h.id === match?.id ? ' (zelfde advertentie)' : ''}
              </option>
            ))}
            <option value="nieuw">+ Nieuw huis met deze advertentie</option>
          </select>
        </label>
        {error && <div className="notice notice-error">{error}</div>}
        <div className="row">
          <button className="btn btn-primary" disabled={!target || busy} onClick={() => void save()}>
            {target === 'nieuw' ? <Plus size={16} /> : <Download size={16} />}{' '}
            {busy ? 'Bezig met opslaan…' : 'Opslaan in Huizenjacht'}
          </button>
        </div>
        <p className="muted small">
          De app bewaart een kopie zonder scripts en haalt de foto's op. Je ziet ze daarna in het advertentievenster.
        </p>
      </section>
    </div>
  )
}

export function BookmarkletPanel() {
  const link = useRef<HTMLAnchorElement>(null)
  const code = bookmarkletCode(location.origin)
  const [copied, setCopied] = useState(false)

  // React refuses javascript: addresses in href, so it is set on the element itself.
  useEffect(() => {
    link.current?.setAttribute('href', code)
  }, [code])

  return (
    <>
      <section className="panel">
        <h2>Advertenties naar Huizenjacht sturen</h2>
        <p>
          Funda laat de app de advertenties niet zelf ophalen: servers krijgen een captcha. Met deze bladwijzer stuur je
          de pagina die jij op Funda ziet naar Huizenjacht, met de foto's.
        </p>
        <ol className="steps">
          <li>
            Sleep deze knop naar je bladwijzerbalk:{' '}
            <a ref={link} className="btn btn-primary bookmarklet" onClick={(e) => e.preventDefault()} draggable>
              <Bookmark size={16} /> Naar Huizenjacht
            </a>
          </li>
          <li>Open een huis op Funda en klik op de bladwijzer.</li>
          <li>Huizenjacht opent in een nieuw tabblad. Kies het huis en klik op Opslaan.</li>
        </ol>
        <p className="muted small">
          Sta pop-ups toe voor funda.nl als je browser het nieuwe tabblad tegenhoudt. Op een telefoon kun je een bladwijzer
          maken met de code hieronder als adres.
        </p>
      </section>
      <section className="panel">
        <h2>Code van de bladwijzer</h2>
        <textarea className="code" readOnly value={code} rows={4} onFocus={(e) => e.currentTarget.select()} />
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(code).catch(() => undefined)
            setCopied(true)
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Gekopieerd' : 'Kopieer code'}
        </button>
      </section>
    </>
  )
}
