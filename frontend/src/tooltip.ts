/**
 * Tooltips, as in Interactive Recipe Reader: a short line that says what a button or link
 * does. Any element with a `data-tip` attribute gets one, and so does a button or link that
 * only has an icon and an `aria-label`. The tip shows
 * - after resting the mouse on it for a moment,
 * - when it gets the keyboard focus,
 * - on a touchscreen, when holding a finger on it. That long press only shows the tip: the
 *   element's own action does not run, and the browser's menu for links and text selection
 *   stay away. The tip stays for a few seconds after letting go.
 *
 * One tip element serves the whole page; `installTooltips` sets it up once, in main.tsx.
 */

// How long a finger rests on an element before its tip shows, in milliseconds.
export const LONG_PRESS_MS = 450
// How far a finger may move during a long press before it counts as scrolling, in pixels.
const MOVE_TOLERANCE = 10
// How long the mouse rests on an element before its tip shows; right after another tip,
// the next shows at once.
const HOVER_MS = 500
const WARM_MS = 400
// How long a tip stays after the finger lets go.
const TOUCH_SHOWS_MS = 3000
// How long after letting go the click that ends a long press may still come.
const SWALLOW_CLICK_MS = 800

// Room between the tip and its element, and between the tip and the screen's edges.
const GAP = 8
const MARGIN = 8
// How close the arrow may come to the tip's own corners.
const ARROW_INSET = 14

type Rect = { left: number; top: number; right: number; bottom: number }
type Size = { width: number; height: number }

export type Placement = {
  left: number
  top: number
  side: 'above' | 'below'
  // Where the arrow points, from the tip's left edge.
  arrow: number
}

/**
 * Where a tip of `tip` size goes for an element at `target`: centred above it, where a
 * finger does not cover it, or below when there is no room above; always on screen.
 */
export function placeTip(target: Rect, tip: Size, viewport: Size): Placement {
  const middle = (target.left + target.right) / 2
  const maxLeft = Math.max(MARGIN, viewport.width - MARGIN - tip.width)
  const left = Math.min(Math.max(middle - tip.width / 2, MARGIN), maxLeft)
  const above = target.top - GAP - tip.height
  const below = target.bottom + GAP
  const fitsBelow = below + tip.height <= viewport.height - MARGIN
  const side = above >= MARGIN || !fitsBelow ? 'above' : 'below'
  const top = side === 'above' ? Math.max(above, MARGIN) : below
  const arrow = Math.min(Math.max(middle - left, ARROW_INSET), tip.width - ARROW_INSET)
  return { left, top, side, arrow }
}

// Elements that get a tip: their own `data-tip`, or the label of a button or link with only
// an icon.
export const TIP_SELECTOR = '[data-tip], button[aria-label], a[aria-label], [role="radio"][aria-label]'

/** The text of an element's tip, if it has one. */
export function tipText(element: HTMLElement): string {
  return element.dataset.tip ?? element.getAttribute('aria-label') ?? ''
}

/** The element a tip belongs to: `node` or the closest element around it with a tip. */
function tipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  const target = node.closest<HTMLElement>(TIP_SELECTOR)
  return target && tipText(target) ? target : null
}

