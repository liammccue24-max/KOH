import { useMemo, useState } from 'react'
import { FileUpload } from './components/FileUpload.tsx'
import { ControlsPanel } from './components/ControlsPanel.tsx'
import { WaferScene } from './components/WaferScene.tsx'
import { CrossSectionView } from './components/CrossSectionView.tsx'
import { parseGds } from './gds/parser.ts'
import { collectLayers, flattenLayer } from './gds/flatten.ts'
import type { GdsLibrary } from './gds/types.ts'
import { toMicrons } from './lib/units.ts'
import { simulateEtch } from './sim/etchSim.ts'
import type { EtchParams } from './sim/types.ts'

const DEFAULT_PARAMS: EtchParams = {
  rate100UmPerMin: 1.0,
  undercutRateUmPerMin: 0.3,
  timeMin: 30,
  polarity: 'layerIsOpening',
  resolution: 256,
  marginFraction: 0.15,
}

function App() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [library, setLibrary] = useState<GdsLibrary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [topName, setTopName] = useState<string | null>(null)
  const [selectedLayer, setSelectedLayer] = useState<{ layer: number; datatype: number } | null>(null)
  const [params, setParams] = useState<EtchParams>(DEFAULT_PARAMS)
  const [verticalExaggeration, setVerticalExaggeration] = useState(1)
  const [crossAxis, setCrossAxis] = useState<'row' | 'col'>('row')
  const [crossFraction, setCrossFraction] = useState(0.5)
  const [trueAspect, setTrueAspect] = useState(true)

  const handleFile = (buffer: ArrayBuffer, name: string) => {
    try {
      const lib = parseGds(buffer)
      if (lib.structures.size === 0) throw new Error('No structures found — is this a valid GDSII stream file?')
      const top = lib.topLevelCandidates[0]
      const layers = collectLayers(lib, top)
      if (layers.length === 0) throw new Error(`Structure "${top}" has no drawn geometry (BOUNDARY/PATH/BOX) on any layer.`)
      setLibrary(lib)
      setFileName(name)
      setTopName(top)
      setSelectedLayer(layers[0])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse GDS file.')
      setLibrary(null)
    }
  }

  const layers = useMemo(() => (library && topName ? collectLayers(library, topName) : []), [library, topName])
  const structures = useMemo(() => (library ? [...library.structures.keys()].sort() : []), [library])

  const polygonsUm = useMemo(() => {
    if (!library || !topName || !selectedLayer) return null
    const flat = flattenLayer(library, topName, selectedLayer.layer, selectedLayer.datatype)
    return flat.map((p) => toMicrons(p.points, library.dbUnitInMeters))
  }, [library, topName, selectedLayer])

  const result = useMemo(() => {
    if (!polygonsUm || polygonsUm.length === 0) return null
    try {
      return simulateEtch(polygonsUm, params)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed.')
      return null
    }
  }, [polygonsUm, params])

  const crossIndex = result
    ? Math.min(
        (crossAxis === 'row' ? result.height : result.width) - 1,
        Math.round(crossFraction * ((crossAxis === 'row' ? result.height : result.width) - 1)),
      )
    : 0

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>KOH Anisotropic Etch Simulator</h1>
        <p>Upload a GDSII mask design and preview how it etches into a (100) silicon wafer in KOH.</p>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <FileUpload onFile={handleFile} fileName={fileName} />
          {error && <div className="error-banner">{error}</div>}

          {library && topName && selectedLayer && (
            <ControlsPanel
              structures={structures}
              topName={topName}
              onTopNameChange={(name) => {
                setTopName(name)
                const newLayers = collectLayers(library, name)
                setSelectedLayer(newLayers[0] ?? null)
              }}
              layers={layers}
              selectedLayer={selectedLayer}
              onLayerChange={setSelectedLayer}
              params={params}
              onParamsChange={setParams}
              maxTimeMin={240}
            />
          )}

          {result && (
            <div className="controls">
              <label className="control-row">
                <div className="control-label">
                  <span>3D vertical exaggeration: {verticalExaggeration.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.5}
                  value={verticalExaggeration}
                  onChange={(e) => setVerticalExaggeration(Number(e.target.value))}
                />
              </label>

              <div className="legend">
                <span className="legend-swatch" style={{ background: 'rgb(217,173,64)' }} /> mask (protected)
                <span className="legend-swatch" style={{ background: 'rgb(158,168,179)' }} /> original surface
                <span className="legend-swatch" style={{ background: 'rgb(31,41,61)' }} /> etched (deep)
              </div>
              <div className="stat-line">Max etched depth: {result.maxActualDepthUm.toFixed(3)} µm</div>
            </div>
          )}
        </aside>

        <main className="main-view">
          {!library && !error && (
            <div className="placeholder">
              <p>Load a GDSII (.gds) file to begin. The tool will parse layers, flatten cell references, and simulate anisotropic KOH etching of a (100)-oriented wafer assuming mask edges run along the &lt;110&gt; flats.</p>
            </div>
          )}

          {result && (
            <>
              <div className="view-3d">
                <WaferScene key={fileName} result={result} verticalExaggeration={verticalExaggeration} />
              </div>
              <div className="view-cross-section">
                <div className="cross-section-controls">
                  <label>
                    <input
                      type="radio"
                      name="axis"
                      checked={crossAxis === 'row'}
                      onChange={() => setCrossAxis('row')}
                    />
                    Slice along X (pick Y)
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="axis"
                      checked={crossAxis === 'col'}
                      onChange={() => setCrossAxis('col')}
                    />
                    Slice along Y (pick X)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={crossFraction}
                    onChange={(e) => setCrossFraction(Number(e.target.value))}
                  />
                  <label>
                    <input type="checkbox" checked={trueAspect} onChange={(e) => setTrueAspect(e.target.checked)} />
                    True aspect ratio
                  </label>
                </div>
                <CrossSectionView result={result} axis={crossAxis} index={crossIndex} trueAspect={trueAspect} />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
