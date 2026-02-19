import { makeRng, randInt, randNorm, randRange } from './rng.js'
import init, { diffuse_food, grow_food } from '../pkg/evoio_wasm.js'

let wasmReady = false
let wasmRngState = 0

// Initialize Wasm once
export async function initWasm() {
  if (wasmReady) return
  await init()
  wasmReady = true
}

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x
}

function wrap(x, n) {
  x %= n
  return x < 0 ? x + n : x
}

function torusDelta(d, size) {
  if (d > size / 2) return d - size
  if (d < -size / 2) return d + size
  return d
}

// ── Food types ──
const FOOD_PLANT = 0 // green — photosynthetic, grows from light
const FOOD_MINERAL = 1 // amber — rare mineral deposits, high energy
const FOOD_MEAT = 2 // red — dropped by dead/eaten cells
const FOOD_TYPES = 3

// ── Organelle types ──
const ORGANELLE_NUCLEUS = 0
const ORGANELLE_MITOCHONDRIA = 1
const ORGANELLE_FLAGELLUM = 2
const ORGANELLE_RECEPTOR = 3
const ORGANELLE_VACUOLE = 4
const ORGANELLE_COUNT = 5

// ── Cell roles ──
const ROLE_NONE = 0
const ROLE_EDGE = 1
const ROLE_INTERIOR = 2
const ROLE_PIONEER = 3

export { FOOD_PLANT, FOOD_MINERAL, FOOD_MEAT, FOOD_TYPES }
export {
  ORGANELLE_NUCLEUS,
  ORGANELLE_MITOCHONDRIA,
  ORGANELLE_FLAGELLUM,
  ORGANELLE_RECEPTOR,
  ORGANELLE_VACUOLE,
  ORGANELLE_COUNT
}
export { ROLE_NONE, ROLE_EDGE, ROLE_INTERIOR, ROLE_PIONEER }

export function defaultConfig() {
  return {
    seed: 'evoio',
    w: 440,
    h: 320,
    maxCells: 200,
    sampleScale: 0.1,
    cellRadius: 1.5,
    dt: 1,
    mutationRate: 0.06,
    foodGrowth: 1.2,
    patchiness: 0.75,
    diffusion: 0.14,
    uptake: 0.3,
    baseMove: 0.04,
    moveWander: 0.14,
    gradientWeight: 0.85,
    metabolismBase: 0.01,
    linkDist: 4.0,
    linkSpring: 0.055,
    linkDamp: 0.12,
    linkMax: 3,
    shareRate: 0.03,
    cladeShiftMut: 0.002,
    deathAge: 9000,
    // ── New: seasonal gradient (inspired by Colizzi et al. 2020) ──
    seasonLength: 1200, // ticks per season before gradient shifts
    gradientSlope: 0.008, // shallow gradient slope (kχ analog)
    gradientNoise: 0.12, // probability a food site has no signal
    // ── New: persistent migration (τp from paper) ──
    persistenceInterval: 40, // ticks between migration direction updates
    persistenceStrength: 0.6, // μp — bias toward previous direction
    // ── New: contact inhibition of locomotion ──
    contactInhibition: 0.15, // CIL strength — slows cells touching others
    // ── New: organelle development ──
    organelleGrowthRate: 0.002, // how fast organelles develop per tick
    organelleMutRate: 0.08, // mutation rate for organelle genome
    // ── New: surface tension (γ from paper) ──
    surfaceTensionBase: 0.3, // baseline surface tension for adhesion calc
    // ── Multi-food ──
    mineralGrowth: 0.15, // mineral food growth rate (rare)
    mineralEnergy: 2.5, // energy per unit mineral (high value)
    meatDecay: 0.005, // meat food decays over time
    meatDropEnergy: 0.6, // fraction of cell energy dropped as meat on death
    // ── Predation ──
    predationRange: 3.5, // how close predator must be to attack
    predationCooldown: 60, // ticks between attacks
    predationMinSize: 0.8, // minimum predator advantage to eat (energy ratio)
    // ── Morphology ──
    morphMutRate: 0.07, // mutation rate for morphology genes
    spawn: {
      n: 60,
      energy: 2.2
    }
  }
}

export class Sim {
  constructor(cfg) {
    this.cfg = structuredClone(cfg)
    this.reset(this.cfg.seed)
  }

