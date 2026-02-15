export function installFood(Renderer) {
  const P = Renderer.prototype

  P._ensureFoodImage = function (w, h) {
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

  P._drawFood = function (sim) {
    const { w, h } = sim
    const food = sim.food
    const mineral = sim.mineralFood
    const meat = sim.meatFood
    const t = this._frameTick

    const stride = 8
    const cw = Math.ceil(w / stride)
    const ch = Math.ceil(h / stride)
    if (!this._foodCanvas) {
      this._foodCanvas = document.createElement('canvas')
      this._foodCtx = this._foodCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
    }
    if (this._foodCanvas.width !== cw || this._foodCanvas.height !== ch) {
      this._foodCanvas.width = cw
      this._foodCanvas.height = ch
      this._foodImgData = this._foodCtx.createImageData(cw, ch)
    }
    const fctx = this._foodCtx
    const imgData = this._foodImgData
    const d = imgData.data
    // Clear previous frame data
    d.fill(0)

    // Animated pulse for food shimmer — very gentle
    const pulse = 0.92 + 0.08 * Math.sin(t * 0.008)
    const pulse2 = 0.94 + 0.06 * Math.sin(t * 0.012 + 1.5)

    for (let cy2 = 0; cy2 < ch; cy2++) {
      const gy = cy2 * stride
      for (let cx2 = 0; cx2 < cw; cx2++) {
        const gx = cx2 * stride

        const j = Math.min(gx, w - 1) + Math.min(gy, h - 1) * w
        const p = food[j]
        const m = mineral ? mineral[j] : 0
        const k = meat ? meat[j] : 0

        if (p < 0.06 && m < 0.02 && k < 0.01) continue

        const idx = (cy2 * cw + cx2) * 4
        let r = 0,
          g = 0,
          b = 0,
          a = 0

        // Spatial noise — cheap hash
        const noise = 0.88 + 0.12 * (((gx * 31 + gy * 17) & 255) / 255)

        // Plant food — lush bioluminescent green with cyan highlights
        if (p > 0.06) {
          const v = p < 4 ? p / 4 : 1
          const vp = v * pulse * noise
          r += (15 + vp * 45) | 0
          g += (120 + vp * 135) | 0
          b += (40 + vp * 80) | 0
          a += (40 + vp * 200) | 0
        }

        // Mineral food — golden crystalline with warm white sparkle
        if (m > 0.02) {
          const v = m < 1.2 ? m / 1.2 : 1
          const vm = v * pulse2 * noise
          r += (180 + vm * 75) | 0
          g += (150 + vm * 90) | 0
          b += (30 + vm * 80) | 0
          a += (60 + vm * 180) | 0
        }

        // Meat food — visceral crimson with dark undertones
        if (k > 0.01) {
          const v = k < 1.0 ? k / 1.0 : 1
          const vk = v * pulse
          r += (180 + vk * 75) | 0
          g += (15 + vk * 35) | 0
          b += (25 + vk * 40) | 0
          a += (70 + vk * 180) | 0
        }

        d[idx] = r > 255 ? 255 : r
        d[idx + 1] = g > 255 ? 255 : g
        d[idx + 2] = b > 255 ? 255 : b
        d[idx + 3] = a > 255 ? 255 : a
      }
    }
    fctx.putImageData(imgData, 0, 0)
  }

  // ── Bud consumption particles ──
  P._budParticles = []

  // ── Plant buds & fronds overlay — PERFORMANCE OPTIMIZED ──
  // No createRadialGradient calls. Simple filled circles only.
  P._drawFoodBuds = function (sim) {
    const ctx = this.ctx
    const t = this._frameTick
    const food = sim.food
    const mineral = sim.mineralFood
    const { w, h } = sim
    const TAU = Math.PI * 2
    const cw = this.canvas.width,
      ch = this.canvas.height
    const scale = this.view.scale

    // Coarse scan — only scan visible region, not entire world
    const step = 24
    const budThreshold = 2.5
    const mineralThreshold = 1.5
    const maxBuds = 80
    let budCount = 0

    // Compute visible world-space bounds from camera
    const _vcx = this.view.cx
    const _vcy = this.view.cy
    const _vs = this.view.scale
    const _hw = cw * 0.5
    const _hh = ch * 0.5
    const visX0 = Math.max(0, Math.floor(_vcx - _hw / _vs - step))
    const visY0 = Math.max(0, Math.floor(_vcy - _hh / _vs - step))
    const visX1 = Math.min(w, Math.ceil(_vcx + _hw / _vs + step))
    const visY1 = Math.min(h, Math.ceil(_vcy + _hh / _vs + step))

    ctx.save()
    ctx.lineCap = 'round'

    for (let gy = visY0; gy < visY1 && budCount < maxBuds; gy += step) {
      for (let gx = visX0; gx < visX1 && budCount < maxBuds; gx += step) {
        const j = Math.min(gx, w - 1) + Math.min(gy, h - 1) * w
        const p = food[j]

        if (p > budThreshold) {
          const [sx, sy] = this.worldToScreen(gx + 0.5, gy + 0.5)
          if (sx < -20 || sx > cw + 20 || sy < -20 || sy > ch + 20) continue

          const density = Math.min((p - budThreshold) / 5, 1)
          const nBuds = (2 + density * 2) | 0
          const baseR = (1.5 + density * 2.5) * scale
          const seed = (gx * 31 + gy * 17) | 0

          for (let bi = 0; bi < nBuds; bi++) {
            const ba = (((seed + bi * 137) % 360) / 360) * TAU
            const bLen = baseR * (1.2 + 0.4 * ((seed * 0.3 + bi * 2.1) % 1))
            const curl = 0.3 + 0.08 * (((t * 0.003 + seed + bi) % 6.28) - 3.14)
            const tipA = ba + curl
            const bx = sx + Math.cos(ba) * baseR * 0.3
            const by = sy + Math.sin(ba) * baseR * 0.3
            const tipX = bx + Math.cos(tipA) * bLen
            const tipY = by + Math.sin(tipA) * bLen

            // Frond stem — single stroke
            ctx.globalAlpha = 0.2 + density * 0.15
            ctx.strokeStyle = '#3aaa45'
            ctx.lineWidth = (0.4 + density * 0.5) * scale
            ctx.beginPath()
            ctx.moveTo(bx, by)
            ctx.lineTo(tipX, tipY)
            ctx.stroke()

            // Bud tip — simple filled circle, no gradient
            const budR = (0.8 + density * 1.2) * scale
            ctx.globalAlpha = 0.3 + density * 0.25
            ctx.fillStyle = '#78f050'
            ctx.beginPath()
            ctx.arc(tipX, tipY, budR, 0, TAU)
            ctx.fill()

            budCount++
          }
        }

        // ── Mineral clusters — simple polygon, no sparkle pass ──
        const m = mineral ? mineral[j] : 0
        if (m > mineralThreshold) {
          const [sx, sy] = this.worldToScreen(gx + 0.5, gy + 0.5)
          if (sx < -15 || sx > cw + 15 || sy < -15 || sy > ch + 15) continue

          const density = Math.min((m - mineralThreshold) / 1.5, 1)
          const crystR = (0.7 + density * 1.8) * scale
          const seed = (gx * 47 + gy * 23) | 0
          const facets = 5 + (seed % 3)

          ctx.globalAlpha = 0.18 + density * 0.2
          ctx.fillStyle = '#dcc850'
          ctx.beginPath()
          for (let fi = 0; fi < facets; fi++) {
            const fa = (fi / facets) * TAU + seed * 0.1
            const fr = crystR * (0.7 + 0.3 * ((seed * 3 + fi * 5) % 1))
            if (fi === 0) ctx.moveTo(sx + Math.cos(fa) * fr, sy + Math.sin(fa) * fr)
            else ctx.lineTo(sx + Math.cos(fa) * fr, sy + Math.sin(fa) * fr)
          }
          ctx.closePath()
          ctx.fill()
        }
      }
    }

    ctx.restore()

    // ── Draw & update bud absorption particles (capped) ──
    this._updateBudParticles()
  }

  P._updateBudParticles = function () {
    const parts = this._budParticles
    if (!parts || parts.length === 0) return
    const ctx = this.ctx
    const TAU = Math.PI * 2

    ctx.save()
    ctx.fillStyle = '#78f050'
    // Compact dead particles with forward sweep (O(1) per removal)
    let bw = 0
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      p.life -= p.decay
      if (p.life <= 0) continue
      if (bw !== i) parts[bw] = p
      bw++
    }
    parts.length = bw

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      const dx = p.tx - p.x,
        dy = p.ty - p.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const speed = 2.5 + (1 - p.life) * 4
      p.x += (dx / dist) * speed
      p.y += (dy / dist) * speed

      ctx.globalAlpha = p.life * p.life * 0.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * p.life, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }
}
