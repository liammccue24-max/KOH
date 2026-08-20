import type { Theme } from '../lib/theme.ts'

interface Props {
  theme: Theme
  onChange: (theme: Theme) => void
}

export function ThemeToggle({ theme, onChange }: Props) {
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => onChange(isDark ? 'light' : 'dark')}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      {isDark ? '🌙' : '☀️'} {isDark ? 'Dark' : 'Light'}
    </button>
  )
}
