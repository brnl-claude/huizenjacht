/**
 * Zoeken op de pagina: the text search behind the magnifier in the top bar. The Android app and
 * the installed app have no browser menu with "Zoeken op pagina", so the app brings its own.
 *
 * Matches are shown with the CSS Custom Highlight API, which marks text without touching the
 * DOM that React owns.
 */

/** One character folded for searching: lower case and without accents, so "e" finds "é". */
function foldChar(c: string): string {
  const base = c.normalize('NFD')[0] ?? c
  const lower = base.toLowerCase()
  // Keep one character per character, so offsets in the folded text match the original.
  return lower.length === 1 ? lower : c
}

/** Text folded for searching, with the same length as the original. */
export function fold(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) out += foldChar(text[i])
  return out
}

/** Folded query with runs of white space as one space and no space around it. */
export function foldQuery(query: string): string {
  return fold(query.replace(/\s+/g, ' ').trim())
}

/** Where the folded query starts in the folded text, without overlapping matches. */
export function findOffsets(foldedText: string, foldedQuery: string): number[] {
  const offsets: number[] = []
  if (!foldedQuery) return offsets
  let from = 0
  for (;;) {
    const at = foldedText.indexOf(foldedQuery, from)
    if (at < 0) return offsets
    offsets.push(at)
    from = at + foldedQuery.length
  }
}

function visible(el: Element): boolean {
  if (el.closest('[aria-hidden="true"], [data-find-skip], .visually-hidden')) return false
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true })
  return (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed'
}

/** Ranges of every match of the query in the visible text under root. */
export function findRanges(root: Element, query: string): Range[] {
  const q = foldQuery(query)
  if (!q) return []
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT
      if (parent.closest('script, style, noscript, textarea, input, select, svg, template')) return NodeFilter.FILTER_REJECT
      return visible(parent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  // Text of separate nodes is joined, so a match may run across bold or a link. Collapsing
  // white space keeps "Grote  tuin" with a line break findable as "grote tuin".
  let lastWasSpace = true
  const map: { node: number; offset: number }[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text
    nodes.push(node)
    starts.push(text.length)
    const value = node.nodeValue ?? ''
    const folded = fold(value)
    for (let i = 0; i < folded.length; i++) {
      const space = /\s/.test(folded[i])
      if (space && lastWasSpace) continue
      text += space ? ' ' : folded[i]
      map.push({ node: nodes.length - 1, offset: i })
      lastWasSpace = space
    }
  }
  return findOffsets(text, q).map((at) => {
    const first = map[at]
    const last = map[at + q.length - 1]
    const range = document.createRange()
    range.setStart(nodes[first.node], first.offset)
    range.setEnd(nodes[last.node], last.offset + 1)
    return range
  })
}

export const highlightsSupported = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'

/** Show all matches and the current one in a stronger colour. */
export function paint(ranges: Range[], current: number) {
  if (!highlightsSupported) return
  const others = ranges.filter((_, i) => i !== current)
  CSS.highlights.set('zoek', new Highlight(...others))
  if (ranges[current]) CSS.highlights.set('zoek-huidig', new Highlight(ranges[current]))
  else CSS.highlights.delete('zoek-huidig')
}

export function clearPaint() {
  if (!highlightsSupported) return
  CSS.highlights.delete('zoek')
  CSS.highlights.delete('zoek-huidig')
}

/** Scroll the match to the middle of what is left of the screen below the sticky bars. */
export function reveal(range: Range) {
  const el = range.startContainer.parentElement
  // Horizontal scrollers (such as Vergelijken) first bring the match in from the side.
  el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  const rect = range.getBoundingClientRect()
  const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0
  const sticky = document.querySelector('.house-sticky')?.getBoundingClientRect().height ?? 0
  const tabbar = document.querySelector('.tabbar')?.getBoundingClientRect().height ?? 0
  const top = topbar + sticky
  const bottom = window.innerHeight - tabbar
  if (rect.top >= top + 8 && rect.bottom <= bottom - 8) return
  const middle = top + (bottom - top) / 2
  window.scrollBy({ top: rect.top + rect.height / 2 - middle })
}
