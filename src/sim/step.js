import { randNorm, randRange } from '../rng.js'
import { torusDelta } from './helpers.js'
import {
  ORGANELLE_RECEPTOR,
  ORGANELLE_MITOCHONDRIA,
  ORGANELLE_FLAGELLUM,
  ORGANELLE_VACUOLE,
  ORGANELLE_COUNT,
  ROLE_NONE,
  ROLE_EDGE,
  ROLE_INTERIOR,
  ROLE_PIONEER,
  FOOD_PLANT,
  FOOD_MINERAL,
  FOOD_MEAT
} from './constants.js'
import { batch_food_sense, gas_grid_diffuse, batch_neighbor_forces } from '../../pkg/evoio_wasm.js'

// Reusable object for _computeChemotaxis return — avoids per-cell GC allocation
const _chemoResult = { cx: 0, cy: 0, strength: 0 }
// Flat direction arrays for chemotaxis: [dx0..dx7, dy0..dy7]
const _chemoDirs = [1, -1, 0, 0, 1, -1, 1, -1, 0, 0, 1, -1, 1, 1, -1, -1]

export function installStep(Sim, getWasmReady) {
  const P = Sim.prototype

  P._updatePersistence = function (c) {
    c.persistTimer++
    if (c.persistTimer >= this.cfg.persistenceInterval) {
      c.persistTimer = 0
      const v = Math.sqrt(c.vx * c.vx + c.vy * c.vy)
      if (v > 0.001) {
        c.persistDir.x = c.vx / v
        c.persistDir.y = c.vy / v
      }
    }
  }

  P._computeChemotaxis = function (c) {
    const sense = c.g.sense * (1 + c.organelles[ORGANELLE_RECEPTOR] * 1.5)
    const senseRadius = sense * 2.2
    let sumGx = 0,
      sumGy = 0,
      sumG = 0
    const here = this._sampleGradient(c.x, c.y)
    for (let di = 0; di < 8; di++) {
      const dx = _chemoDirs[di],
        dy = _chemoDirs[di + 8]
      const g = this._sampleGradient(c.x + dx * senseRadius, c.y + dy * senseRadius)
      if (g > here) {
        sumGx += dx * (g - here)
        sumGy += dy * (g - here)
      }
      sumG += g
    }
    const len = Math.sqrt(sumGx * sumGx + sumGy * sumGy) || 1
    c.chemoVec.x = sumGx / len
    c.chemoVec.y = sumGy / len
    _chemoResult.cx = c.chemoVec.x
    _chemoResult.cy = c.chemoVec.y
    _chemoResult.strength = sumG * 0.125
    return _chemoResult
  }

  // Find a compatible mate for sexual reproduction
  // Requirements: same clade, within mating range, not the same cell,
  // from a different organism (not directly linked), has sufficient energy
  P._findMate = function (idx, spatial) {
    const c = this.cells[idx]
    const { grid, gw, gh } = spatial
    const mateRange = this.cfg.linkDist * 5 // generous search range
    const mateRangeSq = mateRange * mateRange
    const minMateEnergy = c.g.division * 0.2 // mate just needs to not be starving

    let bx = Math.floor((c.x / this.w) * gw)
    let by = Math.floor((c.y / this.h) * gh)
    if (!(bx >= 0 && bx < gw)) bx = 0
    if (!(by >= 0 && by < gh)) by = 0

    let bestJ = -1
    let bestD2 = Infinity

    // Search wider neighborhood to cover the larger mate range
    const searchR = 2
    for (let oy = -searchR; oy <= searchR; oy++) {
      for (let ox = -searchR; ox <= searchR; ox++) {
        const gx = (((bx + ox) % gw) + gw) % gw
        const gy = (((by + oy) % gh) + gh) % gh
        const bucket = grid[gx + gy * gw]
        for (let k = 0; k < bucket.length; k++) {
          const j = bucket[k]
          if (j === idx) continue
          const o = this.cells[j]
          // Must be same species
          if (o.clade !== c.clade) continue
          // Must have enough energy (not starving)
          if (o.energy < minMateEnergy) continue
          // Must be within mating range
          const dx = torusDelta(c.x - o.x, this.w)
          const dy = torusDelta(c.y - o.y, this.h)
          const d2 = dx * dx + dy * dy
          if (d2 > mateRangeSq) continue
          // Outbreeding preference: prefer mates from different organisms
          // Cheap heuristic: if both have links and are very close, likely same organism
          const likelySameOrg =
            c.linkCount > 0 && o.linkCount > 0 && d2 < this.cfg.linkDist * this.cfg.linkDist
          const penalty = likelySameOrg ? d2 * 3 : d2
          if (penalty < bestD2) {
            bestD2 = penalty
            bestJ = j
          }
        }
      }
    }
    return bestJ >= 0 ? bestJ : null
  }

  // Periodic environmental stress events that favor multicellular life.
  // Solitary cells take full damage; organisms are buffered by size/complexity.
  P._environmentalStress = function (era) {
    const severity = 0.15 + era * 0.2 // scales with era: 0.15 early, up to 0.55 late
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      // Buffer: organism size and complexity reduce stress damage
      const sizeBuffer = Math.min(0.8, c.organismSize * 0.08)
      const complexBuffer = Math.min(0.3, (c.complexity || 0) * 0.05)
      const membraneBuffer = (c.g.membrane || 0) * 0.15
      const toughnessBuffer = (c.g.toughness || 0) * 0.2
      const totalBuffer = Math.min(0.9, sizeBuffer + complexBuffer + membraneBuffer + toughnessBuffer)
      const damage = severity * (1 - totalBuffer)
      c.energy -= c.energy * damage
    }
  }

  // Density-dependent crowding stress (logistic growth / Verhulst model).
  // Returns a per-cell crowding penalty based on local neighbor count.
  // Scientific basis: intraspecific competition — cells in crowded areas
  // compete for the same resources, increasing effective metabolism.
  P._localDensity = function (c, spatial) {
    const { grid, gw, gh } = spatial
    let bx = Math.floor((c.x / this.w) * gw)
    let by = Math.floor((c.y / this.h) * gh)
    if (!(bx >= 0 && bx < gw)) bx = 0
    if (!(by >= 0 && by < gh)) by = 0
    let count = 0
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = (((bx + ox) % gw) + gw) % gw
        const gy = (((by + oy) % gh) + gh) % gh
        count += grid[gx + gy * gw].length
      }
    }
    return count
  }

  P.step = function () {
    const _st = performance.now()
    let _sl = _st
    const _sp = {}
    const _sm = (name) => {
      const _n = performance.now()
      _sp[name] = +(_n - _sl).toFixed(3)
      _sl = _n
    }

    this.t += 1
    this.seasonTick++

    if (this.seasonTick >= this.cfg.seasonLength) {
      this._shiftSeason()
    }

    // ── Sun / Day-Night cycle ──
    this._updateSun()

    // ── Environmental escalation ──
    // The world gets progressively harder, favoring complex multicellular life.
    // era ramps from 0 to ~1.0 over the first ~15000 ticks, then slowly beyond
    const era = Math.min(2.0, this.t / 12000)
    // Harshness: increases base metabolism cost for ALL cells, but organisms get a discount
    const envHarshness = 1.0 + era * 0.35
    // Food scarcity: food growth effectiveness slowly decreases
    const foodScarcity = Math.max(0.55, 1.0 - era * 0.18)

    // Periodic environmental stress events (~every 2500 ticks after tick 1500)
    if (this.t > 1500 && this.t % 2500 === 0) {
      this._environmentalStress(era)
    }

    const popNow = this.cells.length
    // World area scale factor: at 5x world size, area is 25x, so strides scale up
    // Reference area: 1920*960 = 1,843,200 pixels
    const _worldArea = this.w * this.h
    const _areaScale = Math.max(1, Math.round(_worldArea / 1843200))
    const envStride = (popNow > 4000 ? 8 : popNow > 2500 ? 4 : popNow > 1200 ? 2 : 1) * _areaScale

    if (this.t % envStride === 0) this._growFood(envStride, foodScarcity, this.sunIntensity)
    if (this.t % (2 * envStride) === 0) this._diffuseStep()
    if (this.t % (4 * _areaScale) === 0) this._growMinerals()
    if (this.t % 4 === 0) this._depositSeeds()
    if (this.t % (4 * _areaScale) === 0) this._driftFood()
    if (this.t % (8 * _areaScale) === 0) this._decayMeat()
    if (this.t % (8 * _areaScale) === 0) this._growShelter()
    if (this.t % (2 * _areaScale) === 0) this._decayAlarm()
    const _cladeStatsStride = popNow > 8000 ? 64 : popNow > 4000 ? 32 : 16
    if (this.t % _cladeStatsStride === 0) this._updateCladeStats()

    // ── Gas grid diffusion & ambient replenishment ──
    const gasStride = (popNow > 3000 ? 16 : 8) * _areaScale
    if (this.t % gasStride === 0) {
      const gw = this.gasW,
        gh = this.gasH
      if (getWasmReady()) {
        // WASM path: offload entire gas diffusion + replenishment to Rust
        gas_grid_diffuse(
          this.o2Grid,
          this.co2Grid,
          gw,
          gh,
          0.15, // o2 diffusion rate
          0.15, // co2 diffusion rate
          0.8, // ambient O2 target
          0.004, // ambient replenish rate (~0.003 equivalent)
          0.003 // co2 decay rate (~0.002 equivalent)
        )
      } else {
        // JS fallback
        const o2 = this.o2Grid,
          co2 = this.co2Grid
        const parity = (this.t >> 3) & 1
        for (let y = 0; y < gh; y++) {
          for (let x = parity; x < gw; x += 2) {
            const idx = x + y * gw
            let sumO2 = o2[idx] * 4,
              sumCO2 = co2[idx] * 4,
              n = 4
            if (x > 0) {
              sumO2 += o2[idx - 1]
              sumCO2 += co2[idx - 1]
              n++
            }
            if (x < gw - 1) {
              sumO2 += o2[idx + 1]
              sumCO2 += co2[idx + 1]
              n++
            }
            if (y > 0) {
              sumO2 += o2[idx - gw]
              sumCO2 += co2[idx - gw]
              n++
            }
            if (y < gh - 1) {
              sumO2 += o2[idx + gw]
              sumCO2 += co2[idx + gw]
              n++
            }
            o2[idx] = sumO2 / n
            co2[idx] = sumCO2 / n
          }
        }
        for (let i = 0; i < gw * gh; i++) {
          o2[i] = Math.min(1.5, o2[i] + 0.003)
          co2[i] = Math.max(0, co2[i] - 0.002)
        }
      }
    }
    _sm('environment')

    const predStride =
      popNow > 8000 ? 6 : popNow > 5000 ? 5 : popNow > 3000 ? 4 : popNow > 1500 ? 3 : popNow > 800 ? 2 : 1

    const maxOrganisms = this.cfg.maxOrganisms | 0
    const orgCount = this.organismCount || this.cells.length

    const spatial = this._buildSpatialIndex()
    _sm('spatial')
    if (this.t % 8 === 0) {
      this._assignRoles(spatial)
    }

    const startCount = this.cells.length
    this.birthEvents = []
    this.eatEvents = []
    this.mateEvents = []

    // WASM batch food sensing
    let foodSenseResult = null
    if (getWasmReady() && startCount > 0) {
      if (!this._wasmBufs || this._wasmBufs.len < startCount) {
        const n = Math.max(startCount, 256)
        this._wasmBufs = {
          len: n,
          cx: new Float32Array(n),
          cy: new Float32Array(n),
          cs: new Float32Array(n),
          cd: new Float32Array(n),
          out: new Float32Array(n * 3)
        }
      }
      const b = this._wasmBufs
      for (let i = 0; i < startCount; i++) {
        const c = this.cells[i]
        const recBonus = c.organelles[ORGANELLE_RECEPTOR]
        b.cx[i] = c.x
        b.cy[i] = c.y
        b.cs[i] = c.g.sense * (1 + recBonus * 1.2)
        b.cd[i] = c.g.diet
      }
      const useFull = startCount < 800 ? 1 : 0
      foodSenseResult = batch_food_sense(
        b.cx.subarray(0, startCount),
        b.cy.subarray(0, startCount),
        b.cs.subarray(0, startCount),
        b.cd.subarray(0, startCount),
        this.food,
        this.mineralFood,
        this.meatFood,
        this.w,
        this.h,
        useFull,
        b.out.subarray(0, startCount * 3)
      )
    }

    _sm('foodSense')

    // Hoist stride computations out of per-cell loop
    const orgStride =
      startCount > 10000
        ? 8
        : startCount > 6000
          ? 6
          : startCount > 4000
            ? 4
            : startCount > 3000
              ? 3
              : startCount > 600
                ? 2
                : 1
    const _flockStride =
      startCount > 12000
        ? 20
        : startCount > 8000
          ? 16
          : startCount > 6000
            ? 12
            : startCount > 4000
              ? 8
              : startCount > 3000
                ? 6
                : startCount > 2000
                  ? 5
                  : startCount > 1500
                    ? 4
                    : startCount > 800
                      ? 3
                      : startCount < 400
                        ? 1
                        : 2
    const _predStride2 =
      startCount > 12000
        ? 16
        : startCount > 8000
          ? 12
          : startCount > 6000
            ? 10
            : startCount > 4000
              ? 8
              : startCount > 3000
                ? 6
                : startCount > 2000
                  ? 5
                  : startCount > 1500
                    ? 4
                    : 3
    const _chemoStride =
      startCount > 6000
        ? 12
        : startCount > 4000
          ? 10
          : startCount > 3000
            ? 8
            : startCount > 2000
              ? 6
              : startCount > 1200
                ? 5
                : startCount > 600
                  ? 4
                  : 3
    const _alarmStride =
      startCount > 6000 ? 16 : startCount > 3000 ? 12 : startCount > 2000 ? 8 : startCount > 1000 ? 6 : 3
    const _symbStride = startCount > 6000 ? 20 : startCount > 3000 ? 16 : startCount > 2000 ? 12 : 6
    const _tick = this.t

    // Hoist sunlight trig outside cell loop (was recomputed per _sampleSunlight call)
    const _sunCos = Math.cos(this.sunAngle)
    const _sunSin = Math.sin(this.sunAngle)
    const _sunIntensity = this.sunIntensity
    const _wcx = this.w * 0.5
    const _wcy = this.h * 0.5
    const _invHalfW = 1.0 / _wcx
    const _invHalfH = 1.0 / _wcy

    // Hoist biome array outside cell loop
    const _biomes = this.cfg.biomes
    const _numBiomes = _biomes ? _biomes.length : 0
    const _biomeRegionW = _numBiomes > 0 ? this.w / _numBiomes : this.w

    // Hoist world dims
    const _w = this.w
    const _h = this.h

    // ── Cell loop sub-timing accumulators ──
    // Sample every 16th cell to keep overhead low (~0.25ms at 20K cells).
    // Uses running _cl_t0 that carries across phases so no time leaks.
    const _CL_SAMPLE = 16
    let _cl_moveT = 0,
      _cl_feedT = 0,
      _cl_metabT = 0,
      _cl_lifeT = 0
    let _cl_t0 = performance.now()

    // Hoist spatial grid outside cell loop — avoids destructuring per flocking/predAI block
    const _sgrid = spatial.grid,
      _sgw = spatial.gw,
      _sgh = spatial.gh
    const _halfW = _w * 0.5,
      _halfH = _h * 0.5
    const _persistInterval = this.cfg.persistenceInterval
    const _contactInhibition = this.cfg.contactInhibition
    const _baseMove = this.cfg.baseMove
    const _gradientWeight = this.cfg.gradientWeight
    const _persistStr = this.cfg.persistenceStrength
    const _moveWander = this.cfg.moveWander
    const _metabolismBase = this.cfg.metabolismBase
    const _dt = this.cfg.dt
    const _gasW = this.gasW
    const _gasH = this.gasH
    const _gasWm1 = _gasW - 1
    const _gasHm1 = _gasH - 1
    const _o2Grid = this.o2Grid
    const _co2Grid = this.co2Grid
    const _gPeaks = this.gradientPeaks || [this.gradientPeak]
    const _nGPeaks = _gPeaks.length
    const _uptake = this.cfg.uptake
    const _meatDropEnergy = this.cfg.meatDropEnergy
    const _splitWorld = this.splitWorld || null
    const _gasTickStride = startCount > 3000 ? 8 : startCount > 2000 ? 6 : 4
    const _densStride = startCount > 2000 ? 12 : 8

    // ── WASM batch neighbor forces (flocking + predator-prey in one pass) ──
    // Replaces two separate JS spatial grid scans with a single compiled Rust pass.
    let _nbrOut = null // Float32Array, 8 floats per cell
    const _useWasmNbr = getWasmReady() && startCount > 200
    if (_useWasmNbr) {
      try {
        // Build flat spatial grid for WASM: bucket_offsets, bucket_sizes, flat_grid
        const _nBuckets = _sgw * _sgh
        // Reuse/grow buffers
        if (!this._nbrBufs || this._nbrBufs.nBuckets < _nBuckets || this._nbrBufs.nCells < startCount) {
          const nb = Math.max(_nBuckets, 256)
          const nc = Math.max(startCount, 512)
          this._nbrBufs = {
            nBuckets: nb,
            nCells: nc,
            offsets: new Float32Array(nb),
            sizes: new Float32Array(nb),
            flatGrid: new Float32Array(nc + 256),
            cx: new Float32Array(nc),
            cy: new Float32Array(nc),
            cvx: new Float32Array(nc),
            cvy: new Float32Array(nc),
            clade: new Float32Array(nc),
            diet: new Float32Array(nc),
            energy: new Float32Array(nc),
            sense: new Float32Array(nc),
            social: new Float32Array(nc),
            speed: new Float32Array(nc),
            flags: new Float32Array(nc)
          }
        }
        const nb = this._nbrBufs
        // Fill bucket offsets/sizes from spatial grid
        let flatIdx = 0
        for (let bi = 0; bi < _nBuckets; bi++) {
          const bucket = _sgrid[bi]
          nb.offsets[bi] = flatIdx
          nb.sizes[bi] = bucket ? bucket.length : 0
          if (bucket) {
            // Grow flatGrid if needed
            if (flatIdx + bucket.length > nb.flatGrid.length) {
              const newFG = new Float32Array((flatIdx + bucket.length) * 2)
              newFG.set(nb.flatGrid)
              nb.flatGrid = newFG
            }
            for (let k = 0; k < bucket.length; k++) {
              nb.flatGrid[flatIdx++] = bucket[k]
            }
          }
        }
        // Fill per-cell data arrays
        const popScale = startCount > 3000 ? 0.55 : startCount > 2000 ? 0.7 : startCount > 1500 ? 0.85 : 1.0
        for (let i = 0; i < startCount; i++) {
          const c = this.cells[i]
          nb.cx[i] = c.x
          nb.cy[i] = c.y
          nb.cvx[i] = c.vx
          nb.cvy[i] = c.vy
          nb.clade[i] = c.clade
          nb.diet[i] = c.g.diet
          nb.energy[i] = c.energy
          const recBonus = c.organelles[ORGANELLE_RECEPTOR]
          const eyeB = (c.g.eyespot || 0) > 0.1 ? 1.0 + (c.g.eyespot || 0) : 1.0
          nb.sense[i] = c.g.sense * (1 + recBonus * 1.2) * eyeB
          const epiSocial = ((c.g.epiMarks || {}).socialPriming || 0) * 0.2
          const sigBoost = (c.g.signaling || 0) * 0.15
          nb.social[i] = Math.min(1, (c.g.sociality ?? 0.3) + epiSocial + sigBoost)
          const flagBonus = c.organelles[ORGANELLE_FLAGELLUM]
          nb.speed[i] = c.g.speed * (1 + flagBonus * 0.8)
          // Flags: bit0=do_flock, bit1=do_pred
          let fl = 0
          if ((i + _tick) % _flockStride === 0) fl |= 1
          if ((i + _tick) % _predStride2 === 0 && startCount > 5) fl |= 2
          nb.flags[i] = fl
        }
        const sr = startCount > 2000 ? 1 : 2
        // Allocate fresh output buffer each call (wasm-bindgen detaches by-value Float32Array)
        const _nbrOutBuf = new Float32Array(startCount * 8)
        _nbrOut = batch_neighbor_forces(
          nb.cx.subarray(0, startCount),
          nb.cy.subarray(0, startCount),
          nb.cvx.subarray(0, startCount),
          nb.cvy.subarray(0, startCount),
          nb.clade.subarray(0, startCount),
          nb.diet.subarray(0, startCount),
          nb.energy.subarray(0, startCount),
          nb.sense.subarray(0, startCount),
          nb.social.subarray(0, startCount),
          nb.speed.subarray(0, startCount),
          nb.flags.subarray(0, startCount),
          nb.flatGrid.subarray(0, flatIdx),
          nb.offsets.subarray(0, _nBuckets),
          nb.sizes.subarray(0, _nBuckets),
          _sgw,
          _sgh,
          _w,
          _h,
          popScale,
          sr,
          _nbrOutBuf
        )
      } catch (e) {
        // WASM failed — fall back to JS path
        if (!this._nbrWarnShown) {
          console.warn('batch_neighbor_forces WASM failed, using JS fallback:', e)
          this._nbrWarnShown = true
        }
        _nbrOut = null
      }
    }

    // ── Migratory trig LUT: precompute cos/sin for 256 angle slots ──
    if (!this._migrLUT) {
      const LUT_N = 256
      this._migrLUT = { cos: new Float32Array(LUT_N), sin: new Float32Array(LUT_N) }
      for (let i = 0; i < LUT_N; i++) {
        const a = (i / LUT_N) * Math.PI * 2
        this._migrLUT.cos[i] = Math.cos(a)
        this._migrLUT.sin[i] = Math.sin(a)
      }
    }
    const _migrCos = this._migrLUT.cos
    const _migrSin = this._migrLUT.sin
    const _migrN = 256

    for (let i = 0; i < startCount; i++) {
      const c = this.cells[i]
      c.age++
      c.membranePhase += 0.03 + 0.02 * c.g.speed

      if ((i + _tick) % orgStride === 0) this._developOrganelles(c)

      // Guard against NaN organelles — only check every 16 ticks to reduce overhead
      if ((c.age & 15) === 0) {
        for (let _oi = 0; _oi < ORGANELLE_COUNT; _oi++) {
          if (!isFinite(c.organelles[_oi])) c.organelles[_oi] = 0
        }
      }

      if (c.age % 16 === 0) {
        let orgSum = 0
        for (let oi = 0; oi < ORGANELLE_COUNT; oi++) orgSum += c.organelles[oi]
        const orgBonus = orgSum * 0.006
        const linkBonus = c.linkCount * 0.005
        const roleBonus = c.role !== ROLE_NONE ? 0.004 : 0
        const morphBonus =
          (c.g.flipper +
            c.g.membrane +
            c.g.cilia +
            c.g.spines +
            (c.g.elongation || 0) +
            (c.g.biolum || 0) +
            (c.g.vesicles || 0)) *
          0.002
        // Genome architecture contributes to complexity
        const regBonus = (c.g.regulatoryComplexity || 0) * 0.008
        const genomeSizeBonus = Math.max(0, (c.g.genomeSize || 1) - 1) * 0.003
        const ploidyBonus = ((c.g.ploidy || 1) - 1) * 0.005
        c.complexity = Math.min(
          c.complexity +
            orgBonus +
            linkBonus +
            roleBonus +
            morphBonus +
            regBonus +
            genomeSizeBonus +
            ploidyBonus,
          10.0
        )
      }

      const mitoBonus = c.organelles[ORGANELLE_MITOCHONDRIA]
      const flagBonus = c.organelles[ORGANELLE_FLAGELLUM]
      const recBonus = c.organelles[ORGANELLE_RECEPTOR]
      const vacBonus = c.organelles[ORGANELLE_VACUOLE]

      // ── Developmental timing (heterochrony) ──
      // Traits develop gradually based on age and growthRate gene.
      // devTiming controls maturation schedule: low = precocial (early), high = altricial (late).
      // Scientific basis: Gould 1977 — heterochronic shifts drive major evolutionary transitions.
      const devTime = c.g.devTiming || 0.5
      const gRate = c.g.growthRate || 0.5
      const maturity = Math.min(1.0, (c.age / (80 + devTime * 200)) * (0.5 + gRate))
      // Phenotypic plasticity: environment modulates effective gene expression
      // Scientific basis: West-Eberhard 2003 — developmental plasticity and evolution.
      const plast = c.g.plasticity || 0.15
      const localFood = c._cachedDensity !== undefined ? 1.0 : 1.0 // placeholder for env signal
      // Plasticity allows partial compensation for poor genes in good environments
      const plasticMod = 1.0 + plast * 0.1 * (localFood - 0.5)

      // Ploidy: diploid/polyploid organisms have gene redundancy (masking deleterious alleles)
      // Scientific basis: Crow & Kimura — diploid advantage via heterozygosity.
      const ploidyMask = Math.min(0.3, ((c.g.ploidy || 1) - 1) * 0.15)

      // Regulatory complexity: better gene regulation = more efficient phenotype expression
      // Scientific basis: Carroll 2005 — cis-regulatory evolution drives morphological
      // diversity. More regulatory elements = finer control over gene expression timing,
      // tissue specificity, and dosage. This is the key difference between complex and
      // simple organisms (humans and nematodes have similar gene counts but vastly
      // different regulatory complexity).
      const regBoost = 1.0 + (c.g.regulatoryComplexity || 0) * 0.25

      // Eyespot: doubles effective sense range (stigma/photoreceptor)
      const eyespotBonus = (c.g.eyespot || 0) > 0.1 ? 1.0 + (c.g.eyespot || 0) * 1.0 : 1.0
      const sense = c.g.sense * (1 + recBonus * 1.2) * eyespotBonus * maturity * regBoost
      const speed = c.g.speed * (1 + flagBonus * 0.8) * (0.7 + maturity * 0.3)
      const metabolism = c.g.metabolism * (1 - mitoBonus * 0.35) * plasticMod
      // Ploidy masks some drift load damage
      const effectiveDriftLoad = Math.max(0, (c.g.driftLoad || 0) - ploidyMask)
      const divisionThreshold = c.g.division * (1 - vacBonus * 0.15)

      const flagellaBoost = c.g.flagella * 0.8
      const ciliaBoost = c.g.cilia * 0.4
      const amoeboidBoost = c.g.amoeboid * 0.3
      const flipperBoost = c.g.flipper * 0.6
      const paddleFinBoost = (c.g.paddleFin || 0) * 0.7
      const membraneDrag = c.g.membrane * 0.15
      const elongDrag = (c.g.elongation || 0) * 0.08
      const bodySizeDrag = Math.max(0, (c.g.bodyScale || 1) - 1) * 0.03
      const spinesCost = c.g.spines * 0.002
      const camoEnergyCost = c.g.camouflage * 0.001
      if (c.jetCooldown > 0) c.jetCooldown--
      if (c.toxinTimer > 0) c.toxinTimer--

      // Cache velocity magnitude — used 5+ times per cell
      const _cvx = c.vx,
        _cvy = c.vy
      const _vLenSq = _cvx * _cvx + _cvy * _cvy
      const _vLen = _vLenSq > 0.000001 ? Math.sqrt(_vLenSq) : 0.001

      // Inlined _updatePersistence — reuses cached _vLen instead of recomputing sqrt
      if (++c.persistTimer >= _persistInterval) {
        c.persistTimer = 0
        if (_vLen > 0.001) {
          c.persistDir.x = _cvx / _vLen
          c.persistDir.y = _cvy / _vLen
        }
      }

      const skipChemo = startCount > 400 && (i + _tick) % _chemoStride !== 0
      if (skipChemo) {
        _chemoResult.cx = c.chemoVec.x
        _chemoResult.cy = c.chemoVec.y
        _chemoResult.strength = 0
      } else {
        this._computeChemotaxis(c)
      }
      const chemo = _chemoResult

      const herbivoreAff = 1 - c.g.diet
      const carnivoreAff = c.g.diet
      let bfx, bfy
      if (foodSenseResult) {
        const oi = i * 3
        bfx = foodSenseResult[oi]
        bfy = foodSenseResult[oi + 1]
      } else {
        const senseR = sense * 2.2
        // Diet-specific foraging strategy:
        // Herbivores (diet<0.3): wide 8-dir plant search, ignore meat
        // Carnivores (diet>0.7): focused meat tracking, ignore plants
        // Omnivores (0.3-0.7): dynamically weight based on local abundance
        const isHerb = c.g.diet < 0.3
        const isCarn = c.g.diet > 0.7
        const plantW = isHerb ? 1.5 : isCarn ? 0.1 : herbivoreAff
        const meatW = isCarn ? 2.5 : isHerb ? 0.1 : carnivoreAff * 2.0

        let bestFoodVal = this._sampleFood(c.x, c.y) * plantW + this._sampleMeat(c.x, c.y) * meatW
        bfx = 0
        bfy = 0
        // Herbivores search wider (8 dirs) — they graze broadly
        // Carnivores search focused (4 dirs) — they track specific targets
        const dirs8 = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [-1, 1],
          [1, -1],
          [-1, -1]
        ]
        const dirCount = isHerb ? 8 : 4
        for (let di = 0; di < dirCount; di++) {
          const ddx = dirs8[di][0],
            ddy = dirs8[di][1]
          const dLen = Math.sqrt(ddx * ddx + ddy * ddy)
          const sx = c.x + (ddx / dLen) * senseR
          const sy = c.y + (ddy / dLen) * senseR
          const fv = this._sampleFood(sx, sy) * plantW + this._sampleMeat(sx, sy) * meatW
          if (fv > bestFoodVal) {
            bestFoodVal = fv
            bfx = ddx / dLen
            bfy = ddy / dLen
          }
        }
      }

      // Shell: heavy armor slows movement significantly
      const shellDrag = (c.g.shell || 0) * 0.3
      // Stalk: anchored cells barely move
      const stalkDrag = (c.g.stalk || 0) * 0.7
      const moveAmt =
        _baseMove * speed * (1 - membraneDrag - elongDrag - bodySizeDrag - shellDrag - stalkDrag)
      // Cilia: maneuverability — ciliated cells turn faster (reduced persistence lock)
      const ciliaAgility = c.g.cilia > 0.15 ? 1.0 - c.g.cilia * 0.4 : 1.0
      const persist = c.g.persistence * _persistStr * ciliaAgility

      const cilFactor =
        c.contactCount > 0 ? Math.max(0.5, 1 - _contactInhibition * Math.min(c.contactCount, 4)) : 1.0

      let roleSpeedMod = 1.0
      if (c.role === ROLE_PIONEER) roleSpeedMod = 1.3
      else if (c.role === ROLE_INTERIOR) roleSpeedMod = 0.75
      else if (c.role === ROLE_EDGE) roleSpeedMod = 1.1

      const bold = c.g.boldness ?? 0.5
      // Epigenetic modulation of sociality: social priming mark boosts effective sociality
      const epiSocial = ((c.g.epiMarks || {}).socialPriming || 0) * 0.2
      // Cell signaling boosts effective sociality (quorum sensing / morphogen coordination)
      const sigBoost = (c.g.signaling || 0) * 0.15
      const social = Math.min(1, (c.g.sociality ?? 0.3) + epiSocial + sigBoost)

      const foodW = _gradientWeight * (0.3 + bold * 0.4)
      const chemoW = _gradientWeight * (0.3 + bold * 0.2)
      const wanderW = (1 - _gradientWeight) * (1.2 - bold * 0.4)
      let wx =
        wanderW * randNorm(this.rng) * _moveWander +
        foodW * bfx +
        chemoW * chemo.cx +
        persist * c.persistDir.x
      let wy =
        wanderW * randNorm(this.rng) * _moveWander +
        foodW * bfy +
        chemoW * chemo.cy +
        persist * c.persistDir.y

      // ── Conspecific flocking + Predator-prey AI ──
      // WASM path: read pre-computed vectors from batch_neighbor_forces
      // JS fallback: original spatial grid scan (for small pop or no WASM)
      if (_nbrOut) {
        // WASM results: [flockX, flockY, fleeX, fleeY, chaseX, chaseY, nNear, _]
        const _oi8 = i * 8
        wx += _nbrOut[_oi8]
        wy += _nbrOut[_oi8 + 1]
        if ((i + _tick) % _predStride2 === 0 && startCount > 5) {
          c._fleeX = _nbrOut[_oi8 + 2]
          c._fleeY = _nbrOut[_oi8 + 3]
          c._chaseX = _nbrOut[_oi8 + 4]
          c._chaseY = _nbrOut[_oi8 + 5]
        }
      } else {
        // JS fallback: flocking
        if ((i + _tick) % _flockStride === 0) {
          const isHerb = c.g.diet < 0.4
          const isCarn = c.g.diet > 0.6
          const herdDrive = isHerb ? 0.3 + social * 0.7 : isCarn ? social * 0.6 : social * 0.4
          if (herdDrive > 0.1) {
            let cohX = 0,
              cohY = 0,
              sepX = 0,
              sepY = 0,
              aliX = 0,
              aliY = 0
            let nNear = 0
            const popScale =
              startCount > 3000 ? 0.55 : startCount > 2000 ? 0.7 : startCount > 1500 ? 0.85 : 1.0
            const searchR = (isHerb ? 20 + social * 25 : 12 + social * 15) * popScale
            const searchR2 = searchR * searchR
            const comfortR = isHerb ? 3 + social * 2 : 5 + social * 4
            const comfortR2 = comfortR * comfortR
            let bx2 = Math.floor((c.x / _w) * _sgw)
            let by2 = Math.floor((c.y / _h) * _sgh)
            if (!(bx2 >= 0 && bx2 < _sgw)) bx2 = 0
            if (!(by2 >= 0 && by2 < _sgh)) by2 = 0
            const sr = startCount > 2000 ? 1 : 2
            for (let oy = -sr; oy <= sr; oy++) {
              for (let ox = -sr; ox <= sr; ox++) {
                const gx = (((bx2 + ox) % _sgw) + _sgw) % _sgw
                const gy = (((by2 + oy) % _sgh) + _sgh) % _sgh
                const bucket = _sgrid[gx + gy * _sgw]
                for (let k = 0; k < bucket.length; k++) {
                  const j = bucket[k]
                  if (j === i) continue
                  const other = this.cells[j]
                  if (other.clade !== c.clade) continue
                  const ddx = torusDelta(other.x - c.x, _w)
                  const ddy = torusDelta(other.y - c.y, _h)
                  const d2 = ddx * ddx + ddy * ddy
                  if (d2 > searchR2 || d2 < 0.01) continue
                  const dist = Math.sqrt(d2)
                  nNear++
                  const nx = ddx / dist,
                    ny = ddy / dist
                  const cohStr = Math.max(0, dist - comfortR) / searchR
                  cohX += nx * cohStr
                  cohY += ny * cohStr
                  if (d2 < comfortR2) {
                    const sepStr = (comfortR - dist) / comfortR
                    sepX -= nx * sepStr
                    sepY -= ny * sepStr
                  }
                  aliX += other.vx
                  aliY += other.vy
                }
              }
            }
            if (nNear > 0) {
              const inv = 1 / nNear
              wx += cohX * inv * herdDrive * 0.5
              wy += cohY * inv * herdDrive * 0.5
              wx += sepX * inv * herdDrive * 0.35
              wy += sepY * inv * herdDrive * 0.35
              const aliLen = Math.sqrt(aliX * aliX + aliY * aliY) || 1
              const aliStr = isCarn ? 0.2 : 0.1
              wx += (aliX / aliLen) * herdDrive * aliStr
              wy += (aliY / aliLen) * herdDrive * aliStr
            }
          }
        }
        // JS fallback: predator-prey AI
        if ((i + _tick) % _predStride2 === 0 && startCount > 5) {
          let fleeX = 0,
            fleeY = 0
          let chaseX = 0,
            chaseY = 0
          const senseR = (sense * 2.5 + 4) * (1 + recBonus * 0.5)
          const senseR2 = senseR * senseR
          let _pbx = Math.floor((c.x / _w) * _sgw)
          let _pby = Math.floor((c.y / _h) * _sgh)
          if (!(_pbx >= 0 && _pbx < _sgw)) _pbx = 0
          if (!(_pby >= 0 && _pby < _sgh)) _pby = 0
          const _psr = startCount > 2000 ? 1 : 2
          for (let _poy = -_psr; _poy <= _psr; _poy++) {
            for (let _pox = -_psr; _pox <= _psr; _pox++) {
              const _pgx = (((_pbx + _pox) % _sgw) + _sgw) % _sgw
              const _pgy = (((_pby + _poy) % _sgh) + _sgh) % _sgh
              const _pbucket = _sgrid[_pgx + _pgy * _sgw]
              for (let _pk = 0; _pk < _pbucket.length; _pk++) {
                const j = _pbucket[_pk]
                if (j === i) continue
                const o = this.cells[j]
                if (o.clade === c.clade) continue
                const ddx = torusDelta(o.x - c.x, _w)
                const ddy = torusDelta(o.y - c.y, _h)
                const d2 = ddx * ddx + ddy * ddy
                if (d2 > senseR2 || d2 < 0.01) continue
                const dist = Math.sqrt(d2)
                const nx = ddx / dist,
                  ny = ddy / dist
                if (c.g.diet < 0.5 && o.g.diet > 0.5) {
                  const threat = o.g.diet * o.energy * 0.5
                  const urgency = 1.0 / (1.0 + dist * 0.15)
                  const fleeStr = threat * urgency * (1 - c.g.diet) * sense
                  fleeX -= nx * fleeStr
                  fleeY -= ny * fleeStr
                }
                if (c.g.diet > 0.4 && o.energy < c.energy * 1.5) {
                  const preyValue = (1 - o.g.diet) * o.energy * 0.3
                  const proximity = 1.0 / (1.0 + dist * 0.1)
                  const chaseStr = preyValue * proximity * c.g.diet * speed
                  chaseX += nx * chaseStr
                  chaseY += ny * chaseStr
                }
              }
            }
          }
          c._fleeX = fleeX
          c._fleeY = fleeY
          c._chaseX = chaseX
          c._chaseY = chaseY
        }
      }

      // ── Epigenetic mark updates (every 32 ticks for perf) ──
      if (c.age % 32 === 0) {
        const epi =
          c.g.epiMarks ||
          (c.g.epiMarks = {
            stressResponse: 0,
            abundanceMemory: 0,
            socialPriming: 0,
            predatorMemory: 0,
            darkAdapt: 0
          })
        const decay = 0.97 // slow decay per update (~2% per 16 ticks)
        // Starvation → stress response mark (doubled rates since we run half as often)
        if (c.energy < 1.0) epi.stressResponse = Math.min(1, epi.stressResponse + 0.08)
        else epi.stressResponse *= decay * decay
        // Abundance → abundance memory mark
        if (c.energy > 3.0) epi.abundanceMemory = Math.min(1, epi.abundanceMemory + 0.06)
        else epi.abundanceMemory *= decay * decay
        // Nearby kin → social priming mark
        if (c.organismSize > 1 || (c._cachedDensity || 0) > 4)
          epi.socialPriming = Math.min(1, epi.socialPriming + 0.06)
        else epi.socialPriming *= decay * decay
        // Predator encounters → predator memory mark
        const hadPredator = (c._fleeX || 0) * (c._fleeX || 0) + (c._fleeY || 0) * (c._fleeY || 0) > 0.01
        if (hadPredator) epi.predatorMemory = Math.min(1, epi.predatorMemory + 0.1)
        else epi.predatorMemory *= decay * decay
        // Low light → dark adaptation mark (inlined sunlight sampling)
        const _snx = (c.x - _wcx) * _invHalfW
        const _sny = (c.y - _wcy) * _invHalfH
        const sunHere = (0.5 + (_snx * _sunCos + _sny * _sunSin) * 0.5) * _sunIntensity
        if (sunHere < 0.4) epi.darkAdapt = Math.min(1, epi.darkAdapt + 0.06)
        else epi.darkAdapt *= decay * decay
      }

      // ── Behavioral gene effects on movement ──
      const epi = c.g.epiMarks || {}

      // Fear gene + predator memory epigenetic mark → amplified flee response
      const fearMod = (c.g.fear || 0.3) + (epi.predatorMemory || 0) * 0.3
      // Aggression gene → amplified chase response
      const aggrMod = (c.g.aggression || 0.1) + (epi.stressResponse || 0) * 0.15
      // Curiosity gene → random exploration impulse (explore new areas)
      const curiosityMod = (c.g.curiosity || 0.3) + (epi.abundanceMemory || 0) * 0.1

      // Apply cached flee/chase vectors with behavioral modulation
      const fleeScale = 0.6 * (1 - c.g.diet) * (0.5 + fearMod) // fear amplifies fleeing
      const chaseScale = 0.5 * c.g.diet * (0.5 + aggrMod) // aggression amplifies chasing
      wx += (c._fleeX || 0) * fleeScale
      wy += (c._fleeY || 0) * fleeScale
      wx += (c._chaseX || 0) * chaseScale
      wy += (c._chaseY || 0) * chaseScale

      // Curiosity: random exploration bursts — curious cells occasionally veer off
      if (curiosityMod > 0.2 && c.age % 32 < 4) {
        wx += randNorm(this.rng) * curiosityMod * 0.4
        wy += randNorm(this.rng) * curiosityMod * 0.4
      }

      // Territorial: cells with high territorial gene resist moving far from birthplace
      // They develop a "home range" preference (cached as _homeX/_homeY on first set)
      const terr = c.g.territorial || 0
      if (terr > 0.15) {
        if (c._homeX === undefined) {
          c._homeX = c.x
          c._homeY = c.y
        }
        const hdx = torusDelta(c._homeX - c.x, _w)
        const hdy = torusDelta(c._homeY - c.y, _h)
        const homeDist = Math.sqrt(hdx * hdx + hdy * hdy) || 0.001
        if (homeDist > 15) {
          wx += (hdx / homeDist) * terr * 0.3
          wy += (hdy / homeDist) * terr * 0.3
        }
      }

      // Migratory: long-range directional drift using LUT (no per-cell trig)
      const migr = c.g.migratory || 0
      if (migr > 0.1) {
        const migrAngle = (c.id * 1.7 + _tick * 0.0003 * (1 + migr)) % 6.2832
        const _lutIdx = (((migrAngle * _migrN) / 6.2832) | 0) & (_migrN - 1)
        wx += _migrCos[_lutIdx] * migr * 0.25
        wy += _migrSin[_lutIdx] * migr * 0.25
      }

      // ── Alarm pheromone response ──
      // Cells detect chemical alarm signals from killed conspecifics and flee.
      // Response strength: fear gene × alarm concentration × diet filter
      // Pure carnivores (diet > 0.7) ignore alarm — they're the predators.
      // Scientific basis: Schreckstoff in Ostariophysi, alarm pheromones in ants,
      // panic schooling in fish, mobbing calls in birds.
      if (fearMod > 0.1 && c.g.diet < 0.7 && (i + _tick) % _alarmStride === 0) {
        const alarmHere = this.sampleAlarm(c.x, c.y)
        if (alarmHere > 0.05) {
          // Sample alarm gradient to determine flee direction
          const aL = this.sampleAlarm(c.x - 4, c.y)
          const aR = this.sampleAlarm(c.x + 4, c.y)
          const aU = this.sampleAlarm(c.x, c.y - 4)
          const aD = this.sampleAlarm(c.x, c.y + 4)
          // Flee direction = away from highest alarm concentration (negative gradient)
          let adx = aL - aR
          let ady = aU - aD
          const aMag = Math.sqrt(adx * adx + ady * ady) || 0.001
          adx /= aMag
          ady /= aMag
          // Flee strength: fear × alarm intensity, capped
          const fleeStr = Math.min(1.5, fearMod * alarmHere * 0.8)
          wx += adx * fleeStr
          wy += ady * fleeStr
          // Epigenetic: mark predator memory so fear persists after alarm fades
          if (!c.g.epiMarks) c.g.epiMarks = {}
          c.g.epiMarks.predatorMemory = Math.min(1, (c.g.epiMarks.predatorMemory || 0) + alarmHere * 0.1)
        }
      }

      // Nocturnal: cells with high nocturnal gene are more active in low light
      const noct = (c.g.nocturnal || 0) + (epi.darkAdapt || 0) * 0.2
      if (noct > 0.15) {
        // Inlined sunlight sampling
        const _snx2 = (c.x - _wcx) * _invHalfW
        const _sny2 = (c.y - _wcy) * _invHalfH
        const sunHere2 = (0.5 + (_snx2 * _sunCos + _sny2 * _sunSin) * 0.5) * _sunIntensity
        // In darkness: speed boost. In light: sluggish
        const noctMod = sunHere2 < 0.5 ? 1.0 + noct * 0.4 : 1.0 - noct * 0.15
        wx *= noctMod
        wy *= noctMod
      }

      // ── Phototropism: move toward sunlight ──
      // Herbivores with high phototropism gene chase the lit side of the world
      const photoGene = c.g.phototropism || 0
      if (photoGene > 0.05) {
        const photoStr = photoGene * (1 - c.g.diet) * 0.4 // only herbivores benefit
        wx += _sunCos * photoStr
        wy += _sunSin * photoStr
      }

      // Reuse cached _vLen for all directional thrust computations
      const _nvx = _cvx / _vLen,
        _nvy = _cvy / _vLen
      if (c.g.flagella > 0.05) {
        wx += _nvx * flagellaBoost
        wy += _nvy * flagellaBoost
      }
      if (c.g.flipper > 0.1) {
        wx += _nvx * flipperBoost
        wy += _nvy * flipperBoost
      }
      // Elongation: strong forward thrust along current heading, resists turning
      if ((c.g.elongation || 0) > 0.1) {
        const el = c.g.elongation
        wx += _nvx * el * 1.2
        wy += _nvy * el * 1.2
      }
      // Paddle fins: broad directional thrust with slight lateral stability
      if ((c.g.paddleFin || 0) > 0.1) {
        wx += _nvx * paddleFinBoost
        wy += _nvy * paddleFinBoost
      }
      if (c.g.amoeboid > 0.05) {
        wx += randNorm(this.rng) * amoeboidBoost
        wy += randNorm(this.rng) * amoeboidBoost
      }
      if (c.g.jet > 0.1 && c.jetCooldown === 0 && c.energy > 0.8) {
        const jetPower = c.g.jet * 2.5
        const _wLen = Math.sqrt(wx * wx + wy * wy) || 0.001
        c.vx += (wx / _wLen) * jetPower
        c.vy += (wy / _wLen) * jetPower
        c.energy -= c.g.jet * 0.15
        c.jetCooldown = Math.max(8, 30 - c.g.jet * 20) | 0
      }

      c.vx += wx * moveAmt * cilFactor * roleSpeedMod
      c.vy += wy * moveAmt * cilFactor * roleSpeedMod

      // Velocity clamping — use squared comparison to skip sqrt for most cells
      const mechSpeedBonus = c.g.flagella * 0.3 + c.g.jet * 0.5
      const elongSpeedBonus = (c.g.elongation || 0) * 0.4
      const vmax = (0.55 + 0.65 * speed + mechSpeedBonus + elongSpeedBonus) * roleSpeedMod
      const _v2 = c.vx * c.vx + c.vy * c.vy
      const _vmax2 = vmax * vmax
      if (_v2 > _vmax2) {
        const _vScale = vmax / Math.sqrt(_v2)
        c.vx *= _vScale
        c.vy *= _vScale
      }

      if (c.eatFlash > 0) c.eatFlash--
      if (c.engulfing > 0) c.engulfing--

      // ── Sub-timing: end movement, start feeding ──
      if ((i & (_CL_SAMPLE - 1)) === 0) {
        const _t = performance.now()
        _cl_moveT += _t - _cl_t0
        _cl_t0 = _t
      }

      const prevEnergy = c.energy

      const depthPenalty = c.organismDepth > 0 ? Math.max(0.65, 1.0 - c.organismDepth * 0.08) : 1.0
      const orgFeedBonus = c.organismSize > 1 ? 1.0 + Math.min(c.organismSize, 8) * 0.06 : 1.0
      // Local resource competition: uptake drops in crowded areas
      // Scientific basis: scramble competition — more individuals sharing
      // the same food patch means each gets a smaller share
      const cachedDens = c._cachedDensity || 5
      const competitionPenalty = cachedDens > 6 ? Math.max(0.5, 1.0 - (cachedDens - 6) * 0.02) : 1.0
      // A/B split world: side B gets food uptake multiplier
      const splitFood =
        _splitWorld && _splitWorld.active && _splitWorld.getSide(c, this) === 'B'
          ? _splitWorld.sideB.foodGrowthMult || 1.0
          : 1.0
      const uptakeBase =
        _uptake *
        (0.75 + 0.35 * sense) *
        (1 + recBonus * 0.5) *
        depthPenalty *
        orgFeedBonus *
        competitionPenalty *
        splitFood

      // Bioluminescence: pull nearby food toward this cell
      if ((c.g.biolum || 0) > 0.1 && _tick % 8 === 0) {
        const bl = c.g.biolum
        const pullR = 3 + bl * 4
        const pullStr = bl * 0.12
        this._attractFood(c.x, c.y, pullR, pullStr)
      }

      // Proboscis: extended feeding range in direction of movement
      const probRange = (c.g.proboscis || 0) > 0.1 ? c.g.proboscis * 3 : 0
      let feedX = c.x,
        feedY = c.y
      if (probRange > 0) {
        feedX = c.x + _nvx * probRange
        feedY = c.y + _nvy * probRange
      }
      // Amoeboid: pseudopods extend surface area for absorption — sample food in a ring
      const amoeboidUptakeBonus = (c.g.amoeboid || 0) > 0.15 ? 1.0 + c.g.amoeboid * 0.8 : 1.0
      // Stalk: sessile filter feeding — anchored cells get +50% ground food uptake
      // Scientific basis: stalked ciliates (Vorticella), barnacles, sea lilies —
      // sessile organisms compensate for immobility with enhanced local resource extraction
      const stalkUptakeBonus = (c.g.stalk || 0) > 0.1 ? 1.0 + (c.g.stalk || 0) * 0.5 : 1.0
      // Inlined sunlight sampling (avoid function call overhead per cell)
      const _snx3 = (c.x - _wcx) * _invHalfW
      const _sny3 = (c.y - _wcy) * _invHalfH
      const localSunlight = (0.5 + (_snx3 * _sunCos + _sny3 * _sunSin) * 0.5) * _sunIntensity
      // Large herbivores graze more efficiently: bigger mouth/filtering apparatus
      // Scientific basis: baleen whales, elephants, manatees — body size enables
      // bulk feeding strategies unavailable to small organisms
      const herbGrazeScale = c.g.diet < 0.4 ? 1.0 + Math.max(0, (c.g.bodyScale || 1.0) - 0.9) * 0.5 : 1.0
      const plantTake = this._takeFood(
        feedX,
        feedY,
        uptakeBase * herbivoreAff * amoeboidUptakeBonus * stalkUptakeBonus * herbGrazeScale
      )
      // Herbivore digestion bonus: specialized enzymes extract more energy from plants
      // (cellulase, fermentation — cows get 70% more energy from grass than a carnivore would)
      const herbDigestionBonus =
        c.g.diet < 0.3 ? 1.0 + (0.3 - c.g.diet) * 1.2 : c.g.diet < 0.5 ? 1.0 + (0.5 - c.g.diet) * 0.3 : 1.0
      c.energy += plantTake * herbDigestionBonus
      if (plantTake > 0.02) {
        c.lastAte = FOOD_PLANT
        c.eatFlash = 15
        // Seed transport: cell carries eaten food as a seed to deposit later
        this._pickupSeed(c, plantTake)
        if (plantTake > 0.08 && this.eatEvents.length < 15)
          this.eatEvents.push({ x: c.x, y: c.y, foodType: 0 })
      }

      const mineralTake = this._takeMineral(c.x, c.y, uptakeBase * 0.5)
      c.energy += mineralTake * this.cfg.mineralEnergy
      if (mineralTake > 0.02) {
        c.lastAte = FOOD_MINERAL
        c.eatFlash = 20
        if (mineralTake > 0.06 && this.eatEvents.length < 15)
          this.eatEvents.push({ x: c.x, y: c.y, foodType: 1 })
      }

      // Scavenger gene: boosts meat/carrion uptake and energy extraction
      // Scientific basis: vultures, hyenas, hagfish — specialized decomposers
      // with enhanced enzymes, gut flora, and immune systems for carrion.
      const scavengerBoost = 1.0 + (c.g.scavenger || 0) * 2.5
      const meatTake = this._takeMeat(c.x, c.y, uptakeBase * carnivoreAff * scavengerBoost)
      c.energy += meatTake * (2.5 + (c.g.scavenger || 0) * 1.5)
      if (meatTake > 0.02) {
        c.lastAte = FOOD_MEAT
        c.eatFlash = 18
        if (meatTake > 0.05 && this.eatEvents.length < 15)
          this.eatEvents.push({ x: c.x, y: c.y, foodType: 2 })
      }

      // Cilia: sweep feeding — hair-like projections create currents that pull food from multiple directions
      if (c.g.cilia > 0.15 && (i + _tick) % 4 === 0) {
        const ciliaRange = 1.5 + ciliaBoost * 4
        const sweepPoints = Math.min(4, 2 + Math.floor(c.g.cilia * 3))
        let ciliaTotal = 0
        for (let ci = 0; ci < sweepPoints; ci++) {
          const angle = (ci / sweepPoints) * Math.PI * 2
          ciliaTotal += this._takeFood(
            c.x + Math.cos(angle) * ciliaRange,
            c.y + Math.sin(angle) * ciliaRange,
            uptakeBase * c.g.cilia * 0.6
          )
        }
        c.energy += ciliaTotal
      }

      // Symbiosis: redistribute energy among nearby kin (mutualistic sharing)
      // Scientific basis: mycorrhizal networks in forests, coral-zooxanthellae,
      // slime mold nutrient sharing — cooperative resource pooling
      if ((c.g.symbiosis || 0) > 0.15 && (i + _tick) % _symbStride === 0) {
        const sym = c.g.symbiosis
        const shareR = 5 + sym * 8
        const shareR2 = shareR * shareR
        const scanW = Math.min(15, Math.max(5, Math.floor(startCount * 0.008)))
        for (let j = Math.max(0, i - scanW); j < Math.min(startCount, i + scanW); j++) {
          if (j === i) continue
          const o = this.cells[j]
          if (o.clade !== c.clade) continue
          const sdx = torusDelta(o.x - c.x, this.w)
          const sdy = torusDelta(o.y - c.y, this.h)
          if (sdx * sdx + sdy * sdy > shareR2) continue
          // Transfer energy from richer to poorer
          const diff = c.energy - o.energy
          if (Math.abs(diff) > 0.1) {
            const transfer = diff * sym * 0.02
            c.energy -= transfer
            o.energy += transfer * 0.9 // 10% loss in transfer (thermodynamic cost)
          }
        }
      }

      // Biome symbiosis bonus: organisms with symbiosis gene thrive in symbiosis-rich biomes
      // Scientific basis: coral-zooxanthellae mutualism, vent tube worm-bacteria symbiosis
      if ((c.g.symbiosis || 0) > 0.1 && (i + _tick) % 8 === 0) {
        const _bCfg = this.getBiomeConfigAt(c.x, c.y)
        if (_bCfg && _bCfg.symbiosis > 0) {
          c.energy += c.g.symbiosis * _bCfg.symbiosis * 0.003
        }
      }

      // Shelter-seeking: organisms near shelter get reduced metabolism (less stress)
      // Scientific basis: reef organisms expend less energy on predator vigilance
      if ((i + _tick) % 12 === 0) {
        const _localShelter = this.sampleShelter(c.x, c.y)
        if (_localShelter > 0.2) {
          // Small energy bonus from shelter — reduced stress
          c.energy += Math.min(_localShelter, 2.0) * 0.0005
        }
      }

      // Amoeboid: pseudopods also absorb minerals better (engulfing particles)
      if ((c.g.amoeboid || 0) > 0.15) {
        const amoebMineralBonus = this._takeMineral(c.x, c.y, uptakeBase * c.g.amoeboid * 0.3)
        c.energy += amoebMineralBonus * this.cfg.mineralEnergy
      }

      // Proboscis: parasitic energy drain — siphon energy from nearby non-kin cells
      if ((c.g.proboscis || 0) > 0.2 && c.g.diet > 0.3 && _tick % 8 === 0) {
        const probR = 3 + c.g.proboscis * 5
        const probR2 = probR * probR
        for (let j = Math.max(0, i - 20); j < Math.min(startCount, i + 20); j++) {
          if (j === i) continue
          const o = this.cells[j]
          if (o.clade === c.clade) continue
          const pdx = torusDelta(c.x - o.x, this.w)
          const pdy = torusDelta(c.y - o.y, this.h)
          if (pdx * pdx + pdy * pdy < probR2 && o.energy > 0.5) {
            const drain = c.g.proboscis * 0.02
            o.energy -= drain
            c.energy += drain * 0.7
            break // only drain one target per tick
          }
        }
      }

      // ── Sub-timing: end feeding, start metabolism ──
      if ((i & (_CL_SAMPLE - 1)) === 0) {
        const _t = performance.now()
        _cl_feedT += _t - _cl_t0
        _cl_t0 = _t
      }

      // ── Density-dependent metabolism (logistic growth / Verhulst) ──
      // Crowded cells pay more energy — this creates natural carrying capacity.
      // Scientific basis: intraspecific competition for resources increases
      // metabolic stress when population density is high locally.
      const localDens =
        (i + _tick) % _densStride === 0 ? this._localDensity(c, spatial) : c._cachedDensity || 5
      c._cachedDensity = localDens
      // crowdingStress: 1.0 at low density, up to ~1.6 at very high density
      const crowdingStress = 1.0 + Math.max(0, localDens - 8) * 0.025
      // Organisms buffer crowding via cooperation (division of labor)
      const orgCrowdBuffer = c.organismSize > 1 ? Math.max(0.7, 1.0 - c.organismSize * 0.03) : 1.0

      // Multicellular metabolic efficiency (Kleiber's law / allometric scaling)
      // Small multicellular organisms gain efficiency (division of labor),
      // but very large ones pay coordination/transport overhead.
      // Optimal size ~4-12 cells; beyond that, costs rise.
      let orgMetabBonus = 1.0
      if (c.organismSize > 1) {
        const effSize = Math.min(c.organismSize, 8)
        const bonus = 1.0 - effSize * 0.04 // efficiency gain up to size 8
        const overhead = c.organismSize > 12 ? (c.organismSize - 12) * 0.02 : 0 // coordination cost
        orgMetabBonus = Math.max(0.7, bonus) + overhead
      }
      // Solitary penalty: as environment gets harsher, unlinked cells pay more
      const solitaryPenalty = c.linkCount === 0 ? envHarshness : Math.max(1.0, envHarshness * 0.7)
      // PaddleFin: energy-efficient locomotion at speed
      const paddleEfficiency = (c.g.paddleFin || 0) > 0.15 ? 1.0 - c.g.paddleFin * 0.25 : 1.0
      // Carnivore metabolic discount: predators have efficient resting metabolism
      // (feast-famine adaptation — cats, snakes, crocodiles all have low BMR)
      const carnivoreMetab = c.g.diet > 0.5 ? Math.max(0.7, 1.0 - c.g.diet * 0.3) : 1.0
      // Herbivore metabolic efficiency: specialized gut flora, fermentation chambers
      // (ruminants, termites, koalas — extract more energy per unit plant matter)
      // Also rewards larger herbivores: bigger gut = more efficient digestion (Kleiber's law)
      const herbScale = c.g.bodyScale || 1.0
      const herbSizeBonus = herbScale > 1.0 ? 1.0 + (herbScale - 1.0) * 0.15 : 1.0
      const herbivoreMetab =
        c.g.diet < 0.3 ? Math.max(0.7, 1.0 - (0.3 - c.g.diet) * 0.6) * (1.0 / herbSizeBonus) : 1.0
      // Biome-specific metabolism multiplier (uses hoisted biome array)
      let biomeMetab = 1.0
      if (_numBiomes > 0) {
        const _bi = Math.min(_numBiomes - 1, (c.x / _biomeRegionW) | 0)
        biomeMetab = _biomes[_bi].metabolismMult || 1.0
      }
      // Epigenetic stress response: elevated metabolism (cortisol/adrenaline analog)
      const epiStressMetab = 1.0 + ((c.g.epiMarks || {}).stressResponse || 0) * 0.15
      // A/B split world: side B gets metabolism multiplier
      const splitMetab =
        _splitWorld && _splitWorld.active && _splitWorld.getSide(c, this) === 'B'
          ? _splitWorld.sideB.metabolismMult || 1.0
          : 1.0
      c.energy -=
        _metabolismBase *
        metabolism *
        (1 + 0.7 * speed * paddleEfficiency) *
        _dt *
        orgMetabBonus *
        solitaryPenalty *
        crowdingStress *
        orgCrowdBuffer *
        carnivoreMetab *
        herbivoreMetab *
        biomeMetab *
        epiStressMetab *
        splitMetab
      // Batched trait maintenance costs (single property write instead of 33)
      {
        const _g = c.g
        c.energy -=
          spinesCost +
          camoEnergyCost +
          _g.flipper * 0.001 +
          _g.cilia * 0.0008 +
          _g.flagella * 0.0012 +
          _g.jet * 0.002 +
          _g.amoeboid * 0.0003 +
          _g.toxin * 0.0015 +
          _g.spike * 0.001 +
          _g.constrict * 0.0008 +
          (_g.toxinResist || 0) * 0.0005 +
          (_g.elongation || 0) * 0.0004 +
          (_g.biolum || 0) * 0.0018 +
          (_g.vesicles || 0) * 0.001 +
          Math.max(0, (_g.bodyScale || 1) - 1) * 0.0004 +
          (_g.brightness || 0) * 0.0006 +
          (_g.proboscis || 0) * 0.0005 +
          (_g.paddleFin || 0) * 0.0008 +
          (_g.scavenger || 0) * 0.0006 +
          (_g.shell || 0) * 0.0015 +
          (_g.symbiosis || 0) * 0.0008 +
          (_g.eyespot || 0) * 0.0006 +
          (_g.stalk || 0) * 0.0004 +
          // Behavioral gene maintenance costs (neural signaling networks)
          (_g.curiosity || 0) * 0.0003 +
          (_g.aggression || 0) * 0.0004 +
          (_g.fear || 0) * 0.0002 +
          (_g.territorial || 0) * 0.0003 +
          (_g.nocturnal || 0) * 0.0002 +
          (_g.migratory || 0) * 0.0003 +
          (_g.nurturing || 0) * 0.0002 +
          (_g.respiration || 0) * 0.0003 +
          (_g.wasteExpel || 0) * 0.0002
      }

      // ── Gas exchange & aerobic respiration ──
      if (c.age % _gasTickStride === 0) {
        const gx = Math.min(_gasWm1, ((c.x / _w) * _gasW) | 0)
        const gy = Math.min(_gasHm1, ((c.y / _h) * _gasH) | 0)
        const gi = gx + gy * _gasW
        const resp = c.g.respiration || 0.4
        const localO2 = _o2Grid[gi]

        // O2 intake: cell absorbs O2 from environment based on respiration gene
        // Scientific basis: gill/membrane surface area determines gas exchange rate.
        // Mitochondria level boosts O2 utilization (more powerhouses = more demand).
        const mitoBoost = 1.0 + c.organelles[ORGANELLE_MITOCHONDRIA] * 0.5
        const o2Intake = Math.min(localO2 * 0.15, resp * 0.08 * mitoBoost) * 4
        c.o2Store = Math.min(1.0, (c.o2Store || 0) + o2Intake)
        _o2Grid[gi] = Math.max(0, localO2 - o2Intake)

        // Aerobic energy production: O2 + metabolized food → ATP (energy) + CO2 + waste
        // This is the Krebs cycle / oxidative phosphorylation analog.
        // Without O2, cells can only use anaerobic metabolism (much less efficient).
        const o2Available = c.o2Store || 0
        const aerobicRate = Math.min(o2Available, metabolism * 0.04) * 4
        if (aerobicRate > 0.001) {
          // Aerobic bonus: extra energy from efficient O2-based metabolism
          c.energy += aerobicRate * 0.15
          c.o2Store -= aerobicRate
          // CO2 output: byproduct of respiration
          _co2Grid[gi] = Math.min(2.0, _co2Grid[gi] + aerobicRate * 0.8)
          // Waste production: metabolic byproducts (urea, ammonia, lactate analogs)
          c.waste = (c.waste || 0) + aerobicRate * 0.12
        }

        // Anaerobic waste: even without O2, baseline metabolism produces waste
        c.waste = (c.waste || 0) + metabolism * 0.004

        // Waste expulsion: cells actively pump out waste
        const expelRate = (c.g.wasteExpel || 0.3) * 0.06 * 4
        c.waste = Math.max(0, c.waste - expelRate)

        // Chloroplast photosynthesis: consume CO2, produce O2
        // Scientific basis: 6CO2 + 6H2O → C6H12O6 + 6O2
        const chloro = c.g.chloroplast || 0
        if (chloro > 0.05) {
          const localCO2 = _co2Grid[gi]
          const photoRate = chloro * localSunlight * 0.06 * 4
          const co2Used = Math.min(localCO2 * 0.2, photoRate)
          _co2Grid[gi] = Math.max(0, localCO2 - co2Used)
          _o2Grid[gi] = Math.min(2.0, _o2Grid[gi] + co2Used * 0.9)
        }
      }

      // Waste toxicity: high waste levels poison the cell
      // Scientific basis: uremia, acidosis — metabolic waste buildup damages cells
      const wasteLevel = c.waste || 0
      if (wasteLevel > 0.5) {
        const wastePenalty = (wasteLevel - 0.5) * 0.004
        c.energy -= wastePenalty
        // Waste accelerates senescence (cellular damage from toxins)
        c.senescence = (c.senescence || 0) + (wasteLevel - 0.5) * 0.00005
      }

      // ── Muller's ratchet + genome architecture + irreducible complexity costs ──
      // Batched into single subtraction for fewer property writes
      {
        const _g = c.g
        let _genomeCost =
          effectiveDriftLoad * 0.006 +
          Math.max(0, (_g.genomeSize || 1) - 1) * 0.0008 +
          Math.max(0, (_g.ploidy || 1) - 1) * 0.0006 +
          (_g.regulatoryComplexity || 0) * 0.0005 +
          (_g.dnaRepair || 0) * 0.0008 +
          (_g.immuneStrength || 0) * 0.0006 +
          (_g.signaling || 0) * 0.0004 +
          (_g.plasticity || 0) * 0.0003
        // Irreducible complexity barriers (Behe / Axe): fitness valleys
        if (_g.jet > 0.05 && _g.jet < 0.25) _genomeCost += _g.jet * 0.003
        if (_g.constrict > 0.03 && _g.constrict < 0.15) _genomeCost += _g.constrict * 0.004
        if (_g.toxin > 0.03 && _g.toxin < 0.15) _genomeCost += _g.toxin * 0.003
        c.energy -= _genomeCost
      }

      // ── Photosynthesis: chloroplast gene converts sunlight → energy ──
      // This is the PRIMARY energy source for the ecosystem.
      // Cells with high chloroplast generate energy proportional to sunlight.
      // Scientific basis: photosystem II captures photons → ATP + NADPH → glucose
      const chloro = c.g.chloroplast || 0
      if (chloro > 0.02) {
        // localSunlight was computed above during food uptake
        const photoRate = chloro * localSunlight * 0.012 // max ~0.012 energy/tick at full sun + full chloroplast
        c.energy += photoRate

        // Excrete excess energy as food on the grid — this feeds the ecosystem
        // Like real plants releasing organic matter (leaf litter, root exudates, dissolved organics)
        // Only excrete when well-fed (energy > 1.5) to avoid starving yourself
        if (c.energy > 1.5 && chloro > 0.1) {
          const excreteRate = chloro * 0.003 * Math.min(1, (c.energy - 1.5) * 0.5)
          c.energy -= excreteRate
          this._dropPlantFood(c.x, c.y, excreteRate * 0.8)
        }
      }
      // Chloroplast maintenance cost (protein complexes, thylakoid membranes)
      c.energy -= chloro * 0.002

      let organelleCost = 0
      for (let oi = 0; oi < ORGANELLE_COUNT; oi++) {
        organelleCost += c.organelles[oi] * 0.0005
      }
      c.energy -= organelleCost
      if (!isFinite(c.energy)) c.energy = 0.1

      const energyGained = Math.max(0, c.energy - prevEnergy)
      const decay = 0.98
      c.foragingEff = c.foragingEff * decay + energyGained * (1 - decay)
      const moveDist = Math.sqrt(c.vx * c.vx + c.vy * c.vy)
      c.explorationScore = c.explorationScore * decay + moveDist * (1 - decay)

      c.moveAccum += moveDist
      if (moveDist > 0.1) c.activeMoveTicks++
      c.energyGainAccum += energyGained
      if (c.energy > c.peakEnergy) c.peakEnergy = c.energy
      const survivalBonus = c.age > 500 ? 0.1 : 0
      // Stronger multicellular fitness rewards that scale with era
      const multiBonus =
        c.linkCount > 0 ? 0.2 + c.organismSize * 0.06 + (c.complexity || 0) * 0.04 + era * 0.1 : -era * 0.05 // solitary cells get slight fitness penalty as world escalates
      c.behavioralFitness =
        c.foragingEff * 3.0 + c.explorationScore * 0.5 + c.cooperationScore * 2.5 + survivalBonus + multiBonus

      // Use nearest gradient peak for fitness distance
      let bestFitD2 = Infinity
      for (let gpi = 0; gpi < _nGPeaks; gpi++) {
        const gdx = torusDelta(c.x - _gPeaks[gpi].x, _w)
        const gdy = torusDelta(c.y - _gPeaks[gpi].y, _h)
        const gd2 = gdx * gdx + gdy * gdy
        if (gd2 < bestFitD2) bestFitD2 = gd2
      }
      const bestFitDist = Math.sqrt(bestFitD2)
      c.fitnessDist = bestFitDist
      c.fitnessAccum += 1.0 / (1.0 + bestFitDist * 0.02)

      if (!isFinite(c.vx)) c.vx = 0
      if (!isFinite(c.vy)) c.vy = 0
      c.x = (((c.x + c.vx) % _w) + _w) % _w
      c.y = (((c.y + c.vy) % _h) + _h) % _h
      if (!isFinite(c.x)) c.x = _halfW
      if (!isFinite(c.y)) c.y = _halfH
      c.vx *= 0.985
      c.vy *= 0.985
      this._enforceBlobBoundary(c)
      this._enforceBarriers(c)

      // Ratcliff: programmed cell death (apoptosis)
      if (
        c.g.apoptosis > 0.1 &&
        c.organismDepth >= 3 &&
        c.linkCount >= 2 &&
        c.age > 400 &&
        this.rng() < c.g.apoptosis * 0.003
      ) {
        this._dropMeat(c.x, c.y, c.energy * _meatDropEnergy)
        c.energy = -1
      }

      // ── Emergent multicellular life cycles (Staps/Tarnita 2019) ──
      // Scientific basis: In the Staps et al. model, cells evolve to periodically
      // switch off their stickiness gene, causing complete group disintegration
      // into single-cell propagules that seed new groups. This creates a life
      // cycle: grow → fragment → disperse → re-aggregate. The fragmentation gene
      // controls the propensity for this behavior; propaguleSize (Gao/Traulsen 2022)
      // controls whether offspring are single cells or multi-cell clusters.
      const frag = c.g.fragmentation || 0
      if (frag > 0.15 && c.organismSize >= 3 && c.linkCount > 0 && c.age > 300) {
        // Fragmentation probability increases with organism size and age
        // Larger organisms fragment more readily (growth costs exceed benefits)
        const sizePress = Math.min(1, (c.organismSize - 3) / 8)
        const agePress = Math.min(1, (c.age - 300) / 2000)
        const fragProb = frag * 0.002 * (1 + sizePress * 2 + agePress)
        if (this.rng() < fragProb) {
          // Propagule size gene (Gao/Traulsen): determines fragment size
          // Low propaguleSize → release single cells (like slime mold spores)
          // High propaguleSize → break into multi-cell clusters (like cyanobacteria hormogonia)
          const propSize = c.g.propaguleSize || 0
          if (propSize < 0.3) {
            // Single-cell propagule release: sever ALL links from this cell
            // The cell becomes a free-swimming propagule that can seed a new group
            c.linkCount = 0 // will be cleaned up in link force step
            c._fragmented = true
          } else {
            // Multi-cell fragmentation: weaken links so organism splits into clusters
            // Only sever links on edge cells (interior stays connected)
            if (c.role !== ROLE_INTERIOR) {
              c.linkCount = 0
              c._fragmented = true
            }
          }
        }
      }

      // ── Adhesion co-option (Staps/Tarnita 2019) ──
      // Scientific basis: ancestral cell-surface proteins that originally bound
      // extracellular entities were co-opted for cell-cell adhesion. In the model,
      // the stickiness gene has a dual function: its ancestral role (receptor
      // sensitivity) AND group formation. Environmental conditions modulate
      // expression — cells in nutrient-poor areas upregulate adhesion to form
      // protective groups, while well-fed cells may downregulate it to disperse.
      // This creates environmentally responsive group formation/dissolution.
      if (c.g.adhesion > 0.1 && c.age % 32 === 0) {
        const localFood = this._sampleFood(c.x, c.y)
        const starvation = localFood < 0.3 ? 1 : 0
        // Starving cells become stickier (form protective groups)
        // Well-fed cells become less sticky (disperse to find new patches)
        if (starvation && c.linkCount === 0) {
          // Temporarily boost effective adhesion for link formation
          c._adhesionBoost = Math.min(0.3, c.g.adhesion * 0.5)
        } else if (localFood > 1.5 && c.linkCount > 0 && frag > 0.1) {
          // Well-fed + high fragmentation: weaken bonds to disperse
          c._adhesionBoost = -c.g.fragmentation * 0.2
        } else {
          c._adhesionBoost = 0
        }
      }

      // ── Sub-timing: end metabolism, start lifecycle ──
      if ((i & (_CL_SAMPLE - 1)) === 0) {
        const _t = performance.now()
        _cl_metabT += _t - _cl_t0
        _cl_t0 = _t
      }

      // ── Continuous senescence / aging system (runs every 8 ticks for perf) ──
      if (c.age % 8 === 0) {
        const longevity = c.g.longevity || 0.5
        const baseRate = 0.00096 / (0.3 + longevity * 0.7) // 8x rate since we run 1/8 as often

        // Accelerators (cheap: no sqrt, no complex branching)
        const eRatio = c.energy < divisionThreshold * 0.5 ? c.energy / (divisionThreshold * 0.5) : 1
        const starveAccel = eRatio < 0.4 ? (0.4 - eRatio) * 0.006 : 0
        c.starveTicks = c.energy < 0.5 ? (c.starveTicks || 0) + 8 : c.starveTicks > 0 ? c.starveTicks - 8 : 0
        if (c.starveTicks < 0) c.starveTicks = 0
        const chronicStarve = c.starveTicks > 100 ? 0.0024 : 0
        const speedSq = c.vx * c.vx + c.vy * c.vy // avoid sqrt
        const moveWear = speedSq * (c.g.speed || 1) * 0.00006
        const metabWear = ((c.g.metabolism || 1) - 0.8) * 0.00024
        const toxDmg = (c.g.toxin || 0) * 0.00032
        const driftDmg = (c.g.driftLoad || 0) * 0.00048

        // Protection factor (single division)
        const prot =
          1.0 +
          (c.g.membrane || 0) * 0.3 +
          (c.g.toughness || 0) * 0.2 +
          (c.g.shell || 0) * 0.25 +
          (c.g.chloroplast || 0) * 0.15 +
          (eRatio > 0.7 ? (eRatio - 0.7) * 0.3 : 0) +
          (c.organismSize > 1 ? c.organismSize * 0.02 : 0)

        c.senescence =
          (c.senescence || 0) +
          (baseRate + starveAccel + chronicStarve + moveWear + metabWear + toxDmg + driftDmg) / prot
      }

      // Senescence effects (cheap, every tick)
      {
        const sen = c.senescence || 0
        if (sen > 0.3) {
          const d = sen - 0.3
          c.energy -= d * 0.002
          const slow = d * 0.008
          c.vx *= 1.0 - slow
          c.vy *= 1.0 - slow
        }
        if (sen > 0.6 && this.rng() < (sen - 0.6) * (sen - 0.6) * 0.06) {
          this._dropMeat(c.x, c.y, c.energy * 0.8 + 0.3)
          c._deathCause = 'senescence'
          c.energy = -1
        } else if (sen >= 1.0) {
          this._dropMeat(c.x, c.y, c.energy * 0.9 + 0.2)
          c._deathCause = 'senescence'
          c.energy = -1
        }
      }

      // Division — sexual or asexual depending on complexity & sexuality gene
      // Body scale: large cells store more energy before dividing (fat reserves)
      const bodyScaleStorage = (c.g.bodyScale || 1.0) > 1.1 ? 1.0 + ((c.g.bodyScale || 1.0) - 1.0) * 0.3 : 1.0

      // ── Logistic growth: soft carrying capacity (Verhulst model) ──
      // Division threshold increases as population approaches K.
      // K is estimated from total food in the world — more food = higher K.
      // Scientific basis: per-capita resource availability decreases with N,
      // making reproduction progressively harder near carrying capacity.
      const popRatio = orgCount / maxOrganisms // 0..1+ (can exceed 1)
      const logisticPenalty = popRatio > 0.3 ? 1.0 + (popRatio - 0.3) * 2.5 : 1.0

      // ── Allee effect: very small species populations have reduced fitness ──
      // Scientific basis: mate-finding difficulty, inbreeding depression,
      // cooperative defense failure. Seen in passenger pigeons, many fish species.
      const cachedDens2 = c._cachedDensity || 5
      const alleeEffect = cachedDens2 < 3 ? 1.0 + (3 - cachedDens2) * 0.15 : 1.0

      // ── Selection-drift balance (Lynch 2007, Discovery article) ──
      // Scientific basis: in small populations, genetic drift overpowers
      // natural selection. Beneficial mutations are lost and deleterious
      // ones fix at higher rates. The effective population size determines
      // the boundary: selection is efficient when Ne*s >> 1, inefficient
      // when Ne*s << 1. We use local density as a proxy for Ne.
      // Drift load penalty on reproduction: loaded genomes divide less efficiently
      const driftDivPenalty = 1.0 + (c.g.driftLoad || 0) * 0.8

      // Senescence penalty on reproduction: aging cells are less fertile
      // This creates strong selection pressure to reproduce while young
      const senDivPenalty = 1.0 + Math.max(0, (c.senescence || 0) - 0.2) * 2.5

      const sizeCost =
        (1.0 + Math.max(0, c.organismSize - 4) * 0.06 + Math.max(0, c.organismSize - 15) * 0.12) *
        bodyScaleStorage *
        logisticPenalty *
        alleeEffect *
        driftDivPenalty *
        senDivPenalty
      // Maturation delay: cells must reach minimum age before first division
      // Scientific basis: G1 phase checkpoint — cells must grow and accumulate
      // sufficient organelles/proteins before entering S phase (DNA replication).
      // Young cells also pay a higher division cost (immature cellular machinery).
      const minDivAge = 60
      const youthPenalty = c.age < minDivAge * 2 ? 1.0 + (1.0 - c.age / (minDivAge * 2)) * 0.8 : 1.0
      // Hard cap is now a performance safety valve only (set very high)
      if (
        c.age >= minDivAge &&
        c.energy > divisionThreshold * sizeCost * youthPenalty &&
        orgCount < maxOrganisms
      ) {
        // Determine if this cell requires sexual reproduction
        // sexualDrive: 0 = fully asexual, 1 = fully sexual
        const sexGene = c.g.sexuality || 0
        const complexityFactor = Math.min(1, (c.complexity || 0) / 5)
        const sizeFactor = Math.min(1, Math.max(0, c.organismSize - 2) / 6)
        // sexualDrive: even modest sexuality gene + some complexity/size triggers mating
        const sexualDrive = sexGene * (0.5 + complexityFactor * 0.3 + sizeFactor * 0.2)

        let mate = null
        let useSexual = false
        if (sexualDrive > 0.08) {
          // Try to find a mate: same clade, nearby, has energy
          mate = this._findMate(i, spatial)
          if (mate !== null) {
            useSexual = true
          } else if (sexualDrive > 0.5) {
            // Highly sexual organisms MUST find a mate — skip division
            continue
          }
          // Otherwise fall through to asexual division
        }

        c.divisionCount++
        const mateCell = useSexual ? this.cells[mate] : null

        // Energy cost: both parents contribute if sexual
        // Nurturing gene: parents invest more energy into offspring
        // Scientific basis: K-strategy vs r-strategy — nurturing species
        // produce fewer, higher-quality offspring with better survival odds.
        // Epigenetic abundance memory further boosts parental investment.
        const nurt = (c.g.nurturing || 0) + ((c.g.epiMarks || {}).abundanceMemory || 0) * 0.1
        const parentInvest = 0.35 + nurt * 0.15 // 0.35 base, up to 0.50 with max nurturing

        let childEnergy
        if (useSexual) {
          childEnergy = c.energy * parentInvest + mateCell.energy * 0.15
          c.energy *= 1 - parentInvest
          mateCell.energy *= 0.85
          // Emit mating event for visual effect
          if (!this.mateEvents) this.mateEvents = []
          if (this.mateEvents.length < 10) {
            this.mateEvents.push({
              x1: c.x,
              y1: c.y,
              x2: mateCell.x,
              y2: mateCell.y,
              clade: c.clade
            })
          }
        } else {
          childEnergy = c.energy * 0.47
          c.energy *= 0.53
        }

        // ── Formation-governed budding direction ──
        // The daughter cell is placed at a deterministic angle based on
        // the parent's formation genes, creating species-specific shapes.
        const TAU = Math.PI * 2
        const sym = c.g.growthSymmetry ?? 0.5
        const bAngle = (c.g.branchAngle ?? 0.5) * Math.PI // 0..π
        const bOff = (c.g.budOffset ?? 0.5) * TAU // rotational offset
        const compact = c.g.compactness ?? 0.5

        // Determine number of budding slots based on symmetry gene
        let nSlots
        if (sym < 0.3)
          nSlots = 2 // linear: chain/filament
        else if (sym < 0.6)
          nSlots = 4 // bilateral: cross/rectangle
        else nSlots = 3 + Math.floor(sym * 6) // radial: star/rosette (3-8 arms)

        // Pick which slot this division uses (cycles through slots)
        // divisionCount was already incremented, so subtract 1
        const slotIdx = (c.divisionCount - 1) % nSlots

        // Compute budding angle: evenly spaced slots + branch angle spread + offset
        // For linear (2 slots): alternates forward/backward
        // For bilateral (4 slots): 90° increments
        // For radial (N slots): evenly around the circle
        let budAngle
        if (nSlots === 2) {
          // Linear: bud along or against facing direction
          const faceAngle = Math.atan2(c.vy, c.vx)
          budAngle = faceAngle + (slotIdx === 0 ? 0 : Math.PI) + bOff * 0.2
        } else {
          budAngle = (slotIdx / nSlots) * TAU + bOff
        }

        // Add small jitter so it's not perfectly mechanical (biological noise)
        budAngle += randNorm(this.rng) * 0.15

        // Budding distance: governed by compactness (tight = close, loose = far)
        const budDist = 2.5 + (1 - compact) * 2.5 + randNorm(this.rng) * 0.3

        const budX = c.x + Math.cos(budAngle) * budDist
        const budY = c.y + Math.sin(budAngle) * budDist

        // Genome: recombine if sexual, mutate-only if asexual
        // DNA strands are the true genetic material — mutations happen on the strand,
        // then the phenotype (named genes) is re-interpreted from the mutated strand.
        const childResult = useSexual
          ? this._recombineGenomes(c.g, mateCell.g, c.dna, mateCell ? mateCell.dna : null)
          : this._mutateGenome(c.g, c.dna)
        const childGenome = childResult.g
        const childDna = childResult.dna

        // Speciation check: if child genome has diverged enough from the
        // clade's founder genome, assign a new clade (new species).
        // This creates the phylogenetic tree tracing all organisms back
        // to their single-cell ancestors.
        const childClade = this._maybeSpeciate(c.clade, childGenome)

        const child = this._makeCell({
          x: ((budX % this.w) + this.w) % this.w,
          y: ((budY % this.h) + this.h) % this.h,
          energy: childEnergy,
          clade: childClade,
          genome: childGenome,
          dnaStrand: childDna
        })
        this._registerClade(childClade, childGenome.diet)
        child.vx = c.vx + randNorm(this.rng) * 0.06
        child.vy = c.vy + randNorm(this.rng) * 0.06
        for (let oi = 0; oi < ORGANELLE_COUNT; oi++) {
          child.organelles[oi] = c.organelles[oi] * randRange(this.rng, 0.2, 0.6)
          c.organelles[oi] *= randRange(this.rng, 0.5, 0.8)
        }
        // Child inherits partial division history so nucleus signal doesn't start at zero
        child.divisionCount = Math.floor(c.divisionCount * randRange(this.rng, 0.2, 0.5))
        // Sexual offspring inherit averaged complexity from both parents
        if (useSexual) {
          child.complexity = (c.complexity + mateCell.complexity) * 0.5 * randRange(this.rng, 0.3, 0.6)
          c.complexity *= randRange(this.rng, 0.7, 0.9)
          mateCell.complexity *= randRange(this.rng, 0.85, 0.95)
        } else {
          child.complexity = c.complexity * randRange(this.rng, 0.3, 0.6)
          c.complexity *= randRange(this.rng, 0.6, 0.85)
        }
        child.persistDir.x = c.persistDir.x + randNorm(this.rng) * 0.3
        child.persistDir.y = c.persistDir.y + randNorm(this.rng) * 0.3

        // ── Reproductive senescence reset ──
        // Scientific basis: reproduction reactivates telomerase, resetting
        // the cellular aging clock. Germ cells are effectively "immortal"
        // — they pass on rejuvenated DNA to offspring. This gives a strong
        // evolutionary advantage to organisms that reproduce: they partially
        // reverse their own aging and create fresh offspring.
        // Sexual reproduction gives a bigger reset (recombination repairs more damage).
        const senResetFactor = useSexual ? 0.35 : 0.2
        c.senescence = Math.max(0, (c.senescence || 0) * (1 - senResetFactor))
        // Mate also gets a small rejuvenation from sexual reproduction
        if (useSexual && mateCell) {
          mateCell.senescence = Math.max(0, (mateCell.senescence || 0) * 0.9)
        }
        // Child starts with zero senescence (fresh telomeres)
        child.senescence = 0
        child.starveTicks = 0
        child.lifetimeEnergyGain = 0
        child.lifetimeMoveDist = 0

        this.cells.push(child)
        if (this.birthEvents.length < 20)
          this.birthEvents.push({ x: child.x, y: child.y, clade: child.clade, sexual: useSexual })

        // Organism size gate: don't link if organism is already very large
        // Scientific basis: diffusion limits — beyond ~20 cells, nutrient/signal
        // transport becomes a bottleneck without specialized vasculature.
        if (
          c.g.adhesion > 0.25 &&
          c.linkCount < this.cfg.linkMax &&
          child.linkCount < this.cfg.linkMax &&
          c.organismSize < 20
        ) {
          const gamma = this._surfaceTension(c, child)
          // Link rest length governed by compactness gene
          const linkRest = 2.5 + (1 - compact) * 3.0
          this.links.push({
            a: i,
            b: this.cells.length - 1,
            rest: linkRest,
            s: (c.g.adhesion + child.g.adhesion) * 0.5,
            gamma
          })
          c.linkCount++
          child.linkCount++
        }
      }
    }

    // Lifecycle phase ends here — accumulate final timing
    {
      const _t = performance.now()
      _cl_lifeT += _t - _cl_t0
    }
    // Scale sampled sub-timings proportionally to total cellLoop wall time
    const _cl_sampledTotal = _cl_moveT + _cl_feedT + _cl_metabT + _cl_lifeT
    if (_cl_sampledTotal > 0.001) {
      const _cl_totalMs = performance.now() - _sl
      const _cl_r = _cl_totalMs / _cl_sampledTotal
      _sp.cl_movement = +(_cl_moveT * _cl_r).toFixed(3)
      _sp.cl_feeding = +(_cl_feedT * _cl_r).toFixed(3)
      _sp.cl_metabolism = +(_cl_metabT * _cl_r).toFixed(3)
      _sp.cl_lifecycle = +(_cl_lifeT * _cl_r).toFixed(3)
    } else {
      _sp.cl_movement = _sp.cl_feeding = _sp.cl_metabolism = _sp.cl_lifecycle = 0
    }

    _sm('cellLoop')

    // Linking
    if (this.cells.length > 1) {
      const pop = this.cells.length
      const linkStride = pop > 3200 ? 8 : pop > 2200 ? 4 : pop > 1400 ? 2 : 1
      if (this.t % linkStride === 0) this._maybeLink(spatial)
    }

    this._applyLinksForces()
    _sm('links')

    // Clear fragmentation flags after links are processed
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i]._fragmented) this.cells[i]._fragmented = false
    }

    // ── Population-size-dependent drift acceleration (Lynch 2007) ──
    // Scientific basis: genetic drift is inversely proportional to effective
    // population size (Ne). In small populations, drift dominates selection,
    // causing faster accumulation of deleterious mutations and loss of
    // beneficial ones. This is the "nearly neutral" theory of Ohta (1973).
    // We accelerate drift load accumulation for cells in small local populations.
    if (this.t % 32 === 0) {
      for (let i = 0; i < this.cells.length; i++) {
        const c = this.cells[i]
        const localPop = c._cachedDensity || 5
        // Small local populations: drift load accumulates faster
        // Large populations: selection efficiently purges deleterious mutations
        if (localPop < 4 && c.g.driftLoad < 0.8) {
          const driftAccel = (4 - localPop) * 0.0005
          c.g.driftLoad = Math.min(1.0, (c.g.driftLoad || 0) + driftAccel)
        }
        // Large populations with sexual reproduction can slowly purge drift load
        if (localPop > 10 && (c.g.sexuality || 0) > 0.2 && c.g.driftLoad > 0) {
          c.g.driftLoad = Math.max(0, c.g.driftLoad - 0.0002)
        }
      }
    }

    if (this.t % predStride === 0 && this.cells.length > 1) {
      this._predation(spatial)
    }
    _sm('predation')

    // Cull dead/old cells and remap link indices
    this.deathEvents = []
    this.birthEvents = this.birthEvents || []
    this.eatEvents = this.eatEvents || []
    const next = []
    const remap = new Int32Array(this.cells.length)
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      if (c.energy <= 0 || c.age > this.cfg.deathAge) {
        const deathType = c._deathCause === 'senescence' ? 'senescence' : c.energy <= 0 ? 'killed' : 'aged'
        this.deathEvents.push({
          x: c.x,
          y: c.y,
          clade: c.clade,
          energy: Math.max(c.energy, 0.5),
          diet: c.g.diet,
          hueShift: c.g.hueShift || 0,
          brightness: c.g.brightness || 0,
          organelles: c.organelles ? c.organelles.slice() : null,
          type: deathType
        })
        if (c.energy > 0.1) this._dropMeat(c.x, c.y, c.energy * this.cfg.meatDropEnergy)
        // Dead organisms deposit shelter — builds reef/structure over time
        // Scientific basis: coral skeletons, shell middens, tube worm casings accumulate
        const _biome = this.getBiomeConfigAt(c.x, c.y)
        const _shelterRate = _biome ? _biome.shelterRate || 0.5 : 0.5
        this.depositShelter(c.x, c.y, Math.max(c.energy, 0.3) * _shelterRate * 0.05)
        // Horizontal gene transfer: nearby cells with HGT gene absorb some DNA
        // Scientific basis: bacteria acquire genes from lysed neighbors (transformation),
        // enabling rapid adaptation. Key driver of antibiotic resistance spread.
        if ((this.t + i) % 8 === 0) {
          const hgtR2 = 64 // ~8 unit radius
          for (let j = Math.max(0, i - 15); j < Math.min(this.cells.length, i + 15); j++) {
            if (j === i) continue
            const o = this.cells[j]
            if (o.energy <= 0) continue
            const hgtCap = o.g.hgt || 0
            if (hgtCap < 0.05) continue
            const dx = c.x - o.x,
              dy = c.y - o.y
            if (dx * dx + dy * dy > hgtR2) continue
            // Transfer: blend a small fraction of the dead cell's genes into the survivor
            const transferRate = hgtCap * 0.08
            const dg = c.g,
              og = o.g
            // Only transfer a few key adaptive genes (not everything)
            if (this.rng() < transferRate)
              og.toxinResist = Math.min(1, og.toxinResist + (dg.toxinResist || 0) * 0.1)
            if (this.rng() < transferRate)
              og.respiration = Math.min(1, og.respiration + (dg.respiration || 0) * 0.05)
            if (this.rng() < transferRate)
              og.immuneStrength = Math.min(1, (og.immuneStrength || 0) + (dg.immuneStrength || 0) * 0.08)
            if (this.rng() < transferRate)
              og.dnaRepair = Math.min(1, (og.dnaRepair || 0) + (dg.dnaRepair || 0) * 0.05)
            if (this.rng() < transferRate * 0.5)
              og.immuneBits = og.immuneBits ^ ((dg.immuneBits || 0) & (1 << ((this.rng() * 12) | 0)))
          }
        }
        // Drop any carried seeds at death location
        if (c.seeds) {
          for (let si = 0; si < c.seeds.length; si++) {
            this._dropPlantFood(c.x, c.y, c.seeds[si].amount)
          }
        }
        remap[i] = -1
        continue
      }
      remap[i] = next.length
      next.push(c)
    }
    this.cells = next
    // Remap link indices, drop links to dead cells
    const nextLinks = []
    for (let k = 0; k < this.links.length; k++) {
      const L = this.links[k]
      const na = L.a < remap.length ? remap[L.a] : -1
      const nb = L.b < remap.length ? remap[L.b] : -1
      if (na >= 0 && nb >= 0) {
        L.a = na
        L.b = nb
        nextLinks.push(L)
      }
    }
    this.links = nextLinks

    // ── Density-dependent natural population regulation ──
    // All population control is now through natural mechanisms, not artificial culling.
    // Scientific basis: Verhulst logistic model + SIR epidemic threshold + Harman aging theory
    if (this.t % 8 === 0 && this.cells.length > 50) {
      const popN = this.organismCount || this.cells.length
      const K = this.cfg.maxOrganisms // soft carrying capacity

      // 1. SCRAMBLE COMPETITION: at high density, all cells pay an energy tax
      // Scientific basis: scramble (exploitative) competition — each individual
      // gets less as N increases. Seen in Daphnia, flour beetles, yeast.
      // This is the primary mechanism that creates logistic growth curves.
      if (popN > K * 0.4) {
        const overK = (popN - K * 0.4) / (K * 0.6) // 0 at 40% K, 1 at K
        const starvationRate = overK * overK * 0.015 // quadratic — gentle at first, harsh near K
        for (let i = 0; i < this.cells.length; i++) {
          const c = this.cells[i]
          // Larger organisms buffer starvation better (fat reserves)
          const sizeBuffer = Math.min(0.6, c.organismSize * 0.06)
          // High-energy cells lose proportionally more (they're bigger targets for competition)
          c.energy -= c.energy * starvationRate * (1 - sizeBuffer)
        }
      }

      // 2. EPIDEMIC DISEASE: density-dependent pathogen transmission
      // Scientific basis: SIR model — disease spreads when R0 = β*N/γ > 1
      // At low density, pathogens can't find new hosts. At high density, epidemics sweep through.
      // This creates the boom-bust cycles seen in real ecosystems (e.g., snowshoe hare/lynx).
      if (popN > K * 0.6 && this.t % 32 === 0) {
        const epidemicRisk = Math.min(0.8, (popN / K - 0.6) * 1.5)
        if (this.rng() < epidemicRisk) {
          // Disease outbreak — damages a fraction of the population
          const infectionRate = 0.05 + epidemicRisk * 0.1 // 5-15% of pop infected
          for (let i = 0; i < this.cells.length; i++) {
            if (this.rng() > infectionRate) continue
            const c = this.cells[i]
            // Immune resistance: membrane + complexity provide protection
            const immunity = Math.min(
              0.8,
              (c.g.membrane || 0) * 0.3 + (c.complexity || 0) * 0.05 + c.organismSize * 0.04
            )
            const damage = (1 - immunity) * (0.3 + this.rng() * 0.4) // 30-70% energy loss
            c.energy -= c.energy * damage
          }
        }
      }

      // 3. DENSITY-DEPENDENT SENESCENCE: crowded cells age faster
      // Scientific basis: oxidative stress from competition increases cellular damage.
      // Harman free radical theory — metabolic stress accelerates telomere shortening.
      if (popN > K * 0.5) {
        const crowdSen = Math.min(0.0004, (popN / K - 0.5) * 0.0008)
        for (let i = 0; i < this.cells.length; i++) {
          this.cells[i].senescence = (this.cells[i].senescence || 0) + crowdSen
          this.cells[i].age += 1 // minor age bump for compatibility
        }
      }
    }

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

    _sm('deathCleanup')
    _sp._total = +(performance.now() - _st).toFixed(3)
    this.stepProfile = _sp
  }
}
