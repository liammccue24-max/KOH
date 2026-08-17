import type { ReactNode } from 'react'
import type { EtchParams, MaskPolarity } from '../sim/types.ts'

interface LayerOption {
  layer: number
  datatype: number
}

interface Props {
  structures: string[]
  topName: string | null
  onTopNameChange: (name: string) => void

  layers: LayerOption[]
  selectedLayer: LayerOption | null
  onLayerChange: (l: LayerOption) => void

  boundaryLayer: LayerOption | null
  onBoundaryLayerChange: (l: LayerOption | null) => void

  params: EtchParams
  onParamsChange: (p: EtchParams) => void

  maxTimeMin: number
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="control-row">
      <div className="control-label">
        <span>{label}</span>
        {hint && <span className="control-hint">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

export function ControlsPanel({
  structures,
  topName,
  onTopNameChange,
  layers,
  selectedLayer,
  onLayerChange,
  boundaryLayer,
  onBoundaryLayerChange,
  params,
  onParamsChange,
}: Props) {
  const set = <K extends keyof EtchParams>(key: K, value: EtchParams[K]) => onParamsChange({ ...params, [key]: value })

  return (
    <div className="controls">
      {structures.length > 1 && (
        <Row label="Top-level cell">
          <select value={topName ?? ''} onChange={(e) => onTopNameChange(e.target.value)}>
            {structures.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
      )}

      <Row label="Etch mask layer">
        <select
          value={selectedLayer ? `${selectedLayer.layer}:${selectedLayer.datatype}` : ''}
          onChange={(e) => {
            const [layer, datatype] = e.target.value.split(':').map(Number)
            onLayerChange({ layer, datatype })
          }}
        >
          {layers.map((l) => (
            <option key={`${l.layer}:${l.datatype}`} value={`${l.layer}:${l.datatype}`}>
              Layer {l.layer} / datatype {l.datatype}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Wafer/die outline" hint="Optional — shown as flat context around the etched patch, at full detail">
        <select
          value={boundaryLayer ? `${boundaryLayer.layer}:${boundaryLayer.datatype}` : 'none'}
          onChange={(e) => {
            if (e.target.value === 'none') {
              onBoundaryLayerChange(null)
              return
            }
            const [layer, datatype] = e.target.value.split(':').map(Number)
            onBoundaryLayerChange({ layer, datatype })
          }}
        >
          <option value="none">None</option>
          {layers.map((l) => (
            <option key={`${l.layer}:${l.datatype}`} value={`${l.layer}:${l.datatype}`}>
              Layer {l.layer} / datatype {l.datatype}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Layer meaning">
        <select
          value={params.polarity}
          onChange={(e) => set('polarity', e.target.value as MaskPolarity)}
        >
          <option value="layerIsOpening">Drawn shapes = etch openings</option>
          <option value="layerIsProtect">Drawn shapes = protective mask</option>
        </select>
      </Row>

      <Row label={`Etch time: ${params.timeMin.toFixed(1)} min`} hint={`~${(params.rate100UmPerMin * params.timeMin).toFixed(2)} µm max depth`}>
        <input
          type="range"
          min={0}
          max={240}
          step={0.5}
          value={params.timeMin}
          onChange={(e) => set('timeMin', Number(e.target.value))}
        />
      </Row>

      <Row label={`(100) etch rate: ${params.rate100UmPerMin.toFixed(2)} µm/min`}>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.05}
          value={params.rate100UmPerMin}
          onChange={(e) => set('rate100UmPerMin', Number(e.target.value))}
        />
      </Row>

      <Row
        label={`Convex-corner undercut rate: ${params.undercutRateUmPerMin.toFixed(2)} µm/min`}
        hint="Approximate; set to 0 to disable undercut modeling"
      >
        <input
          type="range"
          min={0}
          max={3}
          step={0.05}
          value={params.undercutRateUmPerMin}
          onChange={(e) => set('undercutRateUmPerMin', Number(e.target.value))}
        />
      </Row>

      <Row
        label={`Grid resolution: ${params.resolution} cells`}
        hint="Resolves just the mask geometry, so this stays sharp regardless of wafer size"
      >
        <input
          type="range"
          min={64}
          max={768}
          step={32}
          value={params.resolution}
          onChange={(e) => set('resolution', Number(e.target.value))}
        />
      </Row>

      <Row
        label={`Domain margin: ${params.marginEnabled ? `${(params.marginFraction * 100).toFixed(0)}%` : 'off'}`}
        hint={
          params.marginEnabled
            ? "Extra protected silicon padding added around the mask. Only needed if the mask itself wasn't drawn with its own spacing/compensation — otherwise this pads on top of what you designed."
            : boundaryLayer
              ? 'Off: the Wafer/die outline layer’s own drawn geometry defines the margin instead, clipped to a sensible local area.'
              : 'Off: the domain is exactly the mask’s own bounding box, with no padding. Set a Wafer/die outline layer above to use its real geometry as the margin instead.'
        }
      >
        <div className="control-margin-row">
          <input
            type="checkbox"
            checked={params.marginEnabled}
            onChange={(e) => set('marginEnabled', e.target.checked)}
            aria-label="Enable domain margin"
          />
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={params.marginFraction}
            disabled={!params.marginEnabled}
            onChange={(e) => set('marginFraction', Number(e.target.value))}
          />
        </div>
      </Row>
    </div>
  )
}
