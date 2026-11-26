import { useLayoutEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'

/** Pinch zoom for a scrolling box, shared by the document viewer and the photo gallery. */

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
export const MIN_ZOOM = ZOOMS[0]
export const MAX_ZOOM = ZOOMS[ZOOMS.length - 1]

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

/**
 * Put `body` on the scrolling box and `content` on the one element inside it, spread
 * `handlers` on the box, and size the content by `zoom`. Pinching only scales the content
 * while the fingers move (smooth); when they let go the zoom is set, so it is drawn sharp at
 * the new size, and the box scrolls so the spot between the fingers stays under them.
 */
export function usePinchZoom(enabled = true) {
  const body = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinch = useRef<Pinch | null>(null)
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1)

  useLayoutEffect(() => {
    const el = body.current
    if (el && anchor.current) {
      el.scrollLeft = anchor.current.x
      el.scrollTop = anchor.current.y
      anchor.current = null
    }
  }, [zoom])

  function onTouchStart(e: React.TouchEvent) {
    const el = body.current
    if (!enabled || !el || e.touches.length !== 2) return
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

  /** Zoom with the buttons, keeping the middle of the box in the middle. */
  function zoomTo(next: number) {
    const el = body.current
    if (el && next !== zoom) {
      const cx = el.scrollLeft + el.clientWidth / 2
      const cy = el.scrollTop + el.clientHeight / 2
      const f = next / zoom
      anchor.current = { x: cx * f - el.clientWidth / 2, y: cy * f - el.clientHeight / 2 }
    }
    setZoom(next)
  }

  return {
    body,
    content,
    zoom,
    zoomTo,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  }
}

export function ZoomButtons({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  return (
    <div className="doc-zoom" role="group" aria-label="Zoomen">
      <button className="icon-btn" aria-label="Kleiner" disabled={zoom <= MIN_ZOOM} onClick={() => onZoom(stepZoom(zoom, -1))}>
        <Minus size={18} />
      </button>
      <span className="doc-zoom-value">{Math.round(zoom * 100)}%</span>
      <button className="icon-btn" aria-label="Groter" disabled={zoom >= MAX_ZOOM} onClick={() => onZoom(stepZoom(zoom, 1))}>
        <Plus size={18} />
      </button>
    </div>
  )
}
