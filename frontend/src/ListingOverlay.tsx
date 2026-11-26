import { useModalDialog } from './nav'
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { AlertTriangle, Download, ExternalLink, Images, Newspaper, RefreshCw, X } from 'lucide-react'
import { api } from './api'
import { displayAddress, photoGalleryUrl, photoUrls, type House, type Listing } from './house'
import { errorText, useStore } from './store'
import { usePinchZoom, ZoomButtons } from './PinchZoom'

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

/** All photos under each other, to scroll through and pinch to zoom; it opens at `start`. */
function PhotoList({ photos, start }: { photos: string[]; start: number }) {
  const { body, content, zoom, zoomTo, handlers } = usePinchZoom()
  const items = useRef<(HTMLDivElement | null)[]>([])
  // Until the person scrolls themselves, keep `start` at the top while the photos above it
  // load and get their real height.
  const pinned = useRef(start > 0)
  const [at, setAt] = useState(start)
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set())

  // Not scrollIntoView: that would also scroll the dialog around the list.
  const toStart = useCallback(() => {
    const item = items.current[start]
    if (item) body.current?.scrollTo({ top: item.offsetTop - 6 })
  }, [body, start])

  // On opening, and again each time a photo got its real height.
  useLayoutEffect(() => {
    if (start > 0 && pinned.current) toStart()
  }, [start, toStart, loaded])

  function onLoad(i: number) {
    setLoaded((s) => new Set(s).add(i))
  }

  function onScroll() {
    const el = body.current
    if (!el) return
    const line = el.getBoundingClientRect().top + el.clientHeight / 3
    const i = items.current.findIndex((item) => item && item.getBoundingClientRect().bottom > line)
    if (i >= 0) setAt(i)
  }

  const release = () => {
    pinned.current = false
  }

  return (
    <div className="photo-list-wrap">
      <div
        ref={body}
        className="photo-list-scroll"
        {...handlers}
        onTouchStart={(e) => {
          release()
          handlers.onTouchStart(e)
        }}
        onWheel={release}
        onKeyDown={release}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Foto's"
      >
        <div ref={content} className="photo-list-content">
          <div className="photo-list" style={{ width: `${zoom * 100}%`, maxWidth: `${zoom * 1000}px` }}>
            {photos.map((src, i) => (
              <div
                key={src}
                ref={(el) => {
                  items.current[i] = el
                }}
                className={`photo-list-item${loaded.has(i) ? '' : ' loading'}`}
              >
                <img
                  src={src}
                  alt={`Foto ${i + 1} van ${photos.length}`}
                  loading={Math.abs(i - start) <= 2 ? 'eager' : 'lazy'}
                  referrerPolicy="no-referrer"
                  onLoad={() => onLoad(i)}
                  onError={() => onLoad(i)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <span className="photo-list-count" aria-live="polite">
        {at + 1} / {photos.length}
      </span>
      <div className="photo-list-zoom">
        <ZoomButtons
          zoom={zoom}
          onZoom={(z) => {
            release()
            zoomTo(z)
          }}
        />
      </div>
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
  const [busy, setBusy] = useState(false)
  const listing = house.record.listing
  const photos = photoUrls(house)
  const url = house.url!

  useModalDialog(ref)

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
        <a className="btn btn-small btn-primary" href={tab === 'fotos' ? photoGalleryUrl(url) : url} target="_blank" rel="noreferrer">
          <ExternalLink size={16} /> <span className="hide-small">Open in nieuw tabblad</span>
        </a>
        <button className="icon-btn" aria-label="Sluiten" onClick={() => ref.current?.close()}>
          <X size={22} />
        </button>
      </header>

      {listing && <ListingStatus houseId={house.id} listing={listing} busy={busy} onRefresh={() => void refresh()} />}

      <div className={`overlay-body${tab === 'fotos' && photos.length > 0 ? ' photos-body' : ''}`}>
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
          ) : (
            <PhotoList photos={photos} start={initialPhoto} />
          ))}
      </div>
    </dialog>
  )
}
