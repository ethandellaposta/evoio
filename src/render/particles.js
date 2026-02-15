import { hsl, hsla, cladeHue } from './color.js'
import { ROLE_PIONEER, ORGANELLE_FLAGELLUM } from '../sim/index.js'

const TAU = Math.PI * 2

export function installParticles(Renderer) {
  const P = Renderer.prototype

  // ══════════════════════════════════════
  //  DEATH & KILL PARTICLES
  // ══════════════════════════════════════

  P._spawnDeathParticles = function (sim) {
    if (!sim.deathEvents || sim.deathEvents.length === 0) return
    const S = this.view.scale
    // Scale particle budget with population — fewer particles when busy
    const pop = sim.cells.length
    const particleBudget = pop > 3000 ? 0.25 : pop > 1500 ? 0.5 : pop > 800 ? 0.75 : 1.0
    for (const ev of sim.deathEvents) {
      const [sx, sy] = this.worldToScreen(ev.x, ev.y)
      if (sx < -80 || sx > this.canvas.width + 80 || sy < -80 || sy > this.canvas.height + 80) continue

      // Compute organism's actual color — matches cell renderer formula
      const baseHue = cladeHue(ev.clade)
      const hue = (baseHue + (ev.hueShift || 0) * 60 + ev.diet * 40 - 10 + 360) % 360
      const sat = 65 + ev.diet * 12
      const lum = 50 + (ev.brightness || 0) * 15
      // Organelle accent hues
      const nucHue = (hue + 180) % 360
      const hasNuc = ev.organelles && ev.organelles[0] > 0.1
      const hasMito = ev.organelles && ev.organelles[1] > 0.1

      if (ev.type === 'killed') {
        // ── PREDATION KILL: violent explosion in organism colors ──
        this._deathParticles.push({
          x: sx,
          y: sy,
          vx: 0,
          vy: 0,
          life: 1.0,
          decay: 0.04,
          size: (3 + ev.energy * 2) * S,
          hue,
          sat,
          lum,
          kind: 'shockwave',
          diet: ev.diet
        })
        this._deathParticles.push({
          x: sx,
          y: sy,
          vx: 0,
          vy: 0,
          life: 1.0,
          decay: 0.05,
          size: (8 + ev.energy * 3) * S,
          hue,
          sat,
          lum,
          kind: 'flash',
          diet: ev.diet
        })
        const meatCount = Math.ceil((10 + Math.floor(ev.energy * 3)) * particleBudget)
        for (let i = 0; i < meatCount; i++) {
          if (this._deathParticles.length >= this._maxDeathParticles) break
          const angle = (i / meatCount) * TAU + Math.random() * 0.5
          const v = (1.5 + Math.random() * 3.0) * S
          // Mix of organism color, nucleus, and mito chunks
          let chunkHue = hue
          if (hasNuc && Math.random() < 0.25) chunkHue = nucHue
          else if (hasMito && Math.random() < 0.2) chunkHue = 15
          this._deathParticles.push({
            x: sx,
            y: sy,
            vx: Math.cos(angle) * v,
            vy: Math.sin(angle) * v,
            life: 1.0,
            decay: 0.015 + Math.random() * 0.012,
            size: (1.5 + Math.random() * 3.0) * S,
            hue: chunkHue,
            sat,
            lum,
            kind: 'meat_chunk',
            rot: Math.random() * TAU,
            rotV: (Math.random() - 0.5) * 0.15
          })
        }
        const splatCount = Math.ceil((6 + Math.floor(ev.energy * 2)) * particleBudget)
        for (let i = 0; i < splatCount; i++) {
          if (this._deathParticles.length >= this._maxDeathParticles) break
          const angle = Math.random() * TAU
          const v = (0.8 + Math.random() * 2.0) * S
          this._deathParticles.push({
            x: sx + (Math.random() * 4 - 2) * S,
            y: sy + (Math.random() * 4 - 2) * S,
            vx: Math.cos(angle) * v,
            vy: Math.sin(angle) * v,
            life: 1.0,
            decay: 0.018 + Math.random() * 0.012,
            size: (2.0 + Math.random() * 3.5) * S,
            hue,
            sat: sat * 0.6,
            lum: lum - 10,
            kind: 'splatter'
          })
        }
      } else if (ev.type === 'culled') {
        // ── BEHAVIORAL CULL: quiet dissolve in organism color ──
        const wispCount = Math.ceil(6 * particleBudget)
        for (let i = 0; i < wispCount; i++) {
          if (this._deathParticles.length >= this._maxDeathParticles) break
          const angle = (i / wispCount) * TAU + Math.random() * 0.8
          this._deathParticles.push({
            x: sx,
            y: sy,
            vx: Math.cos(angle) * 0.5 * S,
            vy: (Math.sin(angle) * 0.5 + 0.2) * S,
            life: 1.0,
            decay: 0.025,
            size: (1.5 + Math.random() * 2.0) * S,
            hue,
            sat,
            lum,
            kind: 'decay_wisp'
          })
        }
      } else {
        // ── NATURAL DEATH (aged): slow decay in organism color ──
        this._deathParticles.push({
          x: sx,
          y: sy,
          vx: 0,
          vy: 0,
          life: 1.0,
          decay: 0.012,
          size: (5 + ev.energy * 1.5) * S,
          hue,
          sat,
          lum,
          kind: 'decay_body'
        })
        const dripCount = Math.ceil((6 + Math.floor(ev.energy * 2)) * particleBudget)
        for (let i = 0; i < dripCount; i++) {
          if (this._deathParticles.length >= this._maxDeathParticles) break
          const angle = Math.random() * TAU
          let dripHue = hue
          if (hasNuc && Math.random() < 0.2) dripHue = nucHue
          else if (hasMito && Math.random() < 0.15) dripHue = 15
          this._deathParticles.push({
            x: sx + Math.cos(angle) * 2 * S,
            y: sy + Math.sin(angle) * 2 * S,
            vx: (Math.cos(angle) * 0.3 + (Math.random() - 0.5) * 0.4) * S,
            vy: (0.3 + Math.random() * 0.8) * S,
            life: 1.0,
            decay: 0.018 + Math.random() * 0.01,
            size: (1.0 + Math.random() * 2.0) * S,
            hue: dripHue,
            sat,
            lum,
            kind: 'meat_drip'
          })
        }
        for (let i = 0; i < 4; i++) {
          if (this._deathParticles.length >= this._maxDeathParticles) break
          const angle = Math.random() * TAU
          this._deathParticles.push({
            x: sx,
            y: sy,
            vx: Math.cos(angle) * 0.8 * S,
            vy: Math.sin(angle) * 0.8 * S,
            life: 1.0,
            decay: 0.03,
            size: (1.5 + Math.random() * 1.5) * S,
            hue,
            sat,
            lum,
            kind: 'membrane_frag',
            rot: Math.random() * TAU,
            rotV: (Math.random() - 0.5) * 0.2
          })
        }
      }
    }
  }

  P._updateAndDrawDeathParticles = function () {
    const parts = this._deathParticles
    if (parts.length === 0) return
    const ctx = this.ctx
    const S = this.view.scale
    ctx.save()

    // Compact dead particles with swap-and-pop (O(1) per removal)
    let writeIdx = 0
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      p.life -= p.decay
      if (p.life <= 0) continue
      if (writeIdx !== i) parts[writeIdx] = p
      writeIdx++
    }
    parts.length = writeIdx

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]

      const a = p.life * p.life

      switch (p.kind) {
        case 'shockwave': {
          const ringR = p.size * (3.0 + (1 - p.life) * 12)
          ctx.globalAlpha = a * 0.2
          ctx.strokeStyle = hsla(p.hue, p.sat || 70, (p.lum || 60) + 15, 0.8)
          ctx.lineWidth = 1.5 * p.life + 0.3
          ctx.beginPath()
          ctx.arc(p.x, p.y, ringR, 0, TAU)
          ctx.stroke()
          break
        }
        case 'flash': {
          const fr = p.size * p.life * p.life
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = a * 0.25
          ctx.fillStyle = hsla(p.hue, (p.sat || 70) - 10, (p.lum || 60) + 25, 0.8)
          ctx.beginPath()
          ctx.arc(p.x, p.y, fr, 0, TAU)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'
          break
        }
        case 'ember': {
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.94
          p.vy *= 0.94
          p.vy += 0.02 * S
          const s = p.size * (0.4 + p.life * 0.6)
          ctx.globalAlpha = a * 0.5
          ctx.fillStyle = hsl(p.hue, 85, 60)
          ctx.beginPath()
          ctx.arc(p.x, p.y, s, 0, TAU)
          ctx.fill()
          break
        }
        case 'splatter': {
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.88
          p.vy *= 0.88
          p.vy += 0.04 * S
          const sr = p.size * (0.5 + p.life * 0.5)
          ctx.globalAlpha = a * 0.35
          ctx.fillStyle = hsl(p.hue, p.sat || 60, (p.lum || 40) - 8)
          ctx.beginPath()
          ctx.arc(p.x, p.y, sr, 0, TAU)
          ctx.fill()
          break
        }
        case 'dissolve_ring': {
          // Gentle expanding dissolve ring
          const dr = p.size * (1.5 + (1 - p.life) * 6)
          ctx.globalAlpha = a * 0.25
          ctx.strokeStyle = hsla(p.hue, 40, 70, 0.5)
          ctx.lineWidth = 1.0 * p.life + 0.2
          ctx.setLineDash([2, 3])
          ctx.beginPath()
          ctx.arc(p.x, p.y, dr, 0, TAU)
          ctx.stroke()
          ctx.setLineDash([])
          break
        }
        case 'soul_wisp': {
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.97
          p.vy *= 0.98
          const wr = p.size * (0.3 + p.life * 0.7)
          ctx.globalAlpha = a * 0.25
          ctx.fillStyle = hsl(p.hue, p.sat || 45, p.lum || 70)
          ctx.beginPath()
          ctx.arc(p.x, p.y, wr, 0, TAU)
          ctx.fill()
          break
        }
        case 'membrane_frag': {
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.92
          p.vy *= 0.92
          p.rot += p.rotV
          // Curved membrane fragment
          const mfr = p.size * p.life
          ctx.globalAlpha = a * 0.3
          ctx.strokeStyle = hsla(p.hue, p.sat || 50, (p.lum || 60) + 10, 0.7)
          ctx.lineWidth = 0.6 + p.life * 0.8
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          ctx.beginPath()
          ctx.arc(0, 0, mfr, -0.8, 0.8)
          ctx.stroke()
          ctx.restore()
          break
        }
        case 'wisp': {
          p.x += p.vx
          p.y += p.vy
          p.vy -= 0.02
          p.vx *= 0.96
          const wr2 = p.size * p.life
          ctx.globalAlpha = a * 0.3
          ctx.fillStyle = hsla(p.hue, 30, 60, 0.5)
          ctx.beginPath()
          ctx.arc(p.x, p.y, wr2, 0, TAU)
          ctx.fill()
          break
        }
        case 'meat_chunk': {
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.93
          p.vy *= 0.93
          p.vy += 0.03 * S
          const mcLife = p.life
          const mcHue = p.hue
          const mcr = p.size * (0.4 + mcLife * 0.6)
          ctx.globalAlpha = a * 0.4
          ctx.fillStyle = hsl(mcHue, p.sat || 60, (p.lum || 45) - 8)
          ctx.beginPath()
          ctx.arc(p.x, p.y, mcr, 0, TAU)
          ctx.fill()
          break
        }
        case 'decay_body': {
          const dbLife = p.life
          const dbHue = p.hue
          const dbr = p.size * (0.3 + dbLife * 0.7)
          // Core body — simple circle
          ctx.globalAlpha = a * 0.35
          ctx.fillStyle = hsl(dbHue, p.sat || 50, (p.lum || 40) - 10)
          ctx.beginPath()
          ctx.arc(p.x, p.y, dbr, 0, TAU)
          ctx.fill()
          // Decay spots
          if (dbLife < 0.7) {
            ctx.globalAlpha = (1 - dbLife) * 0.35
            ctx.fillStyle = hsl(p.hue, (p.sat || 40) - 20, 20)
            const sa = (2.3 + p.size) % TAU
            ctx.beginPath()
            ctx.arc(p.x + Math.cos(sa) * dbr * 0.3, p.y + Math.sin(sa) * dbr * 0.3, dbr * 0.15, 0, TAU)
            ctx.fill()
          }
          break
        }
        case 'meat_drip': {
          // Small chunks that drip downward, shifting from organism color to meat red
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.96
          p.vy += 0.015 * S
          const mdLife = p.life
          const mdHue = p.hue
          const mdSat = (p.sat || 55) - (1 - mdLife) * 10
          const mdLum = (p.lum || 45) - (1 - mdLife) * 12
          const mdr = p.size * (0.4 + mdLife * 0.6)
          ctx.globalAlpha = a * 0.4
          ctx.fillStyle = hsla(mdHue, mdSat, mdLum, 0.8)
          ctx.beginPath()
          // Teardrop shape — elongated downward
          ctx.ellipse(p.x, p.y, mdr * 0.6, mdr, Math.PI * 0.5 + Math.atan2(p.vy, p.vx), 0, TAU)
          ctx.fill()
          break
        }
        case 'decay_wisp': {
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.95
          p.vy *= 0.95
          p.vy += 0.01 * S
          const dwLife = p.life
          const dwHue = p.hue
          const dwr = p.size * (0.3 + dwLife * 0.7)
          ctx.globalAlpha = a * 0.2
          ctx.fillStyle = hsl(dwHue, p.sat || 40, (p.lum || 45) - 5)
          ctx.beginPath()
          ctx.arc(p.x, p.y, dwr, 0, TAU)
          ctx.fill()
          break
        }
        // Birth particles
        case 'birth_ring': {
          const br = p.size * (1.0 + (1 - p.life) * 5)
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = a * 0.2
          ctx.strokeStyle = hsla(p.hue, 70, 80, 0.8)
          ctx.lineWidth = 1.2 * p.life + 0.3
          ctx.beginPath()
          ctx.arc(p.x, p.y, br, 0, TAU)
          ctx.stroke()
          ctx.globalCompositeOperation = 'source-over'
          break
        }
        case 'birth_flash': {
          const bfr = p.size * p.life
          ctx.globalAlpha = a * 0.2
          ctx.fillStyle = 'rgba(200,255,220,0.7)'
          ctx.beginPath()
          ctx.arc(p.x, p.y, bfr, 0, TAU)
          ctx.fill()
          break
        }
        case 'birth_sparkle': {
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.92
          p.vy *= 0.92
          const bsr = p.size * (0.3 + p.life * 0.7)
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = a * 0.35
          ctx.fillStyle = hsla(p.hue + 60, 70, 85, 0.9)
          ctx.beginPath()
          ctx.arc(p.x, p.y, bsr, 0, TAU)
          ctx.fill()
          // Cross sparkle
          ctx.strokeStyle = hsla(p.hue + 60, 50, 90, 0.6)
          ctx.lineWidth = 0.3
          ctx.beginPath()
          ctx.moveTo(p.x - bsr * 2, p.y)
          ctx.lineTo(p.x + bsr * 2, p.y)
          ctx.moveTo(p.x, p.y - bsr * 2)
          ctx.lineTo(p.x, p.y + bsr * 2)
          ctx.stroke()
          ctx.globalCompositeOperation = 'source-over'
          break
        }
        case 'birth_strand': {
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.95
          p.vy *= 0.95
          p.rot += p.rotV
          // Helical DNA-like strand fragment
          const stLen = p.size * 2 * p.life
          ctx.globalAlpha = a * 0.2
          ctx.strokeStyle = hsla(p.hue + 120, 60, 70, 0.7)
          ctx.lineWidth = 0.5
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          ctx.beginPath()
          for (let si = 0; si < 8; si++) {
            const sf = si / 7
            const sw = Math.sin(sf * TAU * 1.5) * stLen * 0.15
            ctx.lineTo(sf * stLen - stLen / 2, sw)
          }
          ctx.stroke()
          ctx.restore()
          break
        }
        // Eating particles
        case 'eat_absorb': {
          // Spiral inward toward center
          p.rot += 0.15
          const eDist = p.size * p.life * 3
          p.x = p.cx + Math.cos(p.rot) * eDist
          p.y = p.cy + Math.sin(p.rot) * eDist
          const ear = (0.5 + p.life * 1.0) * S
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = a * 0.3
          ctx.fillStyle = hsla(p.hue, 70, 70, 0.8)
          ctx.beginPath()
          ctx.arc(p.x, p.y, ear, 0, TAU)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'
          break
        }
        case 'eat_ripple': {
          const er = p.size * (0.5 + (1 - p.life) * 3)
          ctx.globalAlpha = a * 0.2
          ctx.strokeStyle = hsla(p.hue, 50, 70, 0.5)
          ctx.lineWidth = 0.6 * p.life
          ctx.beginPath()
          ctx.arc(p.x, p.y, er, 0, TAU)
          ctx.stroke()
          break
        }
        case 'eat_nutrient': {
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.9
          p.vy *= 0.9
          const enr = p.size * p.life
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = a * 0.25
          ctx.fillStyle = hsla(p.hue, 60, 75, 0.7)
          ctx.beginPath()
          ctx.arc(p.x, p.y, enr, 0, TAU)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'
          break
        }
      }
    }

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
  }

  // ══════════════════════════════════════
  //  BIRTH PARTICLES — spawned from sim
  // ══════════════════════════════════════

  P._spawnBirthParticles = function (sim) {
    if (!sim.birthEvents || sim.birthEvents.length === 0) return
    const S = this.view.scale
    const pop = sim.cells.length
    const particleBudget = pop > 3000 ? 0.25 : pop > 1500 ? 0.5 : pop > 800 ? 0.75 : 1.0
    for (const ev of sim.birthEvents) {
      const [sx, sy] = this.worldToScreen(ev.x, ev.y)
      if (sx < -60 || sx > this.canvas.width + 60 || sy < -60 || sy > this.canvas.height + 60) continue

      const hue = cladeHue(ev.clade)
      this._deathParticles.push({
        x: sx,
        y: sy,
        vx: 0,
        vy: 0,
        life: 1.0,
        decay: 0.05,
        size: 3 * S,
        hue,
        kind: 'birth_ring'
      })
      this._deathParticles.push({
        x: sx,
        y: sy,
        vx: 0,
        vy: 0,
        life: 1.0,
        decay: 0.07,
        size: 6 * S,
        hue,
        kind: 'birth_flash'
      })
      const sparkCount = Math.ceil(8 * particleBudget)
      for (let i = 0; i < sparkCount; i++) {
        if (this._deathParticles.length >= this._maxDeathParticles) break
        const angle = (i / sparkCount) * TAU + Math.random() * 0.4
        const v = (1.0 + Math.random() * 2.0) * S
        this._deathParticles.push({
          x: sx,
          y: sy,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v,
          life: 1.0,
          decay: 0.04 + Math.random() * 0.02,
          size: (0.5 + Math.random() * 1.0) * S,
          hue,
          kind: 'birth_sparkle'
        })
      }
      const strandCount = Math.ceil(3 * particleBudget)
      for (let i = 0; i < strandCount; i++) {
        if (this._deathParticles.length >= this._maxDeathParticles) break
        const angle = Math.random() * TAU
        this._deathParticles.push({
          x: sx,
          y: sy,
          vx: Math.cos(angle) * 1.5 * S,
          vy: Math.sin(angle) * 1.5 * S,
          life: 1.0,
          decay: 0.03,
          size: (2 + Math.random() * 2) * S,
          hue,
          kind: 'birth_strand',
          rot: Math.random() * TAU,
          rotV: (Math.random() - 0.5) * 0.15
        })
      }
    }
  }

  // ══════════════════════════════════════
  //  EATING PARTICLES — spawned from sim
  // ══════════════════════════════════════

  P._spawnEatParticles = function (sim) {
    if (!sim.eatEvents || sim.eatEvents.length === 0) return
    const S = this.view.scale
    const pop = sim.cells.length
    const particleBudget = pop > 3000 ? 0.25 : pop > 1500 ? 0.5 : pop > 800 ? 0.75 : 1.0
    for (const ev of sim.eatEvents) {
      const [sx, sy] = this.worldToScreen(ev.x, ev.y)
      if (sx < -40 || sx > this.canvas.width + 40 || sy < -40 || sy > this.canvas.height + 40) continue

      const hue = ev.foodType === 0 ? 120 : ev.foodType === 1 ? 45 : 0
      const absCount = Math.ceil(5 * particleBudget)
      for (let i = 0; i < absCount; i++) {
        if (this._deathParticles.length >= this._maxDeathParticles) break
        this._deathParticles.push({
          x: sx,
          y: sy,
          vx: 0,
          vy: 0,
          cx: sx,
          cy: sy,
          life: 1.0,
          decay: 0.04,
          size: (1.5 + Math.random() * 2) * S,
          hue,
          kind: 'eat_absorb',
          rot: (i / absCount) * TAU + Math.random() * 0.5
        })
      }
      this._deathParticles.push({
        x: sx,
        y: sy,
        vx: 0,
        vy: 0,
        life: 1.0,
        decay: 0.05,
        size: 3 * S,
        hue,
        kind: 'eat_ripple'
      })
      const nutCount = Math.ceil(4 * particleBudget)
      for (let i = 0; i < nutCount; i++) {
        if (this._deathParticles.length >= this._maxDeathParticles) break
        const angle = Math.random() * TAU
        this._deathParticles.push({
          x: sx + Math.cos(angle) * 6 * S,
          y: sy + Math.sin(angle) * 6 * S,
          vx: -Math.cos(angle) * 1.5 * S,
          vy: -Math.sin(angle) * 1.5 * S,
          life: 1.0,
          decay: 0.05,
          size: (0.6 + Math.random() * 0.8) * S,
          hue,
          kind: 'eat_nutrient'
        })
      }
    }
  }

  // ══════════════════════════════════════
  //  PIONEER TRAILS
  // ══════════════════════════════════════

  P._updateTrails = function (sim) {
    if (this._frameTick % 3 === 0) {
      for (let i = 0; i < sim.cells.length; i++) {
        const c = sim.cells[i]
        if (c.role === ROLE_PIONEER && c.organelles[ORGANELLE_FLAGELLUM] > 0.15) {
          if (this._trails.length < this._maxTrails) {
            this._trails.push({
              x: c.x - c.vx * 2.5,
              y: c.y - c.vy * 2.5,
              life: 1.0,
              hue: cladeHue(c.clade),
              size: 1.0 + c.organelles[ORGANELLE_FLAGELLUM] * 1.8
            })
          }
        }
      }
    }

    let tw = 0
    for (let i = 0; i < this._trails.length; i++) {
      this._trails[i].life -= 0.035
      if (this._trails[i].life > 0) {
        if (tw !== i) this._trails[tw] = this._trails[i]
        tw++
      }
    }
    this._trails.length = tw
  }

  // ══════════════════════════════════════
  //  MATING PARTICLES
  // ══════════════════════════════════════

  P._mateParticles = []

  P._spawnMateParticles = function (sim) {
    if (!sim.mateEvents || sim.mateEvents.length === 0) return
    const S = this.view.scale
    for (const ev of sim.mateEvents) {
      const [sx1, sy1] = this.worldToScreen(ev.x1, ev.y1)
      const [sx2, sy2] = this.worldToScreen(ev.x2, ev.y2)
      const cw = this.canvas.width,
        ch = this.canvas.height
      if (sx1 < -60 || sx1 > cw + 60 || sy1 < -60 || sy1 > ch + 60) continue

      const hue = cladeHue(ev.clade)
      const mx = (sx1 + sx2) / 2,
        my = (sy1 + sy2) / 2
      const dx = sx2 - sx1,
        dy = sy2 - sy1
      const dist = Math.sqrt(dx * dx + dy * dy) || 1

      // Helix strand particles — spiral between the two parents
      const count = Math.min(16, 6 + Math.floor(dist * 0.15))
      for (let i = 0; i < count; i++) {
        const frac = i / count
        const helixAngle = frac * Math.PI * 4 // 2 full turns
        const perpX = -dy / dist,
          perpY = dx / dist
        const helixR = (3 + S * 2) * Math.sin(helixAngle)
        this._mateParticles.push({
          x: sx1 + dx * frac + perpX * helixR,
          y: sy1 + dy * frac + perpY * helixR,
          vx: perpX * (0.3 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1),
          vy: perpY * (0.3 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1),
          life: 1.0,
          decay: 0.012 + Math.random() * 0.008,
          size: (1.5 + Math.random() * 2.0) * S,
          hue: (hue + 300 + Math.random() * 40) % 360, // pink/magenta shifted from clade hue
          strand: i % 2 // which helix strand (0 or 1)
        })
      }

      // Central glow burst at midpoint
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * TAU
        const spd = 0.3 + Math.random() * 0.6
        this._mateParticles.push({
          x: mx,
          y: my,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          life: 1.0,
          decay: 0.02 + Math.random() * 0.01,
          size: (2.5 + Math.random() * 2.0) * S,
          hue: (hue + 320) % 360,
          strand: -1 // glow particle, not strand
        })
      }
    }
    // Cap total particles
    if (this._mateParticles.length > 200) {
      this._mateParticles.splice(0, this._mateParticles.length - 200)
    }
  }

  P._updateAndDrawMateParticles = function () {
    const parts = this._mateParticles
    if (!parts || parts.length === 0) return
    const ctx = this.ctx

    ctx.save()
    // Compact dead particles with forward sweep
    let mw = 0
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      p.life -= p.decay
      if (p.life <= 0) continue
      if (mw !== i) parts[mw] = p
      mw++
    }
    parts.length = mw

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      p.x += p.vx
      p.y += p.vy
      // Gentle drift toward center (particles converge)
      p.vx *= 0.97
      p.vy *= 0.97

      const a = p.life * p.life

      if (p.strand >= 0) {
        // Helix strand particle — small bright dot
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = a * 0.15
        ctx.fillStyle = hsla(p.hue, 80, 70, 0.5)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (0.5 + p.life * 0.5), 0, TAU)
        ctx.fill()
        // Soft glow around it
        ctx.globalAlpha = a * 0.06
        ctx.fillStyle = hsla(p.hue, 60, 80, 0.3)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (1.5 + p.life), 0, TAU)
        ctx.fill()
      } else {
        // Central glow burst — larger, softer
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = a * 0.1
        ctx.fillStyle = hsla(p.hue, 70, 75, 0.4)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (1.0 + (1 - p.life) * 2), 0, TAU)
        ctx.fill()
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.restore()
  }

  P._drawTrails = function () {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < this._trails.length; i++) {
      const tr = this._trails[i]
      const [sx, sy] = this.worldToScreen(tr.x, tr.y)
      const r = tr.size * this.view.scale * 0.45 * (0.3 + tr.life * 0.7)
      ctx.globalAlpha = tr.life * tr.life * 0.12
      ctx.fillStyle = hsla(tr.hue, 55, 50, 0.5)
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }
}
