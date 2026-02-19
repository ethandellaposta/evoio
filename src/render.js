import {
  FOOD_PLANT,
  FOOD_MINERAL,
  FOOD_MEAT,
  ORGANELLE_NUCLEUS,
  ORGANELLE_MITOCHONDRIA,
  ORGANELLE_FLAGELLUM,
  ORGANELLE_RECEPTOR,
  ORGANELLE_VACUOLE,
  ORGANELLE_COUNT,
  ROLE_NONE,
  ROLE_EDGE,
  ROLE_INTERIOR,
  ROLE_PIONEER
} from './sim.js'

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x
}

function hsl(h, s, l) {
  return `hsl(${h} ${s}% ${l}%)`
}

function hsla(h, s, l, a) {
  return `hsla(${h} ${s}% ${l}% / ${a})`
}

// ── Color palettes for roles ──
const ROLE_COLORS = {
  [ROLE_NONE]: { hShift: 0, satBoost: 0, lumBoost: 0 },
  [ROLE_EDGE]: { hShift: 10, satBoost: 10, lumBoost: 5 },
  [ROLE_INTERIOR]: { hShift: -20, satBoost: -5, lumBoost: -8 },
  [ROLE_PIONEER]: { hShift: 30, satBoost: 15, lumBoost: 12 }
}

