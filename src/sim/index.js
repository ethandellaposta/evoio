import { makeRng, randRange } from '../rng.js'
import init from '../../pkg/evoio_wasm.js'
import { wrap } from './helpers.js'
import { setWasmRngState, getWasmRngState } from './food.js'

// Re-export constants and config
export {
  FOOD_PLANT,
  FOOD_MINERAL,
  FOOD_MEAT,
  FOOD_TYPES,
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
} from './constants.js'
export { defaultConfig } from './config.js'

// Mixin installers
import { installWorld } from './world.js'
import { installGenome } from './genome.js'
import { installFood } from './food.js'
import { installPredation } from './predation.js'
import { installOrganelles } from './organelles.js'
import { installRoles } from './roles.js'
import { installLinks } from './links.js'
import { installStep } from './step.js'
import { installStats } from './stats.js'

let wasmReady = false

export async function initWasm() {
  if (wasmReady) return
  await init()
  wasmReady = true
}

export class Sim {
  constructor(cfg) {
    this.cfg = structuredClone(cfg)
    this.reset(this.cfg.seed)
  }

  reset(seedStr) {
    if (!wasmReady) throw new Error('Call initWasm() before creating Sim')
    this.t = 0
    this.rng = makeRng(seedStr)
    this.cfg.seed = seedStr
    setWasmRngState(Math.floor(this.rng() * 0x100000000))

    this.w = this.cfg.w
    this.h = this.cfg.h
    this.food = new Float32Array(this.w * this.h)
    this.mineralFood = new Float32Array(this.w * this.h)
    this.meatFood = new Float32Array(this.w * this.h)
    this.killCount = 0

    this.cells = []
    this.links = []
    this.deathEvents = []
    this.birthEvents = []
    this.eatEvents = []

    this.cladeRegistry = new Map()
    this.foodChain = new Map()

    this._generateWorldBlob()
    this._generateBarriers()

    this.season = 0
    this.seasonTick = 0
    this._initGradient()
    this._initSun()

    this.camera = { x: this.w / 2, y: this.h / 2, zoom: 1 }

    this._nextId = 1
    this._nextClade = 1

    for (let i = 0; i < this.cfg.spawn.n; i++) {
      const clade = this._nextClade++
      let sx, sy
      for (let attempt = 0; attempt < 50; attempt++) {
        sx = randRange(this.rng, 0, this.w)
        sy = randRange(this.rng, 0, this.h)
        if (this.isInsideBlob(sx, sy) && !this.isInsideBarrier(sx, sy)) break
      }
      this.cells.push(this._makeCell({ x: sx, y: sy, energy: this.cfg.spawn.energy, clade }))
      this._registerClade(clade, 0.0)
    }

    // Seed initial food — more generous since food now relies on seed transport
    for (let i = 0; i < this.w * this.h; i++) {
      this.food[i] = randRange(this.rng, 0.3, 1.2)
    }
    // Add dense food patches scattered around the blob
    for (let k = 0; k < 60; k++) {
      const pt = this._randomBlobInteriorPoint()
      const r = 6 + ((this.rng() * 8) | 0)
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue
          const ix = wrap((pt.x + dx) | 0, this.w)
          const iy = wrap((pt.y + dy) | 0, this.h)
          this.food[ix + iy * this.w] += randRange(this.rng, 1.0, 3.5)
        }
      }
    }
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
}

