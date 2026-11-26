/**
 * Hierarchical navigation. The browser history follows the structure of the app, so the back
 * button (also Android's) goes up one level: a tab of a house → its overview → all houses, and
 * a section of the settings → the settings → all houses. Switching between tabs replaces the
 * history entry instead of adding one.
 */

import { useEffect, type RefObject } from 'react'

const ROOT = '#/'

/** The canonical form of a hash: `#/huis/x/overzicht` is the overview `#/huis/x`. */
export function normalise(hash: string): string {
  const parts = hash.replace(/^#?\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'huis' && parts[2] === 'overzicht') parts.length = 2
  return `#/${parts.join('/')}`
}

/** One level up, or null at the top. */
export function parentOf(hash: string): string | null {
  const h = normalise(hash)
  if (h === ROOT) return null
  const parts = h.slice(2).split('/')
  if (parts[0] === 'huis' && parts.length > 2) return `#/huis/${parts[1]}`
  if (parts[0] === 'instellingen' && parts.length > 1) return '#/instellingen'
  return ROOT
}

/** From the top down to this page: ['#/', '#/huis/x', '#/huis/x/checklist']. */
export function chainOf(hash: string): string[] {
  const chain = [normalise(hash)]
  for (let p = parentOf(chain[0]); p; p = parentOf(p)) chain.unshift(p)
  return chain
}

type State = { hj: string; prev: string | null }

function state(): State | null {
  const s = history.state as State | null
  return s && typeof s.hj === 'string' ? s : null
}

function announce() {
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/** The history steps to go from one page to another. */
export function plan(
  from: string,
  to: string,
  prev: string | null,
): { kind: 'none' } | { kind: 'back' } | { kind: 'replace' } | { kind: 'push'; hashes: string[] } {
  const a = normalise(from)
  const b = normalise(to)
  if (a === b) return { kind: 'none' }
  if (prev && normalise(prev) === b) return { kind: 'back' }
  if (b !== ROOT && parentOf(a) === parentOf(b)) return { kind: 'replace' }
  const chainA = chainOf(a)
  const chainB = chainOf(b)
  let common = 0
  while (common < chainA.length && common < chainB.length && chainA[common] === chainB[common]) common++
  // Going up to a page that is not right behind this one (such as Huizen after coming from a
  // house to the settings): open it as a new step rather than doing nothing.
  const hashes = chainB.slice(Math.max(common, 1))
  return { kind: 'push', hashes: hashes.length ? hashes : [b] }
}

export function navigate(to: string): void {
  const current = state() ?? { hj: normalise(location.hash), prev: parentOf(location.hash) }
  const step = plan(location.hash, to, current.prev)
  // The entry of an open dialog (see useModalDialog) is a copy of this page; it gives way.
  const modal = modalEntry()
  if (step.kind === 'none') return
  if (step.kind === 'back') {
    history.go(-1 - modalDepth())
    return
  }
  if (step.kind === 'replace') {
    history.replaceState({ hj: normalise(to), prev: current.prev } satisfies State, '', normalise(to))
  } else {
    let prev = normalise(location.hash)
    step.hashes.forEach((hash, i) => {
      const next = { hj: hash, prev } satisfies State
      if (i === 0 && modal) history.replaceState(next, '', hash)
      else history.pushState(next, '', hash)
      prev = hash
    })
  }
  announce()
}

/** How many dialogs the current history entry has open on top of the page. */
function modalDepth(): number {
  const modal = (history.state as { modal?: boolean | number } | null)?.modal
  return modal === true ? 1 : typeof modal === 'number' ? modal : 0
}

function modalEntry(): boolean {
  return modalDepth() > 0
}

let openModals = 0

/**
 * Once at start: a page opened directly (a link, a share, the bookmarklet) gets its parents
 * underneath, so back goes up instead of out of the app. Links inside the app go through
 * `navigate`.
 */
export function installNavigation(): void {
  if (!state()) {
    const chain = chainOf(location.hash)
    history.replaceState({ hj: chain[0], prev: null } satisfies State, '', chain[0])
    for (let i = 1; i < chain.length; i++) {
      history.pushState({ hj: chain[i], prev: chain[i - 1] } satisfies State, '', chain[i])
    }
  }
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const link = (e.target as Element | null)?.closest?.('a[href^="#/"]') as HTMLAnchorElement | null
    if (!link || link.target) return
    e.preventDefault()
    navigate(link.getAttribute('href') ?? ROOT)
  })
}

/**
 * Opens a <dialog> as a modal with its own history entry, so the back button closes it (and
 * only it) instead of leaving the page underneath. Closing it another way removes that entry.
 */
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>): void {
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal?.()
    // A dialog opened from another one (a photo from the gallery) gets an entry of its own on
    // top, so back closes only the top one.
    const depth = ++openModals
    const isOpenEntry = () => modalDepth() >= depth
    if (!isOpenEntry()) history.pushState({ ...(history.state ?? {}), modal: depth }, '', location.href)
    let left = false
    const onPop = () => {
      if (isOpenEntry()) return
      left = true
      if (dialog.open) dialog.close()
    }
    const onClose = () => {
      if (isOpenEntry() && !left) history.back()
      left = true
    }
    window.addEventListener('popstate', onPop)
    dialog.addEventListener('close', onClose)
    return () => {
      window.removeEventListener('popstate', onPop)
      dialog.removeEventListener('close', onClose)
      openModals--
      // Gone without closing (its page removed it): drop its entry too, unless it is opening
      // again right away (React's development double mount) or the app navigated on.
      setTimeout(() => {
        if (!left && openModals < depth && isOpenEntry()) history.back()
      })
    }
  }, [ref])
}
