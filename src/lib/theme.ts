export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'koh-etch-theme'

/** The CSS already fully supports both palettes via `[data-theme]` (see index.css); this just picks a starting point -- a saved explicit choice, else the OS/browser preference. */
export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage can throw in locked-down embeds; fall through to the media query.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Best-effort persistence only.
  }
}
