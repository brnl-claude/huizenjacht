export type Theme = 'system' | 'light' | 'dark'

export const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: 'Zoals het apparaat' },
  { id: 'light', label: 'Licht' },
  { id: 'dark', label: 'Donker' },
]

const KEY = 'hj.theme'

export function rememberedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // not remembered
  }
  applyTheme(theme)
}
