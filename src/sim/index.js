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
export { defaultConfig, generateBiomes, BIOME_POOL } from './config.js'
import { generateBiomes as _generateBiomes } from './config.js'

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

    // Gas exchange grids at 1/4 resolution for performance
    // Scientific basis: dissolved gas diffusion in aquatic/atmospheric environments.
    // O2 produced by photosynthesis, consumed by aerobic respiration.
    // CO2 produced by respiration, consumed by photosynthesis.
    this.gasW = Math.ceil(this.w / 4)
    this.gasH = Math.ceil(this.h / 4)
    this.o2Grid = new Float32Array(this.gasW * this.gasH)
    this.co2Grid = new Float32Array(this.gasW * this.gasH)
    // Initialize O2 at ambient level, CO2 low
    for (let i = 0; i < this.gasW * this.gasH; i++) {
      this.o2Grid[i] = 0.8
      this.co2Grid[i] = 0.2
    }

    this.cells = []
    this.links = []
    this.deathEvents = []
    this.birthEvents = []
    this.eatEvents = []

    this.cladeRegistry = new Map()
    this.foodChain = new Map()

    // Phylogenetic tree: clade → { parentClade, founderGenome, birthTick, extinctTick, depth }
    // Every clade traces back to its single-cell ancestor (parentClade === null for root clades)
    this.phyloTree = new Map()

    // ── Shelter grid — 1/4 resolution for performance ──
    // Shelter accumulates from dead organisms, biome growth, and structural deposits.
    // Organisms near shelter get predation protection and reduced current drag.
    // Scientific basis: reef structures, kelp holdfasts, tube worm colonies all
    // provide physical refuge from predation and environmental stress.
    this.shelterW = Math.ceil(this.w / 4)
    this.shelterH = Math.ceil(this.h / 4)
    this.shelterGrid = new Float32Array(this.shelterW * this.shelterH)

    // ── Alarm pheromone grid — same resolution as shelter ──
    // Scientific basis: many fish (Ostariophysi) release Schreckstoff (alarm substance)
    // from damaged skin cells. Nearby conspecifics detect it and flee. Ants release
    // alarm pheromones that trigger fight-or-flight in nestmates. Even coral larvae
    // avoid settlement near damaged conspecifics.
    // Decays quickly (~50 ticks half-life) — transient danger signal.
    this.alarmGrid = new Float32Array(this.shelterW * this.shelterH)

    // ── Terrain objects — static biome features for visual + gameplay ──
    // Each object: { x, y, type, size, biome, age, hue, seed }
    // Types: 'kelp_stalk', 'coral_head', 'coral_fan', 'vent_chimney',
    //        'tube_cluster', 'rock', 'anemone', 'sponge', 'seagrass_patch'
    this.terrainObjects = []

    // Generate random biomes each reset for variety
    this.cfg.biomes = _generateBiomes(this.rng, this.w)

    this._generateWorldBlob()
    this._buildBlobMask()
    this._generateBarriers()
    this._generateTerrain()

    this.season = 0
    this.seasonTick = 0
    this._initGradient()
    this._initSun()

    this.camera = { x: this.w / 2, y: this.h / 2, zoom: 1 }

    // Gene overrides: { traitName: { mode: 'knockout'|'freeze', value: number } }
    // knockout = force to 0, freeze = force to specific value
    if (!this.geneOverrides) this.geneOverrides = {}

    this._nextId = 1
    this._nextClade = 1

    // Spread initial clades across the world — each species starts in its own region
    // Scientific basis: allopatric speciation — geographic separation drives divergence.
    // Initial organisms are placed at evenly-spaced positions around the habitable area.
    const spawnN = this.cfg.spawn.n
    const cx = this.blobCenter ? this.blobCenter.x : this.w / 2
    const cy = this.blobCenter ? this.blobCenter.y : this.h / 2
    const spawnRadius = (this.blobBaseR || Math.min(this.w, this.h) * 0.35) * 0.6

    // Clonal start: create one template cell, then clone its genome for all others.
    // Scientific basis: isogenic populations allow measuring divergence rate from
    // a known starting point, isolating the effect of mutation + selection.
    let clonalTemplate = null
    if (this.cfg.clonalStart) {
      clonalTemplate = this._makeCell({ x: 0, y: 0, energy: this.cfg.spawn.energy })
    }

    for (let i = 0; i < spawnN; i++) {
      const clade = this._nextClade++
      // Place each clade at a different angular position around the world center
      const angle = (i / spawnN) * Math.PI * 2 + this.rng() * 0.3
      const dist = spawnRadius * (0.3 + this.rng() * 0.7)
      let sx = cx + Math.cos(angle) * dist
      let sy = cy + Math.sin(angle) * dist
      // Clamp to world and verify inside blob
      for (let attempt = 0; attempt < 30; attempt++) {
        if (this.isInsideBlob(sx, sy) && !this.isInsideBarrier(sx, sy)) break
        sx = cx + Math.cos(angle + this.rng() * 0.5) * dist * (0.5 + this.rng() * 0.5)
        sy = cy + Math.sin(angle + this.rng() * 0.5) * dist * (0.5 + this.rng() * 0.5)
      }

      let cell
      if (clonalTemplate) {
        // Clone the template genome + DNA strand
        const clonedGenome = { ...clonalTemplate.g }
        const clonedDna = clonalTemplate.dna ? new Float32Array(clonalTemplate.dna) : null
        cell = this._makeCell({
          x: sx,
          y: sy,
          energy: this.cfg.spawn.energy,
          clade,
          genome: clonedGenome,
          dnaStrand: clonedDna
        })
      } else {
        cell = this._makeCell({ x: sx, y: sy, energy: this.cfg.spawn.energy, clade })
      }

      this.cells.push(cell)
      this._registerClade(clade, 0.0)
      // Root clade in phylogenetic tree — single-cell ancestor
      this.phyloTree.set(clade, {
        parentClade: null,
        founderGenome: { ...cell.g },
        birthTick: 0,
        extinctTick: null,
        depth: 0,
        children: []
      })
    }

    // Seed initial food — sparse base with scattered rich patches
    // Cells must forage to find food before they can accumulate enough energy to divide
    for (let i = 0; i < this.w * this.h; i++) {
      this.food[i] = randRange(this.rng, 0.1, 0.5)
    }
    // Add food patches scattered around the blob (fewer, less dense)
    for (let k = 0; k < 30; k++) {
      const pt = this._randomBlobInteriorPoint()
      const r = 6 + ((this.rng() * 8) | 0)
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue
          const ix = wrap((pt.x + dx) | 0, this.w)
          const iy = wrap((pt.y + dy) | 0, this.h)
          this.food[ix + iy * this.w] += randRange(this.rng, 0.5, 2.0)
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
    seeds: c.seeds ? c.seeds.map((s) => ({ ...s })) : undefined,
    dna: c.dna ? f32ToArr(c.dna) : null
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
    blobBaseRx: this.blobBaseRx,
    blobBaseRy: this.blobBaseRy,
    blobPoints: this.blobPoints,
    blobHarmonics: this.blobHarmonics,
    barriers: this.barriers,
    gradientPeaks: this.gradientPeaks,
    cells,
    links,
    cladeRegistry,
    foodChain,
    phyloTree: [...this.phyloTree.entries()],
    gasW: this.gasW,
    gasH: this.gasH,
    o2Grid: f32ToArr(this.o2Grid),
    co2Grid: f32ToArr(this.co2Grid)
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

  // Restore gas grids (backward compat: create fresh if missing)
  this.gasW = state.gasW || Math.ceil(this.w / 4)
  this.gasH = state.gasH || Math.ceil(this.h / 4)
  if (state.o2Grid) {
    this.o2Grid = new Float32Array(state.o2Grid)
    this.co2Grid = new Float32Array(state.co2Grid)
  } else {
    this.o2Grid = new Float32Array(this.gasW * this.gasH)
    this.co2Grid = new Float32Array(this.gasW * this.gasH)
    for (let i = 0; i < this.gasW * this.gasH; i++) {
      this.o2Grid[i] = 0.8
      this.co2Grid[i] = 0.2
    }
  }

  // Restore world geometry
  this.blobCenter = state.blobCenter
  this.blobBaseR = state.blobBaseR
  this.blobBaseRx = state.blobBaseRx || state.blobBaseR
  this.blobBaseRy = state.blobBaseRy || state.blobBaseR
  this.blobPoints = state.blobPoints
  this.blobHarmonics = state.blobHarmonics
  this.barriers = state.barriers
  this.gradientPeaks = state.gradientPeaks
  this._buildBlobMask()

  // Restore cells
  this.cells = state.cells.map((c) => {
    const cell = { ...c }
    cell.g = { ...c.g }
    cell.organelles = new Float32Array(c.organelles)
    cell.persistDir = { ...c.persistDir }
    cell.chemoVec = { ...c.chemoVec }
    cell.engulfTarget = null
    cell.seeds = c.seeds ? c.seeds.map((s) => ({ ...s })) : undefined
    // Restore DNA strand (backward compat: old saves have no dna field)
    cell.dna = c.dna ? new Float32Array(c.dna) : null
    return cell
  })

  // Restore links
  this.links = state.links.map((l) => ({ ...l }))

  // Restore maps
  this.cladeRegistry = new Map(state.cladeRegistry)
  this.foodChain = new Map(state.foodChain)
  this.phyloTree = state.phyloTree ? new Map(state.phyloTree) : new Map()

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
