import { navigate } from './nav'
import { useEffect, useRef, useState } from 'react'
import { Bookmark, Check, Copy, Download, RotateCcw } from 'lucide-react'
import { api, ApiError } from './api'
import { displayAddress, type House } from './house'
import { errorText, useStore } from './store'

/*
 * Funda shows servers a captcha, so the app cannot fetch a listing itself. The bookmarklet
 * takes the page as Bram's browser shows it and posts it, with a secret token, to
 * /api/bookmarklet/page in the background. When the site blocks that request, it opens
 * #/ontvang in this app instead and hands the page over with postMessage; there the app saves
 * it only after Bram confirms, so another site cannot slip a page in.
 */

type Page = {
  type: 'huizenjacht-page'
  url: string
  html: string
  photos?: string
  v?: number
}

/**
 * Raise together with BOOKMARKLET_VERSION in backend/app/main.py whenever the code below
 * changes: the server and #/ontvang refuse a bookmarklet with another version.
 */
export const BOOKMARKLET_VERSION = 3
const OUTDATED = 'Deze bladwijzer is verouderd. Zet hem opnieuw neer via Instellingen → Bladwijzer.'

export function bookmarkletCode(origin: string, token: string): string {
  const app = JSON.stringify(origin)
  const key = JSON.stringify(token)
  // Sends the page in the background and shows a note on the page itself. Only when the site
  // blocks that request does it fall back to opening Huizenjacht in a new tab.
  return (
    `javascript:(()=>{const a=${app},k=${key},here=document.documentElement.outerHTML;` +
    `const e=document.createElement('div');` +
    `e.style.cssText='position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:380px;padding:12px 16px;border-radius:10px;font:15px/1.4 system-ui,sans-serif;color:#fff;background:#2b2b2b;box-shadow:0 6px 24px rgba(0,0,0,.3)';` +
    `const say=(m,bad,h,t)=>{e.textContent='Huizenjacht: '+m;e.style.background=bad?'#c0392b':'#2b2b2b';` +
    `if(h){const l=document.createElement('a');l.href=h;l.target='_blank';l.textContent=t;` +
    `l.style.cssText='color:#f7a100;font-weight:700;margin-left:8px';e.append(l)}};` +
    `document.body.append(e);` +
    `if(!/(^|\\.)funda\\.nl$/i.test(location.hostname)||!/^(\\/en)?\\/(detail\\/)?(koop|huur)\\/[^/]+\\/[^/]+/i.test(location.pathname)){` +
    `say('de bladwijzer werkt alleen op een huis op funda.nl. Open eerst een advertentie.',true);setTimeout(()=>e.remove(),8000);return}` +
    `say('bezig met opslaan…');` +
    // The listing shows only a few photos; its photo page (/media/fotos/) has them all. The
    // bookmarklet works on either and fetches the other one itself, from the same site.
    `const p=location.pathname.match(/^(.*?\\/\\d{6,10})(\\/|$)/),onMedia=!!p&&/^\\/media(\\/|$)/.test(location.pathname.slice(p[1].length)),` +
    `base=p?location.origin+p[1]+'/':location.href,` +
    `get=u=>fetch(u,{credentials:'include'}).then(r=>r.ok?r.text():'').catch(()=>'');` +
    `(p?get(onMedia?base:base+'media/fotos/'):Promise.resolve('')).then(o=>{` +
    `const d={v:${BOOKMARKLET_VERSION},token:k,url:onMedia?base:location.href,html:onMedia?o||here:here,photos:onMedia?here:o};` +
    `fetch(a+'/api/bookmarklet/page',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(d)})` +
    `.then(r=>r.json().then(j=>{say(j.message,!r.ok,r.ok&&j.house?a+'/#/huis/'+encodeURIComponent(j.house):j.outdated?a+'/#/instellingen/bladwijzer':0,r.ok?'Bekijk':'Bijwerken');setTimeout(()=>e.remove(),r.ok?6000:12000)}))` +
    `.catch(()=>{say('deze site houdt het versturen tegen, Huizenjacht opent in een nieuw tabblad.',true);` +
    `const w=window.open(a+'/#/ontvang','huizenjacht');if(!w)return;` +
    `const f=v=>{if(v.source===w&&v.origin===a&&v.data&&v.data.type==='huizenjacht-ready'){` +
    `w.postMessage({type:'huizenjacht-page',v:d.v,url:d.url,html:d.html,photos:d.photos},a);removeEventListener('message',f)}};addEventListener('message',f)})})})()`
  )
}

