import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react'
import { useModalDialog } from './nav'

/** Where the photo is: moved by (x, y) and scaled by s from its fitted place. */
export type View = { s: number; x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }

export const MAX_SCALE = 5
const DOUBLE_TAP = 2.5

/** The photo fitted inside the stage, centred, never cropped. */
export function fitBox(stageW: number, stageH: number, naturalW: number, naturalH: number): Box {
  if (!stageW || !stageH || !naturalW || !naturalH) return { x: 0, y: 0, w: stageW, h: stageH }
  const f = Math.min(stageW / naturalW, stageH / naturalH)
  const w = naturalW * f
  const h = naturalH * f
  return { x: (stageW - w) / 2, y: (stageH - h) / 2, w, h }
}

/** Keep the zoomed photo over the stage: centred while smaller, no empty edge while larger. */
export function clampView(v: View, box: Box, stageW: number, stageH: number): View {
  const s = Math.min(MAX_SCALE, Math.max(1, v.s))
  const axis = (t: number, at: number, size: number, stage: number) => {
    const scaled = size * s
    if (scaled <= stage) return (stage - scaled) / 2 - at
    return Math.min(-at, Math.max(stage - scaled - at, t))
  }
  return { s, x: axis(v.x, box.x, box.w, stageW), y: axis(v.y, box.y, box.h, stageH) }
}

/** Zoom to scale `s` keeping the stage point (px, py) on the same spot of the photo. */
export function zoomAt(v: View, box: Box, s: number, px: number, py: number): View {
  const qx = (px - box.x - v.x) / v.s
  const qy = (py - box.y - v.y) / v.s
  return { s, x: px - box.x - qx * s, y: py - box.y - qy * s }
}

const NONE: View = { s: 1, x: 0, y: 0 }

type Gesture = {
  start: View
  // One finger: where it went down. Two: the middle and distance of the fingers.
  x: number
  y: number
  distance: number
  moved: boolean
  fingers: number
  // Part of a pinch: lifting the fingers never counts as a tap or a swipe.
  pinched: boolean
}

