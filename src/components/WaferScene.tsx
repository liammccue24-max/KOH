import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { computeBoundingBox, type BoundingBox, type EtchResult, type Polygon } from '../sim/types.ts'
import { rasterizePolygons, type GridSpec } from '../sim/raster.ts'
import { depthToColor, MASK_COLOR } from './depthColor.ts'
import type { MaskAppearance } from './maskAppearance.ts'
import { getGnomeTexture } from '../lib/gnomeTexture.ts'

export type CameraViewPreset = 'iso' | 'top'

interface Props {
  results: EtchResult[]
  boundaryPolygonsUm: Polygon[] | null
  verticalExaggeration: number
  maskAppearance: MaskAppearance
  viewPreset: CameraViewPreset
}

// A thin sliver-like feature (e.g. a 25um pad on a 500um-wide trace) can be
// only a few screen pixels wide under the default isometric angle -- easy to
// misread as a rendering glitch rather than the real, correctly-drawn shape
// it is. 'top' looks straight down instead, where every edge reads as the
// plain rectilinear shape it actually is. Not exactly (0,1,0): a camera
// forward vector exactly parallel to the up vector is a gimbal-lock
// singularity (roll becomes undefined), so a tiny lateral nudge keeps the
// orientation numerically stable while still reading as top-down.
const VIEW_DIRECTIONS: Record<CameraViewPreset, THREE.Vector3> = {
  iso: new THREE.Vector3(0.6, 0.55, 0.75).normalize(),
  top: new THREE.Vector3(0.0001, 1, 0).normalize(),
}

const CONTEXT_RESOLUTION = 260
const CAMERA_FOV_DEG = 40
// How many times the mask's fill pattern (currently only the gnome
// texture) repeats across the longer axis of a mesh. Tied to grid-index
// fraction rather than physical microns, so it looks like the same size
// pattern regardless of whether a patch is 50um or 5cm across.
const PATCH_PATTERN_TILES = 5
const CONTEXT_PATTERN_TILES = 20

function patchBoundingBox(result: EtchResult): BoundingBox {
  return {
    minX: result.originXUm,
    minY: result.originYUm,
    maxX: result.originXUm + result.width * result.cellSizeXUm,
    maxY: result.originYUm + result.height * result.cellSizeYUm,
  }
}

function unionBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }
}

/**
 * Per-vertex normals for a regular height-field grid, via central
 * differences against the neighboring grid positions (forward/backward
 * difference at the edges). `BufferGeometry.computeVertexNormals()` is a
 * generic implementation that walks every face and accumulates into
 * temporary per-triangle vectors; measured against this on an identical
 * mesh it was 3-10x slower and highly variable (GC pressure from all those
 * temporaries), which was the actual cause of the interaction lag reported
 * after the previous change -- rebuilding the whole geometry (necessary,
 * since depth values change) was never the expensive part, recomputing
 * normals generically was. This exploits the fixed grid topology to do it
 * in a single allocation-free pass instead.
 */
function computeHeightFieldNormals(positions: Float32Array, width: number, height: number): Float32Array {
  const normals = new Float32Array(width * height * 3)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const cl = col > 0 ? col - 1 : col
      const cr = col < width - 1 ? col + 1 : col
      const rt = row > 0 ? row - 1 : row
      const rb = row < height - 1 ? row + 1 : row
      const iL = (row * width + cl) * 3
      const iR = (row * width + cr) * 3
      const iT = (rt * width + col) * 3
      const iB = (rb * width + col) * 3

      const dx = positions[iR] - positions[iL]
      const dyx = positions[iR + 1] - positions[iL + 1]
      const dz = positions[iB + 2] - positions[iT + 2]
      const dyz = positions[iB + 1] - positions[iT + 1]

      // normal = normalize(cross(tangent_z, tangent_x))
      const nx = -dz * dyx
      const ny = dz * dx
      const nz = -dyz * dx
      const len = Math.hypot(nx, ny, nz) || 1

      normals[i * 3] = nx / len
      normals[i * 3 + 1] = ny / len
      normals[i * 3 + 2] = nz / len
    }
  }
  return normals
}

