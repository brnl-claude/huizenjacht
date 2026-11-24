import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, ExternalLink, Images, Newspaper, RefreshCw, X } from 'lucide-react'
import { api } from './api'
import { displayAddress, photoUrls, type House, type Listing } from './house'
import { errorText, useStore } from './store'

/** A link that opens the overlay on a plain click, and stays a real link for Ctrl/Cmd/Shift
 * click and the middle button (those open a new tab or window as usual). */
export function overlayClick(open: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    open()
  }
}

type Tab = 'advertentie' | 'fotos'

function when(stamp: string) {
  return new Date(stamp).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** How the last fetch of the listing went, with a retry, so a failure is never silent. */
function ListingStatus({
  houseId,
  listing,
  busy,
  onRefresh,
}: {
  houseId: string
  listing: Listing
  busy: boolean
  onRefresh: () => void
}) {
  const failed = listing.status !== 'ok'
  const raw = `/api/houses/${encodeURIComponent(houseId)}/listing/raw`
  const photos = listing.photos === 1 ? '1 foto' : `${listing.photos} foto's`
  return (
    <div className={`overlay-status${failed ? ' failed' : listing.message ? ' warn' : ''}`} role={failed ? 'alert' : 'status'}>
      {(failed || listing.message) && <AlertTriangle size={16} aria-hidden="true" />}
      <span className="overlay-status-text">
        {failed
          ? `Ophalen mislukt (${when(listing.fetchedAt)}): ${listing.message ?? 'onbekende fout'}`
          : `Opgehaald ${when(listing.fetchedAt)} · ${photos}${listing.message ? ` · ${listing.message}` : ''}`}
        {failed && listing.hasPage && ' Je ziet de vorige kopie.'}
      </span>
      {(failed || listing.message) && (
        <a className="overlay-status-link" href={raw} download>
          <Download size={14} /> Wat de site stuurde
        </a>
      )}
      <button className="btn btn-small btn-ghost" disabled={busy} onClick={onRefresh}>
        <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? 'Bezig…' : 'Opnieuw ophalen'}
      </button>
    </div>
  )
}

export function ListingOverlay({
  house,
  initialTab = 'advertentie',
  initialPhoto = 0,
  onClose,
}: {
  house: House
  initialTab?: Tab
  initialPhoto?: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const { replace, notify } = useStore()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [photo, setPhoto] = useState<number | null>(initialTab === 'fotos' ? initialPhoto : null)
  const [busy, setBusy] = useState(false)
  const listing = house.record.listing
  const photos = photoUrls(house)
  const url = house.url!

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal?.()
  }, [])

  useEffect(() => {
    if (photo === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPhoto((p) => ((p ?? 0) + 1) % photos.length)
      if (e.key === 'ArrowLeft') setPhoto((p) => ((p ?? 0) - 1 + photos.length) % photos.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photo, photos.length])

  async function refresh() {
    setBusy(true)
    try {
      replace(await api.refreshListing(house.id))
    } catch (e) {
      notify(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const record = await api.importListing(house.id, url, await file.text())
      replace(record)
      if (record.listing?.status !== 'ok') notify(record.listing?.message ?? 'Dit is geen advertentie.', 'error')
    } catch (e) {
      notify(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return 'de site'
    }
  })()

  return (
    <dialog ref={ref} className="overlay" onClose={onClose} onCancel={onClose} aria-label="Advertentie">
      <header className="overlay-head">
        <div className="overlay-title">
          <b>{displayAddress(house)}</b>
          <span className="muted small">{host}</span>
        </div>
        <div className="segmented overlay-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'advertentie'} className={tab === 'advertentie' ? 'on' : ''} onClick={() => setTab('advertentie')}>
            <Newspaper size={16} /> Advertentie
          </button>
          <button role="tab" aria-selected={tab === 'fotos'} className={tab === 'fotos' ? 'on' : ''} onClick={() => setTab('fotos')}>
            <Images size={16} /> Foto's {photos.length > 0 && <span className="muted">{photos.length}</span>}
          </button>
        </div>
        <a className="btn btn-small btn-primary" href={url} target="_blank" rel="noreferrer">
          <ExternalLink size={16} /> <span className="hide-small">Open in nieuw tabblad</span>
        </a>
        <button className="icon-btn" aria-label="Sluiten" onClick={() => ref.current?.close()}>
          <X size={22} />
        </button>
      </header>

      {listing && <ListingStatus houseId={house.id} listing={listing} busy={busy} onRefresh={() => void refresh()} />}

      <div className="overlay-body">
        {tab === 'advertentie' &&
          (listing?.hasPage ? (
            <iframe
              className="overlay-frame"
              title={`Advertentie ${displayAddress(house)}`}
              src={`/api/houses/${encodeURIComponent(house.id)}/listing/page?v=${encodeURIComponent(listing.fetchedAt)}`}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="overlay-empty">
              <Newspaper size={40} />
              <h2>Nog geen kopie van de advertentie</h2>
              <p className="muted">
                {listing?.status === 'blocked'
                  ? 'Funda laat de app de advertentie niet zelf ophalen.'
                  : listing?.status === 'error'
                    ? listing.message
                    : 'De app probeert de advertentie op de achtergrond op te halen.'}
              </p>
              <p className="overlay-hint">
                Open de advertentie op {host} en klik daar op je bladwijzer <b>Naar Huizenjacht</b>.{' '}
                <a href="#/instellingen/bladwijzer" onClick={() => ref.current?.close()}>
                  Bladwijzer instellen
                </a>
                <br />
                Of sla de pagina op met Ctrl+S en{' '}
                <label className="link-button">
                  upload het bestand
                  <input type="file" accept=".html,.htm,text/html" hidden onChange={(e) => void upload(e.target.files?.[0])} />
                </label>
                .
              </p>
              <div className="row">
                <button className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>
                  <RefreshCw size={16} className={busy ? 'spin' : ''} /> Nu ophalen
                </button>
                <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Open op {host}
                </a>
              </div>
            </div>
          ))}

        {tab === 'fotos' &&
          (photos.length === 0 ? (
            <div className="overlay-empty">
              <Images size={40} />
              <h2>Nog geen foto's</h2>
              <p className="muted">Ze komen mee zodra de advertentie is opgehaald.</p>
              <button className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw size={16} className={busy ? 'spin' : ''} /> Nu ophalen
              </button>
            </div>
          ) : photo === null ? (
            <div className="gallery">
              {photos.map((src, i) => (
                <button key={src} className="gallery-item" onClick={() => setPhoto(i)} aria-label={`Foto ${i + 1}`}>
                  <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          ) : (
            <div className="viewer">
              <img src={photos[photo]} referrerPolicy="no-referrer" alt={`Foto ${photo + 1} van ${photos.length}`} />
              <button className="viewer-nav prev" aria-label="Vorige foto" onClick={() => setPhoto((photo - 1 + photos.length) % photos.length)}>
                <ChevronLeft size={28} />
              </button>
              <button className="viewer-nav next" aria-label="Volgende foto" onClick={() => setPhoto((photo + 1) % photos.length)}>
                <ChevronRight size={28} />
              </button>
              <div className="viewer-bar">
                <button className="btn btn-small btn-ghost" onClick={() => setPhoto(null)}>
                  Alle foto's
                </button>
                <span>
                  {photo + 1} / {photos.length}
                </span>
              </div>
            </div>
          ))}
      </div>
    </dialog>
  )
}