/** A house page on funda.nl; the server checks the same. */
export function isFundaListing(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      /^https?:$/.test(u.protocol) &&
      /(^|\.)funda\.nl$/i.test(u.hostname) &&
      /^(\/en)?\/(detail\/)?(koop|huur)\/[^/]+\/[^/]+/i.test(u.pathname)
    )
  } catch {
    return false
  }
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
      setPage({
        type: d.type,
        url: d.url,
        html: d.html,
        photos: typeof d.photos === 'string' ? d.photos : undefined,
        v: typeof d.v === 'number' ? d.v : undefined,
      })
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
      const id = target
      const record = await api.importListing(id, page.url, page.html, page.photos)
      replace(record)
      if (record.listing?.status !== 'ok') {
        setError(record.listing?.message ?? 'De pagina kon niet worden opgeslagen.')
        return
      }
      notify('Advertentie opgeslagen.', 'info')
      navigate(`#/huis/${encodeURIComponent(id)}`)
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
            Zet de bladwijzer eerst in je browser via <a href="#/instellingen/bladwijzer">Instellingen → Bladwijzer</a>,
            open dan een huis op Funda en klik erop.
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

  if (page.v !== BOOKMARKLET_VERSION) {
    return (
      <div className="page narrow">
        <h1>Advertentie ontvangen</h1>
        <section className="panel receive">
          <div className="notice notice-error">
            {OUTDATED} <a href="#/instellingen/bladwijzer">Naar de bladwijzer</a>
          </div>
        </section>
      </div>
    )
  }

  if (!isFundaListing(page.url)) {
    return (
      <div className="page narrow">
        <h1>Advertentie ontvangen</h1>
        <section className="panel receive">
          <p className="muted small">Van {host}</p>
          <h2>{title || page.url}</h2>
          <div className="notice notice-error">
            De bladwijzer werkt alleen op een huis op funda.nl. Deze pagina is niet opgeslagen.
          </div>
        </section>
      </div>
    )
  }

  if (!match) {
    return (
      <div className="page narrow">
        <h1>Advertentie ontvangen</h1>
        <section className="panel receive">
          <p className="muted small">Van {host}</p>
          <h2>{title || page.url}</h2>
          <div className="notice notice-error">
            Dit huis staat nog niet in Huizenjacht. Huizen komen erin via de rapporten; daarna kun je de advertentie
            hier opslaan.
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="page narrow">
      <h1>Advertentie ontvangen</h1>
      <section className="panel receive">
        <p className="muted small">Van {host}</p>
        <h2>{title || page.url}</h2>
        <label className="field">
          <span>Opslaan bij</span>
          <select value={target} onChange={(e) => setChoice(e.target.value)}>
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {displayAddress(h)}
                {h.plaats ? `, ${h.plaats}` : ''}
                {h.id === match.id ? ' (zelfde advertentie)' : ''}
              </option>
            ))}
          </select>
        </label>
        {error && <div className="notice notice-error">{error}</div>}
        <div className="row">
          <button className="btn btn-primary" disabled={!target || busy} onClick={() => void save()}>
            <Download size={16} /> {busy ? 'Bezig met opslaan…' : 'Opslaan in Huizenjacht'}
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
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const code = token ? bookmarkletCode(location.origin, token) : ''
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api
      .bookmarklet()
      .then((r) => setToken(r.token))
      .catch((e) => setError(errorText(e)))
  }, [])

  // React refuses javascript: addresses in href, so it is set on the element itself.
  useEffect(() => {
    if (code) link.current?.setAttribute('href', code)
  }, [code])

  if (error) return <div className="notice notice-error">{error}</div>
  if (!token) return <p className="muted">Laden…</p>

  return (
    <>
      <section className="panel">
        <h2>Advertenties naar Huizenjacht sturen</h2>
        <p>
          Funda laat de app de advertenties niet zelf ophalen: servers krijgen een captcha. Met deze bladwijzer stuur je
          de pagina die jij op Funda ziet op de achtergrond naar Huizenjacht, met alle foto's van de advertentie. Je
          blijft gewoon op Funda.
        </p>
        <ol className="steps">
          <li>
            Sleep deze knop naar je bladwijzerbalk:{' '}
            <a ref={link} className="btn btn-primary bookmarklet" onClick={(e) => e.preventDefault()} draggable>
              <Bookmark size={16} /> Naar Huizenjacht
            </a>
          </li>
          <li>Open een huis op Funda en klik op de bladwijzer.</li>
          <li>
            Rechtsonder op de pagina zie je of het gelukt is. Het huis wordt herkend aan het Funda-nummer. De bladwijzer
            werkt alleen op Funda en alleen voor huizen die al in de app staan; nieuwe huizen komen erin via de
            rapporten.
          </li>
        </ol>
        <p className="muted small">
          De bladwijzer bevat een eigen sleutel, zodat alleen jij pagina's naar je app kunt sturen. Deel hem dus niet.
          Op een telefoon maak je een bladwijzer met de code hieronder als adres. Dit is versie {BOOKMARKLET_VERSION};
          zegt de bladwijzer op Funda dat hij verouderd is, zet hem dan hier opnieuw neer.
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
        </button>{' '}
        <button
          className="btn btn-ghost"
          onClick={async () => {
            if (!confirm('Een nieuwe sleutel maken? De bladwijzer die je nu hebt, werkt daarna niet meer.')) return
            setToken((await api.bookmarkletRotate()).token)
            setCopied(false)
          }}
        >
          <RotateCcw size={16} /> Nieuwe sleutel
        </button>
      </section>
    </>
  )
}