/**
 * One fine, physically-resolved etch patch: always built at full grid
 * resolution around just its own mask geometry's bounding box (see
 * simulateEtch -- each spatially-separate feature is simulated
 * independently, see clusterPolygons), positioned at (centerXUm, centerZUm)
 * in shared scene space.
 */
function buildPatchGeometry(result: EtchResult, verticalExaggeration: number, centerXUm: number, centerZUm: number): THREE.BufferGeometry {
  const { width, height, cellSizeXUm, cellSizeYUm, originXUm, originYUm, depthUm, finalProtect, maxActualDepthUm } = result

  const positions = new Float32Array(width * height * 3)
  const colors = new Float32Array(width * height * 3)
  const protect = new Float32Array(width * height)
  const patternUv = new Float32Array(width * height * 2)
  const longerAxis = Math.max(width, height)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const xUm = originXUm + (col + 0.5) * cellSizeXUm - centerXUm
      const zUm = originYUm + (row + 0.5) * cellSizeYUm - centerZUm
      const depth = depthUm[i]
      const yUm = -depth * verticalExaggeration

      positions[i * 3] = xUm
      positions[i * 3 + 1] = yUm
      positions[i * 3 + 2] = zUm

      const [r, g, b] = depthToColor(depth, maxActualDepthUm)
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b

      protect[i] = finalProtect[i]
      patternUv[i * 2] = (col / longerAxis) * PATCH_PATTERN_TILES
      patternUv[i * 2 + 1] = (row / longerAxis) * PATCH_PATTERN_TILES
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
  geometry.setAttribute('protect', new THREE.BufferAttribute(protect, 1))
  geometry.setAttribute('patternUv', new THREE.BufferAttribute(patternUv, 2))
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(computeHeightFieldNormals(positions, width, height), 3))
  geometry.setIndex(indices)
  return geometry
}

/**
 * A flat, uniformly-colored disc/shape triangulated directly from a
 * wafer/die outline layer -- pure geometry, no etch physics -- giving
 * wafer-scale context around the fine patches without needing (or being
 * limited by) a single grid resolution shared across both vastly
 * different scales. Each patch's own bounding box is cut out of this mesh
 * entirely (not just offset slightly below it): a small constant Y offset
 * to avoid z-fighting scales with the *overall* scene, but the actual
 * z-buffer precision available at a given camera distance does not scale
 * the same way, so a offset that was enough separation for one design
 * silently stopped being enough for a much smaller one, and the patch
 * flickered in and out under the context mesh instead of rendering on top
 * of it. Removing the overlap entirely removes the possibility of
 * z-fighting regardless of scale.
 */
