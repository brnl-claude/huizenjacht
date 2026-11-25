import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { api } from './api'
import { EDITABLE_FIELDS, type Fields, type House, type Mine } from './house'
import { errorText, useStore } from './store'

export const FIELD_LABELS: Partial<Record<keyof Fields, { label: string; type?: 'number' | 'url'; unit?: string }>> = {
  adres: { label: 'Adres' },
  postcode: { label: 'Postcode' },
  plaats: { label: 'Plaats' },
  wijk: { label: 'Wijk' },
  vraagprijs: { label: 'Vraagprijs', type: 'number', unit: '€' },
  woonoppervlakte: { label: 'Woonoppervlakte', type: 'number', unit: 'm²' },
  perceel: { label: 'Perceel', type: 'number', unit: 'm²' },
  kamers: { label: 'Kamers', type: 'number' },
  slaapkamers: { label: 'Slaapkamers', type: 'number' },
  badkamers: { label: 'Badkamers', type: 'number' },
  bouwjaar: { label: 'Bouwjaar', type: 'number' },
  energielabel: { label: 'Energielabel' },
  woningtype: { label: 'Soort woning' },
  url: { label: 'Link naar advertentie', type: 'url' },
  foto: { label: 'Link naar foto', type: 'url' },
}

/** A form for the house's facts. For a house from a report, it stores corrections. */
export function HouseForm({
  house,
  onDone,
  onCancel,
  extraAction,
}: {
  house?: House
  onDone: (id: string) => void
  onCancel: () => void
  // Shown on the left of the buttons, such as Huis verwijderen.
  extraAction?: ReactNode
}) {
  const { replace, update, notify } = useStore()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const key of EDITABLE_FIELDS) {
      const value = house?.[key]
      if (value !== undefined && value !== null) v[key] = String(value)
    }
    return v
  })
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const changes: Partial<Record<keyof Mine, unknown>> = {}
    for (const key of EDITABLE_FIELDS) {
      const raw = (values[key] ?? '').trim()
      const meta = FIELD_LABELS[key]
      const fromReport = house?.record.report[key]
      let value: unknown = raw === '' ? null : meta?.type === 'number' ? Number(raw.replace(/\./g, '').replace(',', '.')) : raw
      if (typeof value === 'number' && Number.isNaN(value)) value = null
      // Only store what differs from the report.
      if (house && fromReport !== undefined && String(fromReport) === String(value ?? '')) value = null
      if (house || value !== null) changes[key] = value
    }
    try {
      if (house) {
        await update(house.id, changes)
        onDone(house.id)
      } else {
        const record = await api.createHouse({ ...(changes as Mine), status: 'interessant' })
        replace(record)
        onDone(record.id)
      }
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="form-grid">
        {EDITABLE_FIELDS.map((key) => {
          const meta = FIELD_LABELS[key]
          if (!meta) return null
          const fromReport = house?.record.report[key]
          return (
            <label key={key} className={key === 'adres' || key === 'url' || key === 'foto' ? 'wide' : ''}>
              <span>
                {meta.label}
                {meta.unit && <small> ({meta.unit})</small>}
              </span>
              <input
                type={meta.type === 'url' ? 'url' : 'text'}
                inputMode={meta.type === 'number' ? 'decimal' : undefined}
                value={values[key] ?? ''}
                required={key === 'adres' && !house}
                placeholder={fromReport !== undefined ? `Rapport: ${String(fromReport)}` : ''}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              />
            </label>
          )
        })}
      </div>
      <div className="form-actions">
        {extraAction && <div className="form-actions-start">{extraAction}</div>}
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Annuleren
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {house ? 'Opslaan' : 'Toevoegen'}
        </button>
      </div>
    </form>
  )
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal?.()
  }, [])
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose}>
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-btn" aria-label="Sluiten" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}

export function NewHouseDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Huis toevoegen" onClose={onClose}>
      <p className="muted small">
        Voor een huis zonder rapport. Komt er later een rapport met hetzelfde adres binnen, dan
        verschijnt dat als apart huis.
      </p>
      <HouseForm
        onCancel={onClose}
        onDone={(id) => {
          onClose()
          location.hash = `#/huis/${encodeURIComponent(id)}`
        }}
      />
    </Dialog>
  )
}
