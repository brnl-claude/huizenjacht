import { useEffect, useMemo, useState } from 'react'
import { Mic, Share2, Trash2, Video } from 'lucide-react'
import { api, type Share } from './api'
import { checklistFor } from './checklist'
import { displayAddress, place, type House } from './house'
import { ensureThumb, formatDuration, mediaUrl } from './media'
import { errorText, useStore } from './store'

/** The house whose viewing is now, just was or comes soonest: where shared photos most likely belong. */
export function likelyHouse(houses: House[], now = Date.now()): House | undefined {
  const viewed = houses
    .filter((h) => h.status !== 'afgevallen' && h.mine.bezichtiging)
    .map((h) => ({ h, t: Date.parse(h.mine.bezichtiging!) }))
    .filter(({ t }) => Number.isFinite(t) && t <= now + 12 * 3600_000)
    .sort((a, b) => b.t - a.t)
  return viewed[0]?.h
}

/** Files shared to Huizenjacht from another app: pick the house (and point) they belong to. */
export function SharePage({ id }: { id: string }) {
  const { houses, loading, template, withStandard, replace, notify } = useStore()
  const [share, setShare] = useState<Share | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [houseId, setHouseId] = useState('')
  const [item, setItem] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.share(id).then(setShare, (e) => setFailed(errorText(e)))
  }, [id])

  const options = useMemo(
    () =>
      [...houses]
        .filter((h) => h.status !== 'afgevallen' || h.id === houseId)
        .sort((a, b) => displayAddress(a).localeCompare(displayAddress(b), 'nl')),
    [houses, houseId],
  )
  const suggested = likelyHouse(houses)
  const chosen = houses.find((h) => h.id === (houseId || suggested?.id))
  const categories = chosen ? checklistFor(chosen, template, withStandard) : []

  async function save() {
    if (!chosen || !share) return
    setBusy(true)
    try {
      await api.fileShare(share.id, chosen.id, item || null)
      // Shared files came without a preview; make them here, a few at a time.
      await Promise.all(share.files.map((f) => ensureThumb(f)))
      replace(await api.house(chosen.id))
      notify(`${share.files.length === 1 ? '1 bestand' : `${share.files.length} bestanden`} bij ${displayAddress(chosen)}`)
      location.hash = `#/huis/${encodeURIComponent(chosen.id)}/checklist`
    } catch (e) {
      notify(errorText(e), 'error')
      setBusy(false)
    }
  }

  async function drop() {
    if (!share || !confirm('Deze gedeelde bestanden weggooien?')) return
    await api.dropShare(share.id).catch(() => undefined)
    location.hash = '#/'
  }

  if (failed) {
    return (
      <div className="page">
        <h1>Delen</h1>
        <p className="muted">{failed} Deel de bestanden nog eens vanuit je galerij.</p>
        <a href="#/">Naar je huizen</a>
      </div>
    )
  }
  if (!share || loading) return <div className="loading">Laden…</div>

  return (
    <div className="page share-page">
      <h1>
        <Share2 size={24} aria-hidden="true" /> Bij welk huis?
      </h1>
      {share.files.length === 0 ? (
        <p className="muted">Er kwamen geen foto's, video's of geluiden mee. Alleen die kun je bij een huis bewaren.</p>
      ) : (
        <ul className="media-tiles share-tiles">
          {share.files.map((f) => (
            <li key={f.id}>
              <div className={`media-tile kind-${f.kind}`}>
                {f.kind === 'foto' ? (
                  <img src={mediaUrl(f.id)} alt="" />
                ) : (
                  <span className="media-tile-icon">{f.kind === 'video' ? <Video size={22} /> : <Mic size={22} />}</span>
                )}
                {f.duration ? <span className="media-tile-time">{formatDuration(f.duration)}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {share.files.length > 0 && (
        <div className="panel share-form">
          <label className="field">
            <span>Huis</span>
            <select
              value={chosen?.id ?? ''}
              onChange={(e) => {
                setHouseId(e.target.value)
                setItem('')
              }}
            >
              {!chosen && <option value="">Kies een huis</option>}
              {options.map((h) => (
                <option key={h.id} value={h.id}>
                  {displayAddress(h)}
                  {place(h) ? `, ${place(h)}` : ''}
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <label className="field">
              <span>Hoort bij</span>
              <select value={item} onChange={(e) => setItem(e.target.value)}>
                <option value="">Het huis in het algemeen</option>
                {categories.map((c) => (
                  <optgroup key={c.id} label={c.titel}>
                    {c.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.tekst}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          <div className="row">
            <button className="btn btn-primary" disabled={!chosen || busy} onClick={() => void save()}>
              {busy ? 'Bewaren…' : 'Bewaren bij dit huis'}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => void drop()}>
              <Trash2 size={16} /> Weggooien
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