/** Sets up tooltips for the whole page; returns a function that removes them again. */
export function installTooltips(): () => void {
  const tip = document.createElement('div')
  tip.id = 'tooltip'
  tip.className = 'tooltip'
  tip.setAttribute('role', 'tooltip')
  // In the top layer, so a tip also shows over an open dialog such as the QR code's.
  const popover = typeof tip.showPopover === 'function'
  if (popover) tip.popover = 'manual'
  tip.hidden = !popover
  document.body.append(tip)

  // The element whose tip shows, and how it came up.
  let shown: { target: HTMLElement; by: 'hover' | 'focus' | 'touch' } | null = null
  let hiddenAt = 0
  let hoverTimer = 0
  let hideTimer = 0
  // A finger resting on an element with a tip.
  let press: {
    pointerId: number
    x: number
    y: number
    target: HTMLElement
    timer: number
    fired: boolean
  } | null = null
  // The click at the end of a long press, which must not run the element's action.
  let swallow: { target: HTMLElement; until: number } | null = null

  const show = (target: HTMLElement, by: 'hover' | 'focus' | 'touch') => {
    window.clearTimeout(hideTimer)
    const text = tipText(target)
    if (!text || !target.isConnected) return
    if (shown && shown.target !== target) unlink(shown.target)
    shown = { target, by }
    tip.textContent = text
    tip.classList.remove('shown')
    // Measured at the left edge, where it has all the room, then kept at that width.
    tip.style.left = '0px'
    tip.style.width = ''
    if (popover) {
      if (!tip.matches(':popover-open')) tip.showPopover()
    } else {
      tip.hidden = false
    }
    const box = tip.getBoundingClientRect()
    tip.style.width = `${Math.ceil(box.width)}px`
    const place = placeTip(
      target.getBoundingClientRect(),
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    )
    tip.style.left = `${place.left}px`
    tip.style.top = `${place.top}px`
    tip.style.setProperty('--arrow', `${place.arrow}px`)
    tip.dataset.side = place.side
    tip.classList.add('shown')
    // Screen readers read the tip along with the element's name, unless it says the same.
    if (!target.hasAttribute('aria-describedby') && text !== accessibleName(target)) {
      target.setAttribute('aria-describedby', tip.id)
    }
  }

  const hide = () => {
    window.clearTimeout(hoverTimer)
    window.clearTimeout(hideTimer)
    if (!shown) return
    unlink(shown.target)
    shown = null
    hiddenAt = Date.now()
    tip.classList.remove('shown')
    if (popover) {
      if (tip.matches(':popover-open')) tip.hidePopover()
    } else {
      tip.hidden = true
    }
  }

  const endPress = () => {
    if (press) window.clearTimeout(press.timer)
    press = null
  }

  const longPress = () => {
    if (!press || press.fired) return
    window.clearTimeout(press.timer)
    press.fired = true
    show(press.target, 'touch')
  }

  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || press) return
    const target = tipTarget(event.target)
    if (!target || shown?.target === target) return
    window.clearTimeout(hoverTimer)
    const warm = shown !== null || Date.now() - hiddenAt < WARM_MS
    hoverTimer = window.setTimeout(() => show(target, 'hover'), warm ? 0 : HOVER_MS)
  }

  const onPointerOut = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    const target = tipTarget(event.target)
    if (!target || target.contains(event.relatedTarget as Node | null)) return
    window.clearTimeout(hoverTimer)
    if (shown?.target === target && shown.by === 'hover') hide()
  }

  const onPointerDown = (event: PointerEvent) => {
    endPress()
    swallow = null
    // Clicking hides the tip; so does touching anywhere while a tip shows.
    if (shown?.by !== 'focus') hide()
    if (event.pointerType === 'mouse' || !event.isPrimary) return
    const target = tipTarget(event.target)
    if (!target) return
    press = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target,
      timer: window.setTimeout(longPress, LONG_PRESS_MS),
      fired: false,
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y)
    if (moved <= MOVE_TOLERANCE) return
    // Scrolling or swiping: no tip, or not any more.
    if (press.fired) hide()
    else endPress()
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return
    if (press.fired) {
      swallow = { target: press.target, until: Date.now() + SWALLOW_CLICK_MS }
      if (shown?.by === 'touch') hideTimer = window.setTimeout(hide, TOUCH_SHOWS_MS)
    }
    endPress()
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return
    if (press.fired && shown?.by === 'touch') hideTimer = window.setTimeout(hide, TOUCH_SHOWS_MS)
    endPress()
  }

  // A long press makes the browser offer its own menu (for links: open in a new tab, copy,
  // and so on) or select text. On an element with a tip, the tip comes instead.
  const onContextMenu = (event: MouseEvent) => {
    const target = tipTarget(event.target)
    const touch = (event as PointerEvent).pointerType === 'touch'
    if (press && target === press.target) {
      event.preventDefault()
      longPress()
    } else if (target && (touch || shown?.by === 'touch')) {
      event.preventDefault()
    }
  }

  const onClick = (event: MouseEvent) => {
    if (!swallow) return
    const { target, until } = swallow
    swallow = null
    if (Date.now() > until || !target.contains(event.target as Node)) return
    event.preventDefault()
    event.stopPropagation()
  }

  // Holding a link or photo still may start dragging it on Android; not on a long press.
  const onDragStart = (event: DragEvent) => {
    if (press && press.target.contains(event.target as Node)) event.preventDefault()
  }

  const onFocusIn = (event: FocusEvent) => {
    const target = tipTarget(event.target)
    if (target && target === event.target && focusVisible(target)) show(target, 'focus')
  }

  const onFocusOut = (event: FocusEvent) => {
    if (shown?.by === 'focus' && shown.target === event.target) hide()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide()
  }

  // Another app or tab comes forward. Not an element losing the focus, which passes by here
  // too, as the listeners capture.
  const onWindowBlur = (event: Event) => {
    if (event.target === window) hide()
  }

  const listeners: [EventTarget, string, EventListener][] = [
    [document, 'pointerover', onPointerOver as EventListener],
    [document, 'pointerout', onPointerOut as EventListener],
    [document, 'pointerdown', onPointerDown as EventListener],
    [document, 'pointermove', onPointerMove as EventListener],
    [document, 'pointerup', onPointerUp as EventListener],
    [document, 'pointercancel', onPointerCancel as EventListener],
    [document, 'contextmenu', onContextMenu as EventListener],
    // On the window, before anything on the page sees the click.
    [window, 'click', onClick as EventListener],
    [document, 'dragstart', onDragStart as EventListener],
    [document, 'focusin', onFocusIn as EventListener],
    [document, 'focusout', onFocusOut as EventListener],
    [document, 'keydown', onKeyDown as EventListener],
    // A tip stays with its element: when the page moves, it goes.
    [document, 'scroll', hide],
    [window, 'resize', hide],
    [window, 'hashchange', hide],
    [window, 'blur', onWindowBlur],
  ]
  for (const [target, type, listener] of listeners) {
    target.addEventListener(type, listener, { capture: true, passive: !cancels(type) })
  }

  return () => {
    hide()
    endPress()
    for (const [target, type, listener] of listeners) {
      target.removeEventListener(type, listener, { capture: true })
    }
    tip.remove()
  }
}

// The events whose default the tips may need to prevent.
function cancels(type: string): boolean {
  return type === 'contextmenu' || type === 'click' || type === 'dragstart'
}

function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return false
  }
}

function accessibleName(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim()
}

function unlink(target: HTMLElement) {
  if (target.getAttribute('aria-describedby') === 'tooltip') {
    target.removeAttribute('aria-describedby')
  }
}
