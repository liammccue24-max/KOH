import { useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { computeBoundingBox, type BoundingBox, type EtchResult, type Polygon } from '../sim/types.ts'
import { rasterizePolygons, type GridSpec } from '../sim/raster.ts'
import { depthToColor, MASK_COLOR } from './depthColor.ts'

interface Props {
  results: EtchResult[]
  boundaryPolygonsUm: Polygon[] | null
  verticalExaggeration: number
}

const CONTEXT_RESOLUTION = 260

function patchBoundingBox(result: EtchResult): BoundingBox {
  return {
    minX: result.originXUm,
    minY: result.originYUm,
    maxX: result.originXUm + result.width * result.cellSizeUm,
    maxY: result.originYUm + result.height * result.cellSizeUm,
  }
}

function unionBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }
}

/**
 * One fine, physically-resolved etch patch: always built at full grid
 * resolution around just its own mask geometry's bounding box (see
 * simulateEtch -- each spatially-separate feature is simulated
 * independently, see clusterPolygons), positioned at (centerXUm, centerZUm)
 * in shared scene space.
 */
function buildPatchGeometry(result: EtchResult, verticalExaggeration: number, centerXUm: number, centerZUm: number): THREE.BufferGeometry {
  const { width, height, cellSizeUm, originXUm, originYUm, depthUm, finalProtect, maxActualDepthUm } = result

  const positions = new Float32Array(width * height * 3)
  const colors = new Float32Array(width * height * 3)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const xUm = originXUm + (col + 0.5) * cellSizeUm - centerXUm
      const zUm = originYUm + (row + 0.5) * cellSizeUm - centerZUm
      const depth = depthUm[i]
      const yUm = -depth * verticalExaggeration

      positions[i * 3] = xUm
      positions[i * 3 + 1] = yUm
      positions[i * 3 + 2] = zUm

      const [r, g, b] = depthToColor(depth, maxActualDepthUm, finalProtect[i] === 1)
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b
    }
  }

  const indices: number[] = []
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col
      const b = row * width + col + 1
      const c = (row + 1) * width + col
      const d = (row + 1) * width + col + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A flat, uniformly-colored disc/shape triangulated directly from a
 * wafer/die outline layer -- pure geometry, no etch physics -- giving
 * wafer-scale context around the fine patches without needing (or being
 * limited by) a single grid resolution shared across both vastly
 * different scales. Sits a hair below y=0 so each patch's own flat margin
 * renders seamlessly on top of it with no z-fighting.
 */
