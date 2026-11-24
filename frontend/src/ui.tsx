import { useState } from 'react'
import { Home, Star } from 'lucide-react'
import { EARLIER, photoUrls, statusInfo, type House, type Person, type Status } from './house'

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

export function Photo({
  house,
  className = '',
  index = 0,
}: {
  house: House
  className?: string
  index?: number
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = photoUrls(house)[index]
  if (src && failed !== src) {
    return (
      <img
        className={`photo ${className}`}
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
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
  onPhoto = false,
}: {
  active: boolean
  onToggle: () => void
  /** Shown in the corner of a photo, as a round button that stands out. */
  onPhoto?: boolean
}) {
  return (
    <button
      type="button"
      className={`icon-btn fav ${onPhoto ? 'fav-photo' : ''} ${active ? 'on' : ''}`}
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

// One colour per person, the same on every device: blue, pink, green, purple. Grey for
// answers whose owner is not known.
const PERSON_COLORS = ['#1c7ed6', '#d6336c', '#2f9e44', '#7048e8']

export function personColor(person: Person): string {
  return person.kleur < 0 ? '#868e96' : PERSON_COLORS[person.kleur % PERSON_COLORS.length]
}

/** A round badge with the first letter of someone's name, in their colour. */
export function PersonDot({ person, you = false }: { person: Person; you?: boolean }) {
  const label = you ? `${person.naam} (jij)` : person.naam
  return (
    <span className="person-dot" style={{ background: personColor(person) }} title={label} aria-label={label}>
      {person.key === EARLIER ? '?' : person.naam.charAt(0).toUpperCase()}
    </span>
  )
}
