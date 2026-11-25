/** Text size, in five steps; the middle one is the size the app always had. */
export type FontSize = 1 | 2 | 3 | 4 | 5

export const FONT_SIZES: { id: FontSize; label: string; scale: number }[] = [
  { id: 1, label: 'Kleinst', scale: 0.875 },
  { id: 2, label: 'Klein', scale: 0.9375 },
  { id: 3, label: 'Normaal', scale: 1 },
  { id: 4, label: 'Groot', scale: 1.125 },
  { id: 5, label: 'Grootst', scale: 1.25 },
]

export const DEFAULT_FONT_SIZE: FontSize = 3
const KEY = 'hj.fontSize'

export function rememberedFontSize(): FontSize {
  try {
    const value = Number(localStorage.getItem(KEY))
    return FONT_SIZES.some((f) => f.id === value) ? (value as FontSize) : DEFAULT_FONT_SIZE
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

/** Everything sized in rem follows the root font size. */
export function applyFontSize(size: FontSize): void {
  const scale = FONT_SIZES.find((f) => f.id === size)?.scale ?? 1
  if (scale === 1) document.documentElement.style.removeProperty('font-size')
  else document.documentElement.style.fontSize = `${scale * 100}%`
}

export function setFontSize(size: FontSize): void {
  try {
    if (size === DEFAULT_FONT_SIZE) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(size))
  } catch {
    // not remembered
  }
  applyFontSize(size)
}

export function fontSizeLabel(size: FontSize): string {
  return FONT_SIZES.find((f) => f.id === size)?.label ?? 'Normaal'
}
