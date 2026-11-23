import { useState } from 'react'
import { Home, Star } from 'lucide-react'
import { statusInfo, type House, type Status } from './house'

export function StatusBadge({ status }: { status: Status }) {
  const info = statusInfo(status)
  return <span className={`badge tone-${info.tone}`}>{info.label}</span>
}

export function EnergyLabel({ label }: { label?: string }) {
  if (!label) return null
  const letter = label.replace(/\+/g, '').charAt(0).toUpperCase()
  return (
    <span className={`energy energy-${letter}`} title={`Energielabel ${label}`}>
      {label}
    </span>
  )
}

export function Photo({ house, className = '' }: { house: House; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (house.foto && !failed) {
    return (
      <img
        className={`photo ${className}`}
        src={house.foto}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className={`photo photo-empty ${className}`} aria-hidden="true">
      <Home size={36} strokeWidth={1.5} />
    </div>
  )
}

export function FavoriteButton({
  active,
  onToggle,
}: {
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`icon-btn fav ${active ? 'on' : ''}`}
      aria-pressed={active}
      aria-label={active ? 'Favoriet, klik om te verwijderen' : 'Maak favoriet'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
    >
      <Star size={20} fill={active ? 'currentColor' : 'none'} />
    </button>
  )
}

export function ScorePill({ value, label }: { value?: number; label: string }) {
  if (value === undefined || value === null) return null
  const tone = value >= 7.5 ? 'good' : value >= 6 ? 'ok' : 'bad'
  return (
    <span className={`score score-${tone}`} title={label}>
      <small>{label}</small>
      {value.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}
    </span>
  )
}

export function ProgressBar({ done, total, problems }: { done: number; total: number; problems: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="progress" title={`${done} van ${total} punten bekeken`}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-text">
        {done}/{total}
        {problems > 0 && <b className="problems"> · {problems} probleem{problems === 1 ? '' : 'en'}</b>}
      </span>
    </div>
  )
}