  async reset(seedStr) {
    if (!wasmReady) await initWasm()
    this.t = 0
    this.rng = makeRng(seedStr)
    this.cfg.seed = seedStr
    wasmRngState = Math.floor(this.rng() * 0x100000000)

    this.w = this.cfg.w
    this.h = this.cfg.h
    this.food = new Float32Array(this.w * this.h) // plant food (Wasm-managed)
    this.mineralFood = new Float32Array(this.w * this.h) // mineral food (JS-managed)
    this.meatFood = new Float32Array(this.w * this.h) // organic/meat food (JS-managed)
    this.killCount = 0

    this.cells = []
    this.links = []

    // ── Seasonal gradient state ──
    this.season = 0
    this.seasonTick = 0
    this._initGradient()

    this.camera = {
      x: this.w / 2,
      y: this.h / 2,
      zoom: 1
    }

    this._nextId = 1
    this._nextClade = 1

    for (let i = 0; i < this.cfg.spawn.n; i++) {
      this.cells.push(
        this._makeCell({
          x: randRange(this.rng, 0, this.w),
          y: randRange(this.rng, 0, this.h),
          energy: this.cfg.spawn.energy,
          clade: this._nextClade++
        })
      )
    }

    for (let i = 0; i < this.w * this.h; i++) {
      this.food[i] = randRange(this.rng, 0, 0.35)
    }
    // Scatter mineral deposits (rare, clustered)
    for (let k = 0; k < 16; k++) {
      const cx = (this.rng() * this.w) | 0
      const cy = (this.rng() * this.h) | 0
      const r = (3 + this.rng() * 5) | 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue
          const ix = wrap((cx + dx) | 0, this.w)
          const iy = wrap((cy + dy) | 0, this.h)
          this.mineralFood[ix + iy * this.w] += randRange(this.rng, 0.1, 0.5)
        }
      }
    }
  }

  // ── Gradient: resource peak shifts each season (paper: τs) ──
  _initGradient() {
    // Pick a random boundary midpoint as gradient peak
    const sides = [
      { x: 0, y: this.h / 2 },
      { x: this.w, y: this.h / 2 },
      { x: this.w / 2, y: 0 },
      { x: this.w / 2, y: this.h }
    ]
    const pick = sides[(this.rng() * 4) | 0]
    this.gradientPeak = { x: pick.x, y: pick.y }
    // Precompute gradient field (shallow, noisy — per paper)
    this.gradientField = new Float32Array(this.w * this.h)
    const maxDist = Math.sqrt(this.w * this.w + this.h * this.h)
    const slope = this.cfg.gradientSlope
    const noise = this.cfg.gradientNoise
    for (let iy = 0; iy < this.h; iy++) {
      for (let ix = 0; ix < this.w; ix++) {
        const dx = torusDelta(ix - this.gradientPeak.x, this.w)
        const dy = torusDelta(iy - this.gradientPeak.y, this.h)
        const d = Math.sqrt(dx * dx + dy * dy)
        let val = 1.0 + slope * (maxDist - d)
        // Noisy holes in gradient (paper: pχ=0 sites)
        if (this.rng() < noise) val = 0
        this.gradientField[ix + iy * this.w] = Math.max(0, val)
      }
    }
  }

  _shiftSeason() {
    this.season++
    this.seasonTick = 0
    // Shift gradient peak to a different boundary (paper: new season = new direction)
    const oldPeak = this.gradientPeak
    const sides = [
      { x: 0, y: this.h / 2 },
      { x: this.w, y: this.h / 2 },
      { x: this.w / 2, y: 0 },
      { x: this.w / 2, y: this.h }
    ]
    // Pick a different side than current
    let pick
    for (let attempts = 0; attempts < 10; attempts++) {
      pick = sides[(this.rng() * 4) | 0]
      const dx = Math.abs(pick.x - oldPeak.x)
      const dy = Math.abs(pick.y - oldPeak.y)
      if (dx > 10 || dy > 10) break
    }
    this.gradientPeak = pick
    // Rebuild gradient field
    const maxDist = Math.sqrt(this.w * this.w + this.h * this.h)
    const slope = this.cfg.gradientSlope
    const noise = this.cfg.gradientNoise
    for (let iy = 0; iy < this.h; iy++) {
      for (let ix = 0; ix < this.w; ix++) {
        const dx = torusDelta(ix - this.gradientPeak.x, this.w)
        const dy = torusDelta(iy - this.gradientPeak.y, this.h)
        const d = Math.sqrt(dx * dx + dy * dy)
        let val = 1.0 + slope * (maxDist - d)
        if (this.rng() < noise) val = 0
        this.gradientField[ix + iy * this.w] = Math.max(0, val)
      }
    }
  }

  setConfigPatch(patch) {
    Object.assign(this.cfg, patch)
    this.cfg.w = this.w
    this.cfg.h = this.h
  }

  _makeCell({ x, y, energy, clade, genome } = {}) {
    const g = genome ?? {
      speed: randRange(this.rng, 0.65, 1.5),
      metabolism: randRange(this.rng, 0.7, 1.4),
      sense: randRange(this.rng, 0.6, 2.2),
      adhesion: randRange(this.rng, 0.0, 1.0),
      division: randRange(this.rng, 3.2, 5.0),
      // Organelle aptitudes
      nucleusApt: randRange(this.rng, 0.05, 0.5),
      mitoApt: randRange(this.rng, 0.05, 0.5),
      flagellaApt: randRange(this.rng, 0.05, 0.5),
      receptorApt: randRange(this.rng, 0.05, 0.5),
      vacuoleApt: randRange(this.rng, 0.05, 0.5),
      // CPM adhesion bitstrings
      receptorBits: this._randomBits(12),
      ligandBits: this._randomBits(12),
      persistence: randRange(this.rng, 0.3, 0.8),
      // ── Diet: 0=pure herbivore, 1=pure carnivore ──
      diet: randRange(this.rng, 0.0, 0.3),
      // ── Morphology traits [0..1] ──
      flipper: randRange(this.rng, 0.0, 0.2), // directional thrust appendage
      membrane: randRange(this.rng, 0.1, 0.4), // thick membrane = defense
      cilia: randRange(this.rng, 0.0, 0.2), // filter feeding + slow movement
      spines: randRange(this.rng, 0.0, 0.1) // anti-predator defense
    }

    return {
      id: this._nextId++,
      clade: clade ?? this._nextClade++,
      x: x ?? randRange(this.rng, 0, this.w),
      y: y ?? randRange(this.rng, 0, this.h),
      vx: randNorm(this.rng) * 0.02,
      vy: randNorm(this.rng) * 0.02,
      energy: energy ?? randRange(this.rng, 1.0, 2.5),
      age: 0,
      g,
      linkCount: 0,
      organelles: new Float32Array(ORGANELLE_COUNT),
      persistDir: { x: randNorm(this.rng), y: randNorm(this.rng) },
      persistTimer: 0,
      role: ROLE_NONE,
      contactCount: 0,
      chemoVec: { x: 0, y: 0 },
      fitnessDist: 0,
      fitnessAccum: 0,
      membranePhase: this.rng() * Math.PI * 2,
      // ── Predation state ──
      attackCooldown: 0,
      lastAte: 0 // 0=plant, 1=mineral, 2=meat (for visual)
    }
  }

  _randomBits(n) {
    let bits = 0
    for (let i = 0; i < n; i++) {
      if (this.rng() > 0.5) bits |= 1 << i
    }
    return bits
  }

  // ── CPM-inspired surface tension: γ = J(cell,medium) - J(cell,cell)/2 ──
  // Higher γ → stronger adhesion between cells
  _surfaceTension(cellA, cellB) {
    // Hamming distance of receptor↔ligand complementarity (paper eq)
    const compAB = this._bitComplement(cellA.g.receptorBits, cellB.g.ligandBits, 12)
    const compBA = this._bitComplement(cellB.g.receptorBits, cellA.g.ligandBits, 12)
    const Jcc = 52 - 4 * (compAB + compBA) // lower J = stronger binding
    const JcmA = 20 - 2 * (cellA.g.receptorBits & 0x3f) // simplified medium affinity
    const JcmB = 20 - 2 * (cellB.g.receptorBits & 0x3f)
    const Jcm = (JcmA + JcmB) * 0.5
    const gamma = Jcm - Jcc / 2
    // Normalize to [0,1] range for use in sim
    return clamp((gamma + 18) / 36, 0, 1)
  }

  _bitComplement(receptor, ligand, len) {
    // Count complementary bits (XOR then count 1s = mismatches, so complement = len - popcount(XOR))
    let xor = (receptor ^ ligand) & ((1 << len) - 1)
    let count = 0
    while (xor) {
      count += xor & 1
      xor >>= 1
    }
    return (len - count) / len // 1.0 = perfect complement
  }

  _foodIdx(ix, iy) {
    ix = wrap(ix, this.w)
    iy = wrap(iy, this.h)
    return ix + iy * this.w
  }

  _sampleFood(x, y) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    return this.food[ix + iy * this.w]
  }

  _sampleGradient(x, y) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    return this.gradientField[ix + iy * this.w]
  }

  _takeFood(x, y, amount) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    const i = ix + iy * this.w
    const take = this.food[i] < amount ? this.food[i] : amount
    this.food[i] -= take
    return take
  }

  _diffuseStep() {
    this.food = diffuse_food(
      this.food,
      this.w,
      this.h,
      this.cfg.diffusion,
      this.cfg.sampleScale ?? 1,
      wasmRngState
    )
  }

  _growFood(mult = 1) {
    this.food = grow_food(
      this.food,
      this.w,
      this.h,
      this.cfg.foodGrowth * mult,
      this.cfg.patchiness,
      this.cfg.sampleScale ?? 1,
      wasmRngState
    )
  }

  _sampleMineral(x, y) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    return this.mineralFood[ix + iy * this.w]
  }

  _takeMineral(x, y, amount) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    const i = ix + iy * this.w
    const take = this.mineralFood[i] < amount ? this.mineralFood[i] : amount
    this.mineralFood[i] -= take
    return take
  }

  _sampleMeat(x, y) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    return this.meatFood[ix + iy * this.w]
  }

  _takeMeat(x, y, amount) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    const i = ix + iy * this.w
    const take = this.meatFood[i] < amount ? this.meatFood[i] : amount
    this.meatFood[i] -= take
    return take
  }

  _dropMeat(x, y, amount) {
    const ix = wrap(x | 0, this.w)
    const iy = wrap(y | 0, this.h)
    this.meatFood[ix + iy * this.w] += amount
  }

  _growMinerals() {
    // Slow regrowth at random spots
    if (this.rng() < this.cfg.mineralGrowth) {
      const ix = (this.rng() * this.w) | 0
      const iy = (this.rng() * this.h) | 0
      this.mineralFood[ix + iy * this.w] += randRange(this.rng, 0.05, 0.2)
    }
  }

  _decayMeat() {
    const decay = this.cfg.meatDecay
    for (let i = 0; i < this.meatFood.length; i++) {
      if (this.meatFood[i] > 0) {
        this.meatFood[i] *= 1 - decay
        if (this.meatFood[i] < 0.001) this.meatFood[i] = 0
      }
    }
  }

  // ── Predation: carnivorous cells can eat other cells ──
  _predation(spatial) {
    const { grid, gw, gh } = spatial
    const rangeSq = this.cfg.predationRange * this.cfg.predationRange
    const n = this.cells.length
    const toKill = new Set()

    for (let i = 0; i < n; i++) {
      const c = this.cells[i]
      if (c.g.diet < 0.4) continue // not carnivorous enough
      if (c.attackCooldown > 0) {
        c.attackCooldown--
        continue
      }

      const bx = Math.floor((c.x / this.w) * gw) % gw
      const by = Math.floor((c.y / this.h) * gh) % gh

      let bestPrey = -1,
        bestD2 = Infinity
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = (((bx + ox) % gw) + gw) % gw
          const gy = (((by + oy) % gh) + gh) % gh
          const bucket = grid[gx + gy * gw]
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k]
            if (j === i || toKill.has(j)) continue
            const o = this.cells[j]
            if (o.clade === c.clade) continue // don't eat kin
            const dx = torusDelta(c.x - o.x, this.w)
            const dy = torusDelta(c.y - o.y, this.h)
            const d2 = dx * dx + dy * dy
            if (d2 < rangeSq && d2 < bestD2) {
              // Must be bigger/stronger to eat
              const attackPower = c.energy * (1 + c.g.diet) * (1 + c.g.spines * 0.3)
              const defensePower = o.energy * (1 + o.g.membrane * 1.5 + o.g.spines * 2.0)
              if (attackPower > defensePower * this.cfg.predationMinSize) {
                bestPrey = j
                bestD2 = d2
              }
            }
          }
        }
      }

      if (bestPrey >= 0) {
        const prey = this.cells[bestPrey]
        // Predator gains energy from prey (diet efficiency)
        const gained = prey.energy * (0.4 + c.g.diet * 0.3)
        c.energy += gained
        c.lastAte = FOOD_MEAT
        c.attackCooldown = this.cfg.predationCooldown
        // Prey drops remaining energy as meat
        const meatDrop = prey.energy * this.cfg.meatDropEnergy
        this._dropMeat(prey.x, prey.y, meatDrop)
        toKill.add(bestPrey)
        this.killCount++
      }
    }

    // Mark killed cells for removal by the normal cull phase (avoids stale link indices)
    for (const j of toKill) {
      this.cells[j].energy = 0
    }
  }

  // ── Organelle development: cells invest energy to grow organelles ──
  _developOrganelles(c) {
    const rate = this.cfg.organelleGrowthRate
    const energyThreshold = 0.8 // need some energy to invest in organelles

    if (c.energy < energyThreshold) return

    const aptitudes = [c.g.nucleusApt, c.g.mitoApt, c.g.flagellaApt, c.g.receptorApt, c.g.vacuoleApt]

    for (let i = 0; i < ORGANELLE_COUNT; i++) {
      const target = aptitudes[i]
      const current = c.organelles[i]
      if (current < target) {
        const growth = rate * (1 + c.energy * 0.2) * (target - current)
        c.organelles[i] = Math.min(target, current + growth)
        // Small energy cost to develop organelles
        c.energy -= growth * 0.05
      }
    }
  }

  // ── Determine cell role based on position in cluster ──
  _assignRoles(spatial) {
    const { grid, gw, gh } = spatial
    const linkDistSq = this.cfg.linkDist * this.cfg.linkDist * 2.5

    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      if (c.linkCount === 0) {
        c.role = ROLE_NONE
        c.contactCount = 0
        continue
      }

      // Count nearby kin
      const bx = Math.floor((c.x / this.w) * gw) % gw
      const by = Math.floor((c.y / this.h) * gh) % gh
      let kinNear = 0
      let totalNear = 0
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = (((bx + ox) % gw) + gw) % gw
          const gy = (((by + oy) % gh) + gh) % gh
          const bucket = grid[gx + gy * gw]
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k]
            if (j === i) continue
            const o = this.cells[j]
            const dx = torusDelta(c.x - o.x, this.w)
            const dy = torusDelta(c.y - o.y, this.h)
            const d2 = dx * dx + dy * dy
            if (d2 < linkDistSq) {
              totalNear++
              if (o.clade === c.clade) kinNear++
            }
          }
        }
      }

      c.contactCount = totalNear

      // Role assignment based on neighborhood
      if (kinNear >= 3 && totalNear >= 4) {
        c.role = ROLE_INTERIOR // surrounded → interior processor
      } else if (kinNear >= 1) {
        // Check if leading edge (moving toward gradient)
        const gdx = torusDelta(this.gradientPeak.x - c.x, this.w)
        const gdy = torusDelta(this.gradientPeak.y - c.y, this.h)
        const gLen = Math.sqrt(gdx * gdx + gdy * gdy) || 1
        const dot = (c.vx * gdx + c.vy * gdy) / gLen
        if (dot > 0.02 && c.g.flagellaApt > 0.3) {
          c.role = ROLE_PIONEER // leading edge
        } else {
          c.role = ROLE_EDGE // outer cell
        }
      } else {
        c.role = ROLE_NONE
      }
    }
  }

  // ── Persistent migration: update direction every τp ticks (paper) ──
  _updatePersistence(c) {
    c.persistTimer++
    if (c.persistTimer >= this.cfg.persistenceInterval) {
      c.persistTimer = 0
      // Update persistent direction to actual displacement direction
      const v = Math.sqrt(c.vx * c.vx + c.vy * c.vy)
      if (v > 0.001) {
        c.persistDir.x = c.vx / v
        c.persistDir.y = c.vy / v
      }
    }
  }

  // ── Chemotaxis: cell senses gradient over its body (paper: χ→) ──
  _computeChemotaxis(c) {
    const sense = c.g.sense * (1 + c.organelles[ORGANELLE_RECEPTOR] * 1.5)
    const senseRadius = sense * 2.2

    // Sample gradient at cell position and surrounding points
    let sumGx = 0,
      sumGy = 0,
      sumG = 0
    const here = this._sampleGradient(c.x, c.y)

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1]
    ]
    for (const [dx, dy] of dirs) {
      const sx = c.x + dx * senseRadius
      const sy = c.y + dy * senseRadius
      const g = this._sampleGradient(sx, sy)
      if (g > here) {
        sumGx += dx * (g - here)
        sumGy += dy * (g - here)
      }
      sumG += g
    }

    // Chemotaxis vector points from cell center toward perceived higher concentration
    const len = Math.sqrt(sumGx * sumGx + sumGy * sumGy) || 1
    c.chemoVec.x = sumGx / len
    c.chemoVec.y = sumGy / len

    return { cx: c.chemoVec.x, cy: c.chemoVec.y, strength: sumG / 8 }
  }

  _mutateGenome(parentG) {
    const m = this.cfg.mutationRate
    const om = this.cfg.organelleMutRate
    const mm = this.cfg.morphMutRate
    const g = {
      speed: parentG.speed,
      metabolism: parentG.metabolism,
      sense: parentG.sense,
      adhesion: parentG.adhesion,
      division: parentG.division,
      nucleusApt: parentG.nucleusApt,
      mitoApt: parentG.mitoApt,
      flagellaApt: parentG.flagellaApt,
      receptorApt: parentG.receptorApt,
      vacuoleApt: parentG.vacuoleApt,
      receptorBits: parentG.receptorBits,
      ligandBits: parentG.ligandBits,
      persistence: parentG.persistence,
      diet: parentG.diet,
      flipper: parentG.flipper,
      membrane: parentG.membrane,
      cilia: parentG.cilia,
      spines: parentG.spines
    }

    const jitter = (x, scale, lo, hi) => clamp(x + randNorm(this.rng) * m * scale, lo, hi)

    g.speed = jitter(g.speed, 0.55, 0.35, 2.6)
    g.metabolism = jitter(g.metabolism, 0.55, 0.35, 2.6)
    g.sense = jitter(g.sense, 0.85, 0.25, 4.0)
    g.adhesion = jitter(g.adhesion, 0.9, 0, 1)
    g.division = jitter(g.division, 1.05, 2.0, 7.5)
    g.persistence = jitter(g.persistence, 0.5, 0.1, 0.95)

    // Diet mutation
    g.diet = clamp(g.diet + randNorm(this.rng) * m * 0.6, 0, 1)

    // Organelle aptitude mutations
    const nucleusProtection = parentG.nucleusApt * 0.3
    const effectiveOm = om * (1 - nucleusProtection)
    const oje = (x, scale) => clamp(x + randNorm(this.rng) * effectiveOm * scale, 0, 1)

    g.nucleusApt = oje(g.nucleusApt, 0.7)
    g.mitoApt = oje(g.mitoApt, 0.7)
    g.flagellaApt = oje(g.flagellaApt, 0.7)
    g.receptorApt = oje(g.receptorApt, 0.7)
    g.vacuoleApt = oje(g.vacuoleApt, 0.7)

    // Morphology mutations
    const mj = (x, scale) => clamp(x + randNorm(this.rng) * mm * scale, 0, 1)
    g.flipper = mj(g.flipper, 0.8)
    g.membrane = mj(g.membrane, 0.6)
    g.cilia = mj(g.cilia, 0.7)
    g.spines = mj(g.spines, 0.9)

    // Receptor/ligand bit mutations
    for (let i = 0; i < 12; i++) {
      if (this.rng() < m * 0.5) g.receptorBits ^= 1 << i
      if (this.rng() < m * 0.5) g.ligandBits ^= 1 << i
    }

    return g
  }

  _buildSpatialIndex() {
    const dist = this.cfg.linkDist
    const cellSize = Math.max(dist * 1.4, 2)
    const gw = Math.max(1, Math.ceil(this.w / cellSize))
    const gh = Math.max(1, Math.ceil(this.h / cellSize))
    const grid = new Array(gw * gh)
    for (let i = 0; i < grid.length; i++) grid[i] = []
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      const bx = Math.floor((c.x / this.w) * gw) % gw
      const by = Math.floor((c.y / this.h) * gh) % gh
      grid[bx + by * gw].push(i)
    }
    return { grid, gw, gh }
  }

  _nearestKinNearbyIndex(idx, spatial) {
    const c = this.cells[idx]
    const { grid, gw, gh } = spatial
    const bx = Math.floor((c.x / this.w) * gw) % gw
    const by = Math.floor((c.y / this.h) * gh) % gh
    let bestD2 = Infinity,
      bestJ = -1
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = (((bx + ox) % gw) + gw) % gw
        const gy = (((by + oy) % gh) + gh) % gh
        const bucket = grid[gx + gy * gw]
        for (let k = 0; k < bucket.length; k++) {
          const j = bucket[k]
          if (j === idx) continue
          const o = this.cells[j]
          if (o.clade !== c.clade) continue
          const dx = torusDelta(c.x - o.x, this.w)
          const dy = torusDelta(c.y - o.y, this.h)
          const d2 = dx * dx + dy * dy
          if (d2 < bestD2) {
            bestD2 = d2
            bestJ = j
          }
        }
      }
    }
    return bestJ >= 0 ? { idx: bestJ, d2: bestD2 } : null
  }

  _maybeLink() {
    const spatial = this._buildSpatialIndex()
    const n = this.cells.length
    const maxAttempts = Math.max(20, Math.floor(n * (this.cfg.sampleScale ?? 1)))
    const linkDistSq = this.cfg.linkDist * this.cfg.linkDist

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const i = (this.rng() * n) | 0
      const c = this.cells[i]
      const nearest = this._nearestKinNearbyIndex(i, spatial)
      if (!nearest || nearest.d2 > linkDistSq) continue
      const j = nearest.idx
      const o = this.cells[j]
      if (c.linkCount >= this.cfg.linkMax || o.linkCount >= this.cfg.linkMax) continue

      // ── CPM-inspired adhesion probability using surface tension ──
      const gamma = this._surfaceTension(c, o)
      const adhesionProduct = c.g.adhesion * o.g.adhesion
      const p = 0.015 + 0.18 * adhesionProduct * (0.5 + gamma)
      if (this.rng() > p) continue

      // Check if link already exists
      let exists = false
      for (let k = 0; k < this.links.length; k++) {
        const l = this.links[k]
        if ((l.a === i && l.b === j) || (l.a === j && l.b === i)) {
          exists = true
          break
        }
      }
      if (exists) continue
      const s = (c.g.adhesion + o.g.adhesion) * 0.5
      this.links.push({ a: i, b: j, rest: 4.0, s, gamma })
      c.linkCount++
      o.linkCount++
    }
  }

  _applyLinksForces() {
    const next = []
    const linkDistSq = this.cfg.linkDist * this.cfg.linkDist
    const maxKeep = Math.sqrt(linkDistSq) * 1.9

    for (let k = 0; k < this.links.length; k++) {
      const l = this.links[k]
      const a = this.cells[l.a]
      const b = this.cells[l.b]
      if (!a || !b) continue
      if (a.clade !== b.clade) {
        a.linkCount = Math.max(0, a.linkCount - 1)
        b.linkCount = Math.max(0, b.linkCount - 1)
        continue
      }
      const dx = torusDelta(b.x - a.x, this.w)
      const dy = torusDelta(b.y - a.y, this.h)
      const d = Math.sqrt(dx * dx + dy * dy) || 0.0001
      if (d > maxKeep) {
        a.linkCount = Math.max(0, a.linkCount - 1)
        b.linkCount = Math.max(0, b.linkCount - 1)
        continue
      }
      // Spring force scaled by surface tension
      const springK = this.cfg.linkSpring * (0.7 + 0.6 * (l.gamma || 0.5))
      const f = springK * (d - l.rest)
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
      const dvx = b.vx - a.vx,
        dvy = b.vy - a.vy
      a.vx += dvx * this.cfg.linkDamp
      a.vy += dvy * this.cfg.linkDamp
      b.vx -= dvx * this.cfg.linkDamp
      b.vy -= dvy * this.cfg.linkDamp
      // Energy sharing (interior cells share more)
      const shareBoost = a.role === ROLE_INTERIOR || b.role === ROLE_INTERIOR ? 1.5 : 1.0
      const diff = a.energy - b.energy
      const share = diff * this.cfg.shareRate * l.s * shareBoost
      a.energy -= share
      b.energy += share
      next.push(l)
    }
    this.links = next
  }

  step() {
    this.t += 1
    this.seasonTick++

    // ── Season shift (paper: change gradient direction every τs) ──
    if (this.seasonTick >= this.cfg.seasonLength) {
      this._shiftSeason()
    }

    const popNow = this.cells.length
    const envStride = popNow > 2800 ? 4 : popNow > 1600 ? 2 : 1

    if (this.t % envStride === 0) this._growFood(envStride)
    if (this.t % (2 * envStride) === 0) this._diffuseStep()
    // Mineral and meat updates (less frequent)
    if (this.t % 4 === 0) this._growMinerals()
    if (this.t % 8 === 0) this._decayMeat()

    const maxCells = this.cfg.maxCells | 0

    // ── Build spatial index for role assignment ──
    const spatial = this._buildSpatialIndex()
    if (this.t % 8 === 0) {
      this._assignRoles(spatial)
    }

    // Per-cell movement, sensing, energy, reproduction
    const startCount = this.cells.length

    for (let i = 0; i < startCount; i++) {
      const c = this.cells[i]
      c.age++
      c.membranePhase += 0.03 + 0.02 * c.g.speed

      // ── Organelle development ──
      this._developOrganelles(c)

      // ── Persistent migration update (paper: τp) ──
      this._updatePersistence(c)

      // ── Organelle-modified stats ──
      const mitoBonus = c.organelles[ORGANELLE_MITOCHONDRIA]
      const flagBonus = c.organelles[ORGANELLE_FLAGELLUM]
      const recBonus = c.organelles[ORGANELLE_RECEPTOR]
      const vacBonus = c.organelles[ORGANELLE_VACUOLE]

      const sense = c.g.sense * (1 + recBonus * 1.2)
      const speed = c.g.speed * (1 + flagBonus * 0.8)
      const metabolism = c.g.metabolism * (1 - mitoBonus * 0.35)
      const divisionThreshold = c.g.division * (1 - vacBonus * 0.15)

      // ── Morphology effects ──
      const flipperBoost = c.g.flipper * 0.6 // directional thrust
      const ciliaBoost = c.g.cilia * 0.4 // passive filter feeding range
      const membraneDrag = c.g.membrane * 0.15 // thick membrane slows you down
      const spinesCost = c.g.spines * 0.002 // spines cost energy to maintain

      // ── Chemotaxis ──
      const chemo = this._computeChemotaxis(c)

      // Food gradient sensing — sense ALL food types, prefer what you can eat
      const herbivoreAff = 1 - c.g.diet // how well you eat plants
      const carnivoreAff = c.g.diet // how well you eat meat
      let bestFoodVal = 0
      let bfx = 0,
        bfy = 0
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1]
      ]
      const senseR = sense * 2.2
      // Sample combined food attractiveness
      const hereVal =
        this._sampleFood(c.x, c.y) * herbivoreAff +
        this._sampleMineral(c.x, c.y) * 1.5 +
        this._sampleMeat(c.x, c.y) * carnivoreAff * 2.0
      bestFoodVal = hereVal
      for (const [dx, dy] of dirs) {
        const sx = c.x + dx * senseR
        const sy = c.y + dy * senseR
        const fv =
          this._sampleFood(sx, sy) * herbivoreAff +
          this._sampleMineral(sx, sy) * 1.5 +
          this._sampleMeat(sx, sy) * carnivoreAff * 2.0
        if (fv > bestFoodVal) {
          bestFoodVal = fv
          bfx = dx
          bfy = dy
        }
      }

      // ── Combined movement ──
      const moveAmt = this.cfg.baseMove * speed * (1 - membraneDrag)
      const gw = this.cfg.gradientWeight
      const persist = c.g.persistence * this.cfg.persistenceStrength

      // Contact inhibition of locomotion
      const cilFactor =
        c.contactCount > 0 ? Math.max(0.3, 1 - this.cfg.contactInhibition * c.contactCount) : 1.0

      // Role-based movement modifiers
      let roleSpeedMod = 1.0
      if (c.role === ROLE_PIONEER) roleSpeedMod = 1.3
      else if (c.role === ROLE_INTERIOR) roleSpeedMod = 0.6
      else if (c.role === ROLE_EDGE) roleSpeedMod = 1.1

      // Blend: food gradient + chemotactic gradient + persistence + wander
      const foodW = gw * 0.5
      const chemoW = gw * 0.5
      const wanderW = 1 - gw
      let wx =
        wanderW * randNorm(this.rng) * this.cfg.moveWander +
        foodW * bfx +
        chemoW * chemo.cx +
        persist * c.persistDir.x
      let wy =
        wanderW * randNorm(this.rng) * this.cfg.moveWander +
        foodW * bfy +
        chemoW * chemo.cy +
        persist * c.persistDir.y

      // Flipper: extra thrust in movement direction
      if (c.g.flipper > 0.1) {
        const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
        wx += (c.vx / vLen) * flipperBoost
        wy += (c.vy / vLen) * flipperBoost
      }

      c.vx += wx * moveAmt * cilFactor * roleSpeedMod
      c.vy += wy * moveAmt * cilFactor * roleSpeedMod

      // Clamp velocity
      const v = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.0001
      const vmax = (0.55 + 0.65 * speed) * roleSpeedMod
      if (v > vmax) {
        c.vx = (c.vx / v) * vmax
        c.vy = (c.vy / v) * vmax
      }

      // ── Multi-food uptake (diet determines efficiency) ──
      const uptakeBase = this.cfg.uptake * (0.75 + 0.35 * sense) * (1 + recBonus * 0.5)

      // Plant food — herbivores eat well, carnivores poorly
      const plantTake = this._takeFood(c.x, c.y, uptakeBase * herbivoreAff)
      c.energy += plantTake
      if (plantTake > 0.01) c.lastAte = FOOD_PLANT

      // Mineral food — everyone can eat, high value
      const mineralTake = this._takeMineral(c.x, c.y, uptakeBase * 0.5)
      c.energy += mineralTake * this.cfg.mineralEnergy
      if (mineralTake > 0.01) c.lastAte = FOOD_MINERAL

      // Meat food — carnivores eat well, herbivores poorly
      const meatTake = this._takeMeat(c.x, c.y, uptakeBase * carnivoreAff)
      c.energy += meatTake * 1.8
      if (meatTake > 0.01) c.lastAte = FOOD_MEAT

      // Cilia: passive filter feeding from nearby cells (small bonus)
      if (c.g.cilia > 0.15) {
        const ciliaRange = 1 + ciliaBoost * 3
        const extra = this._takeFood(
          c.x + randNorm(this.rng) * ciliaRange,
          c.y + randNorm(this.rng) * ciliaRange,
          uptakeBase * c.g.cilia * 0.3
        )
        c.energy += extra
      }

      // Metabolism
      c.energy -= this.cfg.metabolismBase * metabolism * (1 + 0.7 * speed) * this.cfg.dt

      // Morphology maintenance costs
      c.energy -= spinesCost
      c.energy -= c.g.flipper * 0.001
      c.energy -= c.g.cilia * 0.0008

      // Organelle maintenance cost
      let organelleCost = 0
      for (let oi = 0; oi < ORGANELLE_COUNT; oi++) {
        organelleCost += c.organelles[oi] * 0.0005
      }
      c.energy -= organelleCost

      // ── Fitness tracking (paper: distance to gradient peak) ──
      const gdx = torusDelta(c.x - this.gradientPeak.x, this.w)
      const gdy = torusDelta(c.y - this.gradientPeak.y, this.h)
      c.fitnessDist = Math.sqrt(gdx * gdx + gdy * gdy)
      c.fitnessAccum += 1.0 / (1.0 + c.fitnessDist * 0.02)

      // Position update
      c.x = (((c.x + c.vx) % this.w) + this.w) % this.w
      c.y = (((c.y + c.vy) % this.h) + this.h) % this.h
      c.vx *= 0.985
      c.vy *= 0.985

      // ── Division (with organelle inheritance) ──
      if (c.energy > divisionThreshold && this.cells.length < maxCells) {
        const childEnergy = c.energy * 0.47
        c.energy *= 0.53
        const off = 1.6 + 1.8
        const childGenome = this._mutateGenome(c.g)
        const child = this._makeCell({
          x: (((c.x + randNorm(this.rng) * off) % this.w) + this.w) % this.w,
          y: (((c.y + randNorm(this.rng) * off) % this.h) + this.h) % this.h,
          energy: childEnergy,
          clade: c.clade,
          genome: childGenome
        })
        child.vx = c.vx + randNorm(this.rng) * 0.06
        child.vy = c.vy + randNorm(this.rng) * 0.06
        // Inherit partial organelle development (asymmetric division)
        for (let oi = 0; oi < ORGANELLE_COUNT; oi++) {
          child.organelles[oi] = c.organelles[oi] * randRange(this.rng, 0.2, 0.6)
          c.organelles[oi] *= randRange(this.rng, 0.5, 0.8)
        }
        // Inherit persistent direction
        child.persistDir.x = c.persistDir.x + randNorm(this.rng) * 0.3
        child.persistDir.y = c.persistDir.y + randNorm(this.rng) * 0.3
        this.cells.push(child)
      }
    }

    // Linking (JS — spatial grid neighbor search)
    if (this.cells.length > 1) {
      const pop = this.cells.length
      const linkStride = pop > 3200 ? 12 : pop > 2200 ? 8 : pop > 1400 ? 4 : 2
      if (this.t % linkStride === 0) {
        this._maybeLink()
      }
    }

    // Apply link forces and sharing (JS)
    this._applyLinksForces()

    // ── Predation phase ──
    if (this.t % 3 === 0 && this.cells.length > 1) {
      const predSpatial = this._buildSpatialIndex()
      this._predation(predSpatial)
    }

    // Cull dead/old cells — drop meat on death
    const next = []
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      if (c.energy <= 0 || c.age > this.cfg.deathAge) {
        // Dead cell drops meat
        if (c.energy > 0.1) {
          this._dropMeat(c.x, c.y, c.energy * this.cfg.meatDropEnergy)
        }
        continue
      }
      next.push(c)
    }
    this.cells = next

    if (this.cells.length === 0) {
      this.cells.push(
        this._makeCell({
          x: randRange(this.rng, 0, this.w),
          y: randRange(this.rng, 0, this.h),
          energy: this.cfg.spawn.energy,
          clade: this._nextClade++
        })
      )
    }
  }

  stats() {
    const n = this.cells.length || 1
    let a = 0,
      s = 0,
      m = 0
    let totalOrganelles = new Float32Array(ORGANELLE_COUNT)
    let roles = [0, 0, 0, 0]
    let multicellCount = 0
    let dietSum = 0,
      flipperSum = 0,
      membraneSum = 0,
      ciliaSum = 0,
      spinesSum = 0
    let herbivores = 0,
      omnivores = 0,
      carnivores = 0

    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      const g = c.g
      a += g.adhesion
      s += g.speed
      m += g.metabolism
      dietSum += g.diet
      flipperSum += g.flipper
      membraneSum += g.membrane
      ciliaSum += g.cilia
      spinesSum += g.spines
      if (g.diet < 0.3) herbivores++
      else if (g.diet < 0.6) omnivores++
      else carnivores++
      for (let oi = 0; oi < ORGANELLE_COUNT; oi++) {
        totalOrganelles[oi] += c.organelles[oi]
      }
      roles[c.role]++
      if (c.linkCount > 0) multicellCount++
    }

    return {
      t: this.t,
      pop: this.cells.length,
      links: this.links.length,
      meanAdhesion: a / n,
      meanSpeed: s / n,
      meanMetabolism: m / n,
      season: this.season,
      seasonProgress: this.seasonTick / this.cfg.seasonLength,
      meanNucleus: totalOrganelles[ORGANELLE_NUCLEUS] / n,
      meanMito: totalOrganelles[ORGANELLE_MITOCHONDRIA] / n,
      meanFlagella: totalOrganelles[ORGANELLE_FLAGELLUM] / n,
      meanReceptor: totalOrganelles[ORGANELLE_RECEPTOR] / n,
      meanVacuole: totalOrganelles[ORGANELLE_VACUOLE] / n,
      rolesNone: roles[ROLE_NONE],
      rolesEdge: roles[ROLE_EDGE],
      rolesInterior: roles[ROLE_INTERIOR],
      rolesPioneer: roles[ROLE_PIONEER],
      multicellFraction: multicellCount / n,
      gradientPeak: this.gradientPeak,
      // New stats
      meanDiet: dietSum / n,
      herbivores,
      omnivores,
      carnivores,
      meanFlipper: flipperSum / n,
      meanMembrane: membraneSum / n,
      meanCilia: ciliaSum / n,
      meanSpines: spinesSum / n,
      kills: this.killCount
    }
  }

  densestRegion() {
    const binsX = 18
    const binsY = 14
    const counts = new Uint16Array(binsX * binsY)
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      const bx = clamp(((c.x / this.w) * binsX) | 0, 0, binsX - 1)
      const by = clamp(((c.y / this.h) * binsY) | 0, 0, binsY - 1)
      counts[bx + by * binsX]++
    }
    let best = 0
    let bi = 0
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > best) {
        best = counts[i]
        bi = i
      }
    }
    const bx = bi % binsX
    const by = (bi / binsX) | 0
    return {
      x: ((bx + 0.5) / binsX) * this.w,
      y: ((by + 0.5) / binsY) * this.h,
      density: best
    }
  }
}
