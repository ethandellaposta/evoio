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

    // Biome-specific plant bud palettes
    // { stem, bud, mineralColor } per flora type
    const _floraPalette = {
      kelp: { stem: '#2a7a30', bud: '#5ad040', mineral: '#8ab050' },
      coral: { stem: '#c06848', bud: '#f08870', mineral: '#e0c060' },
      plankton: { stem: '#3088a0', bud: '#50c8d8', mineral: '#90b8d0' },
      detritus: { stem: '#506858', bud: '#80a088', mineral: '#a0a890' },
      tubeworm: { stem: '#a06020', bud: '#d09030', mineral: '#d0a840' }
    }
    const _defaultPalette = { stem: '#3aaa45', bud: '#78f050', mineral: '#dcc850' }
    const biomes = sim.cfg && sim.cfg.biomes ? sim.cfg.biomes : null
    const numBiomes = biomes ? biomes.length : 0
    const regionW = numBiomes > 0 ? w / numBiomes : w

    ctx.save()
    ctx.lineCap = 'round'

    for (let gy = visY0; gy < visY1 && budCount < maxBuds; gy += step) {
      for (let gx = visX0; gx < visX1 && budCount < maxBuds; gx += step) {
        const j = Math.min(gx, w - 1) + Math.min(gy, h - 1) * w
        const p = food[j]

        // Determine biome palette for this grid cell
        let _pal = _defaultPalette
        if (numBiomes > 0) {
          const _bi = Math.min(numBiomes - 1, (gx / regionW) | 0)
          const flora = biomes[_bi].flora || 'plankton'
          _pal = _floraPalette[flora] || _defaultPalette
        }

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

            // Frond stem — biome-colored
            ctx.globalAlpha = 0.2 + density * 0.15
            ctx.strokeStyle = _pal.stem
            ctx.lineWidth = (0.4 + density * 0.5) * scale
            ctx.beginPath()
            ctx.moveTo(bx, by)
            ctx.lineTo(tipX, tipY)
            ctx.stroke()

            // Bud tip — biome-colored
            const budR = (0.8 + density * 1.2) * scale
            ctx.globalAlpha = 0.3 + density * 0.25
            ctx.fillStyle = _pal.bud
            ctx.beginPath()
            ctx.arc(tipX, tipY, budR, 0, TAU)
            ctx.fill()

            budCount++
          }
        }

        // ── Mineral clusters — biome-colored polygon ──
        const m = mineral ? mineral[j] : 0
        if (m > mineralThreshold) {
          const [sx, sy] = this.worldToScreen(gx + 0.5, gy + 0.5)
          if (sx < -15 || sx > cw + 15 || sy < -15 || sy > ch + 15) continue

          const density = Math.min((m - mineralThreshold) / 1.5, 1)
          const crystR = (0.7 + density * 1.8) * scale
          const seed = (gx * 47 + gy * 23) | 0
          const facets = 5 + (seed % 3)

          ctx.globalAlpha = 0.18 + density * 0.2
          ctx.fillStyle = _pal.mineral
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

  // ══════════════════════════════════════
  //  TERRAIN OBJECTS — biome-specific flora & structures
  // ══════════════════════════════════════
  P._drawTerrain = function (sim) {
    const objs = sim.terrainObjects
    if (!objs || objs.length === 0) return
    const ctx = this.ctx
    const t = this._frameTick
    const S = this.view.scale
    const TAU = Math.PI * 2
    const cw = this.canvas.width,
      ch = this.canvas.height
    const vcx = this.view.cx,
      vcy = this.view.cy
    const hw = cw * 0.5,
      hh = ch * 0.5

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (let i = 0; i < objs.length; i++) {
      const obj = objs[i]
      const px = (obj.x - vcx) * S + hw
      const py = (obj.y - vcy) * S + hh
      if (px < -80 || px > cw + 80 || py < -80 || py > ch + 80) continue
      const baseR = obj.size * S * 10
      if (baseR < 0.8) continue

      const seed = obj.seed
      const time = t * 0.01

      switch (obj.type) {
        case 'kelp_stalk': {
          // Giant kelp — long flowing ribbon with gas bladders, swaying in current
          const stalkH = baseR * 4
          const sway1 = Math.sin(time * 0.5 + seed * 0.1) * baseR * 0.6
          const sway2 = Math.sin(time * 0.7 + seed * 0.3) * baseR * 0.3
          const sway3 = Math.sin(time * 0.3 + seed * 0.7) * baseR * 0.15

          // Translucent stipe (main stem) — thick bezier
          ctx.globalAlpha = 0.35
          ctx.strokeStyle = `hsla(${obj.hue - 5}, 40%, 22%, 0.8)`
          ctx.lineWidth = Math.max(1.5, baseR * 0.12)
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.bezierCurveTo(
            px + sway3,
            py - stalkH * 0.33,
            px + sway1 * 0.6 + sway2,
            py - stalkH * 0.66,
            px + sway1,
            py - stalkH
          )
          ctx.stroke()

          // Flowing fronds — wide translucent ribbons that drift in current
          const nFronds = Math.min(8, Math.max(3, (baseR * 0.5) | 0))
          for (let f = 0; f < nFronds; f++) {
            const frac = 0.15 + (f / nFronds) * 0.8
            const stipeX = px + sway1 * frac + sway2 * (1 - frac) * 0.5
            const stipeY = py - stalkH * frac
            const side = f % 2 === 0 ? 1 : -1
            const fLen = baseR * (1.0 + (1 - frac) * 1.5)
            const fSway = Math.sin(time * 1.0 + f * 1.5 + seed) * fLen * 0.3
            const fSway2 = Math.sin(time * 0.6 + f * 0.8 + seed * 1.3) * fLen * 0.15

            // Frond ribbon — translucent flowing shape
            ctx.globalAlpha = 0.18 + frac * 0.08
            ctx.fillStyle = `hsla(${obj.hue + 5 + f * 3}, 45%, ${32 + frac * 12}%, 0.6)`
            ctx.beginPath()
            ctx.moveTo(stipeX, stipeY)
            ctx.bezierCurveTo(
              stipeX + side * fLen * 0.3 + fSway * 0.4,
              stipeY - fLen * 0.15 + fSway2,
              stipeX + side * fLen * 0.7 + fSway,
              stipeY + fLen * 0.05 + fSway2,
              stipeX + side * fLen + fSway,
              stipeY + fLen * 0.2
            )
            ctx.bezierCurveTo(
              stipeX + side * fLen * 0.6 + fSway * 0.8,
              stipeY + fLen * 0.12 + fSway2 * 0.5,
              stipeX + side * fLen * 0.2 + fSway * 0.3,
              stipeY + fLen * 0.05,
              stipeX,
              stipeY + baseR * 0.08
            )
            ctx.fill()

            // Frond midrib — thin line through center
            ctx.globalAlpha = 0.25
            ctx.strokeStyle = `hsla(${obj.hue}, 50%, 28%, 0.7)`
            ctx.lineWidth = Math.max(0.3, baseR * 0.03)
            ctx.beginPath()
            ctx.moveTo(stipeX, stipeY)
            ctx.bezierCurveTo(
              stipeX + side * fLen * 0.3 + fSway * 0.4,
              stipeY - fLen * 0.05,
              stipeX + side * fLen * 0.7 + fSway,
              stipeY + fLen * 0.1,
              stipeX + side * fLen + fSway,
              stipeY + fLen * 0.2
            )
            ctx.stroke()
          }

          // Gas bladders (pneumatocysts) — small glowing spheres along stipe
          const nBladders = Math.min(5, Math.max(2, (baseR * 0.3) | 0))
          ctx.globalCompositeOperation = 'lighter'
          for (let b = 0; b < nBladders; b++) {
            const bf = 0.3 + (b / nBladders) * 0.6
            const bx = px + sway1 * bf + sway2 * (1 - bf) * 0.5
            const by = py - stalkH * bf
            const br = baseR * (0.06 + 0.03 * Math.sin(time * 2 + b * 1.7))
            ctx.globalAlpha = 0.15
            ctx.fillStyle = `hsla(${obj.hue + 20}, 60%, 55%, 0.5)`
            ctx.beginPath()
            ctx.arc(bx, by, br, 0, TAU)
            ctx.fill()
          }
          ctx.globalCompositeOperation = 'source-over'

          // Holdfast — dark organic mass at base
          ctx.globalAlpha = 0.3
          ctx.fillStyle = `hsla(${obj.hue - 15}, 30%, 15%, 0.7)`
          ctx.beginPath()
          ctx.ellipse(px, py + baseR * 0.05, baseR * 0.35, baseR * 0.15, 0, 0, TAU)
          ctx.fill()
          break
        }

        case 'seagrass_patch': {
          // Seagrass meadow — soft flowing blades with light filtering through
          const nBlades = Math.min(12, Math.max(4, (baseR * 0.6) | 0))
          for (let b = 0; b < nBlades; b++) {
            const bAngle = (((seed + b * 47) % 360) / 360) * TAU
            const bDist = baseR * 0.5 * ((seed * 0.3 + b * 0.7) % 1)
            const bx = px + Math.cos(bAngle) * bDist
            const by = py + Math.sin(bAngle) * bDist * 0.4
            const bladeH = baseR * (1.2 + ((seed + b * 13) % 5) * 0.2)
            const bladeSway = Math.sin(time * 0.8 + b * 0.6 + seed * 0.2) * baseR * 0.25
            const bladeSway2 = Math.sin(time * 1.1 + b * 1.1 + seed * 0.5) * baseR * 0.1

            // Blade — translucent ribbon
            ctx.globalAlpha = 0.2 + ((seed + b) % 3) * 0.05
            ctx.strokeStyle = `hsla(${obj.hue + b * 2}, 50%, ${35 + b * 2}%, 0.7)`
            ctx.lineWidth = Math.max(0.8, baseR * 0.07)
            ctx.beginPath()
            ctx.moveTo(bx, by)
            ctx.bezierCurveTo(
              bx + bladeSway * 0.3,
              by - bladeH * 0.33,
              bx + bladeSway + bladeSway2,
              by - bladeH * 0.66,
              bx + bladeSway * 1.3 + bladeSway2,
              by - bladeH
            )
            ctx.stroke()
          }
          break
        }

        case 'coral_head': {
          // Brain/boulder coral — organic mound with glowing polyps
          const nLobes = 6 + (seed % 4)
          const pulse = Math.sin(time * 0.4 + seed) * 0.05

          // Outer glow halo
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = 0.06
          ctx.fillStyle = `hsla(${obj.hue}, 60%, 50%, 0.4)`
          ctx.beginPath()
          ctx.arc(px, py, baseR * 1.3, 0, TAU)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'

          // Main coral body — organic blobby shape
          ctx.globalAlpha = 0.45
          ctx.fillStyle = `hsla(${obj.hue}, 55%, 40%, 0.8)`
          ctx.beginPath()
          for (let b = 0; b < nLobes; b++) {
            const ba = (b / nLobes) * TAU
            const br = baseR * (0.65 + 0.25 * Math.sin(ba * 3 + seed) + pulse)
            if (b === 0) ctx.moveTo(px + Math.cos(ba) * br, py + Math.sin(ba) * br)
            else {
              const ba2 = ((b + 0.5) / nLobes) * TAU
              const br2 = baseR * (0.55 + 0.15 * Math.sin(ba2 * 2 + seed * 1.3))
              ctx.quadraticCurveTo(
                px + Math.cos(ba2) * br2,
                py + Math.sin(ba2) * br2,
                px + Math.cos(ba) * br,
                py + Math.sin(ba) * br
              )
            }
          }
          ctx.closePath()
          ctx.fill()

          // Groove pattern (meandroid ridges)
          ctx.globalAlpha = 0.15
          ctx.strokeStyle = `hsla(${obj.hue + 20}, 40%, 25%, 0.6)`
          ctx.lineWidth = Math.max(0.3, baseR * 0.03)
          for (let g = 0; g < 3; g++) {
            const ga = (g / 3) * Math.PI + seed * 0.1
            ctx.beginPath()
            ctx.moveTo(px + Math.cos(ga) * baseR * 0.5, py + Math.sin(ga) * baseR * 0.3)
            ctx.quadraticCurveTo(
              px + Math.cos(ga + 0.5) * baseR * 0.2,
              py + Math.sin(ga + 0.5) * baseR * 0.2,
              px + Math.cos(ga + 1) * baseR * 0.4,
              py + Math.sin(ga + 1) * baseR * 0.35
            )
            ctx.stroke()
          }

          // Glowing polyps
          ctx.globalCompositeOperation = 'lighter'
          const nPolyps = Math.min(10, Math.max(3, (baseR * 0.4) | 0))
          for (let p = 0; p < nPolyps; p++) {
            const pa = (((seed + p * 97) % 360) / 360) * TAU
            const pd = baseR * 0.45 * ((seed * 0.2 + p * 0.5) % 1)
            const polypR = baseR * (0.05 + 0.02 * Math.sin(time * 2.5 + p * 1.3))
            ctx.globalAlpha = 0.08 + 0.04 * Math.sin(time * 1.5 + p)
            ctx.fillStyle = `hsla(${(obj.hue + 50 + p * 15) % 360}, 70%, 65%, 0.6)`
            ctx.beginPath()
            ctx.arc(px + Math.cos(pa) * pd, py + Math.sin(pa) * pd, polypR, 0, TAU)
            ctx.fill()
          }
          ctx.globalCompositeOperation = 'source-over'
          break
        }

        case 'coral_fan': {
          // Sea fan (gorgonian) — delicate branching fan swaying in current
          const fanSway = Math.sin(time * 0.4 + seed * 0.2) * baseR * 0.15
          const fanH = baseR * 2.0
          const fanW = baseR * 1.5

          // Stem
          ctx.globalAlpha = 0.35
          ctx.strokeStyle = `hsla(${obj.hue - 10}, 35%, 28%, 0.8)`
          ctx.lineWidth = Math.max(1, baseR * 0.08)
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.quadraticCurveTo(px + fanSway * 0.3, py - fanH * 0.3, px + fanSway * 0.5, py - fanH * 0.4)
          ctx.stroke()

          // Fan mesh — overlapping translucent arcs
          const nArcs = Math.min(9, Math.max(4, (baseR * 0.5) | 0))
          for (let a = 0; a < nArcs; a++) {
            const af = a / (nArcs - 1) - 0.5
            const arcSway = fanSway + Math.sin(time * 0.6 + a * 0.7 + seed) * baseR * 0.08
            const tipX = px + af * fanW + arcSway
            const tipY = py - fanH * (0.5 + (1 - Math.abs(af) * 1.5) * 0.45)

            ctx.globalAlpha = 0.12 + 0.03 * Math.sin(time + a)
            ctx.strokeStyle = `hsla(${obj.hue + a * 4}, 50%, ${42 + a * 2}%, 0.7)`
            ctx.lineWidth = Math.max(0.3, baseR * 0.025)
            ctx.beginPath()
            ctx.moveTo(px + fanSway * 0.5, py - fanH * 0.4)
            ctx.bezierCurveTo(
              px + af * fanW * 0.4 + arcSway * 0.6,
              tipY + fanH * 0.15,
              tipX * 0.7 + px * 0.3,
              tipY + fanH * 0.05,
              tipX,
              tipY
            )
            ctx.stroke()
          }

          // Subtle glow at base
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = 0.04
          ctx.fillStyle = `hsla(${obj.hue}, 50%, 50%, 0.4)`
          ctx.beginPath()
          ctx.arc(px, py - fanH * 0.3, baseR * 0.8, 0, TAU)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'
          break
        }

        case 'anemone': {
          // Sea anemone — translucent body with flowing bioluminescent tentacles
          const nTentacles = 8 + (seed % 5)
          const bodyR = baseR * 0.35
          const breathe = Math.sin(time * 0.6 + seed) * bodyR * 0.08

          // Body column — translucent with inner glow
          ctx.globalAlpha = 0.3
          ctx.fillStyle = `hsla(${obj.hue}, 45%, 30%, 0.7)`
          ctx.beginPath()
          ctx.ellipse(px, py, bodyR + breathe, bodyR * 0.65 + breathe * 0.5, 0, 0, TAU)
          ctx.fill()

          // Inner glow
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = 0.06
          ctx.fillStyle = `hsla(${obj.hue + 30}, 60%, 55%, 0.5)`
          ctx.beginPath()
          ctx.arc(px, py, bodyR * 0.6, 0, TAU)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'

          // Tentacles — flowing curves with glowing tips
          for (let tt = 0; tt < nTentacles; tt++) {
            const ta = (tt / nTentacles) * TAU
            const tLen = baseR * (0.7 + ((seed + tt * 23) % 5) * 0.12)
            const tSway = Math.sin(time * 1.2 + tt * 0.7 + seed * 0.15) * tLen * 0.3
            const tSway2 = Math.sin(time * 0.8 + tt * 1.1 + seed * 0.4) * tLen * 0.15
            const tipX = px + Math.cos(ta) * tLen + tSway
            const tipY = py + Math.sin(ta) * tLen * 0.5 + tSway2

            ctx.globalAlpha = 0.2
            ctx.strokeStyle = `hsla(${obj.hue + 10 + tt * 3}, 55%, ${45 + tt}%, 0.6)`
            ctx.lineWidth = Math.max(0.5, baseR * 0.04)
            ctx.beginPath()
            ctx.moveTo(px + Math.cos(ta) * bodyR * 0.7, py + Math.sin(ta) * bodyR * 0.5)
            ctx.bezierCurveTo(
              px + Math.cos(ta) * tLen * 0.4 + tSway * 0.3,
              py + Math.sin(ta) * tLen * 0.3 + tSway2 * 0.5,
              px + Math.cos(ta) * tLen * 0.7 + tSway * 0.7,
              tipY - tLen * 0.05,
              tipX,
              tipY
            )
            ctx.stroke()

            // Glowing tip
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.08 + 0.04 * Math.sin(time * 2 + tt)
            ctx.fillStyle = `hsla(${(obj.hue + 40) % 360}, 70%, 65%, 0.5)`
            ctx.beginPath()
            ctx.arc(tipX, tipY, baseR * 0.04, 0, TAU)
            ctx.fill()
            ctx.globalCompositeOperation = 'source-over'
          }
          break
        }

        case 'sponge': {
          // Barrel sponge — translucent vase shape with water flowing through
          const spongeH = baseR * 1.0
          const spongeW = baseR * 0.55
          const breathe = Math.sin(time * 0.3 + seed) * spongeW * 0.05

          // Outer body — translucent
          ctx.globalAlpha = 0.25
          ctx.fillStyle = `hsla(${obj.hue}, 35%, 32%, 0.7)`
          ctx.beginPath()
          ctx.ellipse(px, py - spongeH * 0.35, spongeW + breathe, spongeH * 0.55, 0, 0, TAU)
          ctx.fill()

          // Inner rim highlight
          ctx.globalAlpha = 0.15
          ctx.strokeStyle = `hsla(${obj.hue + 15}, 45%, 45%, 0.6)`
          ctx.lineWidth = Math.max(0.5, baseR * 0.04)
          ctx.beginPath()
          ctx.ellipse(px, py - spongeH * 0.75, spongeW * 0.55, spongeW * 0.25, 0, 0, TAU)
          ctx.stroke()

          // Osculum (dark opening)
          ctx.globalAlpha = 0.2
          ctx.fillStyle = `hsla(${obj.hue}, 25%, 12%, 0.6)`
          ctx.beginPath()
          ctx.ellipse(px, py - spongeH * 0.75, spongeW * 0.4, spongeW * 0.18, 0, 0, TAU)
          ctx.fill()

          // Water current particles rising from osculum
          ctx.globalCompositeOperation = 'lighter'
          for (let p = 0; p < 3; p++) {
            const pPhase = (time * 1.5 + p * 2.1 + seed) % 3
            if (pPhase > 2) continue
            const pY = py - spongeH * 0.8 - pPhase * baseR * 0.4
            const pX = px + Math.sin(time * 2 + p * 1.7) * baseR * 0.1
            ctx.globalAlpha = 0.04 * (1 - pPhase / 2)
            ctx.fillStyle = `hsla(${obj.hue + 20}, 40%, 60%, 0.4)`
            ctx.beginPath()
            ctx.arc(pX, pY, baseR * 0.03, 0, TAU)
            ctx.fill()
          }
          ctx.globalCompositeOperation = 'source-over'
          break
        }

        case 'vent_chimney': {
          // Black smoker — dark mineral chimney with glowing cracks and rising shimmer
          const chimH = baseR * 3.0
          const chimW = baseR * 0.45

          // Chimney body — dark craggy mineral column
          ctx.globalAlpha = 0.5
          ctx.fillStyle = `hsla(220, 15%, 12%, 0.8)`
          ctx.beginPath()
          ctx.moveTo(px - chimW, py)
          ctx.bezierCurveTo(
            px - chimW * 1.1,
            py - chimH * 0.3,
            px - chimW * 0.7,
            py - chimH * 0.7,
            px - chimW * 0.5,
            py - chimH
          )
          ctx.lineTo(px + chimW * 0.5, py - chimH)
          ctx.bezierCurveTo(
            px + chimW * 0.7,
            py - chimH * 0.7,
            px + chimW * 1.1,
            py - chimH * 0.3,
            px + chimW,
            py
          )
          ctx.closePath()
          ctx.fill()

          // Glowing magma cracks — orange/red lines along chimney
          ctx.globalCompositeOperation = 'lighter'
          for (let c = 0; c < 3; c++) {
            const cy1 = py - chimH * (0.15 + c * 0.25)
            const cy2 = py - chimH * (0.25 + c * 0.25)
            const cx1 = px + (((seed + c * 31) % 7) - 3) * chimW * 0.15
            const glow = 0.15 + 0.08 * Math.sin(time * 1.5 + c * 2.3 + seed)
            ctx.globalAlpha = glow
            ctx.strokeStyle = `hsla(${15 + c * 8}, 90%, 55%, 0.8)`
            ctx.lineWidth = Math.max(0.5, baseR * 0.04)
            ctx.beginPath()
            ctx.moveTo(cx1 - chimW * 0.3, cy1)
            ctx.quadraticCurveTo(cx1, (cy1 + cy2) * 0.5 + baseR * 0.05, cx1 + chimW * 0.2, cy2)
            ctx.stroke()
          }

          // Vent opening glow — pulsing orange radial
          const glowPulse = 0.12 + 0.06 * Math.sin(time * 1.2 + seed)
          ctx.globalAlpha = glowPulse
          const ventGrad = ctx.createRadialGradient(px, py - chimH, 0, px, py - chimH, baseR * 0.5)
          ventGrad.addColorStop(0, 'hsla(25, 100%, 60%, 0.8)')
          ventGrad.addColorStop(0.4, 'hsla(15, 90%, 40%, 0.4)')
          ventGrad.addColorStop(1, 'hsla(0, 80%, 20%, 0)')
          ctx.fillStyle = ventGrad
          ctx.beginPath()
          ctx.arc(px, py - chimH, baseR * 0.5, 0, TAU)
          ctx.fill()

          // Rising shimmer bubbles — heated water particles
          for (let s = 0; s < 6; s++) {
            const sPhase = (time * 0.8 + s * 1.1 + seed * 0.3) % 4
            if (sPhase > 3) continue
            const sY = py - chimH - sPhase * baseR * 0.8
            const sX = px + Math.sin(time * 1.5 + s * 2.3 + seed) * baseR * 0.3 * (0.5 + sPhase * 0.3)
            const sR = baseR * (0.03 + sPhase * 0.02)
            const sAlpha = 0.08 * (1 - sPhase / 3)
            ctx.globalAlpha = sAlpha
            ctx.fillStyle = `hsla(30, 70%, 60%, 0.6)`
            ctx.beginPath()
            ctx.arc(sX, sY, sR, 0, TAU)
            ctx.fill()
          }
          ctx.globalCompositeOperation = 'source-over'

          // Mineral deposits — subtle colored bands
          ctx.globalAlpha = 0.15
          for (let m = 0; m < 3; m++) {
            const my = py - chimH * (0.2 + m * 0.22)
            const mw = chimW * (0.9 + ((seed + m * 31) % 5) * 0.06)
            ctx.fillStyle = `hsla(${200 + m * 20}, 25%, ${18 + m * 4}%, 0.5)`
            ctx.beginPath()
            ctx.ellipse(px, my, mw, baseR * 0.06, 0, 0, TAU)
            ctx.fill()
          }
          break
        }

        case 'tube_cluster': {
          // Giant tube worms — translucent tubes with bright red feathery plumes
          const nTubes = 5 + (seed % 4)
          for (let tt = 0; tt < nTubes; tt++) {
            const ta = (((seed + tt * 53) % 360) / 360) * TAU
            const td = baseR * 0.4 * ((seed * 0.2 + tt * 0.4) % 1)
            const tx = px + Math.cos(ta) * td
            const ty = py + Math.sin(ta) * td * 0.4
            const tubeH = baseR * (1.2 + ((seed + tt * 17) % 5) * 0.25)
            const tubeSway = Math.sin(time * 0.6 + tt * 1.3 + seed * 0.1) * baseR * 0.06

            // Tube body — translucent white/grey chitin
            ctx.globalAlpha = 0.2
            ctx.strokeStyle = `hsla(210, 10%, 55%, 0.6)`
            ctx.lineWidth = Math.max(1.2, baseR * 0.09)
            ctx.beginPath()
            ctx.moveTo(tx, ty)
            ctx.quadraticCurveTo(tx + tubeSway * 0.5, ty - tubeH * 0.5, tx + tubeSway, ty - tubeH)
            ctx.stroke()

            // Red feathery plume (branchial crown) — the iconic tube worm feature
            const crownR = baseR * 0.15
            const plumeSway = Math.sin(time * 1.0 + tt * 0.9 + seed) * crownR * 0.5
            const nFilaments = 6
            for (let f = 0; f < nFilaments; f++) {
              const fa = (f / nFilaments) * TAU + time * 0.3 + tt * 0.5
              const fLen = crownR * (1.5 + 0.5 * Math.sin(time * 1.5 + f + tt))
              ctx.globalAlpha = 0.2
              ctx.strokeStyle = `hsla(${355 + f * 5}, 70%, ${50 + f * 3}%, 0.7)`
              ctx.lineWidth = Math.max(0.3, baseR * 0.02)
              ctx.beginPath()
              ctx.moveTo(tx + tubeSway, ty - tubeH)
              ctx.quadraticCurveTo(
                tx + tubeSway + Math.cos(fa) * fLen * 0.5 + plumeSway,
                ty - tubeH - fLen * 0.3,
                tx + tubeSway + Math.cos(fa) * fLen + plumeSway,
                ty - tubeH + Math.sin(fa) * fLen * 0.3 - fLen * 0.2
              )
              ctx.stroke()
            }

            // Plume glow
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.05
            ctx.fillStyle = `hsla(0, 65%, 55%, 0.4)`
            ctx.beginPath()
            ctx.arc(tx + tubeSway + plumeSway * 0.5, ty - tubeH - crownR * 0.3, crownR * 1.2, 0, TAU)
            ctx.fill()
            ctx.globalCompositeOperation = 'source-over'
          }
          break
        }

        case 'rock': {
          // Underwater rock — smooth, algae-covered, with subtle caustic highlight
          const nFaces = 6 + (seed % 3)
          ctx.globalAlpha = 0.25
          ctx.fillStyle = `hsla(${obj.hue}, 12%, 22%, 0.7)`
          ctx.beginPath()
          for (let f = 0; f < nFaces; f++) {
            const fa = (f / nFaces) * TAU + seed * 0.1
            const fr = baseR * (0.5 + 0.25 * Math.sin(fa * 2.5 + seed * 0.5))
            if (f === 0) ctx.moveTo(px + Math.cos(fa) * fr, py + Math.sin(fa) * fr)
            else ctx.lineTo(px + Math.cos(fa) * fr, py + Math.sin(fa) * fr)
          }
          ctx.closePath()
          ctx.fill()

          // Algae film — green tint
          ctx.globalAlpha = 0.08
          ctx.fillStyle = `hsla(140, 40%, 35%, 0.5)`
          ctx.fill()

          // Caustic highlight on top
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = 0.04
          ctx.fillStyle = `hsla(190, 50%, 70%, 0.4)`
          ctx.beginPath()
          ctx.ellipse(px - baseR * 0.1, py - baseR * 0.15, baseR * 0.3, baseR * 0.15, -0.3, 0, TAU)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'
          break
        }

        case 'bone_pile': {
          // Marine snow / detritus — pale organic particles settling on the floor
          ctx.globalAlpha = 0.15
          const nParts = 4 + (seed % 4)
          for (let b = 0; b < nParts; b++) {
            const ba = (((seed + b * 83) % 360) / 360) * TAU
            const bd = baseR * 0.5 * ((seed * 0.3 + b * 0.6) % 1)
            const partR = baseR * (0.06 + ((seed + b * 11) % 4) * 0.02)
            const partX = px + Math.cos(ba) * bd
            const partY = py + Math.sin(ba) * bd * 0.4

            ctx.fillStyle = `hsla(${40 + b * 10}, 15%, ${50 + b * 5}%, 0.5)`
            ctx.beginPath()
            ctx.ellipse(partX, partY, partR, partR * 0.6, ba, 0, TAU)
            ctx.fill()
          }
          break
        }

        case 'jellyfish_bloom': {
          // Moon jellyfish — ethereal translucent bell with trailing tentacles
          const drift = time * 0.3 + seed
          const jx = px + Math.sin(drift * 0.4) * baseR * 2.5
          const jy = py + Math.cos(drift * 0.3) * baseR * 1.5
          const bellR = baseR * 0.7
          const pulse = Math.sin(time * 1.5 + seed) * bellR * 0.1

          // Bell — translucent dome
          ctx.globalAlpha = 0.12
          ctx.fillStyle = `hsla(${obj.hue}, 30%, 75%, 0.5)`
          ctx.beginPath()
          ctx.arc(jx, jy, bellR + pulse, Math.PI, 0)
          ctx.bezierCurveTo(
            jx + bellR + pulse,
            jy + bellR * 0.2,
            jx + bellR * 0.3,
            jy + bellR * 0.35,
            jx,
            jy + bellR * 0.3
          )
          ctx.bezierCurveTo(
            jx - bellR * 0.3,
            jy + bellR * 0.35,
            jx - bellR - pulse,
            jy + bellR * 0.2,
            jx - bellR - pulse,
            jy
          )
          ctx.fill()

          // Inner organs — four-leaf clover pattern
          ctx.globalAlpha = 0.08
          ctx.fillStyle = `hsla(${obj.hue + 30}, 40%, 60%, 0.5)`
          for (let o = 0; o < 4; o++) {
            const oa = (o / 4) * TAU + 0.4
            ctx.beginPath()
            ctx.ellipse(
              jx + Math.cos(oa) * bellR * 0.2,
              jy - bellR * 0.1 + Math.sin(oa) * bellR * 0.15,
              bellR * 0.15,
              bellR * 0.1,
              oa,
              0,
              TAU
            )
            ctx.fill()
          }

          // Trailing tentacles — sinuous flowing lines
          ctx.globalAlpha = 0.08
          ctx.strokeStyle = `hsla(${obj.hue + 10}, 25%, 70%, 0.4)`
          ctx.lineWidth = 0.4
          for (let tt = 0; tt < 5; tt++) {
            const tx2 = jx + (tt - 2) * bellR * 0.3
            const tSway = Math.sin(time * 0.8 + tt * 1.3) * baseR * 0.3
            ctx.beginPath()
            ctx.moveTo(tx2, jy + bellR * 0.25)
            ctx.bezierCurveTo(
              tx2 + tSway * 0.3,
              jy + bellR * 1.0,
              tx2 + tSway,
              jy + bellR * 2.0,
              tx2 + tSway * 0.7,
              jy + bellR * 3.0
            )
            ctx.stroke()
          }

          // Bioluminescent glow
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = 0.03
          ctx.fillStyle = `hsla(${obj.hue}, 50%, 70%, 0.3)`
          ctx.beginPath()
          ctx.arc(jx, jy, bellR * 1.5, 0, TAU)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'
          break
        }
      }
    }

    ctx.globalAlpha = 1
    ctx.restore()
  }

  // ── Shelter density overlay — subtle glow where shelter is high ──
  P._drawShelterOverlay = function (sim) {
    if (!sim.shelterGrid) return
    const ctx = this.ctx
    const S = this.view.scale
    const TAU = Math.PI * 2
    const cw = this.canvas.width,
      ch = this.canvas.height
    const vcx = this.view.cx,
      vcy = this.view.cy
    const hw = cw * 0.5,
      hh = ch * 0.5
    const sw = sim.shelterW,
      sh = sim.shelterH
    const grid = sim.shelterGrid

    // Only draw every few pixels for performance
    const step = Math.max(1, Math.ceil(4 / S))
    ctx.save()

    for (let gy = 0; gy < sh; gy += step) {
      for (let gx = 0; gx < sw; gx += step) {
        const val = grid[gx + gy * sw]
        if (val < 0.3) continue

        const wx = gx * 4 + 2,
          wy = gy * 4 + 2
        const px = (wx - vcx) * S + hw
        const py = (wy - vcy) * S + hh
        if (px < -10 || px > cw + 10 || py < -10 || py > ch + 10) continue

        const density = Math.min(val / 3.0, 1.0)
        const r = (3 + density * 5) * S * step

        ctx.globalAlpha = density * 0.06
        ctx.fillStyle = `hsl(40, 30%, 50%)`
        ctx.beginPath()
        ctx.arc(px, py, r, 0, TAU)
        ctx.fill()
      }
    }

    ctx.globalAlpha = 1
    ctx.restore()
  }

  // ── Alarm pheromone overlay — red/orange danger glow where alarm is active ──
  P._drawAlarmOverlay = function (sim) {
    if (!sim.alarmGrid) return
    const ctx = this.ctx
    const S = this.view.scale
    const TAU = Math.PI * 2
    const cw = this.canvas.width,
      ch = this.canvas.height
    const vcx = this.view.cx,
      vcy = this.view.cy
    const hw = cw * 0.5,
      hh = ch * 0.5
    const sw = sim.shelterW,
      sh = sim.shelterH
    const grid = sim.alarmGrid
    const t = this._frameTick

    // Skip if no alarm anywhere (fast check — sample a few cells)
    let hasAlarm = false
    const len = grid.length
    const checkStep = Math.max(1, (len / 64) | 0)
    for (let i = 0; i < len; i += checkStep) {
      if (grid[i] > 0.05) {
        hasAlarm = true
        break
      }
    }
    if (!hasAlarm) return

    const step = Math.max(1, Math.ceil(4 / S))
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    for (let gy = 0; gy < sh; gy += step) {
      for (let gx = 0; gx < sw; gx += step) {
        const val = grid[gx + gy * sw]
        if (val < 0.05) continue

        const wx = gx * 4 + 2,
          wy = gy * 4 + 2
        const px = (wx - vcx) * S + hw
        const py = (wy - vcy) * S + hh
        if (px < -20 || px > cw + 20 || py < -20 || py > ch + 20) continue

        const intensity = Math.min(val / 2.0, 1.0)
        const r = (4 + intensity * 8) * S * step
        // Pulsing effect — alarm zones shimmer
        const pulse = 0.7 + 0.3 * Math.sin(t * 0.08 + gx * 0.5 + gy * 0.7)

        ctx.globalAlpha = intensity * 0.12 * pulse
        ctx.fillStyle = `hsl(${10 + intensity * 15}, 90%, ${50 + intensity * 10}%)`
        ctx.beginPath()
        ctx.arc(px, py, r, 0, TAU)
        ctx.fill()

        // Inner bright core for high-concentration zones
        if (intensity > 0.4) {
          ctx.globalAlpha = (intensity - 0.4) * 0.15 * pulse
          ctx.fillStyle = `hsl(25, 100%, 65%)`
          ctx.beginPath()
          ctx.arc(px, py, r * 0.5, 0, TAU)
          ctx.fill()
        }
      }
    }

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.restore()
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