function buildContextGeometry(boundaryPolygonsUm: Polygon[], centerXUm: number, centerZUm: number, maxSpanUm: number): THREE.BufferGeometry {
  const bbox = computeBoundingBox(boundaryPolygonsUm)
  const spanX = Math.max(bbox.maxX - bbox.minX, 1e-6)
  const spanY = Math.max(bbox.maxY - bbox.minY, 1e-6)
  const longerSpan = Math.max(spanX, spanY)
  const cellSizeUm = longerSpan / CONTEXT_RESOLUTION
  const width = Math.max(4, Math.round(spanX / cellSizeUm))
  const height = Math.max(4, Math.round(spanY / cellSizeUm))
  const originXUm = bbox.minX
  const originYUm = bbox.minY

  const grid: GridSpec = { width, height, cellSizeUm, originXUm, originYUm }
  const inside = rasterizePolygons(boundaryPolygonsUm, grid)

  const yUm = -maxSpanUm * 0.0005 // tiny, scale-relative drop to avoid z-fighting with a patch's flat margin

  const positions = new Float32Array(width * height * 3)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      positions[i * 3] = originXUm + (col + 0.5) * cellSizeUm - centerXUm
      positions[i * 3 + 1] = yUm
      positions[i * 3 + 2] = originYUm + (row + 0.5) * cellSizeUm - centerZUm
    }
  }

  const [r, g, b] = MASK_COLOR
  const colors = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }

  const indices: number[] = []
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col
      const b2 = row * width + col + 1
      const c = (row + 1) * width + col
      const d = (row + 1) * width + col + 1
      if (!inside[a] || !inside[b2] || !inside[c] || !inside[d]) continue
      indices.push(a, c, b2, b2, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function SceneContent({ results, boundaryPolygonsUm, verticalExaggeration }: Props) {
  const { camera } = useThree()
  const didInitCamera = useRef(false)

  const combinedPatchBox = useMemo(() => results.map(patchBoundingBox).reduce((acc, b) => (acc ? unionBox(acc, b) : b), null as BoundingBox | null), [results])
  const boundaryBox = boundaryPolygonsUm ? computeBoundingBox(boundaryPolygonsUm) : null

  const centerXUm = boundaryBox ? (boundaryBox.minX + boundaryBox.maxX) / 2 : combinedPatchBox ? (combinedPatchBox.minX + combinedPatchBox.maxX) / 2 : 0
  const centerZUm = boundaryBox ? (boundaryBox.minY + boundaryBox.maxY) / 2 : combinedPatchBox ? (combinedPatchBox.minY + combinedPatchBox.maxY) / 2 : 0

  const combinedPatchSpan = combinedPatchBox ? Math.max(combinedPatchBox.maxX - combinedPatchBox.minX, combinedPatchBox.maxY - combinedPatchBox.minY) : 0
  const boundarySpan = boundaryBox ? Math.max(boundaryBox.maxX - boundaryBox.minX, boundaryBox.maxY - boundaryBox.minY) : 0
  const maxSpan = Math.max(combinedPatchSpan, boundarySpan, 1e-6)

  // How close the camera can zoom is bounded by the smallest patch (so any
  // feature, however fine, can be inspected closely), not the whole scene.
  const smallestPatchSpan = results.reduce((min, r) => Math.min(min, Math.max(r.width * r.cellSizeUm, r.height * r.cellSizeUm)), Infinity)
  const minDistance = Number.isFinite(smallestPatchSpan) ? smallestPatchSpan * 0.03 : maxSpan * 0.03
  const maxDistance = maxSpan * 3

  const patchGeometries = useMemo(
    () => results.map((result) => buildPatchGeometry(result, verticalExaggeration, centerXUm, centerZUm)),
    [results, verticalExaggeration, centerXUm, centerZUm],
  )
  const contextGeometry = useMemo(
    () => (boundaryPolygonsUm ? buildContextGeometry(boundaryPolygonsUm, centerXUm, centerZUm, maxSpan) : null),
    [boundaryPolygonsUm, centerXUm, centerZUm, maxSpan],
  )

  if (!didInitCamera.current) {
    camera.position.set(maxSpan * 0.6, maxSpan * 0.55, maxSpan * 0.75)
    camera.lookAt(0, 0, 0)
    // Fixed near/far planes lose almost all depth-buffer precision once the
    // scene scale is very different from them (e.g. a 150mm wafer against a
    // fine etch patch), which shows up as flickery z-fighting noise on
    // near-coincident surfaces like a patch/context seam. Bound near/far to
    // the actual zoom range instead.
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = minDistance * 0.2
      camera.far = maxDistance * 3
      camera.updateProjectionMatrix()
    }
    didInitCamera.current = true
  }

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[maxSpan, maxSpan * 1.2, maxSpan * 0.5]} intensity={1.1} />
      <directionalLight position={[-maxSpan, maxSpan * 0.4, -maxSpan]} intensity={0.35} />
      {contextGeometry && (
        <mesh geometry={contextGeometry}>
          <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.9} metalness={0.05} />
        </mesh>
      )}
      {patchGeometries.map((geometry, i) => (
        <mesh key={i} geometry={geometry}>
          <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.85} metalness={0.05} />
        </mesh>
      ))}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={minDistance} maxDistance={maxDistance} />
    </>
  )
}

export function WaferScene({ results, boundaryPolygonsUm, verticalExaggeration }: Props) {
  return (
    <Canvas className="wafer-canvas" camera={{ fov: 40, near: 0.01, far: 1e6 }}>
      <SceneContent results={results} boundaryPolygonsUm={boundaryPolygonsUm} verticalExaggeration={verticalExaggeration} />
    </Canvas>
  )
}
