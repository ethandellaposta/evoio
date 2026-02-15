import { hsla } from './color.js'

export function installWorld(Renderer) {
  const P = Renderer.prototype

  P._drawWaterBackground = function (sim) {
    const ctx = this.ctx
    const cw = this.canvas.width
    const ch = this.canvas.height
    const t = this._frameTick

    const targetW = Math.max(1, (cw / 12) | 0)
    const targetH = Math.max(1, (ch / 12) | 0)
    if (!this._waterCanvas || this._waterW !== targetW || this._waterH !== targetH) {
      this._waterCanvas = document.createElement('canvas')
      this._waterCanvas.width = targetW
      this._waterCanvas.height = targetH
      this._waterCtx = this._waterCanvas.getContext('2d', { alpha: false })
      this._waterW = targetW
      this._waterH = targetH
      this._waterImg = this._waterCtx.createImageData(targetW, targetH)
    }

    const data = this._waterImg.data
    const iw = targetW
    const ih = targetH
    const time = t * 0.005
    const camX = this.view.cx
    const camY = this.view.cy

    // Sun direction for light/shadow gradient
    const sunAngle = sim.sunAngle || 0
    const sunIntensity = sim.sunIntensity || 1.0
    const sunDx = Math.cos(sunAngle)
    const sunDy = Math.sin(sunAngle)
    // Day/night global dimming
    const nightDim = 0.25 + sunIntensity * 0.75

    // Slow-drifting nebula offset for large-scale color variation
    const nebulaT = time * 0.12
    const nebulaDx = Math.sin(nebulaT * 0.7) * 2.0
    const nebulaDy = Math.cos(nebulaT * 0.5) * 2.0

    // Biome palette data for per-pixel color tinting
    const biomes = sim.cfg && sim.cfg.biomes ? sim.cfg.biomes : null

    // Precompute per-column biome palette using world-space x
    // so biome colors track the actual world regions as you scroll/zoom
    const colR = new Float32Array(iw)
    const colG = new Float32Array(iw)
    const colB = new Float32Array(iw)
    const colCG = new Float32Array(iw)
    const colCB = new Float32Array(iw)
    const colPS = new Float32Array(iw)
    const simW = sim.w || 1
    const viewScale = this.view.scale || 1
    const halfCW = this.canvas.width * 0.5
    if (biomes && biomes.length > 0) {
      const nb = biomes.length
      for (let px = 0; px < iw; px++) {
        // Map pixel column to world x coordinate
        const screenX = (px / iw) * this.canvas.width
        const worldX = camX + (screenX - halfCW) / viewScale
        // Clamp worldX fraction to [0, 1]
        const frac = Math.max(0, Math.min(1, worldX / simW))
        const bf = frac * nb
        const bi0 = Math.min(nb - 1, bf | 0)
        const bi1 = Math.min(nb - 1, bi0 + 1)
        const t2 = bf - bi0
        const p0 = biomes[bi0].palette,
          p1 = biomes[bi1].palette
        colR[px] = p0.rBase + (p1.rBase - p0.rBase) * t2
        colG[px] = p0.gBase + (p1.gBase - p0.gBase) * t2
        colB[px] = p0.bBase + (p1.bBase - p0.bBase) * t2
        colCG[px] = p0.causticG + (p1.causticG - p0.causticG) * t2
        colCB[px] = p0.causticB + (p1.causticB - p0.causticB) * t2
        colPS[px] = p0.purpStr + (p1.purpStr - p0.purpStr) * t2
      }
    } else {
      for (let px = 0; px < iw; px++) {
        colR[px] = 6
        colG[px] = 12
        colB[px] = 30
        colCG[px] = 75
        colCB[px] = 60
        colPS[px] = 1.0
      }
    }

    for (let py = 0; py < ih; py++) {
      // Precompute row constants
      const ny = (py / ih) * 2 - 1
      const rowOff = py * iw
      for (let px = 0; px < iw; px++) {
        const wx = (px / iw) * 24 + camX * 0.012
        const wy = (py / ih) * 18 + camY * 0.012

        // ── Caustics — 3 layers (removed 4th for perf) ──
        const c1 = Math.sin(wx * 1.3 + time * 0.8) * Math.cos(wy * 1.7 - time * 0.6)
        const c2 = Math.sin(wx * 2.6 - time * 1.1 + wy * 0.7) * Math.cos(wy * 2.2 + time * 0.5)
        const c3 = Math.sin((wx + wy) * 1.5 + time * 0.4) * Math.sin(wx * 0.8 - wy * 1.4 + time * 0.9)
        const caustic = (c1 * 0.35 + c2 * 0.35 + c3 * 0.3) * 0.5 + 0.5
        const causticSq = caustic * caustic

        // ── Purple undertow ──
        const purp = Math.sin(wx * 0.6 + wy * 0.9 - time * 0.3) * 0.5 + 0.5

        // ── Nebula clouds ──
        const nwx = wx * 0.35 + nebulaDx
        const nwy = wy * 0.35 + nebulaDy
        const nebula =
          (Math.sin(nwx * 1.1 + nwy * 0.8) * 0.5 + 0.5) *
          (Math.sin(nwx * 0.7 - nwy * 1.3 + time * 0.08) * 0.5 + 0.5)

        // Vignette — no sqrt, use dist² approximation
        const nx = (px / iw) * 2 - 1
        const dist2 = nx * nx + ny * ny
        const depth = 1 - dist2 * 0.2 // approximate vignette
        const depthSq = depth * depth

        // ── Sunlight ──
        const sunFacing = nx * sunDx + ny * sunDy
        const localSun = (0.5 + sunFacing * 0.45) * sunIntensity
        const warmth = localSun * 0.55
        const coolness = (1 - localSun) * 0.35

        // ── Compose palette ──
        const bright = causticSq * 0.4 * depth * nightDim
        const base = depthSq * 0.5 * nightDim
        const bRbase = colR[px],
          bGbase = colG[px],
          bBbase = colB[px]
        const bCausticG = colCG[px],
          bCausticB = colCB[px],
          bPurpStr = colPS[px]
        const depthNight = depthSq * nightDim

        // Biome base colors are the dominant tint — amplified 3x for visibility
        let r =
          bRbase * 3.0 * nightDim +
          bright * 20 +
          base * 5 +
          purp * depthNight * 10 * bPurpStr +
          warmth * 30 * depthSq +
          nebula * depthNight * 8

        let g =
          bGbase * 3.0 * nightDim +
          bright * bCausticG * 0.8 +
          base * 25 +
          caustic * 12 * nightDim +
          warmth * 8 * depthSq +
          nebula * depthNight * 14

        let b =
          bBbase * 3.0 * nightDim +
          bright * bCausticB * 0.8 +
          base * 40 +
          caustic * 16 * nightDim +
          purp * depthNight * 28 * bPurpStr +
          coolness * 24 * depthSq +
          nebula * depthSq * depth * 20 * nightDim

        const idx = (px + rowOff) * 4
        data[idx] = r > 255 ? 255 : r < 0 ? 0 : r
        data[idx + 1] = g > 255 ? 255 : g < 0 ? 0 : g
        data[idx + 2] = b > 255 ? 255 : b < 0 ? 0 : b
        data[idx + 3] = 255
      }
    }

    this._waterCtx.putImageData(this._waterImg, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'medium'
    ctx.drawImage(this._waterCanvas, 0, 0, iw, ih, 0, 0, cw, ch)

    // ── Floating bioluminescent motes overlay ──
    // Drawn directly on the main canvas for crisp, high-res dots
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const moteCount = 18
    const TAU = Math.PI * 2
    for (let i = 0; i < moteCount; i++) {
      // Deterministic but slowly drifting positions
      const seed = i * 137.508
      const phase = time * 0.15 + seed
      const mx = ((Math.sin(seed * 0.73 + phase * 0.3) * 0.5 + 0.5) * 0.8 + 0.1) * cw
      const my = ((Math.cos(seed * 0.91 + phase * 0.25) * 0.5 + 0.5) * 0.8 + 0.1) * ch
      // Gentle pulsing
      const pulse = Math.sin(phase * 1.2 + i * 0.9) * 0.5 + 0.5
      const alpha = (0.03 + pulse * 0.06) * nightDim
      if (alpha < 0.01) continue
      const radius = 1.5 + pulse * 2.5
      // Color varies per mote — teal, cyan, soft green
      const mHue = 160 + Math.sin(seed) * 40
      ctx.globalAlpha = alpha
      ctx.fillStyle = hsla(mHue, 50, 70, 0.6)
      ctx.beginPath()
      ctx.arc(mx, my, radius, 0, TAU)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.restore()
  }

  P._drawWorldBlob = function (sim) {
    const ctx = this.ctx
    const t = this._frameTick
    const cw = this.canvas.width
    const ch = this.canvas.height
    ctx.save()

    if (!sim.blobPoints || sim.blobPoints.length < 3) {
      ctx.restore()
      return
    }

    // Convert blob points to screen space
    const pts = []
    for (let i = 0; i < sim.blobPoints.length; i++) {
      pts.push(this.worldToScreen(sim.blobPoints[i].x, sim.blobPoints[i].y))
    }

    // Helper: build a smooth blob path
    const drawBlobPath = (sPts) => {
      const lastPt = sPts[sPts.length - 1]
      ctx.moveTo((lastPt[0] + sPts[0][0]) / 2, (lastPt[1] + sPts[0][1]) / 2)
      for (let i = 0; i < sPts.length; i++) {
        const next = sPts[(i + 1) % sPts.length]
        ctx.quadraticCurveTo(sPts[i][0], sPts[i][1], (sPts[i][0] + next[0]) / 2, (sPts[i][1] + next[1]) / 2)
      }
      ctx.closePath()
    }

    const drawBlobPathReverse = (sPts) => {
      const last = sPts[sPts.length - 1]
      ctx.moveTo((last[0] + sPts[0][0]) / 2, (last[1] + sPts[0][1]) / 2)
      for (let i = sPts.length - 1; i >= 0; i--) {
        const prev = sPts[(i - 1 + sPts.length) % sPts.length]
        ctx.quadraticCurveTo(sPts[i][0], sPts[i][1], (sPts[i][0] + prev[0]) / 2, (sPts[i][1] + prev[1]) / 2)
      }
      ctx.closePath()
    }

    // ── Outer void ──
    ctx.globalCompositeOperation = 'source-over'
    ctx.beginPath()
    ctx.rect(0, 0, cw, ch)
    drawBlobPathReverse(pts)
    ctx.fillStyle = 'rgba(2,1,8,0.96)'
    ctx.fill()

    // ── Biome-tinted rim ──
    // Each point on the perimeter gets a color based on its world x-position (biome region).
    // We draw short line segments per point with interpolated biome colors.
    const biomes = sim.cfg && sim.cfg.biomes ? sim.cfg.biomes : null
    const numBiomes = biomes ? biomes.length : 1

    // Biome rim RGB values [r, g, b]
    const BIOME_COLORS = [
      [60, 220, 140], // Shallows — warm green
      [40, 180, 220], // Deep Ocean — cool blue-teal
      [220, 130, 50] // Thermal Vents — warm amber
    ]

    // Precompute per-point biome color
    const nPts = pts.length
    const ptColors = new Array(nPts)
    for (let i = 0; i < nPts; i++) {
      const wx = sim.blobPoints[i].x
      const bf = (wx / sim.w) * numBiomes
      const bi0 = Math.min(numBiomes - 1, bf | 0)
      const bi1 = Math.min(numBiomes - 1, bi0 + 1)
      const blend = bf - bi0
      const c0 = BIOME_COLORS[bi0] || BIOME_COLORS[1]
      const c1 = BIOME_COLORS[bi1] || BIOME_COLORS[1]
      ptColors[i] = [
        (c0[0] + (c1[0] - c0[0]) * blend) | 0,
        (c0[1] + (c1[1] - c0[1]) * blend) | 0,
        (c0[2] + (c1[2] - c0[2]) * blend) | 0
      ]
    }

    // Batch segments by biome index to minimize strokeStyle changes.
    // Draw 3 passes: wide haze, mid glow, bright edge.
    const layers = [
      { alpha: 0.1, lw: 22, aScale: 0.5 },
      { alpha: 0.2, lw: 8, aScale: 0.6 },
      { alpha: 0.55, lw: 2.0, aScale: 0.9 }
    ]
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li]
      ctx.globalAlpha = layer.alpha
      ctx.lineWidth = layer.lw
      // Draw segments, batching consecutive same-color runs
      let prevColor = ''
      ctx.beginPath()
      for (let i = 0; i < nPts; i++) {
        const col = ptColors[i]
        const colorStr = `rgba(${col[0]},${col[1]},${col[2]},${layer.aScale})`
        if (colorStr !== prevColor) {
          // Flush previous batch
          if (prevColor) ctx.stroke()
          ctx.strokeStyle = colorStr
          prevColor = colorStr
          ctx.beginPath()
        }
        const p0 = pts[i]
        const p1 = pts[(i + 1) % nPts]
        const mx = (p0[0] + p1[0]) / 2
        const my = (p0[1] + p1[1]) / 2
        ctx.moveTo(p0[0], p0[1])
        ctx.lineTo(mx, my)
      }
      ctx.stroke()
    }

    ctx.restore()
  }

  P._drawBarriers = function (sim) {
    if (!sim.barriers || sim.barriers.length === 0) return
    const ctx = this.ctx
    ctx.save()

    for (let i = 0; i < sim.barriers.length; i++) {
      const b = sim.barriers[i]
      const pts = b.points
      if (!pts || pts.length < 3) continue

      const [scx, scy] = this.worldToScreen(b.cx, b.cy)
      if (scx < -150 || scx > this.canvas.width + 150 || scy < -150 || scy > this.canvas.height + 150)
        continue

      const sPts = pts.map((p) => this.worldToScreen(p.x, p.y))
      const bHue = 260 + i * 30

      // Build path once, reuse
      ctx.beginPath()
      const last = sPts[sPts.length - 1]
      ctx.moveTo((last[0] + sPts[0][0]) / 2, (last[1] + sPts[0][1]) / 2)
      for (let j = 0; j < sPts.length; j++) {
        const next = sPts[(j + 1) % sPts.length]
        ctx.quadraticCurveTo(sPts[j][0], sPts[j][1], (sPts[j][0] + next[0]) / 2, (sPts[j][1] + next[1]) / 2)
      }
      ctx.closePath()

      // Dark fill
      ctx.globalAlpha = 0.7
      ctx.fillStyle = 'rgba(18,12,28,0.85)'
      ctx.fill()

      // Bright edge — single stroke, visible from far
      ctx.globalAlpha = 0.7
      ctx.strokeStyle = hsla(bHue, 60, 60, 0.9)
      ctx.lineWidth = 2.5
      ctx.stroke()

      // Outer glow — single wider stroke
      ctx.globalAlpha = 0.15
      ctx.strokeStyle = hsla(bHue, 50, 55, 0.5)
      ctx.lineWidth = 12
      ctx.stroke()
    }
    ctx.restore()
  }

  P._drawGradientPeak = function (sim) {
    const peaks = sim.gradientPeaks || (sim.gradientPeak ? [sim.gradientPeak] : [])
    if (peaks.length === 0) return
    const ctx = this.ctx
    const pulse = 0.5 + 0.5 * Math.sin(this._frameTick * 0.05)

    ctx.save()
    for (let pi = 0; pi < peaks.length; pi++) {
      const pk = peaks[pi]
      const [px, py] = this.worldToScreen(pk.x, pk.y)
      const r = 8 + 4 * pulse

      ctx.globalAlpha = 0.25 + 0.1 * pulse
      const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 3)
      grad.addColorStop(0, 'rgba(35,213,171,0.5)')
      grad.addColorStop(0.5, 'rgba(35,213,171,0.12)')
      grad.addColorStop(1, 'rgba(35,213,171,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(px, py, r * 3, 0, Math.PI * 2)
      ctx.fill()

      ctx.globalAlpha = 0.6
      ctx.fillStyle = 'rgba(35,213,171,0.8)'
      ctx.beginPath()
      ctx.arc(px, py, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // ── Water current flow lines — visible streamlines showing drift direction ──
  P._drawCurrentLines = function (sim) {
    const ctx = this.ctx
    const t = this._frameTick
    const cw = this.canvas.width,
      ch = this.canvas.height
    const TAU = Math.PI * 2

    // Match the current angle from food drift
    const currentAngle = sim.t * 0.0008 + Math.sin(sim.t * 0.0003) * 0.5
    const currentSpeed = 0.35 + 0.15 * Math.sin(sim.t * 0.0005 + 1.7)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'

    // Draw ~20 streamlines distributed across the screen
    const lineCount = 18
    for (let i = 0; i < lineCount; i++) {
      // Seed position — slowly drifts so lines appear to flow
      const seed = i * 137.5 + t * 0.02
      const baseX = (seed * 73.1) % cw
      const baseY = (seed * 41.7 + i * 97) % ch

      // Local turbulence variation
      const localTurb = Math.sin(baseX * 0.005 + baseY * 0.007 + t * 0.008) * 0.4
      const angle = currentAngle + localTurb
      const len = (40 + currentSpeed * 60 + Math.sin(seed) * 20) * this.view.scale * 0.3

      // Curved streamline with 3 segments
      const cos = Math.cos(angle),
        sin = Math.sin(angle)
      const x0 = baseX - cos * len * 0.5
      const y0 = baseY - sin * len * 0.5

      // Fade based on position in flow cycle
      const flowPhase = (t * 0.015 + i * 0.4) % 1.0
      const alpha = Math.sin(flowPhase * Math.PI) * 0.06

      if (alpha < 0.01) continue

      ctx.globalAlpha = alpha
      ctx.strokeStyle = 'rgba(80,200,180,0.5)'
      ctx.lineWidth = 0.6 + currentSpeed * 0.8

      ctx.beginPath()
      ctx.moveTo(x0, y0)
      // Gentle curve with turbulence
      const cx1 = x0 + cos * len * 0.33 + sin * len * 0.08 * Math.sin(seed * 2.3)
      const cy1 = y0 + sin * len * 0.33 - cos * len * 0.08 * Math.sin(seed * 2.3)
      const cx2 = x0 + cos * len * 0.66 - sin * len * 0.06 * Math.cos(seed * 1.7)
      const cy2 = y0 + sin * len * 0.66 + cos * len * 0.06 * Math.cos(seed * 1.7)
      const x3 = x0 + cos * len
      const y3 = y0 + sin * len
      ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x3, y3)
      ctx.stroke()

      // Small arrowhead at tip
      if (alpha > 0.02) {
        const arrowLen = 3 + currentSpeed * 4
        const arrowAngle = 0.4
        ctx.globalAlpha = alpha * 1.5
        ctx.beginPath()
        ctx.moveTo(x3, y3)
        ctx.lineTo(x3 - Math.cos(angle - arrowAngle) * arrowLen, y3 - Math.sin(angle - arrowAngle) * arrowLen)
        ctx.moveTo(x3, y3)
        ctx.lineTo(x3 - Math.cos(angle + arrowAngle) * arrowLen, y3 - Math.sin(angle + arrowAngle) * arrowLen)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  P._drawSeasonBar = function (sim) {
    const ctx = this.ctx
    const barW = 120
    const barH = 4
    const x = this.canvas.width - barW - 12
    const y = this.canvas.height - 12

    ctx.save()
    ctx.globalAlpha = 0.4
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    ctx.fillRect(x, y, barW, barH)

    const progress = sim.seasonTick / sim.cfg.seasonLength
    ctx.fillStyle = 'rgba(35,213,171,0.6)'
    ctx.fillRect(x, y, barW * progress, barH)

    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#8f9bb7'
    ctx.font = '9px ui-sans-serif,system-ui,sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(`S${sim.season}`, x - 4, y + 4)
    ctx.restore()
  }
}
