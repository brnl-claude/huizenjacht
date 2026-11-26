import { useEffect, useState } from 'react'
import { Check, MonitorSmartphone, Trash2, X } from 'lucide-react'
import { api, ApiError, type LoginSession } from './api'
import { navigate } from './nav'
import { errorText, useStore } from './store'

/**
 * #/koppel/<id>: the phone scanned the QR code of a device that cannot log in itself (see
 * backend/app/pairing.py). The person checks the code and lets that device in as themselves.
 */
export function PairPage({ id }: { id: string }) {
  const { notify } = useStore()
  const [pair, setPair] = useState<{ code: string; device: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .pairing(id)
      .then(setPair)
      .catch((e) => setError(e instanceof ApiError ? e.message : errorText(e)))
  }, [id])

  async function answer(approve: boolean) {
    setBusy(true)
    try {
      if (approve) {
        await api.approvePairing(id)
        notify(`${pair?.device ?? 'Het apparaat'} is ingelogd.`)
      } else {
        await api.denyPairing(id)
        notify('Geweigerd.')
      }
      navigate('#/instellingen/account')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page settings">
      <h1>Ander apparaat inloggen</h1>
      <section className="panel pair">
        {error && <p className="notice notice-error">{error}</p>}
        {!error && !pair && <p className="muted">Even kijken…</p>}
        {pair && (
          <>
            <p>
              <MonitorSmartphone size={18} aria-hidden="true" /> <b>{pair.device}</b> wil inloggen met jouw account.
            </p>
            <p className="muted">Staat deze code ook op dat apparaat?</p>
            <p className="pair-code">{pair.code}</p>
            <p className="muted small">
              Sta het alleen toe als je het apparaat voor je hebt en de code klopt. Heeft iemand je deze link gestuurd,
              weiger dan.
            </p>
            <div className="pair-buttons">
              <button className="btn btn-primary" disabled={busy} onClick={() => void answer(true)}>
                <Check size={16} /> Ja, inloggen
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => void answer(false)}>
                <X size={16} /> Weigeren
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/** Every device logged in with this account; another one can be logged out from here. */
export function Devices() {
  const { notify } = useStore()
  const [list, setList] = useState<{ current: string; sessions: LoginSession[] } | null>(null)
  const load = () => void api.sessions().then(setList, () => undefined)
  useEffect(load, [])
  if (!list) return null
  return (
    <section className="panel">
      <h2>Apparaten</h2>
      <p className="muted small">
        Lukt inloggen op een apparaat niet (zoals een tablet)? Kies daar <b>Inloggen met je telefoon</b> en scan de
        QR-code met deze telefoon.
      </p>
      <ul className="devices">
        {list.sessions.map((s) => (
          <li key={s.id}>
            <span>
              <b>{s.device || 'Onbekend apparaat'}</b>
              {s.id === list.current && <span className="muted"> · dit apparaat</span>}
              <br />
              <span className="muted small">
                {s.via === 'telefoon' ? 'Via je telefoon' : 'Ingelogd'} op {when(s.createdAt)}
              </span>
            </span>
            {s.id !== list.current && (
              <button
                className="icon-btn"
                aria-label={`${s.device || 'Dit apparaat'} uitloggen`}
                data-tip="Uitloggen"
                onClick={async () => {
                  if (!confirm(`${s.device || 'Dit apparaat'} uitloggen?`)) return
                  try {
                    await api.endSession(s.id)
                    load()
                  } catch (e) {
                    notify(errorText(e), 'error')
                  }
                }}
              >
                <Trash2 size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
