import { useModalDialog } from './nav'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, FileText, Minus, Plus, X } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Document } from './house'

export type DocumentKind = 'pdf' | 'image' | 'text' | 'other'

const IMAGE = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic']
const TEXT = ['txt', 'md', 'csv']

/** What the viewer can do with a document, by its file name (the server only knows the name too). */
export function documentKind(name: string | undefined): DocumentKind {
  const ext = (name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (ext === 'pdf') return 'pdf'
  // SVG would be an image, but the server only offers it as a download (it can hold scripts).
  if (IMAGE.includes(ext)) return 'image'
  if (TEXT.includes(ext)) return 'text'
  return 'other'
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const MIN_ZOOM = ZOOMS[0]
const MAX_ZOOM = ZOOMS[ZOOMS.length - 1]

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** The next step of the − and + buttons, also from a zoom that pinching left between steps. */
export function stepZoom(zoom: number, step: 1 | -1): number {
  const next = step > 0 ? ZOOMS.find((z) => z > zoom + 0.01) : [...ZOOMS].reverse().find((z) => z < zoom - 0.01)
  return next ?? zoom
}

type Pinch = { distance: number; x: number; y: number; zoom: number; factor: number }

function touchDistance(t: React.TouchList): number {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
}

/** A document of a house, shown inside the app instead of downloaded (Android opens a PDF
 * link as a download). PDFs are drawn with pdf.js, page by page as they scroll into view. */
export function DocumentViewer({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinch = useRef<Pinch | null>(null)
  // Where to scroll after a pinch, so the spot between the fingers stays under them.
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const kind = documentKind(doc.bestand ?? doc.url)
  const url = doc.url!

  useModalDialog(ref)

  useLayoutEffect(() => {
    const el = body.current
    if (el && anchor.current) {
      el.scrollLeft = anchor.current.x
      el.scrollTop = anchor.current.y
      anchor.current = null
    }
  }, [zoom])

  const canZoom = kind === 'pdf' || kind === 'image'

  // Pinching only scales the picture while the fingers move (smooth); when they let go the
  // document is drawn again, sharp, at the new size.
  function onTouchStart(e: React.TouchEvent) {
    const el = body.current
    if (!canZoom || !el || e.touches.length !== 2) return
    const box = el.getBoundingClientRect()
    pinch.current = {
      distance: touchDistance(e.touches),
      x: el.scrollLeft + (e.touches[0].clientX + e.touches[1].clientX) / 2 - box.left,
      y: el.scrollTop + (e.touches[0].clientY + e.touches[1].clientY) / 2 - box.top,
      zoom,
      factor: 1,
    }
    if (content.current) content.current.style.transformOrigin = `${pinch.current.x}px ${pinch.current.y}px`
  }
  function onTouchMove(e: React.TouchEvent) {
    const p = pinch.current
    if (!p || e.touches.length !== 2) return
    p.factor = clampZoom((p.zoom * touchDistance(e.touches)) / p.distance) / p.zoom
    if (content.current) content.current.style.transform = `scale(${p.factor})`
  }
  function onTouchEnd(e: React.TouchEvent) {
    const p = pinch.current
    if (!p || e.touches.length >= 2) return
    pinch.current = null
    if (content.current) content.current.style.transform = ''
    const el = body.current
    if (el && Math.abs(p.factor - 1) > 0.02) {
      anchor.current = {
        x: p.x * p.factor - (p.x - el.scrollLeft),
        y: p.y * p.factor - (p.y - el.scrollTop),
      }
      setZoom(Math.round(p.zoom * p.factor * 100) / 100)
    }
  }

  return (
    <dialog ref={ref} className="overlay doc-viewer" onClose={onClose} onCancel={onClose} aria-label={doc.naam}>
      <header className="overlay-head">
        <div className="overlay-title">
          <b>{doc.naam}</b>
          {doc.bestand && !doc.zonderTitel && <span className="muted small">{doc.bestand}</span>}
        </div>
        {canZoom && (
          <div className="doc-zoom" role="group" aria-label="Zoomen">
            <button className="icon-btn" aria-label="Kleiner" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(stepZoom(zoom, -1))}>
              <Minus size={18} />
            </button>
            <span className="doc-zoom-value">{Math.round(zoom * 100)}%</span>
            <button className="icon-btn" aria-label="Groter" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(stepZoom(zoom, 1))}>
              <Plus size={18} />
            </button>
          </div>
        )}
        <a className="icon-btn" href={`${url}?download=1`} aria-label="Downloaden" title="Downloaden">
          <Download size={20} />
        </a>
        <button className="icon-btn" aria-label="Sluiten" onClick={() => ref.current?.close()}>
          <X size={22} />
        </button>
      </header>
      <div
        ref={body}
        className={`overlay-body doc-body${canZoom ? ' can-pinch' : ''}`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div ref={content} className="doc-content">
          {kind === 'pdf' && <PdfView url={url} zoom={zoom} />}
          {kind === 'image' && (
            <div className="doc-image" style={{ width: `${zoom * 100}%` }}>
              <img src={url} alt={doc.naam} />
            </div>
          )}
          {kind === 'text' && <TextView url={url} />}
          {kind === 'other' && <CannotShow url={url} />}
        </div>
      </div>
    </dialog>
  )
}

function CannotShow({ url, error }: { url: string; error?: string }) {
  return (
    <div className="overlay-empty">
      {error ? <AlertTriangle size={40} /> : <FileText size={40} />}
      <h2>{error ? 'Openen lukt niet' : 'Dit bestand kan de app niet tonen'}</h2>
      <p className="muted">{error ?? 'Download het om het in een andere app te openen.'}</p>
      <a className="btn btn-primary" href={`${url}?download=1`}>
        <Download size={16} /> Downloaden
      </a>
    </div>
  )
}

function TextView({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`Het bestand kwam niet (${r.status}).`))))
      .then((t) => current && setText(t))
      .catch((e: unknown) => current && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      current = false
    }
  }, [url])
  if (error) return <CannotShow url={url} error={error} />
  if (text === null) return <div className="doc-loading">Laden…</div>
  return <pre className="doc-text-view">{text}</pre>
}

