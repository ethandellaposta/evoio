import { wrap } from './helpers.js'
import { randRange } from '../rng.js'
import { diffuse_food, grow_food } from '../../pkg/evoio_wasm.js'

let wasmRngState = 0
export function setWasmRngState(s) {
  wasmRngState = s
}
export function getWasmRngState() {
  return wasmRngState
}

function _sanitizeArray(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (!isFinite(arr[i]) || arr[i] < 0) arr[i] = 0
  }
}

export function installFood(Sim) {
  const P = Sim.prototype

  P._foodIdx = function (ix, iy) {
    ix = wrap(ix, this.w)
    iy = wrap(iy, this.h)
    return ix + iy * this.w
  }

  P._sampleFood = function (x, y) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    return this.food[ix + iy * this.w]
  }

  P._sampleGradient = function (x, y) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    return this.gradientField[ix + iy * this.w]
  }

  P._takeFood = function (x, y, amount) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    const i = ix + iy * this.w
    const take = this.food[i] < amount ? this.food[i] : amount
    this.food[i] -= take
    return take
  }

  P._diffuseStep = function () {
    this.food = diffuse_food(
      this.food,
      this.w,
      this.h,
      this.cfg.diffusion,
      this.cfg.sampleScale ?? 1,
      wasmRngState
    )
    _sanitizeArray(this.food)
  }

  // Slow ambient photosynthesis — food grows very slowly based on gradient field
  // This replaces the old bulk WASM _growFood. Most food now comes from seed transport.
  P._growFood = function (mult = 1, foodScarcity = 1.0, sunIntensity = 1.0) {
    // Abiotic nutrient trickle — very slow. Real food comes from photosynthetic cells.
    // This represents chemosynthesis, mineral dissolution, and organic detritus.
    const baseRate = this.cfg.foodGrowth * mult * 0.00006 * foodScarcity
    const grad = this.gradientField
    const food = this.food
    const w = this.w,
      h = this.h
    const n = food.length
    const cap = 5.0 // max food per cell
    // Only update a fraction of cells each tick for performance
    const stride = 8
    const offset = this.t % stride

    // Sun direction for position-dependent photosynthesis
    const sunAngle = this.sunAngle || 0
    const sunDx = Math.cos(sunAngle)
    const sunDy = Math.sin(sunAngle)
    const cx = w * 0.5,
      cy = h * 0.5
    const invHalfW = 1.0 / (w * 0.5)
    const invHalfH = 1.0 / (h * 0.5)

    // Precompute biome food growth multipliers by x-region
    const biomes = this.cfg.biomes
    const numBiomes = biomes ? biomes.length : 0
    const regionW = numBiomes > 0 ? w / numBiomes : w

    for (let i = offset; i < n; i += stride) {
      if (food[i] < cap) {
        const g = grad[i] || 0.5
        // Compute local sunlight from position
        const ix = i % w,
          iy = (i / w) | 0
        const nx = (ix - cx) * invHalfW
        const ny = (iy - cy) * invHalfH
        const facing = nx * sunDx + ny * sunDy
        const localSun = (0.5 + facing * 0.5) * sunIntensity
        // Photosynthesis: food grows proportional to sunlight
        // Minimum 10% growth even in shadow (detritus, chemosynthesis)
        const lightMult = 0.1 + localSun * 0.9
        // Biome-specific food growth multiplier
        let biomeMult = 1.0
        if (numBiomes > 0) {
          const bi = Math.min(numBiomes - 1, (ix / regionW) | 0)
          biomeMult = biomes[bi].foodGrowthMult || 1.0
        }
        food[i] += baseRate * biomeMult * g * stride * lightMult
      }
    }
  }

  // ── Seed transport system ──
  // Cells carry seeds after eating plant food. Seeds drop food at the cell's
  // current position after a delay, simulating biological seed dispersal.
  P._depositSeeds = function () {
    const cells = this.cells
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      if (!c.seeds) continue
      for (let si = c.seeds.length - 1; si >= 0; si--) {
        const seed = c.seeds[si]
        seed.timer--
        if (seed.timer <= 0) {
          // Drop food at cell's current position
          this._dropPlantFood(c.x, c.y, seed.amount)
          c.seeds.splice(si, 1)
        }
      }
      if (c.seeds.length === 0) c.seeds = null
    }
  }

  P._dropPlantFood = function (x, y, amount) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    // Spread in a small radius for natural-looking patches
    const r = 2
    const total = amount
    const perCell = total / ((2 * r + 1) * (2 * r + 1))
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const sx = wrap(ix + dx, this.w)
        const sy = wrap(iy + dy, this.h)
        this.food[sx + sy * this.w] += perCell
      }
    }
  }

  P._pickupSeed = function (cell, amount) {
    if (amount < 0.01) return
    if (!cell.seeds) cell.seeds = []
    if (cell.seeds.length >= 5) return // max 5 seeds per cell
    // Delay: 80-200 ticks — enough time for the cell to move away
    const timer = 80 + ((this.rng() * 120) | 0)
    // Seed carries a fraction of what was eaten, amplified for regrowth
    cell.seeds.push({ amount: amount * 1.8, timer })
  }

  P._sampleMineral = function (x, y) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    return this.mineralFood[ix + iy * this.w]
  }

  P._takeMineral = function (x, y, amount) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    const i = ix + iy * this.w
    const take = this.mineralFood[i] < amount ? this.mineralFood[i] : amount
    this.mineralFood[i] -= take
    return take
  }

  P._sampleMeat = function (x, y) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    return this.meatFood[ix + iy * this.w]
  }

  P._takeMeat = function (x, y, amount) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    const i = ix + iy * this.w
    const take = this.meatFood[i] < amount ? this.meatFood[i] : amount
    this.meatFood[i] -= take
    return take
  }

  P._dropMeat = function (x, y, amount) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    this.meatFood[ix + iy * this.w] += amount
  }

  // Bioluminescence: pull food from nearby grid cells toward this position
  P._attractFood = function (cx, cy, radius, strength) {
    const ix0 = wrap(cx | 0, this.w)
    const iy0 = wrap(cy | 0, this.h)
    const r = Math.ceil(radius)
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dy === 0) continue
        const sx = wrap(ix0 + dx, this.w)
        const sy = wrap(iy0 + dy, this.h)
        const si = sx + sy * this.w
        const pull = this.food[si] * strength
        if (pull > 0.0001) {
          this.food[si] -= pull
          this.food[ix0 + iy0 * this.w] += pull
        }
      }
    }
  }

  P._growMinerals = function () {
    if (this.rng() < this.cfg.mineralGrowth) {
      const ix = (this.rng() * this.w) | 0
      const iy = (this.rng() * this.h) | 0
      // Biome-specific mineral growth multiplier
      let biomeMult = 1.0
      const biomes = this.cfg.biomes
      if (biomes && biomes.length > 0) {
        const regionW = this.w / biomes.length
        const bi = Math.min(biomes.length - 1, (ix / regionW) | 0)
        biomeMult = biomes[bi].mineralGrowthMult || 1.0
      }
      this.mineralFood[ix + iy * this.w] += randRange(this.rng, 0.05, 0.2) * biomeMult
    }
  }

  // ── Plant food drift — slow advection simulating water currents ──
  // Scientific basis: phytoplankton and algae are carried by water currents.
  // In aquatic ecosystems, food patches drift with laminar and turbulent flow.
  // This creates a slowly shifting food landscape that organisms must track.
  P._driftFood = function () {
    const food = this.food
    const w = this.w,
      h = this.h
    const t = this.t

    // Global current direction rotates slowly (ocean gyre, ~full rotation per 8000 ticks)
    const currentAngle = t * 0.0008 + Math.sin(t * 0.0003) * 0.5
    const currentSpeed = 0.35 + 0.15 * Math.sin(t * 0.0005 + 1.7)
    const gdx = Math.cos(currentAngle) * currentSpeed
    const gdy = Math.sin(currentAngle) * currentSpeed

    // Precompute rounded global drift offset (skip turbulence for perf)
    const gDxR = Math.round(gdx)
    const gDyR = Math.round(gdy)
    if (gDxR === 0 && gDyR === 0) return // no drift this tick

    const frac = 0.12
    // Process every 4th row per tick (cycle through with phase)
    const phase = t % 4

    for (let iy = phase; iy < h; iy += 4) {
      for (let ix = 0; ix < w; ix++) {
        const si = ix + iy * w
        const val = food[si]
        if (val < 0.02) continue

        const tx = (((ix + gDxR) % w) + w) % w
        const ty = (((iy + gDyR) % h) + h) % h
        const ti = tx + ty * w

        if (ti !== si) {
          const transfer = val * frac
          food[si] -= transfer
          food[ti] += transfer
        }
      }
    }
  }

  P._decayMeat = function () {
    const decay = 1 - this.cfg.meatDecay
    const meat = this.meatFood
    // Process every 4th pixel per tick (cycle through with phase)
    const stride = 4
    const offset = this.t % stride
    const n = meat.length
    for (let i = offset; i < n; i += stride) {
      if (meat[i] > 0.001) {
        meat[i] *= decay
      } else if (meat[i] > 0) {
        meat[i] = 0
      }
    }
  }
}
