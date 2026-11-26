import { useEffect, useRef, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { lastSeenVersion, markChangelogSeen, releasesSince, type Release } from './changelog'
import { Dialog } from './NewHouseDialog'

// More versions than this since the last visit are only counted, not listed.
const MAX_LISTED = 6

/** The changes in the Android app of one version, for the changelog and the news pop-up. */
export function AndroidChanges({ release, compact = false }: { release: Release; compact?: boolean }) {
  if (!release.android?.length) return null
  return (
    <div className="android-changes">
      <div className="android-changes-head">
        <Smartphone size={16} aria-hidden="true" />
        <b>Nieuwe Android-app {release.version}</b>
      </div>
      {!compact && (
        <ul>
          {release.android.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Once after an update of the web app: what is new since the version this browser saw last,
 * with a link to the full changelog. Opening it counts as seen, so it never shows twice.
 */
export function WhatsNew() {
  const [releases] = useState(() => {
    const seen = lastSeenVersion()
    // undefined: this browser cannot remember it, so it would show every time.
    return seen === undefined ? [] : releasesSince(seen)
  })
  const [open, setOpen] = useState(releases.length > 0)
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!releases.length) return
    markChangelogSeen()
    // The dialog focuses its first button, the cross; Oké is the one to press.
    ok.current?.focus()
  }, [releases])
  if (!open) return null
  const close = () => setOpen(false)
  const listed = releases.slice(0, MAX_LISTED)
  const more = releases.length - listed.length
  const single = releases.length === 1 ? releases[0] : null
  return (
    <Dialog title={single ? `Nieuw in versie ${single.version}` : 'Nieuw in Huizenjacht'} onClose={close} closeOnBackdrop>
      <div className="whats-new">
        {single ? (
          <>
            <p>
              <b>{single.title}</b>
            </p>
            <ul>
              {single.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            <AndroidChanges release={single} />
          </>
        ) : (
          <>
            <p className="muted small">
              Sinds je laatste bezoek {releases.length === 2 ? 'zijn er twee' : `zijn er ${releases.length}`} nieuwe
              versies:
            </p>
            <ol className="whats-new-list">
              {listed.map((r) => (
                <li key={r.version}>
                  <span className="version">{r.version}</span>
                  <span>
                    {r.title}
                    {r.android?.length ? (
                      <span className="android-tag">
                        <Smartphone size={13} aria-hidden="true" /> Android-app
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            {more > 0 && (
              <p className="muted small">
                En nog {more} eerdere {more === 1 ? 'versie' : 'versies'}.
              </p>
            )}
          </>
        )}
        <div className="whats-new-actions">
          <a href="#/instellingen/over" onClick={close}>
            Alles lezen in Instellingen → Over
          </a>
          <button className="btn btn-primary" onClick={close} ref={ok}>
            Oké
          </button>
        </div>
      </div>
    </Dialog>
  )
}
