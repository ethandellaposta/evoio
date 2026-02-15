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
  }

  updateQuality(sim) {
    const pop = sim.cells.length

    // Keep full resolution always — LOD is handled per-cell via screen-space drawR
    this.renderScale = 1
    this.simpleCells = false
    this.drawOrganelles = true
    this.linkStride = 1

    // Only scale food overlay frequency based on population
    if (pop > 5000) {
      this.foodEvery = 8
    } else if (pop > 2500) {
      this.foodEvery = 6
    } else if (pop > 1200) {
      this.foodEvery = 4
    } else {
      this.foodEvery = 2
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

  // Non-allocating version: writes into pre-allocated out array at offset
  worldToScreenXY(x, y, out, off) {
    const s = this.view.scale
    out[off] = (x - this.view.cx) * s + this.canvas.width / 2
    out[off + 1] = (y - this.view.cy) * s + this.canvas.height / 2
  }

  draw(sim, opts) {
    const ctx = this.ctx
    this._frameTick++
    this._opts = opts

    // Animated water pool background
    if (this._frameTick % 4 === 0 || !this._waterCanvas) {
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

    // Food overlay
    if (opts.showFood) {
      this._foodTick++
      if (!this._foodCanvas || this._foodTick % this.foodEvery === 0) this._drawFood(sim)
      if (this._foodCanvas) {
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'medium'
        ctx.globalCompositeOperation = 'screen'
        ctx.globalAlpha = 1
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

    // Plant buds & mineral crystals overlay on top of food
    if (opts.showFood) {
      this._drawFoodBuds(sim)
    }

    this._drawBarriers(sim)
    this._drawGradientPeak(sim)
    this._drawCurrentLines(sim)

    this._updateTrails(sim)
    this._drawTrails()

    if (sim.cells.length < 5200) this._drawOrganismHulls(sim)

    // Particles behind cells — spawn then draw before cells
    this._spawnDeathParticles(sim)
    this._spawnBirthParticles(sim)
    this._spawnEatParticles(sim)
    this._spawnMateParticles(sim)
    this._updateAndDrawDeathParticles()

    this._drawCells(sim)

    // Mating particles drawn on top of cells (visible above organisms)
    this._updateAndDrawMateParticles()

    this._drawWorldBlob(sim)
    this._drawSeasonBar(sim)

    ctx.strokeStyle = 'rgba(255,255,255,.10)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, this.canvas.width - 1, this.canvas.height - 1)
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
