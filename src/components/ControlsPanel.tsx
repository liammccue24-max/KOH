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

      <Row label="Mask layer">
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

      <Row label={`Grid resolution: ${params.resolution} cells`}>
        <input
          type="range"
          min={64}
          max={512}
          step={32}
          value={params.resolution}
          onChange={(e) => set('resolution', Number(e.target.value))}
        />
      </Row>

      <Row label={`Domain margin: ${(params.marginFraction * 100).toFixed(0)}%`} hint="Protected silicon padding around the drawn geometry">
        <input
          type="range"
          min={0}
          max={0.5}
          step={0.01}
          value={params.marginFraction}
          onChange={(e) => set('marginFraction', Number(e.target.value))}
        />
      </Row>
    </div>
  )
}
