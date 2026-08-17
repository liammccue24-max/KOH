import { useMemo, useState } from 'react'
import { FileUpload } from './components/FileUpload.tsx'
import { ControlsPanel } from './components/ControlsPanel.tsx'
import { WaferScene } from './components/WaferScene.tsx'
import { CrossSectionView } from './components/CrossSectionView.tsx'
import { WaferMark } from './components/WaferMark.tsx'
import { parseGds } from './gds/parser.ts'
import { collectLayers, flattenLayer } from './gds/flatten.ts'
import type { GdsLibrary } from './gds/types.ts'
import { toMicrons } from './lib/units.ts'
import { base64ToArrayBuffer } from './lib/base64.ts'
import { simulateEtch } from './sim/etchSim.ts'
import { computeBoundingBox, type BoundingBox, type EtchParams } from './sim/types.ts'

type LayerKey = { layer: number; datatype: number }

function bboxArea(b: BoundingBox): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY)
}

function contains(outer: BoundingBox, inner: BoundingBox): boolean {
  return outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY
}

declare global {
  interface Window {
    // Set by scripts/pack-artifact.mjs when bundling into a single
    // self-contained HTML file, so the sample design can be loaded without
    // any network request (some artifact hosting sandboxes apply a strict
    // CSP that blocks fetch() even for data: URIs).
    __EMBEDDED_SAMPLE_GDS_BASE64__?: string
  }
}

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
  const [selectedLayer, setSelectedLayer] = useState<LayerKey | null>(null)
  const [boundaryLayer, setBoundaryLayer] = useState<LayerKey | null>(null)
  const [params, setParams] = useState<EtchParams>(DEFAULT_PARAMS)
  const [verticalExaggeration, setVerticalExaggeration] = useState(1)
  const [crossAxis, setCrossAxis] = useState<'row' | 'col'>('row')
  const [crossFraction, setCrossFraction] = useState(0.5)
  const [trueAspect, setTrueAspect] = useState(true)

  // When a file has exactly two layers and one's geometry fully contains
  // and dwarfs the other's, guess it's a wafer/die outline plus a mask
  // layer (a very common two-layer pattern) and preselect accordingly, so
  // the boundary doesn't have to be found and set by hand.
  const guessLayers = (lib: GdsLibrary, top: string, layers: LayerKey[]): { mask: LayerKey; boundary: LayerKey | null } => {
    if (layers.length !== 2) return { mask: layers[0], boundary: null }
    const bboxes = layers.map((l) => computeBoundingBox(flattenLayer(lib, top, l.layer, l.datatype).map((p) => toMicrons(p.points, lib.dbUnitInMeters))))
    const [a, b] = layers
    const [boxA, boxB] = bboxes
    const areaA = bboxArea(boxA)
    const areaB = bboxArea(boxB)
    if (areaA > areaB * 3 && contains(boxA, boxB)) return { mask: b, boundary: a }
    if (areaB > areaA * 3 && contains(boxB, boxA)) return { mask: a, boundary: b }
    return { mask: layers[0], boundary: null }
  }

  const handleFile = (buffer: ArrayBuffer, name: string) => {
    try {
      const lib = parseGds(buffer)
      if (lib.structures.size === 0) throw new Error('No structures found — is this a valid GDSII stream file?')
      const top = lib.topLevelCandidates[0]
      const layers = collectLayers(lib, top)
      if (layers.length === 0) throw new Error(`Structure "${top}" has no drawn geometry (BOUNDARY/PATH/BOX) on any layer.`)
      const guess = guessLayers(lib, top, layers)
      setLibrary(lib)
      setFileName(name)
      setTopName(top)
      setSelectedLayer(guess.mask)
      setBoundaryLayer(guess.boundary)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse GDS file.')
      setLibrary(null)
    }
  }

  const loadSampleDesign = () => {
    const embedded = window.__EMBEDDED_SAMPLE_GDS_BASE64__
    if (embedded) {
      handleFile(base64ToArrayBuffer(embedded), 'sample-koh-mask.gds')
      return
    }
    fetch('/sample-koh-mask.gds')
      .then((r) => r.arrayBuffer())
      .then((buf) => handleFile(buf, 'sample-koh-mask.gds'))
      .catch(() => setError('Could not load the sample design.'))
  }

  const layers = useMemo(() => (library && topName ? collectLayers(library, topName) : []), [library, topName])
  const structures = useMemo(() => (library ? [...library.structures.keys()].sort() : []), [library])

  const polygonsUm = useMemo(() => {
    if (!library || !topName || !selectedLayer) return null
    const flat = flattenLayer(library, topName, selectedLayer.layer, selectedLayer.datatype)
    return flat.map((p) => toMicrons(p.points, library.dbUnitInMeters))
  }, [library, topName, selectedLayer])

  const boundaryPolygonsUm = useMemo(() => {
    if (!library || !topName || !boundaryLayer) return null
    const flat = flattenLayer(library, topName, boundaryLayer.layer, boundaryLayer.datatype)
    return flat.map((p) => toMicrons(p.points, library.dbUnitInMeters))
  }, [library, topName, boundaryLayer])

  const result = useMemo(() => {
    if (!polygonsUm || polygonsUm.length === 0) return null
    try {
      return simulateEtch(polygonsUm, params, boundaryPolygonsUm)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed.')
      return null
    }
  }, [polygonsUm, boundaryPolygonsUm, params])

  const crossIndex = result
    ? Math.min(
        (crossAxis === 'row' ? result.height : result.width) - 1,
        Math.round(crossFraction * ((crossAxis === 'row' ? result.height : result.width) - 1)),
      )
    : 0

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="wafer-mark">
          <WaferMark />
        </div>
        <div className="app-header-text">
          <h1>KOH Etch Simulator</h1>
          <p>GDSII mask &rarr; anisotropic KOH etch preview, (100) Si, edges on &lt;110&gt;</p>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <div>
            <p className="section-label">Mask design</p>
            <FileUpload onFile={handleFile} fileName={fileName} />
            {!library && (
              <button type="button" className="sample-link" onClick={loadSampleDesign}>
                No file handy? Load the sample design
              </button>
            )}
          </div>
          {error && <div className="error-banner">{error}</div>}

          {library && topName && selectedLayer && (
            <div>
              <p className="section-label">Process parameters</p>
              <ControlsPanel
                structures={structures}
                topName={topName}
                onTopNameChange={(name) => {
                  setTopName(name)
                  const newLayers = collectLayers(library, name)
                  const guess = guessLayers(library, name, newLayers)
                  setSelectedLayer(guess.mask)
                  setBoundaryLayer(guess.boundary)
                }}
                layers={layers}
                selectedLayer={selectedLayer}
                onLayerChange={setSelectedLayer}
                boundaryLayer={boundaryLayer}
                onBoundaryLayerChange={setBoundaryLayer}
                params={params}
                onParamsChange={setParams}
                maxTimeMin={240}
              />
            </div>
          )}

          {result && (
            <div>
              <p className="section-label">Result</p>
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
                  <span className="legend-swatch" style={{ background: '#d9ad40' }} /> mask (protected)
                  <span className="legend-swatch" style={{ background: '#9ea8b3' }} /> original surface
                  <span className="legend-swatch" style={{ background: '#1a2431' }} /> etched (deep)
                </div>
                <div className="stat-line">Max etched depth: {result.maxActualDepthUm.toFixed(3)} µm</div>
              </div>
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
