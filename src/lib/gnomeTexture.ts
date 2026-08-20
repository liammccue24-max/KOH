import * as THREE from 'three'

const HAT_COLORS = ['#c0392b', '#2e7d32', '#1565c0', '#f9a825', '#7b1fa2']
const TUNIC_COLORS = ['#2e7d32', '#c0392b', '#1565c0', '#6d4c26', '#00838f']

function drawGnome(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, tilt: number, hatColor: string, tunicColor: string) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.scale(scale, scale)

  // Boots.
  ctx.fillStyle = '#4e342e'
  ctx.beginPath()
  ctx.ellipse(-9, 46, 8, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(9, 46, 8, 5, 0, 0, Math.PI * 2)
  ctx.fill()

  // Tunic.
  ctx.fillStyle = tunicColor
  ctx.beginPath()
  ctx.moveTo(-20, 44)
  ctx.lineTo(-14, 4)
  ctx.lineTo(14, 4)
  ctx.lineTo(20, 44)
  ctx.closePath()
  ctx.fill()

  // Arms.
  ctx.beginPath()
  ctx.ellipse(-19, 18, 6, 12, 0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(19, 18, 6, 12, -0.4, 0, Math.PI * 2)
  ctx.fill()

  // Belt.
  ctx.fillStyle = '#3e2723'
  ctx.fillRect(-16, 24, 32, 6)

  // Face.
  ctx.fillStyle = '#f0c39a'
  ctx.beginPath()
  ctx.ellipse(0, -6, 13, 12, 0, 0, Math.PI * 2)
  ctx.fill()

  // Rosy cheeks.
  ctx.fillStyle = '#e8927c'
  ctx.beginPath()
  ctx.ellipse(-7, -3, 3, 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(7, -3, 3, 2, 0, 0, Math.PI * 2)
  ctx.fill()

  // Eyes.
  ctx.fillStyle = '#2b2018'
  ctx.beginPath()
  ctx.arc(-5, -8, 1.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(5, -8, 1.6, 0, Math.PI * 2)
  ctx.fill()

  // Nose.
  ctx.fillStyle = '#e8a97c'
  ctx.beginPath()
  ctx.ellipse(0, -2, 3.5, 3, 0, 0, Math.PI * 2)
  ctx.fill()

  // Beard.
  ctx.fillStyle = '#f5f5f0'
  ctx.beginPath()
  ctx.moveTo(-13, -2)
  ctx.quadraticCurveTo(-14, 26, 0, 30)
  ctx.quadraticCurveTo(14, 26, 13, -2)
  ctx.quadraticCurveTo(0, 6, -13, -2)
  ctx.closePath()
  ctx.fill()

  // Hat.
  ctx.fillStyle = hatColor
  ctx.beginPath()
  ctx.moveTo(-16, -14)
  ctx.quadraticCurveTo(0, -60, 4, -62)
  ctx.quadraticCurveTo(10, -50, 15, -14)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(0, -14, 18, 5, 0, 0, Math.PI * 2)
  ctx.fill()

  // Pom-pom.
  ctx.fillStyle = '#f5f5f0'
  ctx.beginPath()
  ctx.arc(4, -62, 4, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

function buildGnomeCanvas(): HTMLCanvasElement {
  const size = 320
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  ctx.fillStyle = '#f4e9d8'
  ctx.fillRect(0, 0, size, size)

  const cols = 3
  const rows = 3
  let n = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const jitterX = (row % 2 === 0 ? 1 : -1) * (size / cols) * 0.12
      const cx = ((col + 0.5) / cols) * size + jitterX
      const cy = ((row + 0.5) / rows) * size
      const hat = HAT_COLORS[n % HAT_COLORS.length]
      const tunic = TUNIC_COLORS[(n + 2) % TUNIC_COLORS.length]
      const tilt = (n % 2 === 0 ? -1 : 1) * 0.12
      drawGnome(ctx, cx, cy, 0.62, tilt, hat, tunic)
      n++
    }
  }
  return canvas
}

let cached: { texture: THREE.CanvasTexture; dataUrl: string } | null = null

/**
 * A whimsical repeating hard-mask pattern -- a tongue-in-cheek alternative
 * to a flat mask color. Built once and cached (the drawing is deterministic,
 * no randomness), both as a THREE.CanvasTexture for the 3D scene and as a
 * data URL so the color picker can show the same pattern as a swatch
 * preview instead of a generic icon.
 */
export function getGnomeTexture(): { texture: THREE.CanvasTexture; dataUrl: string } {
  if (cached) return cached
  const canvas = buildGnomeCanvas()
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  cached = { texture, dataUrl: canvas.toDataURL('image/png') }
  return cached
}
