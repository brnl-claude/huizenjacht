/** The Huizenjacht mark: a house outline that opens into a magnifying glass. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo-mark">
      <rect width="64" height="64" rx="15" fill="var(--brand)" />
      <path
        d="M14 30 32 15l18 15"
        fill="none"
        stroke="#fff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 28v19a3 3 0 0 0 3 3h11"
        fill="none"
        stroke="#fff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="40" cy="39" r="7.5" fill="none" stroke="var(--logo-lens)" strokeWidth="5" />
      <path d="m45.5 44.5 6 6" stroke="var(--logo-lens)" strokeWidth="5.5" strokeLinecap="round" />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-word">
        huizen<b>jacht</b>
      </span>
    </span>
  )
}
