/**
 * Hierarchical navigation. The browser history follows the structure of the app, so the back
 * button (also Android's) goes up one level: a tab of a house → its overview → all houses, and
 * a section of the settings → the settings → all houses. Switching between tabs replaces the
 * history entry instead of adding one.
 */

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
  return { kind: 'push', hashes: chainB.slice(Math.max(common, 1)) }
}

export function navigate(to: string): void {
  const current = state() ?? { hj: normalise(location.hash), prev: parentOf(location.hash) }
  const step = plan(location.hash, to, current.prev)
  if (step.kind === 'none') return
  if (step.kind === 'back') {
    history.back()
    return
  }
  if (step.kind === 'replace') {
    history.replaceState({ hj: normalise(to), prev: current.prev } satisfies State, '', normalise(to))
  } else {
    let prev = normalise(location.hash)
    for (const hash of step.hashes) {
      history.pushState({ hj: hash, prev } satisfies State, '', hash)
      prev = hash
    }
  }
  announce()
}

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
