import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { clearPaint, findRanges, paint, reveal } from './find'

/** The bar under the top bar for Zoeken op deze pagina: searches the text of <main>. */
export function FindBar({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [ranges, setRanges] = useState<Range[]>([])
  const [current, setCurrent] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const queryRef = useRef(query)

  useEffect(() => {
    input.current?.focus()
    return clearPaint
  }, [])

  // A new query starts at the first match on or below the top of the screen, like a browser.
  useEffect(() => {
    queryRef.current = query
    const timer = setTimeout(() => {
      const main = document.querySelector('main')
      const found = main ? findRanges(main, query) : []
      const below = found.findIndex((r) => r.getBoundingClientRect().bottom > 0)
      const start = below < 0 ? 0 : below
      setRanges(found)
      setCurrent(start)
      paint(found, start)
      if (found[start]) reveal(found[start])
    }, 120)
    return () => clearTimeout(timer)
  }, [query])

  // The page changes under the bar (another tab, live updates, an opened section): search again
  // and keep the place, without scrolling.
  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // On another page or tab, start again at the first match instead of at the old number.
    let fresh = false
    const onHash = () => {
      fresh = true
    }
    window.addEventListener('hashchange', onHash)
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const found = findRanges(main, queryRef.current)
        setRanges(found)
        const restart = fresh
        fresh = false
        setCurrent((c) => {
          const next = restart ? 0 : Math.min(c, Math.max(found.length - 1, 0))
          paint(found, next)
          return next
        })
      }, 250)
    })
    observer.observe(main, { subtree: true, childList: true, characterData: true, attributes: true })
    return () => {
      window.removeEventListener('hashchange', onHash)
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [])

  const go = useCallback(
    (step: number) => {
      if (!ranges.length) return
      const next = (current + step + ranges.length) % ranges.length
      setCurrent(next)
      paint(ranges, next)
      reveal(ranges[next])
    },
    [ranges, current],
  )

  const status = !query.trim() ? '' : ranges.length ? `${current + 1} van ${ranges.length}` : 'Niets gevonden'

  return (
    <div className="findbar" role="search">
      <div className="findbar-inner">
        <input
          ref={input}
          type="search"
          className="findbar-input"
          placeholder="Zoeken op deze pagina"
          aria-label="Zoeken op deze pagina"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              go(e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
        <span className={`findbar-count${query.trim() && !ranges.length ? ' none' : ''}`} aria-live="polite">
          {status}
        </span>
        <button className="icon-btn" aria-label="Vorige" disabled={!ranges.length} onClick={() => go(-1)}>
          <ChevronUp size={20} />
        </button>
        <button className="icon-btn" aria-label="Volgende" disabled={!ranges.length} onClick={() => go(1)}>
          <ChevronDown size={20} />
        </button>
        <button className="icon-btn" aria-label="Zoeken sluiten" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
    </div>
  )
}
