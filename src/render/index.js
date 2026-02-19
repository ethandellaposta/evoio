// Re-export public utilities
export { cladeColor, cladeHue, cladeSatOffset, cladeLumOffset } from './color.js'
export { buildOrganisms } from './organisms.js'

// Mixin installers
import { installWorld } from './world.js'
import { installHulls } from './hulls.js'
import { installParticles } from './particles.js'
import { installFood } from './food.js'
import { installLinks } from './links.js'
import { installCells } from './cells.js'
import { installMorphology } from './morphology.js'

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })
    this.pixelRatio = 1

    this.renderScale = 1
    this.foodDown = 3
    this.foodEvery = 4
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
    this._maxTrails = 120

    // Death/consume particles
    this._deathParticles = []
    this._maxDeathParticles = 250

    this.view = {
      cx: 0,
      cy: 0,
      scale: 1
    }

    // ── Low-fidelity mode: toggle individual expensive render features ──
    this.lofi = {
      enabled: false, // master toggle — when on, disables all below
      water: true, // animated caustic water background
      foodOverlay: true, // food heatmap overlay
      foodBuds: true, // plant buds & mineral crystals
      terrain: true, // shelter, terrain objects, alarm overlay
      trails: true, // pioneer trail particles
      hulls: true, // organism convex hulls
      particles: true, // death/birth/eat/mate particles
      morphology: true, // flippers, cilia, spines, flagella
      organelles: true, // nucleus, mitochondria, vacuole, receptors
      glow: true // specular highlights, radial gradients on cells
    }
  }

  updateQuality(sim, renderMsEma) {
    const pop = sim.cells.length

    // ── Adaptive feedback loop ──
    // Use actual render time EMA to drive quality, not just population
    const ms = renderMsEma || 0
    // Target: keep render under 10ms to leave room for sim + overhead
    // qualityBudget: 1.0 = plenty of headroom, 0.0 = severely over budget
    const qualityBudget = ms > 0 ? Math.max(0, Math.min(1, (10 - ms) / 10)) : 1

    // Smoothly track quality level to avoid flickering
    if (this._qualityLevel === undefined) this._qualityLevel = 1.0
    const targetQ = qualityBudget
    // Ramp down fast, ramp up slowly (hysteresis)
    // Ramp even faster when severely over budget (>3x target)
    const rampSpeed = targetQ < this._qualityLevel ? (ms > 30 ? 0.35 : 0.15) : 0.03
    this._qualityLevel += (targetQ - this._qualityLevel) * rampSpeed
    const q = this._qualityLevel

    // ── Apply quality settings based on adaptive level ──
    this.renderScale = 1
    this.simpleCells = false
    this.drawOrganelles = true
    this.linkStride = 1

    // Food overlay frequency — less frequent when busy
    if (q < 0.2 || pop > 5000) {
      this.foodEvery = 16
    } else if (q < 0.4 || pop > 3000) {
      this.foodEvery = 10
    } else if (q < 0.6 || pop > 1500) {
      this.foodEvery = 6
    } else if (pop > 600) {
      this.foodEvery = 4
    } else {
      this.foodEvery = 2
    }

    // Link stride — skip links when over budget
    if (q < 0.25 || pop > 4000) {
      this.linkStride = 4
    } else if (q < 0.5 || pop > 2500) {
      this.linkStride = 3
    } else if (q < 0.7 || pop > 1500) {
      this.linkStride = 2
    } else {
      this.linkStride = 1
    }

    // Water background update interval — less frequent when busy
    this._waterInterval = q < 0.3 ? 24 : q < 0.6 ? 16 : 12

    // LOD budget caps — tighten when over budget
    this._lod4Budget = q < 0.2 ? 8 : q < 0.4 ? 20 : q < 0.6 ? 50 : q < 0.8 ? 100 : 160
    this._lod3Budget = q < 0.2 ? 30 : q < 0.4 ? 80 : q < 0.6 ? 180 : q < 0.8 ? 350 : 600

    // Population-driven LOD bias: at high pop, raise LOD thresholds so more cells
    // render as cheap dots/circles. This is the single biggest lever.
    // 0 = no bias (low pop), up to 12 = very aggressive (>6000 cells)
    this._lodBias =
      pop < 1500
        ? 0
        : pop < 3000
          ? Math.min(6, (pop - 1500) * 0.004)
          : Math.min(14, 6 + (pop - 3000) * 0.0027)

    // Particle budget scale
    this._particleBudgetScale = q < 0.3 ? 0.15 : q < 0.5 ? 0.35 : q < 0.7 ? 0.6 : 1.0

    // Max death particles
    this._maxDeathParticles = q < 0.3 ? 60 : q < 0.5 ? 120 : 250
    this._maxTrails = q < 0.3 ? 30 : q < 0.5 ? 60 : 120

    // Hull threshold — skip hulls earlier when over budget
    this._hullMaxPop = q < 0.3 ? 1000 : q < 0.5 ? 2000 : q < 0.7 ? 2800 : 3500
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

  // Non-allocating version: writes into pre-allocated out array at offset
  worldToScreenXY(x, y, out, off) {
    const s = this.view.scale
    out[off] = (x - this.view.cx) * s + this.canvas.width / 2
    out[off + 1] = (y - this.view.cy) * s + this.canvas.height / 2
  }

  draw(sim, opts) {
    const ctx = this.ctx
    if (!opts || !opts.paused) this._frameTick++
    this._opts = opts

    // ── Render profiler — always active so stress test can read it ──
    const _logProf = this._frameTick % 60 === 0
    const _t = performance.now()
    let _last = _t
    const _times = {}
    const _mark = (name) => {
      const now = performance.now()
      _times[name] = +(now - _last).toFixed(2)
      _last = now
    }

    // ── Resolve lofi flags: master toggle overrides individual flags ──
    const _lf = this.lofi
    const _lofi = _lf.enabled
    const _doWater = !_lofi && _lf.water
    const _doFood = !_lofi && _lf.foodOverlay
    const _doFoodBuds = !_lofi && _lf.foodBuds
    const _doTerrain = !_lofi && _lf.terrain
    const _doTrails = !_lofi && _lf.trails
    const _doHulls = !_lofi && _lf.hulls
    const _doParticles = !_lofi && _lf.particles

    // Animated water pool background (cached — interval set by adaptive quality)
    if (_doWater) {
      const _waterInt = this._waterInterval || 12
      if (this._frameTick % _waterInt === 0 || !this._waterCanvas) {
        this._drawWaterBackground(sim)
      } else {
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
    } else {
      // Flat dark background
      ctx.fillStyle = '#050a12'
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    }
    _mark('water')

    // Food overlay
    if (opts.showFood && _doFood) {
      this._foodTick++
      if (!this._foodCanvas || this._foodTick % this.foodEvery === 0) this._drawFood(sim)
      if (this._foodCanvas) {
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'medium'
        ctx.globalCompositeOperation = 'screen'
        ctx.globalAlpha = 0.5
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
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
      }
    }
    _mark('food')

    // Plant buds & mineral crystals overlay on top of food
    if (opts.showFood && _doFoodBuds) {
      this._drawFoodBuds(sim)
    }
    _mark('foodBuds')

    if (_doTerrain) {
      // Shelter density overlay — subtle glow where structures have accumulated
      this._drawShelterOverlay(sim)
      // Terrain objects — biome-specific flora & structures (kelp, coral, vents, etc.)
      this._drawTerrain(sim)
      // Alarm pheromone overlay — red/orange glow where prey was recently killed
      this._drawAlarmOverlay(sim)
    }
    _mark('terrain')

    this._drawBarriers(sim)
    this._drawGradientPeak(sim)
    this._drawCurrentLines(sim)
    _mark('barriers')

    if (_doTrails) {
      this._updateTrails(sim)
      this._drawTrails()
    }
    _mark('trails')

    if (_doHulls && sim.cells.length < (this._hullMaxPop || 3500)) this._drawOrganismHulls(sim)
    _mark('hulls')

    // Particles behind cells — spawn then draw before cells
    if (_doParticles) {
      this._spawnDeathParticles(sim)
      this._spawnBirthParticles(sim)
      this._spawnEatParticles(sim)
      this._spawnMateParticles(sim)
      this._updateAndDrawDeathParticles()
    }
    _mark('particles')

    this._drawCells(sim)
    _mark('cells')

    // Mating particles drawn on top of cells (visible above organisms)
    if (_doParticles) this._updateAndDrawMateParticles()
    _mark('mateParticles')

    this._drawWorldBlob(sim)
    this._drawSeasonBar(sim)
    _mark('worldBlob')

    ctx.strokeStyle = 'rgba(255,255,255,.10)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, this.canvas.width - 1, this.canvas.height - 1)

    // Always update profileData so stress test profiler can read it
    const total = +(performance.now() - _t).toFixed(2)
    _times._total = total
    _times._cells = sim.cells.length
    this.profileData = _times

    // Log to console every 60 frames
    if (_logProf) {
      const sorted = Object.entries(_times)
        .filter(([k]) => !k.startsWith('_'))
        .sort((a, b) => b[1] - a[1])
      const bar = sorted.map(([k, v]) => `${k}:${v}ms`).join('  ')
      console.log(`[render ${total}ms | ${sim.cells.length} cells]  ${bar}`)
    }
  }
}

// Install all mixins onto Renderer.prototype
installWorld(Renderer)
installHulls(Renderer)
installParticles(Renderer)
installFood(Renderer)
installLinks(Renderer)
installMorphology(Renderer)
installCells(Renderer)
