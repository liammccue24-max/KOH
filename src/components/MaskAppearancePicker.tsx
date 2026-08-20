import { MASK_COLOR_PRESETS, type MaskAppearance } from './maskAppearance.ts'
import { getGnomeTexture } from '../lib/gnomeTexture.ts'

interface Props {
  appearance: MaskAppearance
  onChange: (appearance: MaskAppearance) => void
}

export function MaskAppearancePicker({ appearance, onChange }: Props) {
  const customHex = appearance.kind === 'color' ? appearance.hex : MASK_COLOR_PRESETS[0].hex
  const isCustom = appearance.kind === 'color' && !MASK_COLOR_PRESETS.some((p) => p.hex === appearance.hex)

  return (
    <div className="mask-swatches">
      {MASK_COLOR_PRESETS.map((preset) => (
        <button
          key={preset.hex}
          type="button"
          className={`mask-swatch${appearance.kind === 'color' && appearance.hex === preset.hex ? ' selected' : ''}`}
          style={{ background: preset.hex }}
          title={preset.label}
          aria-label={preset.label}
          onClick={() => onChange({ kind: 'color', hex: preset.hex })}
        />
      ))}
      <button
        type="button"
        className={`mask-swatch mask-swatch-pattern${appearance.kind === 'gnomes' ? ' selected' : ''}`}
        style={{ backgroundImage: `url(${getGnomeTexture().dataUrl})` }}
        title="Gnomes"
        aria-label="Gnomes pattern"
        onClick={() => onChange({ kind: 'gnomes' })}
      />
      <label className={`mask-swatch mask-swatch-custom${isCustom ? ' selected' : ''}`} title="Custom color" style={{ background: customHex }}>
        <input type="color" value={customHex} onChange={(e) => onChange({ kind: 'color', hex: e.target.value })} aria-label="Custom hard mask color" />
      </label>
    </div>
  )
}