function buildContextGeometry(boundaryPolygonsUm: Polygon[], holeBoxes: BoundingBox[], centerXUm: number, centerZUm: number): THREE.BufferGeometry {
  const bbox = computeBoundingBox(boundaryPolygonsUm)
  const spanX = Math.max(bbox.maxX - bbox.minX, 1e-6)
  const spanY = Math.max(bbox.maxY - bbox.minY, 1e-6)
  const longerSpan = Math.max(spanX, spanY)
  const cellSizeUm = longerSpan / CONTEXT_RESOLUTION
  const width = Math.max(4, Math.round(spanX / cellSizeUm))
  const height = Math.max(4, Math.round(spanY / cellSizeUm))
  const originXUm = bbox.minX
  const originYUm = bbox.minY

  const grid: GridSpec = { width, height, cellSizeXUm: cellSizeUm, cellSizeYUm: cellSizeUm, originXUm, originYUm }
  const inside = rasterizePolygons(boundaryPolygonsUm, grid)

  const positions = new Float32Array(width * height * 3)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      positions[i * 3] = originXUm + (col + 0.5) * cellSizeUm - centerXUm
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = originYUm + (row + 0.5) * cellSizeUm - centerZUm
    }
  }

  const [r, g, b] = MASK_COLOR
  const colors = new Float32Array(width * height * 3)
  const protect = new Float32Array(width * height)
  const patternUv = new Float32Array(width * height * 2)
  const longerAxis = Math.max(width, height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b
      protect[i] = 1
      patternUv[i * 2] = (col / longerAxis) * CONTEXT_PATTERN_TILES
      patternUv[i * 2 + 1] = (row / longerAxis) * CONTEXT_PATTERN_TILES
    }
  }

  const inHole = (col: number, row: number): boolean => {
    const x = originXUm + (col + 0.5) * cellSizeUm
    const y = originYUm + (row + 0.5) * cellSizeUm
    for (const box of holeBoxes) {
      if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) return true
    }
    return false
  }

  const indices: number[] = []
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col
      const b2 = row * width + col + 1
      const c = (row + 1) * width + col
      const d = (row + 1) * width + col + 1
      if (!inside[a] || !inside[b2] || !inside[c] || !inside[d]) continue
      if (inHole(col, row) || inHole(col + 1, row) || inHole(col, row + 1) || inHole(col + 1, row + 1)) continue
      indices.push(a, c, b2, b2, c, d)
    }
  }

  // Flat mesh -- every normal is simply "up", no need to derive it.
  const normals = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) normals[i * 3 + 1] = 1

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('protect', new THREE.BufferAttribute(protect, 1))
  geometry.setAttribute('patternUv', new THREE.BufferAttribute(patternUv, 2))
  geometry.setIndex(indices)
  return geometry
}

/**
 * Wraps a MeshStandardMaterial so the hard-mask color/pattern is a live
 * uniform instead of baked vertex colors -- both so it can be changed
 * without rebuilding geometry, and so the mask never paints any part of a
 * sloped sidewall triangle, only the still-undisplaced flat surface.
 *
 * A cell right at a mask edge shares a triangle with its first open
 * neighbor, whose vertex has already dropped to that neighbor's own etch
 * depth (not zero -- see buildPatchGeometry). Gating purely on the
 * `protect` attribute (as an earlier version did, via `step(0.5, vProtect)`
 * on its interpolated value) draws mask color across whatever half of that
 * triangle is barycentrically closer to the protected vertex -- but since
 * height is interpolated the same linear way across that same triangle,
 * that half has *already* started dropping below the original surface.
 * The result was mask color visibly painted onto part of the downward
 * slope, when physically the mask sits perfectly flat right up to its edge
 * and stops -- the slope belongs entirely to open silicon, which only
 * loses its "protected" status to begin with via convex-corner undercut
 * (see corners.ts), never by the mask itself extending onto a surface
 * that's already been etched away.
 *
 * The fix adds a second gate on the fragment's own interpolated local
 * height (`vLocalHeightUm`, the raw pre-transform `position.y` -- already
 * `-depth * verticalExaggeration`, so exactly 0 only where nothing has
 * been etched yet): mask color can only appear where the surface is *both*
 * protected *and* still sitting at that undisplaced height. The instant a
 * fragment's interpolated height drops at all, it falls back to the
 * ordinary vertex-color interpolation between depth-ramp colors (see
 * depthToColor -- a protected vertex already bakes to the same zero-depth
 * color the ramp would give it, so that fallback is never mask-tinted
 * either). `uniforms` is shared (and mutated in place, not replaced) across
 * every material built this way so all of them update together and
 * without needing a shader recompile when the mask color/pattern changes.
 */