function PdfView({ url, zoom }: { url: string; zoom: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    let current = true
    let task: { destroy: () => Promise<void> } | null = null
    // pdf.js is large: it only loads when someone opens a PDF.
    Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(async ([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const loading = pdfjs.getDocument({ url })
        task = loading
        if (!current) return void loading.destroy()
        const loaded = await loading.promise
        if (current) setPdf(loaded)
      })
      .catch((e: unknown) => {
        if (current) setError(e instanceof Error && e.name === 'InvalidPDFException' ? 'Dit is geen leesbare PDF.' : 'De PDF kon niet worden geladen.')
      })
    return () => {
      current = false
      void task?.destroy()
    }
  }, [url])

  useEffect(() => {
    // The window's width, not this box's: the box grows with the zoom.
    const el = box.current?.closest<HTMLElement>('.doc-body') ?? box.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Fit the page width at 100%, with a little room on the sides.
  const pageWidth = Math.max(0, Math.round((Math.min(width, 1000) - 24) * zoom))
  return (
    <div className="doc-pdf" ref={box}>
      {error && <CannotShow url={url} error={error} />}
      {!error && !pdf && <div className="doc-loading">PDF laden…</div>}
      {pdf &&
        pageWidth > 0 &&
        Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage key={i} pdf={pdf} number={i + 1} width={pageWidth} />
        ))}
      {pdf && <p className="muted small doc-pages">{pdf.numPages === 1 ? '1 pagina' : `${pdf.numPages} pagina's`}</p>}
    </div>
  )
}

function PdfPage({ pdf, number, width }: { pdf: PDFDocumentProxy; number: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ratio, setRatio] = useState(Math.SQRT2)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const observer = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '800px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: { cancel: () => void } | null = null
    void pdf.getPage(number).then((page) => {
      if (cancelled || !canvas.current) return
      const base = page.getViewport({ scale: 1 })
      setRatio(base.height / base.width)
      // Sharp on a phone screen, without canvases so large that the browser gives up.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const scale = Math.min((width / base.width) * dpr, 4096 / base.width, 4096 / base.height)
      const viewport = page.getViewport({ scale })
      const el = canvas.current
      el.width = Math.floor(viewport.width)
      el.height = Math.floor(viewport.height)
      const render = page.render({ canvas: el, viewport })
      task = render
      render.promise.catch(() => {})
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, number, width, visible])

  return (
    <canvas
      ref={canvas}
      className="doc-page"
      style={{ width, height: Math.round(width * ratio) }}
      aria-label={`Pagina ${number}`}
    />
  )
}
