import { useEffect, useRef } from 'react'
import type { EtchResult } from '../sim/types.ts'
import { maskAppearanceColorHex, type MaskAppearance } from './maskAppearance.ts'
import type { Theme } from '../lib/theme.ts'

interface Props {
  result: EtchResult
  axis: 'row' | 'col'
  index: number
  trueAspect: boolean
  maskAppearance: MaskAppearance
  theme: Theme
}

const PAD = 36

export function CrossSectionView({ result, axis, index, trueAspect, maskAppearance, theme }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const { width, height, cellSizeUm, depthUm, finalProtect } = result
    const n = axis === 'row' ? width : height
    const lateralSpanUm = n * cellSizeUm
    const maxDepthUm = Math.max(1e-6, result.maxActualDepthUm)

    const plotW = cssW - PAD * 2
    const plotH = cssH - PAD * 2
    const depthScalePxPerUm = trueAspect ? plotW / lateralSpanUm : plotH / maxDepthUm
    const lateralScalePxPerUm = plotW / lateralSpanUm
    const depthPlotHeight = maxDepthUm * depthScalePxPerUm

    const isDark = theme === 'dark'
    ctx.fillStyle = isDark ? '#0b0d12' : '#eef1f4'
    ctx.fillRect(0, 0, cssW, cssH)

    const surfaceY = PAD
    const toX = (i: number) => PAD + i * cellSizeUm * lateralScalePxPerUm
    const toY = (depth: number) => surfaceY + depth * depthScalePxPerUm

    // Silicon fill profile.
    ctx.beginPath()
    ctx.moveTo(toX(0), surfaceY)
    for (let i = 0; i < n; i++) {
      const idx = axis === 'row' ? index * width + i : i * width + index
      const d = depthUm[idx] ?? 0
      ctx.lineTo(toX(i), toY(d))
      ctx.lineTo(toX(i + 1), toY(d))
    }
    ctx.lineTo(toX(n), surfaceY + Math.max(depthPlotHeight, plotH) + 50)
    ctx.lineTo(toX(0), surfaceY + Math.max(depthPlotHeight, plotH) + 50)
    ctx.closePath()
    ctx.fillStyle = '#3a4a5c'
    ctx.fill()

    // Mask indicator bar along the top. A real repeating pattern doesn't
    // read at 5px tall, so the gnome option falls back to a flat stand-in
    // color here rather than trying to show the pattern.
    const maskHex = maskAppearanceColorHex(maskAppearance)
    for (let i = 0; i < n; i++) {
      const idx = axis === 'row' ? index * width + i : i * width + index
      if (finalProtect[idx]) {
        ctx.fillStyle = maskHex
        ctx.fillRect(toX(i), surfaceY - 6, toX(i + 1) - toX(i) + 1, 5)
      }
    }

    // Surface reference line.
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD, surfaceY)
    ctx.lineTo(cssW - PAD, surfaceY)
    ctx.stroke()

    // Axis labels.
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'
    ctx.font = '11px monospace'
    ctx.fillText(`0`, PAD - 4, surfaceY - 10)
    ctx.fillText(`${maxDepthUm.toFixed(2)} µm`, PAD - 4, toY(maxDepthUm) + 4)
    ctx.fillText(`0 µm`, PAD, cssH - 8)
    ctx.fillText(`${lateralSpanUm.toFixed(1)} µm`, cssW - PAD - 50, cssH - 8)
    ctx.fillText(trueAspect ? 'true aspect (54.74° sidewalls read correctly)' : 'exaggerated depth axis', PAD, 14)
  }, [result, axis, index, trueAspect, maskAppearance, theme])

  return <canvas ref={canvasRef} className="cross-section-canvas" />
}