// ── Organelle colors ──
const ORGANELLE_STYLES = [
  { h: 270, s: 80, l: 65, name: 'nucleus' }, // purple
  { h: 15, s: 90, l: 55, name: 'mitochondria' }, // orange-red
  { h: 160, s: 75, l: 50, name: 'flagellum' }, // teal
  { h: 45, s: 85, l: 60, name: 'receptor' }, // gold
  { h: 200, s: 60, l: 55, name: 'vacuole' } // blue
]

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })
    this.pixelRatio = 1

    this.renderScale = 1
    this.foodDown = 2
    this.foodEvery = 2
    this.simpleCells = false
    this.linkStride = 1
    this.drawOrganelles = true

    this.foodImage = null
    this.foodImageW = 0
    this.foodImageH = 0
    this._foodTick = 0
    this._frameTick = 0

    // Water background
    this._waterCanvas = null
    this._waterCtx = null
    this._waterW = 0
    this._waterH = 0

    this._idToCell = new Map()

    // Trail particles for pioneers
    this._trails = []
    this._maxTrails = 600

    this.view = {
      cx: 0,
      cy: 0,
      scale: 1
    }
  }

  updateQuality(sim) {
    const pop = sim.cells.length

    if (pop > 3200) {
      this.renderScale = 0.6
      this.foodDown = 5
      this.foodEvery = 8
      this.simpleCells = true
      this.linkStride = 4
      this.drawOrganelles = false
    } else if (pop > 2200) {
      this.renderScale = 0.7
      this.foodDown = 4
      this.foodEvery = 6
      this.simpleCells = true
      this.linkStride = 3
      this.drawOrganelles = false
    } else if (pop > 1400) {
      this.renderScale = 0.8
      this.foodDown = 2
      this.foodEvery = 4
      this.simpleCells = false
      this.linkStride = 2
      this.drawOrganelles = true
    } else {
      this.renderScale = 1
      this.foodDown = 1
      this.foodEvery = 2
      this.simpleCells = false
      this.linkStride = 1
      this.drawOrganelles = true
    }
  }

  resizeToFit() {
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(1, (rect.width * this.pixelRatio * this.renderScale) | 0)
    const h = Math.max(1, (rect.height * this.pixelRatio * this.renderScale) | 0)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  setView({ centerX, centerY, worldW, worldH }) {
    this.view.cx = centerX
    this.view.cy = centerY

    const pad = 1.08
    const sx = this.canvas.width / (worldW * pad)
    const sy = this.canvas.height / (worldH * pad)
    this.view.scale = Math.min(sx, sy)
  }

  worldToScreen(x, y) {
    const s = this.view.scale
    const px = (x - this.view.cx) * s + this.canvas.width / 2
    const py = (y - this.view.cy) * s + this.canvas.height / 2
    return [px, py]
  }

  _ensureFoodImage(w, h) {
    const down = this.foodDown
    const iw = Math.max(1, (w / down) | 0)
    const ih = Math.max(1, (h / down) | 0)
    if (!this.foodImage || this.foodImageW !== iw || this.foodImageH !== ih) {
      this.foodImageW = iw
      this.foodImageH = ih
      this.foodImage = this.ctx.createImageData(iw, ih)
    }
    return { iw, ih, down }
  }

  // ── Animated water pool background ──
  _drawWaterBackground(sim) {
    const ctx = this.ctx
    const cw = this.canvas.width
    const ch = this.canvas.height
    const t = this._frameTick

    // Low-res offscreen canvas for performance
    const targetW = Math.max(1, (cw / 6) | 0)
    const targetH = Math.max(1, (ch / 6) | 0)
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
    const time = t * 0.008

    const camX = this.view.cx
    const camY = this.view.cy

    for (let py = 0; py < ih; py++) {
      for (let px = 0; px < iw; px++) {
        // Map pixel to world-ish coordinates for tiling
        const wx = (px / iw) * 30 + camX * 0.02
        const wy = (py / ih) * 22 + camY * 0.02

        // Layered sine caustics (3 octaves)
        const c1 = Math.sin(wx * 1.7 + time * 0.9) * Math.cos(wy * 2.1 - time * 0.7)
        const c2 = Math.sin(wx * 3.3 - time * 1.3 + wy * 0.8) * Math.cos(wy * 2.8 + time * 0.5)
        const c3 = Math.sin((wx + wy) * 2.0 + time * 0.6) * Math.sin(wx * 1.2 - wy * 1.8 + time * 1.1)

        const caustic = (c1 * 0.45 + c2 * 0.3 + c3 * 0.25) * 0.5 + 0.5 // [0..1]

        // Depth variation — darker in center, lighter at edges (pool feel)
        const nx = (px / iw) * 2 - 1
        const ny = (py / ih) * 2 - 1
        const edgeDist = 1 - Math.sqrt(nx * nx + ny * ny) * 0.5
        const depth = 0.7 + edgeDist * 0.3

        // Color: deep dark blue-green with caustic highlights
        const base = depth * 0.35
        const highlight = caustic * caustic * 0.25 * depth
        const r = (2 + highlight * 30 + base * 8) | 0
        const g = (4 + highlight * 55 + base * 20 + caustic * 8) | 0
        const b = (12 + highlight * 40 + base * 35 + caustic * 12) | 0

        const idx = (px + py * iw) * 4
        data[idx] = r
        data[idx + 1] = g
        data[idx + 2] = b
        data[idx + 3] = 255
      }
    }

    this._waterCtx.putImageData(this._waterImg, 0, 0)

    // Draw scaled up with smoothing for soft water look
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'medium'
    ctx.drawImage(this._waterCanvas, 0, 0, iw, ih, 0, 0, cw, ch)
  }

  draw(sim, opts) {
    const ctx = this.ctx
    this._frameTick++

    // ── Animated water pool background ──
    if (this._frameTick % 2 === 0 || !this._waterCanvas) {
      this._drawWaterBackground(sim)
    } else {
      // Reuse last frame's water
      ctx.drawImage(
        this._waterCanvas,
        0,
        0,
        this._waterW,
        this._waterH,
        0,
        0,
        this.canvas.width,
        this.canvas.height
      )
    }

    // ── Draw food overlay ──
    if (opts.showFood) {
      this._foodTick++
      if (!this._foodCanvas || this._foodTick % this.foodEvery === 0) this._drawFood(sim)
      if (this._foodCanvas) {
        ctx.imageSmoothingEnabled = true
        ctx.globalAlpha = 0.85
        // Map food canvas through the same camera transform as cells
        const [x0, y0] = this.worldToScreen(0, 0)
        const [x1, y1] = this.worldToScreen(sim.w, sim.h)
        ctx.drawImage(
          this._foodCanvas,
          0,
          0,
          this._foodCanvas.width,
          this._foodCanvas.height,
          x0,
          y0,
          x1 - x0,
          y1 - y0
        )
        ctx.globalAlpha = 1
        ctx.imageSmoothingEnabled = true
      }
    }

    // ── Draw gradient peak indicator ──
    this._drawGradientPeak(sim)

    // ── Draw trails ──
    this._updateTrails(sim)
    this._drawTrails()

    if (opts.showLinks) {
      if (sim.links.length < 9000 && sim.cells.length < 5200) this._drawLinks(sim)
    }

    this._drawCells(sim)

    // ── Season progress bar ──
    this._drawSeasonBar(sim)

    ctx.strokeStyle = 'rgba(255,255,255,.10)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, this.canvas.width - 1, this.canvas.height - 1)
  }

  _drawGradientPeak(sim) {
    if (!sim.gradientPeak) return
    const ctx = this.ctx
    const [px, py] = this.worldToScreen(sim.gradientPeak.x, sim.gradientPeak.y)
    const pulse = 0.5 + 0.5 * Math.sin(this._frameTick * 0.05)
    const r = 8 + 4 * pulse

    ctx.save()
    ctx.globalAlpha = 0.3 + 0.15 * pulse
    const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 3)
    grad.addColorStop(0, 'rgba(35,213,171,0.6)')
    grad.addColorStop(0.5, 'rgba(35,213,171,0.15)')
    grad.addColorStop(1, 'rgba(35,213,171,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(px, py, r * 3, 0, Math.PI * 2)
    ctx.fill()

    // Inner dot
    ctx.globalAlpha = 0.7
    ctx.fillStyle = 'rgba(35,213,171,0.9)'
    ctx.beginPath()
    ctx.arc(px, py, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  _drawSeasonBar(sim) {
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

  _updateTrails(sim) {
    // Add trail particles for pioneer cells
    if (this._frameTick % 3 === 0) {
      for (let i = 0; i < sim.cells.length; i++) {
        const c = sim.cells[i]
        if (c.role === ROLE_PIONEER && c.organelles[ORGANELLE_FLAGELLUM] > 0.15) {
          if (this._trails.length < this._maxTrails) {
            this._trails.push({
              x: c.x - c.vx * 2,
              y: c.y - c.vy * 2,
              life: 1.0,
              hue: (c.clade * 37) % 360,
              size: 1.2 + c.organelles[ORGANELLE_FLAGELLUM] * 1.5
            })
          }
        }
      }
    }

    // Decay trails
    for (let i = this._trails.length - 1; i >= 0; i--) {
      this._trails[i].life -= 0.04
      if (this._trails[i].life <= 0) {
        this._trails.splice(i, 1)
      }
    }
  }

  _drawTrails() {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < this._trails.length; i++) {
      const t = this._trails[i]
      const [sx, sy] = this.worldToScreen(t.x, t.y)
      const alpha = t.life * 0.25
      ctx.globalAlpha = alpha
      ctx.fillStyle = hsl(t.hue, 60, 50)
      ctx.beginPath()
      ctx.arc(sx, sy, t.size * this.view.scale * 0.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  _drawFood(sim) {
    const { w, h } = sim
    const { iw, ih } = this._ensureFoodImage(w, h)

    const img = this.foodImage
    const data = img.data
    const food = sim.food

    const scaleX = w / iw
    const scaleY = h / ih
    const inv = 1 / 8

    const mineral = sim.mineralFood
    const meat = sim.meatFood

    // Bilinear interpolation for smooth food rendering
    for (let py = 0; py < ih; py++) {
      const fy = py * scaleY
      const iy0 = fy | 0
      const iy1 = Math.min(iy0 + 1, h - 1)
      const ty = fy - iy0
      for (let px = 0; px < iw; px++) {
        const fx = px * scaleX
        const ix0 = fx | 0
        const ix1 = Math.min(ix0 + 1, w - 1)
        const tx = fx - ix0

        // Bilinear sample plant food (green)
        const p00 = food[ix0 + iy0 * w],
          p10 = food[ix1 + iy0 * w]
        const p01 = food[ix0 + iy1 * w],
          p11 = food[ix1 + iy1 * w]
        const pVal = p00 + (p10 - p00) * tx + (p01 + (p11 - p01) * tx - (p00 + (p10 - p00) * tx)) * ty
        const pt = clamp(Math.pow(pVal * inv, 0.8), 0, 1)

        // Bilinear sample mineral food (amber)
        let mt = 0
        if (mineral) {
          const m00 = mineral[ix0 + iy0 * w],
            m10 = mineral[ix1 + iy0 * w]
          const m01 = mineral[ix0 + iy1 * w],
            m11 = mineral[ix1 + iy1 * w]
          const mVal = m00 + (m10 - m00) * tx + (m01 + (m11 - m01) * tx - (m00 + (m10 - m00) * tx)) * ty
          mt = clamp(mVal * 0.8, 0, 1)
        }

        // Bilinear sample meat food (red)
        let kt = 0
        if (meat) {
          const k00 = meat[ix0 + iy0 * w],
            k10 = meat[ix1 + iy0 * w]
          const k01 = meat[ix0 + iy1 * w],
            k11 = meat[ix1 + iy1 * w]
          const kVal = k00 + (k10 - k00) * tx + (k01 + (k11 - k01) * tx - (k00 + (k10 - k00) * tx)) * ty
          kt = clamp(kVal * 1.2, 0, 1)
        }

        const idx = (px + py * iw) * 4
        // Plant = green, Mineral = amber/gold, Meat = red
        data[idx + 0] = clamp((3 + 15 * pt + 180 * mt + 160 * kt) | 0, 0, 255)
        data[idx + 1] = clamp((5 + 110 * pt + 140 * mt + 25 * kt) | 0, 0, 255)
        data[idx + 2] = clamp((10 + 100 * pt + 20 * mt + 15 * kt) | 0, 0, 255)
        data[idx + 3] = 255
      }
    }

    if (!this._foodCanvas) {
      this._foodCanvas = document.createElement('canvas')
      this._foodCtx = this._foodCanvas.getContext('2d', { alpha: false })
    }

    this._foodCanvas.width = iw
    this._foodCanvas.height = ih
    this._foodCtx.putImageData(img, 0, 0)
  }

  _drawLinks(sim) {
    const ctx = this.ctx
    const cells = sim.cells

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    const stride = Math.max(1, this.linkStride)

    for (let i = 0; i < sim.links.length; i += stride) {
      const L = sim.links[i]
      const a = cells[L.a]
      const b = cells[L.b]
      if (!a || !b) continue
      const [ax, ay] = this.worldToScreen(a.x, a.y)
      const [bx, by] = this.worldToScreen(b.x, b.y)

      // Color links by surface tension strength
      const gamma = L.gamma || 0.5
      const alpha = clamp(0.06 + 0.2 * L.s * gamma, 0.03, 0.35)

      // Energy flow visualization: pulse along link
      const pulse = 0.5 + 0.5 * Math.sin(this._frameTick * 0.08 + i * 0.3)
      const lw = stride > 1 ? 0.75 : 0.8 + 0.6 * gamma * pulse
      ctx.lineWidth = lw

      // Color based on surface tension: high γ = warm, low γ = cool
      const linkHue = 260 + gamma * 60
      ctx.strokeStyle = hsla(linkHue, 70, 60, alpha)
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Build an irregular blobby path for organic cell shape
  _blobPath(ctx, x, y, r, phase, id, nLobes) {
    const lobes = nLobes || 7
    const pts = []
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2
      // Unique per-cell deformation using id as seed
      const deform =
        1.0 +
        0.1 * Math.sin(phase + a * 2.0 + id * 1.7) +
        0.06 * Math.sin(phase * 0.7 + a * 3.0 + id * 0.9) +
        0.04 * Math.cos(a * 5.0 + id * 2.3)
      pts.push({
        x: x + Math.cos(a) * r * deform,
        y: y + Math.sin(a) * r * deform
      })
    }
    // Smooth closed bezier through points
    ctx.beginPath()
    ctx.moveTo((pts[pts.length - 1].x + pts[0].x) / 2, (pts[pts.length - 1].y + pts[0].y) / 2)
    for (let i = 0; i < pts.length; i++) {
      const next = pts[(i + 1) % pts.length]
      const mx = (pts[i].x + next.x) / 2
      const my = (pts[i].y + next.y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    ctx.closePath()
  }

  _drawCells(sim) {
    const ctx = this.ctx
    const baseR = sim.cfg.cellRadius * this.view.scale

    ctx.save()
    ctx.globalCompositeOperation = 'source-over'

    for (let i = 0; i < sim.cells.length; i++) {
      const c = sim.cells[i]
      const [x, y] = this.worldToScreen(c.x, c.y)

      // ── Diet-shifted color: carnivores → warm/red, herbivores → cool/green ──
      const rc = ROLE_COLORS[c.role] || ROLE_COLORS[ROLE_NONE]
      const baseHue = (c.clade * 37) % 360
      const dietShift = c.g.diet * 40 - 10 // carnivores shift +30 toward red
      const hue = (baseHue + rc.hShift + dietShift + 360) % 360
      const sat = clamp(55 + rc.satBoost + c.g.diet * 10, 35, 90)
      const lum = clamp(48 + 12 * c.g.adhesion + rc.lumBoost, 32, 68)

      // Cell size varies with energy, vacuole, and membrane thickness
      const energyScale = clamp(0.9 + c.energy * 0.04, 0.85, 1.15)
      const vacScale = 1 + c.organelles[ORGANELLE_VACUOLE] * 0.12
      const memScale = 1 + c.g.membrane * 0.1
      const r = baseR * energyScale * vacScale * memScale

      if (this.simpleCells) {
        ctx.fillStyle = hsl(hue, sat, lum)
        ctx.fillRect((x - r) | 0, (y - r) | 0, (2 * r) | 0, (2 * r) | 0)
      } else {
        // ── Draw morphology BEHIND cell body ──
        if (r > 2) this._drawMorphology(ctx, c, x, y, r, hue, sat, lum)

        // ── Organic blobby cell body ──
        this._blobPath(ctx, x, y, r, c.membranePhase, c.id, r > 4 ? 8 : 6)

        // Radial gradient fill — tinted by last food eaten
        const hlOff = r * 0.25
        let innerHue = hue
        if (c.lastAte === FOOD_MEAT) innerHue = (hue + 15) % 360
        else if (c.lastAte === FOOD_MINERAL) innerHue = (hue - 10 + 360) % 360
        const grad = ctx.createRadialGradient(x - hlOff, y - hlOff, r * 0.05, x, y, r * 1.1)
        grad.addColorStop(0, hsla(innerHue, sat - 5, lum + 18, 0.95))
        grad.addColorStop(0.45, hsla(hue, sat, lum, 0.92))
        grad.addColorStop(1, hsla(hue, sat + 5, lum - 12, 0.88))
        ctx.fillStyle = grad
        ctx.fill()

        // Membrane outline — thickness scales with membrane gene
        const memThick = 0.5 + c.g.membrane * 1.8
        ctx.strokeStyle = hsla(hue, sat + 8, lum * 0.35, 0.5 + c.g.membrane * 0.3)
        ctx.lineWidth = memThick
        ctx.stroke()

        // ── Specular highlight ──
        if (r > 2.5) {
          const specR = r * 0.35
          const specGrad = ctx.createRadialGradient(
            x - r * 0.28,
            y - r * 0.28,
            0,
            x - r * 0.15,
            y - r * 0.15,
            specR
          )
          specGrad.addColorStop(0, 'rgba(255,255,255,0.22)')
          specGrad.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = specGrad
          ctx.beginPath()
          ctx.arc(x - r * 0.22, y - r * 0.22, specR, 0, Math.PI * 2)
          ctx.fill()
        }

        // ── Role indicators ──
        if (c.role === ROLE_PIONEER) {
          ctx.strokeStyle = 'rgba(35,213,171,0.45)'
          ctx.lineWidth = 1.0
          this._blobPath(ctx, x, y, r + 1.5, c.membranePhase, c.id, 6)
          ctx.stroke()
        } else if (c.role === ROLE_INTERIOR && r > 2) {
          ctx.fillStyle = hsla(hue, sat - 10, lum - 12, 0.25)
          ctx.beginPath()
          ctx.arc(x, y, r * 0.4, 0, Math.PI * 2)
          ctx.fill()
        }

        // ── Draw organelles ──
        if (this.drawOrganelles && r > 2.5) {
          this._drawOrganellesInCell(ctx, c, x, y, r, hue)
        }

        // ── Extra membrane for multicellular cells ──
        if (c.linkCount > 0 && r > 2) {
          ctx.strokeStyle = hsla(hue, sat + 10, lum + 15, 0.3)
          ctx.lineWidth = 0.5
          this._blobPath(ctx, x, y, r + 0.8, c.membranePhase * 0.97, c.id + 100, 6)
          ctx.stroke()
        }
      }
    }

    ctx.restore()
  }

  _drawMorphology(ctx, c, x, y, r, hue, sat, lum) {
    const t = this._frameTick

    // ── Flippers: paddle-shaped appendages on sides ──
    if (c.g.flipper > 0.1) {
      ctx.save()
      ctx.globalAlpha = 0.4 + c.g.flipper * 0.4
      const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
      const dirX = c.vx / vLen,
        dirY = c.vy / vLen
      const perpX = -dirY,
        perpY = dirX
      const fLen = r * (0.8 + c.g.flipper * 1.8)
      const fWid = r * (0.3 + c.g.flipper * 0.4)
      // Flipper animation: rowing motion
      const row = Math.sin(t * 0.12 + c.id) * 0.4 * c.g.flipper

      for (const side of [-1, 1]) {
        const baseX = x + perpX * r * 0.7 * side
        const baseY = y + perpY * r * 0.7 * side
        const tipX = baseX + (perpX * side * fLen * 0.6 + dirX * fLen * 0.4) * (1 + row * side)
        const tipY = baseY + (perpY * side * fLen * 0.6 + dirY * fLen * 0.4) * (1 + row * side)

        ctx.fillStyle = hsla(hue, sat - 10, lum + 5, 0.5)
        ctx.strokeStyle = hsla(hue, sat, lum * 0.5, 0.6)
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(baseX - perpX * side * fWid * 0.3, baseY - perpY * side * fWid * 0.3)
        ctx.quadraticCurveTo(
          (baseX + tipX) / 2 + dirX * fWid * 0.5,
          (baseY + tipY) / 2 + dirY * fWid * 0.5,
          tipX,
          tipY
        )
        ctx.quadraticCurveTo(
          (baseX + tipX) / 2 - dirX * fWid * 0.5,
          (baseY + tipY) / 2 - dirY * fWid * 0.5,
          baseX + perpX * side * fWid * 0.3,
          baseY + perpY * side * fWid * 0.3
        )
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }

    // ── Cilia: tiny hair-like projections all around ──
    if (c.g.cilia > 0.1) {
      const count = Math.floor(8 + c.g.cilia * 16)
      const ciliaLen = r * (0.25 + c.g.cilia * 0.5)
      ctx.save()
      ctx.globalAlpha = 0.3 + c.g.cilia * 0.4
      ctx.strokeStyle = hsla(hue, sat - 15, lum + 20, 0.5)
      ctx.lineWidth = 0.4
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2
        const wave = Math.sin(t * 0.2 + a * 3 + c.id * 0.5) * ciliaLen * 0.3
        const bx = x + Math.cos(a) * (r + 0.5)
        const by = y + Math.sin(a) * (r + 0.5)
        const ex = bx + Math.cos(a + wave * 0.1) * ciliaLen
        const ey = by + Math.sin(a + wave * 0.1) * ciliaLen
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(ex, ey)
        ctx.stroke()
      }
      ctx.restore()
    }

    // ── Spines: sharp radial projections ──
    if (c.g.spines > 0.08) {
      const count = Math.floor(3 + c.g.spines * 8)
      const spineLen = r * (0.6 + c.g.spines * 1.5)
      ctx.save()
      ctx.globalAlpha = 0.5 + c.g.spines * 0.4
      ctx.strokeStyle = hsla(0, 40, 80, 0.7)
      ctx.lineWidth = 0.5 + c.g.spines * 0.8
      ctx.lineCap = 'round'
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + c.id * 0.8
        const bx = x + Math.cos(a) * r
        const by = y + Math.sin(a) * r
        const ex = x + Math.cos(a) * (r + spineLen)
        const ey = y + Math.sin(a) * (r + spineLen)
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(ex, ey)
        ctx.stroke()
        // Spine tip
        ctx.fillStyle = hsla(0, 50, 90, 0.6)
        ctx.beginPath()
        ctx.arc(ex, ey, 0.4 + c.g.spines * 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  _drawOrganellesInCell(ctx, c, x, y, r, baseHue) {
    const org = c.organelles
    const t = this._frameTick

    // ── Nucleus (central dark spot with bright ring) ──
    const nucLevel = org[ORGANELLE_NUCLEUS]
    if (nucLevel > 0.05) {
      const nr = r * 0.35 * nucLevel + r * 0.1
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.5 + nucLevel * 0.4

      // Nucleus body
      const nucGrad = ctx.createRadialGradient(x, y, 0, x, y, nr)
      nucGrad.addColorStop(0, hsla(270, 70, 35, 0.8))
      nucGrad.addColorStop(0.6, hsla(270, 60, 25, 0.5))
      nucGrad.addColorStop(1, hsla(270, 50, 20, 0))
      ctx.fillStyle = nucGrad
      ctx.beginPath()
      ctx.arc(x, y, nr, 0, Math.PI * 2)
      ctx.fill()

      // Nucleolus (bright dot)
      if (nucLevel > 0.3) {
        ctx.globalAlpha = nucLevel * 0.6
        ctx.fillStyle = hsla(280, 80, 70, 0.7)
        ctx.beginPath()
        ctx.arc(x + nr * 0.15, y - nr * 0.1, nr * 0.25, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // ── Mitochondria (small elongated shapes orbiting) ──
    const mitoLevel = org[ORGANELLE_MITOCHONDRIA]
    if (mitoLevel > 0.08) {
      const count = Math.floor(1 + mitoLevel * 4)
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.4 + mitoLevel * 0.4
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + t * 0.015 + c.id * 0.7
        const dist = r * 0.45 + r * 0.15 * Math.sin(t * 0.02 + i)
        const mx = x + Math.cos(angle) * dist
        const my = y + Math.sin(angle) * dist
        const mw = r * 0.18 * (0.8 + mitoLevel * 0.4)
        const mh = mw * 2.2

        ctx.save()
        ctx.translate(mx, my)
        ctx.rotate(angle + Math.PI / 2)
        ctx.fillStyle = hsla(15, 85, 50, 0.7)
        ctx.beginPath()
        ctx.ellipse(0, 0, mw * 0.5, mh * 0.5, 0, 0, Math.PI * 2)
        ctx.fill()
        // Inner cristae
        ctx.fillStyle = hsla(25, 70, 65, 0.5)
        ctx.beginPath()
        ctx.ellipse(0, 0, mw * 0.2, mh * 0.35, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
      ctx.restore()
    }

    // ── Flagellum (tail extending from cell) ──
    const flagLevel = org[ORGANELLE_FLAGELLUM]
    if (flagLevel > 0.1) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.3 + flagLevel * 0.5
      const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
      const tailDx = -c.vx / vLen
      const tailDy = -c.vy / vLen
      const tailLen = r * (1.5 + flagLevel * 2.5)

      ctx.strokeStyle = hsla(160, 70, 55, 0.6)
      ctx.lineWidth = 0.8 + flagLevel * 0.8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x + tailDx * r * 0.8, y + tailDy * r * 0.8)

      // Sinusoidal flagellum
      const segments = 6
      for (let s = 1; s <= segments; s++) {
        const frac = s / segments
        const wave = Math.sin(t * 0.15 + frac * Math.PI * 3) * r * 0.3 * flagLevel
        const perpX = -tailDy
        const perpY = tailDx
        const fx = x + tailDx * (r * 0.8 + tailLen * frac) + perpX * wave
        const fy = y + tailDy * (r * 0.8 + tailLen * frac) + perpY * wave
        ctx.lineTo(fx, fy)
      }
      ctx.stroke()
      ctx.restore()
    }

    // ── Membrane receptors (dots on cell surface) ──
    const recLevel = org[ORGANELLE_RECEPTOR]
    if (recLevel > 0.1) {
      const count = Math.floor(2 + recLevel * 6)
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.4 + recLevel * 0.4
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + c.id * 1.3
        const rx = x + Math.cos(angle) * (r + 0.5)
        const ry = y + Math.sin(angle) * (r + 0.5)
        ctx.fillStyle = hsla(45, 85, 60, 0.7)
        ctx.beginPath()
        ctx.arc(rx, ry, 0.6 + recLevel * 0.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // ── Vacuole (translucent bubble inside cell) ──
    const vacLevel = org[ORGANELLE_VACUOLE]
    if (vacLevel > 0.1) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.2 + vacLevel * 0.3
      const vr = r * 0.3 * vacLevel + r * 0.08
      const vx = x + r * 0.2 * Math.sin(c.id * 2.1)
      const vy = y + r * 0.2 * Math.cos(c.id * 3.7)
      const vacGrad = ctx.createRadialGradient(vx - vr * 0.2, vy - vr * 0.2, 0, vx, vy, vr)
      vacGrad.addColorStop(0, hsla(200, 50, 75, 0.5))
      vacGrad.addColorStop(1, hsla(200, 40, 45, 0.1))
      ctx.fillStyle = vacGrad
      ctx.beginPath()
      ctx.arc(vx, vy, vr, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
}
