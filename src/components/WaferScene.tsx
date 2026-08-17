import { useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { EtchResult } from '../sim/types.ts'
import { depthToColor } from './depthColor.ts'

interface Props {
  result: EtchResult
  verticalExaggeration: number
}

function buildGeometry(result: EtchResult, verticalExaggeration: number): THREE.BufferGeometry {
  const { width, height, cellSizeUm, depthUm, finalProtect, outsideWafer, maxActualDepthUm } = result
  const spanX = width * cellSizeUm
  const spanZ = height * cellSizeUm
  const centerX = spanX / 2
  const centerZ = spanZ / 2

  const positions = new Float32Array(width * height * 3)
  const colors = new Float32Array(width * height * 3)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const xUm = (col + 0.5) * cellSizeUm - centerX
      const zUm = (row + 0.5) * cellSizeUm - centerZ
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

  // Skip any quad touching a cell outside the wafer/die boundary layer (when
  // one was given), so the mesh reads as the true wafer/die shape (e.g. a
  // circular disc) instead of its rectangular bounding box.
  const indices: number[] = []
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col
      const b = row * width + col + 1
      const c = (row + 1) * width + col
      const d = (row + 1) * width + col + 1
      if (outsideWafer && (outsideWafer[a] || outsideWafer[b] || outsideWafer[c] || outsideWafer[d])) continue
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

function SceneContent({ result, verticalExaggeration }: Props) {
  const geometry = useMemo(() => buildGeometry(result, verticalExaggeration), [result, verticalExaggeration])
  const { camera } = useThree()
  const didInitCamera = useRef(false)

  const spanX = result.width * result.cellSizeUm
  const spanZ = result.height * result.cellSizeUm
  const maxSpan = Math.max(spanX, spanZ)

  if (!didInitCamera.current) {
    camera.position.set(maxSpan * 0.6, maxSpan * 0.55, maxSpan * 0.75)
    camera.lookAt(0, 0, 0)
    didInitCamera.current = true
  }

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[maxSpan, maxSpan * 1.2, maxSpan * 0.5]} intensity={1.1} />
      <directionalLight position={[-maxSpan, maxSpan * 0.4, -maxSpan]} intensity={0.35} />
      <mesh geometry={geometry}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.85} metalness={0.05} />
      </mesh>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </>
  )
}

export function WaferScene({ result, verticalExaggeration }: Props) {
  return (
    <Canvas className="wafer-canvas" camera={{ fov: 40, near: 0.01, far: 1e7 }}>
      <SceneContent result={result} verticalExaggeration={verticalExaggeration} />
    </Canvas>
  )
}