Sim.prototype.serialize = function () {
  // Convert Float32Arrays to regular arrays for JSON
  const f32ToArr = (a) => (a ? Array.from(a) : null)

  const cells = this.cells.map((c) => ({
    id: c.id,
    clade: c.clade,
    x: c.x,
    y: c.y,
    vx: c.vx,
    vy: c.vy,
    energy: c.energy,
    age: c.age,
    g: { ...c.g },
    linkCount: c.linkCount,
    organelles: f32ToArr(c.organelles),
    persistDir: { ...c.persistDir },
    persistTimer: c.persistTimer,
    role: c.role,
    contactCount: c.contactCount,
    chemoVec: { ...c.chemoVec },
    fitnessDist: c.fitnessDist,
    fitnessAccum: c.fitnessAccum,
    membranePhase: c.membranePhase,
    attackCooldown: c.attackCooldown,
    lastAte: c.lastAte,
    eatFlash: c.eatFlash,
    engulfing: c.engulfing,
    complexity: c.complexity,
    jetCooldown: c.jetCooldown,
    toxinTimer: c.toxinTimer,
    foragingEff: c.foragingEff,
    explorationScore: c.explorationScore,
    cooperationScore: c.cooperationScore,
    behavioralFitness: c.behavioralFitness,
    divisionCount: c.divisionCount,
    moveAccum: c.moveAccum,
    energyGainAccum: c.energyGainAccum,
    peakEnergy: c.peakEnergy,
    activeMoveTicks: c.activeMoveTicks,
    organismSize: c.organismSize,
    organismDepth: c.organismDepth,
    seeds: c.seeds ? c.seeds.map((s) => ({ ...s })) : undefined
  }))

  const links = this.links.map((l) => ({
    a: l.a,
    b: l.b,
    rest: l.rest,
    age: l.age
  }))

  // Convert Maps to arrays of entries
  const cladeRegistry = [...this.cladeRegistry.entries()]
  const foodChain = [...this.foodChain.entries()]

  return {
    version: 1,
    t: this.t,
    cfg: this.cfg,
    w: this.w,
    h: this.h,
    _nextId: this._nextId,
    _nextClade: this._nextClade,
    killCount: this.killCount,
    season: this.season,
    seasonTick: this.seasonTick,
    sunAngle: this.sunAngle,
    dayPhase: this.dayPhase,
    dayCount: this.dayCount,
    sunIntensity: this.sunIntensity,
    food: f32ToArr(this.food),
    mineralFood: f32ToArr(this.mineralFood),
    meatFood: f32ToArr(this.meatFood),
    gradientField: f32ToArr(this.gradientField),
    blobCenter: this.blobCenter,
    blobBaseR: this.blobBaseR,
    blobPoints: this.blobPoints,
    blobHarmonics: this.blobHarmonics,
    barriers: this.barriers,
    gradientPeaks: this.gradientPeaks,
    cells,
    links,
    cladeRegistry,
    foodChain
  }
}

Sim.prototype.loadState = function (state) {
  if (!state || state.version !== 1) throw new Error('Invalid save file')

  this.t = state.t
  this.w = state.w
  this.h = state.h
  this.cfg = structuredClone(state.cfg)
  this._nextId = state._nextId
  this._nextClade = state._nextClade
  this.killCount = state.killCount
  this.season = state.season
  this.seasonTick = state.seasonTick
  this.sunAngle = state.sunAngle
  this.dayPhase = state.dayPhase
  this.dayCount = state.dayCount
  this.sunIntensity = state.sunIntensity

  // Restore typed arrays
  this.food = new Float32Array(state.food)
  this.mineralFood = new Float32Array(state.mineralFood)
  this.meatFood = new Float32Array(state.meatFood)
  this.gradientField = new Float32Array(state.gradientField)

  // Restore world geometry
  this.blobCenter = state.blobCenter
  this.blobBaseR = state.blobBaseR
  this.blobPoints = state.blobPoints
  this.blobHarmonics = state.blobHarmonics
  this.barriers = state.barriers
  this.gradientPeaks = state.gradientPeaks

  // Restore cells
  this.cells = state.cells.map((c) => {
    const cell = { ...c }
    cell.g = { ...c.g }
    cell.organelles = new Float32Array(c.organelles)
    cell.persistDir = { ...c.persistDir }
    cell.chemoVec = { ...c.chemoVec }
    cell.engulfTarget = null
    cell.seeds = c.seeds ? c.seeds.map((s) => ({ ...s })) : undefined
    return cell
  })

  // Restore links
  this.links = state.links.map((l) => ({ ...l }))

  // Restore maps
  this.cladeRegistry = new Map(state.cladeRegistry)
  this.foodChain = new Map(state.foodChain)

  // Clear transient events
  this.deathEvents = []
  this.birthEvents = []
  this.eatEvents = []
  this.mateEvents = []

  // Restore WASM RNG state
  setWasmRngState(Math.floor(this.rng() * 0x100000000))
}

// Install all mixins onto Sim.prototype
installWorld(Sim)
installGenome(Sim)
installFood(Sim)
installPredation(Sim)
installOrganelles(Sim)
installRoles(Sim)
installLinks(Sim)
installStep(Sim, () => wasmReady)
installStats(Sim)
