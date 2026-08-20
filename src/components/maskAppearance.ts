export type MaskAppearance = { kind: 'color'; hex: string } | { kind: 'gnomes' }

export const MASK_COLOR_PRESETS: { label: string; hex: string }[] = [
  { label: 'Safelight gold', hex: '#d9ad40' },
  { label: 'Nitride blue', hex: '#3f7fbf' },
  { label: 'Oxide teal', hex: '#2e9e8f' },
  { label: 'Resist crimson', hex: '#c1443c' },
  { label: 'Graphite', hex: '#6b7280' },
]

export const DEFAULT_MASK_APPEARANCE: MaskAppearance = { kind: 'color', hex: MASK_COLOR_PRESETS[0].hex }

/** A flat stand-in color for the mask, used anywhere a real pattern can't be shown (e.g. a 5px-tall cross-section indicator bar). */
export const GNOME_FALLBACK_HEX = '#c0392b'

export function maskAppearanceColorHex(appearance: MaskAppearance): string {
  return appearance.kind === 'color' ? appearance.hex : GNOME_FALLBACK_HEX
}