/**
 * One photo on the whole screen: pinch or double-tap to zoom, drag to look around, swipe to
 * the next or previous photo when not zoomed. On a computer: scroll wheel, double-click,
 * arrows and the − and + buttons. Back closes it and returns to the gallery.
 */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: string[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef({ t: 0, x: 0, y: 0 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [view, setViewState] = useState<View>(NONE)
  // The latest view, also between a move and its render (a quick lift of the fingers).
  const latest = useRef<View>(NONE)
  const setView = (v: View) => {
    latest.current = v
    setViewState(v)
  }
  const [busy, setBusy] = useState(false)
  const count = photos.length

  useModalDialog(ref)

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const box = fitBox(size.w, size.h, natural.w, natural.h)
  const clamp = (v: View) => clampView(v, box, size.w, size.h)

  function go(step: 1 | -1) {
    if (count < 2) return
    setView(NONE)
    setNatural({ w: 0, h: 0 })
    onIndex((index + step + count) % count)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function local(e: { clientX: number; clientY: number }) {
    const r = stage.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function begin() {
    const pts = [...pointers.current.values()]
    const pinched = Boolean(gesture.current?.pinched)
    if (pts.length === 1) {
      gesture.current = { start: latest.current, x: pts[0].x, y: pts[0].y, distance: 0, moved: pinched, fingers: 1, pinched }
    } else if (pts.length >= 2) {
      const [a, b] = pts
      gesture.current = {
        start: latest.current,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        moved: true,
        fingers: 2,
        pinched: true,
      }
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    stage.current?.setPointerCapture(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
    pointers.current.set(e.pointerId, local(e))
    setBusy(true)
    begin()
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, local(e))
    const g = gesture.current
    if (!g) return
    const pts = [...pointers.current.values()]
    if (g.fingers === 2 && pts.length >= 2) {
      const [a, b] = pts
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const s = Math.min(MAX_SCALE, Math.max(1, (g.start.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance))
      // Zoom around where the fingers started, and let the photo follow them as they move.
      const zoomed = zoomAt(g.start, box, s, g.x, g.y)
      setView({ s, x: zoomed.x + mx - g.x, y: zoomed.y + my - g.y })
    } else if (g.fingers === 1) {
      const dx = pts[0].x - g.x
      const dy = pts[0].y - g.y
      if (!g.moved && Math.hypot(dx, dy) < 8) return
      g.moved = true
      if (g.start.s > 1.01) setView(clamp({ ...g.start, x: g.start.x + dx, y: g.start.y + dy }))
      // Not zoomed: the photo follows a sideways swipe.
      else setView({ s: 1, x: dx, y: 0 })
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!pointers.current.delete(e.pointerId)) return
    const g = gesture.current
    if (pointers.current.size > 0) {
      // From two fingers to one: carry on dragging from here.
      begin()
      return
    }
    gesture.current = null
    setBusy(false)
    if (!g) return
    if (g.pinched) {
      setView(latest.current.s < 1.05 ? NONE : clamp(latest.current))
      return
    }
    if (g.fingers === 1 && !g.moved) {
      tap(local(e), e.target === stage.current, e.timeStamp)
      return
    }
    if (g.fingers === 1 && g.start.s <= 1.01) {
      const dx = latest.current.x
      if (dx < -60) return go(1)
      if (dx > 60) return go(-1)
      setView(NONE)
      return
    }
    setView(clamp(latest.current))
  }

  function tap(at: { x: number; y: number }, beside: boolean, now: number) {
    const last = lastTap.current
    if (now - last.t < 320 && Math.hypot(at.x - last.x, at.y - last.y) < 30) {
      lastTap.current = { t: 0, x: 0, y: 0 }
      setView(latest.current.s > 1.01 ? NONE : clamp(zoomAt(latest.current, box, DOUBLE_TAP, at.x, at.y)))
      return
    }
    lastTap.current = { t: now, x: at.x, y: at.y }
    // A click on the dark space beside the photo closes it (not a tap: that may be a double tap).
    if (beside && !insideBox(at)) {
      window.setTimeout(() => {
        if (lastTap.current.t === now) ref.current?.close()
      }, 330)
    }
  }

  function insideBox(at: { x: number; y: number }) {
    const x0 = box.x + latest.current.x
    const y0 = box.y + latest.current.y
    return at.x >= x0 && at.x <= x0 + box.w * latest.current.s && at.y >= y0 && at.y <= y0 + box.h * latest.current.s
  }

  function onWheel(e: React.WheelEvent) {
    const at = local(e)
    const s = Math.min(MAX_SCALE, Math.max(1, latest.current.s * Math.exp(-e.deltaY / 300)))
    setView(clamp(zoomAt(latest.current, box, s, at.x, at.y)))
  }

  function zoomButton(factor: number) {
    const s = Math.min(MAX_SCALE, Math.max(1, latest.current.s * factor))
    setView(clamp(zoomAt(latest.current, box, s, size.w / 2, size.h / 2)))
  }

  const src = photos[index]
  return (
    <dialog ref={ref} className="photo-viewer" onClose={onClose} aria-label={`Foto ${index + 1} van ${count}`}>
      <div className="photo-viewer-bar">
        <span className="photo-viewer-count">
          {index + 1} / {count}
        </span>
        <div className="photo-viewer-zoom" role="group" aria-label="Zoomen">
          <button className="icon-btn" aria-label="Uitzoomen" disabled={view.s <= 1.01} onClick={() => zoomButton(1 / 1.6)}>
            <Minus size={20} />
          </button>
          <button className="icon-btn" aria-label="Inzoomen" disabled={view.s >= MAX_SCALE - 0.01} onClick={() => zoomButton(1.6)}>
            <Plus size={20} />
          </button>
        </div>
        <button className="icon-btn" aria-label="Sluiten" onClick={() => ref.current?.close()}>
          <X size={24} />
        </button>
      </div>
      <div
        ref={stage}
        className="photo-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <img
          key={src}
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          className={busy ? '' : 'settle'}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
            visibility: natural.w ? 'visible' : 'hidden',
          }}
        />
      </div>
      {count > 1 && (
        <>
          <button className="photo-viewer-nav prev" aria-label="Vorige foto" onClick={() => go(-1)}>
            <ChevronLeft size={28} />
          </button>
          <button className="photo-viewer-nav next" aria-label="Volgende foto" onClick={() => go(1)}>
            <ChevronRight size={28} />
          </button>
        </>
      )}
    </dialog>
  )
}
