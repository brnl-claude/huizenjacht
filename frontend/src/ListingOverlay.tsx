import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Images, Newspaper, RefreshCw, X } from 'lucide-react'
import { api } from './api'
import { displayAddress, photoUrls, type House } from './house'
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
                  ? `${listing.message} De app probeert het later vanzelf opnieuw.`
                  : listing?.status === 'error'
                    ? listing.message
                    : 'De app haalt de advertentie op de achtergrond op.'}
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
                  <img src={src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          ) : (
            <div className="viewer">
              <img src={photos[photo]} alt={`Foto ${photo + 1} van ${photos.length}`} />
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