function createMaskAwareMaterial(
  params: THREE.MeshStandardMaterialParameters,
  uniforms: { uMaskColor: { value: THREE.Color }; uUseMaskTexture: { value: number }; uMaskTexture: { value: THREE.Texture } },
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, ...params })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float protect;\nattribute vec2 patternUv;\nvarying float vProtect;\nvarying vec2 vPatternUv;\nvarying float vLocalHeightUm;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvProtect = protect;\nvPatternUv = patternUv;\nvLocalHeightUm = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uMaskColor;\nuniform sampler2D uMaskTexture;\nuniform float uUseMaskTexture;\nvarying float vProtect;\nvarying vec2 vPatternUv;\nvarying float vLocalHeightUm;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 maskColor = uUseMaskTexture > 0.5 ? texture2D(uMaskTexture, vPatternUv).rgb : uMaskColor;
          float stillUndisplaced = step(-0.0005, vLocalHeightUm);
          float isMask = stillUndisplaced * step(0.5, vProtect);
          diffuseColor.rgb = mix(diffuseColor.rgb, maskColor, isMask);
        }`,
      )
  }
  return material
}

function SceneContent({ results, boundaryPolygonsUm, verticalExaggeration, maskAppearance, viewPreset }: Props) {
  const { camera } = useThree()
  // The maxSpan/preset the camera was last positioned/aimed for (0/null = never).
  const framedSpanRef = useRef(0)
  const framedViewRef = useRef<CameraViewPreset | null>(null)
  const controlsRef = useRef<OrbitControlsImpl>(null)

  // Shared, mutated-in-place uniforms for both mask-colored materials
  // (patch + context) -- see createMaskAwareMaterial. A ref rather than
  // state because updating a Color/texture in place should not trigger a
  // React re-render or geometry rebuild; only the uniform value itself
  // needs to change for the next frame to pick it up.
  const maskUniformsRef = useRef<{ uMaskColor: { value: THREE.Color }; uUseMaskTexture: { value: number }; uMaskTexture: { value: THREE.Texture } } | null>(null)
  if (!maskUniformsRef.current) {
    const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    placeholder.needsUpdate = true
    maskUniformsRef.current = {
      uMaskColor: { value: new THREE.Color(maskAppearance.kind === 'color' ? maskAppearance.hex : '#ffffff') },
      uUseMaskTexture: { value: maskAppearance.kind === 'gnomes' ? 1 : 0 },
      uMaskTexture: { value: placeholder },
    }
  }
  useEffect(() => {
    const uniforms = maskUniformsRef.current
    if (!uniforms) return
    if (maskAppearance.kind === 'gnomes') {
      uniforms.uMaskTexture.value = getGnomeTexture().texture
      uniforms.uUseMaskTexture.value = 1
    } else {
      uniforms.uMaskColor.value.set(maskAppearance.hex)
      uniforms.uUseMaskTexture.value = 0
    }
  }, [maskAppearance])

  const patchMaterial = useMemo(
    () => createMaskAwareMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0.05 }, maskUniformsRef.current!),
    [],
  )
  const contextMaterial = useMemo(
    () => createMaskAwareMaterial({ side: THREE.DoubleSide, roughness: 0.9, metalness: 0.05 }, maskUniformsRef.current!),
    [],
  )
  // Not JSX children, so (like the hand-built geometries below) r3f never
  // takes ownership of disposing these.
  useEffect(() => {
    return () => {
      patchMaterial.dispose()
      contextMaterial.dispose()
    }
  }, [patchMaterial, contextMaterial])

  const combinedPatchBox = useMemo(() => results.map(patchBoundingBox).reduce((acc, b) => (acc ? unionBox(acc, b) : b), null as BoundingBox | null), [results])
  const boundaryBox = boundaryPolygonsUm ? computeBoundingBox(boundaryPolygonsUm) : null

  const centerXUm = boundaryBox ? (boundaryBox.minX + boundaryBox.maxX) / 2 : combinedPatchBox ? (combinedPatchBox.minX + combinedPatchBox.maxX) / 2 : 0
  const centerZUm = boundaryBox ? (boundaryBox.minY + boundaryBox.maxY) / 2 : combinedPatchBox ? (combinedPatchBox.minY + combinedPatchBox.maxY) / 2 : 0

  const combinedPatchSpan = combinedPatchBox ? Math.max(combinedPatchBox.maxX - combinedPatchBox.minX, combinedPatchBox.maxY - combinedPatchBox.minY) : 0
  const boundarySpan = boundaryBox ? Math.max(boundaryBox.maxX - boundaryBox.minX, boundaryBox.maxY - boundaryBox.minY) : 0

  // A patch's *lateral* span alone isn't a safe bound on the scene's actual
  // size: self-limiting geometry normally keeps depth well under the
  // lateral span, but a fully-undercut/no-longer-self-limiting patch (every
  // cell open, nothing left to measure distance against) is capped only by
  // rate*time, which can grow far past the lateral domain -- e.g. a 40um
  // mesa fully consumed by undercut, still etching a flat 240um-deep floor.
  // Fold in the worst-case depth so a deep patch never ends up taller than
  // the camera's far plane and silently disappears.
  const maxPossibleDepth = results.reduce((max, r) => Math.max(max, r.maxPossibleDepthUm), 0)
  const verticalExtent = maxPossibleDepth * verticalExaggeration
  const maxSpan = Math.max(combinedPatchSpan, boundarySpan, verticalExtent, 1e-6)
  // The scene's geometry only extends downward from y=0 (the original
  // surface); looking at y=0 itself wastes half the frame on empty space
  // above the wafer once a deep etch's vertical extent starts to dominate,
  // so aim at the vertical midpoint of the worst-case depth instead.
  const targetY = -verticalExtent / 2

  // How close the camera can zoom is bounded by the smallest patch (so any
  // feature, however fine, can be inspected closely), not the whole scene.
  const smallestPatchSpan = results.reduce((min, r) => Math.min(min, Math.max(r.width * r.cellSizeXUm, r.height * r.cellSizeYUm)), Infinity)
  const minDistance = Number.isFinite(smallestPatchSpan) ? smallestPatchSpan * 0.03 : maxSpan * 0.03
  const maxDistance = maxSpan * 3

  const patchGeometries = useMemo(
    () => results.map((result) => buildPatchGeometry(result, verticalExaggeration, centerXUm, centerZUm)),
    [results, verticalExaggeration, centerXUm, centerZUm],
  )
  const patchBoxes = useMemo(() => results.map(patchBoundingBox), [results])
  // A patch's bounding box only depends on its mask geometry/margin/
  // resolution, never on etch time/rate/undercut -- but `results` gets a
  // new array of new objects on every debounced parameter change
  // regardless of which fields actually changed. Keying off that array
  // reference directly rebuilt the whole context mesh (a 260x260 grid,
  // hole-cut against every patch) on every slider tweak, not just ones
  // that could have moved a box. This key is stable across changes that
  // don't affect box values, so those tweaks skip the rebuild entirely.
  const patchBoxesKey = patchBoxes.map((b) => `${b.minX},${b.minY},${b.maxX},${b.maxY}`).join('|')
  const contextGeometry = useMemo(
    () => (boundaryPolygonsUm ? buildContextGeometry(boundaryPolygonsUm, patchBoxes, centerXUm, centerZUm) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- patchBoxesKey stands in for patchBoxes' values on purpose
    [boundaryPolygonsUm, patchBoxesKey, centerXUm, centerZUm],
  )

  // These BufferGeometry objects are built by hand (not declared as JSX
  // children), so react-three-fiber never takes ownership of disposing
  // them -- passing a fresh one as `geometry={...}` just orphans the old
  // one's GPU-side buffers. Without this, every parameter change leaked a
  // full position/color/index buffer set, and interaction got visibly
  // slower the longer a session ran.
  useEffect(() => {
    return () => {
      for (const geometry of patchGeometries) geometry.dispose()
    }
  }, [patchGeometries])
  useEffect(() => {
    return () => {
      contextGeometry?.dispose()
    }
  }, [contextGeometry])

  // Re-frame (reposition + re-aim) whenever the scene has grown well past
  // what the camera was last set up for, or the user picked a different
  // view preset -- not on every render, so normal small parameter tweaks
  // don't fight the user's manual orbit/zoom, but reliably enough that an
  // interactively-deepening etch (see maxSpan above) can't grow the
  // geometry out past a camera that's still framed for the shallow scene
  // it started as. This runs in an effect (after commit), not inline
  // during render: OrbitControls.update() clamps the new camera distance
  // against its own minDistance/maxDistance, and those are only current on
  // the underlying object once react-three-fiber has applied this
  // render's (possibly just-grown) prop values to it -- doing this inline
  // mid-render was clamping against the *previous* render's still-small
  // maxDistance, silently undoing the reframe.
  useEffect(() => {
    const spanGrew = maxSpan > framedSpanRef.current * 1.2
    const viewChanged = viewPreset !== framedViewRef.current
    if (!spanGrew && !viewChanged) return
    // Distance derived from the actual vertical FOV (matching the Canvas's
    // camera={{ fov: 40 }}) rather than an arbitrary multiplier, so the
    // full maxSpan reliably fits in view regardless of scale -- an ad-hoc
    // constant here previously under-framed depth-dominated scenes (a
    // shallow-but-wide etch and a narrow-but-deep one need very different
    // distances to show their full extent, which a single fixed multiplier
    // can't give both). The 1.35 factor is slack for the diagonal viewing
    // angle and portrait/narrow viewports, where the binding constraint is
    // horizontal rather than vertical FOV.
    const halfFovRad = ((CAMERA_FOV_DEG / 2) * Math.PI) / 180
    const cameraDistance = (maxSpan / 2 / Math.tan(halfFovRad)) * 1.35
    const dir = VIEW_DIRECTIONS[viewPreset]
    camera.position.set(dir.x * cameraDistance, targetY + dir.y * cameraDistance, dir.z * cameraDistance)
    camera.lookAt(0, targetY, 0)
    // OrbitControls tracks its own target/spherical state independently of
    // the camera object; setting camera.position directly is not enough --
    // on its next internal update() it recomputes the camera position from
    // that tracked state and silently overwrites what was just set here.
    // Reset its target and force a sync so the reframe actually sticks.
    if (controlsRef.current) {
      controlsRef.current.target.set(0, targetY, 0)
      controlsRef.current.update()
    }
    framedSpanRef.current = maxSpan
    framedViewRef.current = viewPreset
  }, [camera, maxSpan, targetY, viewPreset])

  // Fixed near/far planes lose almost all depth-buffer precision once the
  // scene scale is very different from them (e.g. a 150mm wafer against a
  // fine etch patch), which shows up as flickery z-fighting noise on
  // near-coincident surfaces like a patch/context seam -- so these are
  // bounded to the actual zoom range instead of a fixed default. That range
  // (via maxSpan, above) has to be recomputed on every render, not just
  // once at mount: an interactively-deepening etch can grow the scene's
  // vertical extent well past what the camera was originally framed for,
  // and a stale far plane then clips the geometry into invisibility.
  if (camera instanceof THREE.PerspectiveCamera) {
    const desiredNear = minDistance * 0.2
    const desiredFar = maxDistance * 3
    if (camera.near !== desiredNear || camera.far !== desiredFar) {
      camera.near = desiredNear
      camera.far = desiredFar
      camera.updateProjectionMatrix()
    }
  }

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[maxSpan, maxSpan * 1.2, maxSpan * 0.5]} intensity={1.1} />
      <directionalLight position={[-maxSpan, maxSpan * 0.4, -maxSpan]} intensity={0.35} />
      {contextGeometry && <mesh geometry={contextGeometry} material={contextMaterial} />}
      {patchGeometries.map((geometry, i) => (
        <mesh key={i} geometry={geometry} material={patchMaterial} />
      ))}
      <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} minDistance={minDistance} maxDistance={maxDistance} />
    </>
  )
}

export function WaferScene({ results, boundaryPolygonsUm, verticalExaggeration, maskAppearance, viewPreset }: Props) {
  return (
    <Canvas className="wafer-canvas" camera={{ fov: CAMERA_FOV_DEG, near: 0.01, far: 1e6 }}>
      <SceneContent
        results={results}
        boundaryPolygonsUm={boundaryPolygonsUm}
        verticalExaggeration={verticalExaggeration}
        maskAppearance={maskAppearance}
        viewPreset={viewPreset}
      />
    </Canvas>
  )
}
