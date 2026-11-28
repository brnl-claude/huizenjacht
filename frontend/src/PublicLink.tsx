import { useEffect, useState } from 'react'
import { Copy, RefreshCw, Share2, Trash2 } from 'lucide-react'
import { api, type PublicLink } from './api'
import { displayAddress, type House } from './house'
import { Dialog } from './NewHouseDialog'
import { useStore } from './store'

/** Share a house with someone who has no account: a read-only page behind a long random link.
 * The page shows the address, the facts and, if allowed, the listing's photos and the
 * report's summary. Notes, checklist, grades, bid and own media never leave the app. */
export function PublicLinkDialog({ house, onClose }: { house: House; onClose: () => void }) {
  const { notify } = useStore()
  const [link, setLink] = useState<PublicLink | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [fotos, setFotos] = useState(true)
  const [rapport, setRapport] = useState(false)

  useEffect(() => {
    api
      .publicLink(house.id)
      .then((l) => {
        setLink(l)
        if (l) {
          setFotos(l.fotos)
          setRapport(l.rapport)
        }
      })
      .catch((e) => {
        setLink(null)
        notify(e instanceof Error ? e.message : 'Ophalen mislukt.', 'error')
      })
  }, [house.id, notify])

  const run = (work: () => Promise<PublicLink | null>) => {
    setBusy(true)
    work()
      .then(setLink)
      .catch((e) => notify(e instanceof Error ? e.message : 'Dat lukte niet.', 'error'))
      .finally(() => setBusy(false))
  }
  const save = (changes: { fotos?: boolean; rapport?: boolean; nieuw?: boolean }) =>
    run(() => api.savePublicLink(house.id, { fotos, rapport, ...changes }))
  const url = link ? `${location.origin}${link.path}` : ''
  const copy = () =>
    navigator.clipboard
      .writeText(url)
      .then(() => notify('Link gekopieerd.'))
      .catch(() => notify('Kopiëren lukte niet; selecteer de link en kopieer hem zelf.', 'error'))

  return (
    <Dialog title="Delen zonder inloggen" onClose={onClose}>
      <p className="muted small">
        Iedereen met deze link ziet het adres en de kenmerken van {displayAddress(house)}, zonder in te
        loggen. Notities, checklist, cijfers, bod, bezichtiging, eigen foto's en memo's en documenten
        blijven privé.
      </p>
      <div className="public-options">
        <label className="switch">
          <input
            type="checkbox"
            checked={fotos}
            disabled={busy}
            onChange={(e) => {
              setFotos(e.target.checked)
              if (link) save({ fotos: e.target.checked })
            }}
          />
          Foto's van de advertentie
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={rapport}
            disabled={busy}
            onChange={(e) => {
              setRapport(e.target.checked)
              if (link) save({ rapport: e.target.checked })
            }}
          />
          Samenvatting, plus- en minpunten uit het rapport
        </label>
      </div>
      {link === undefined ? (
        <p className="muted">Laden…</p>
      ) : link ? (
        <>
          <div className="public-url">
            <input readOnly value={url} aria-label="Publieke link" onFocus={(e) => e.target.select()} />
            <button className="btn btn-primary" onClick={copy}>
              <Copy size={16} /> Kopieer
            </button>
          </div>
          <div className="form-actions public-actions">
            {'share' in navigator && (
              <button
                className="btn"
                onClick={() => navigator.share({ title: displayAddress(house), url }).catch(() => {})}
              >
                <Share2 size={16} /> Delen…
              </button>
            )}
            <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">
              Bekijk
            </a>
            <button
              className="btn btn-ghost"
              disabled={busy}
              data-tip="Maak een nieuwe link; de oude werkt dan niet meer"
              onClick={() => confirm('Een nieuwe link maken? De oude link werkt dan niet meer.') && save({ nieuw: true })}
            >
              <RefreshCw size={16} /> Nieuwe link
            </button>
            <button
              className="btn btn-danger-ghost"
              disabled={busy}
              onClick={() =>
                confirm('Stoppen met delen? De link werkt dan niet meer.') &&
                run(() => api.stopPublicLink(house.id).then(() => null))
              }
            >
              <Trash2 size={16} /> Stop met delen
            </button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => save({})}>
            <Share2 size={16} /> Link maken
          </button>
        </div>
      )}
    </Dialog>
  )
}
