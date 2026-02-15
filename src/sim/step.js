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
import { batch_food_sense } from '../../pkg/evoio_wasm.js'

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
    const len = Math.sqrt(sumGx * sumGx + sumGy * sumGy) || 1
    c.chemoVec.x = sumGx / len
    c.chemoVec.y = sumGy / len
    return { cx: c.chemoVec.x, cy: c.chemoVec.y, strength: sumG / 8 }
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
    const envStride = popNow > 2500 ? 4 : popNow > 1200 ? 2 : 1

    if (this.t % envStride === 0) this._growFood(envStride, foodScarcity, this.sunIntensity)
    if (this.t % (2 * envStride) === 0) this._diffuseStep()
    if (this.t % 4 === 0) this._growMinerals()
    if (this.t % 4 === 0) this._depositSeeds()
    if (this.t % 4 === 0) this._driftFood()
    if (this.t % 8 === 0) this._decayMeat()
    if (this.t % 16 === 0) this._updateCladeStats()
    const predStride = popNow > 1500 ? 3 : popNow > 800 ? 2 : 1

    const maxOrganisms = this.cfg.maxOrganisms | 0
    const orgCount = this.organismCount || this.cells.length

    const spatial = this._buildSpatialIndex()
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

    for (let i = 0; i < startCount; i++) {
      const c = this.cells[i]
      c.age++
      c.membranePhase += 0.03 + 0.02 * c.g.speed

      if (startCount < 600 || (i + this.t) % 2 === 0) this._developOrganelles(c)

      // Guard against NaN organelles
      for (let _oi = 0; _oi < ORGANELLE_COUNT; _oi++) {
        if (!isFinite(c.organelles[_oi])) c.organelles[_oi] = 0
      }

      if (c.age % 8 === 0) {
        let orgSum = 0
        for (let oi = 0; oi < ORGANELLE_COUNT; oi++) orgSum += c.organelles[oi]
        const orgBonus = orgSum * 0.003
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
        c.complexity = Math.min(c.complexity + orgBonus + linkBonus + roleBonus + morphBonus, 10.0)
      }

      this._updatePersistence(c)

      const mitoBonus = c.organelles[ORGANELLE_MITOCHONDRIA]
      const flagBonus = c.organelles[ORGANELLE_FLAGELLUM]
      const recBonus = c.organelles[ORGANELLE_RECEPTOR]
      const vacBonus = c.organelles[ORGANELLE_VACUOLE]

      // Eyespot: doubles effective sense range (stigma/photoreceptor)
      const eyespotBonus = (c.g.eyespot || 0) > 0.1 ? 1.0 + (c.g.eyespot || 0) * 1.0 : 1.0
      const sense = c.g.sense * (1 + recBonus * 1.2) * eyespotBonus
      const speed = c.g.speed * (1 + flagBonus * 0.8)
      const metabolism = c.g.metabolism * (1 - mitoBonus * 0.35)
      const divisionThreshold = c.g.division * (1 - vacBonus * 0.15)

      const flagellaBoost = c.g.flagella * 0.8
      const ciliaBoost = c.g.cilia * 0.4
      const amoeboidBoost = c.g.amoeboid * 0.3
      const flipperBoost = c.g.flipper * 0.6
      const paddleFinBoost = (c.g.paddleFin || 0) * 0.7
      const membraneDrag = c.g.membrane * 0.15
      const elongDrag = (c.g.elongation || 0) * 0.08
      const bodySizeDrag = Math.max(0, (c.g.bodyScale || 1) - 1) * 0.06
      const spinesCost = c.g.spines * 0.002
      const camoEnergyCost = c.g.camouflage * 0.001
      if (c.jetCooldown > 0) c.jetCooldown--
      if (c.toxinTimer > 0) c.toxinTimer--

      const skipChemo = startCount > 400 && (i + this.t) % 3 !== 0
      const chemo = skipChemo
        ? { cx: c.chemoVec.x, cy: c.chemoVec.y, strength: 0 }
        : this._computeChemotaxis(c)

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
        this.cfg.baseMove * speed * (1 - membraneDrag - elongDrag - bodySizeDrag - shellDrag - stalkDrag)
      const gw = this.cfg.gradientWeight
      // Cilia: maneuverability — ciliated cells turn faster (reduced persistence lock)
      const ciliaAgility = c.g.cilia > 0.15 ? 1.0 - c.g.cilia * 0.4 : 1.0
      const persist = c.g.persistence * this.cfg.persistenceStrength * ciliaAgility

      const cilFactor =
        c.contactCount > 0 ? Math.max(0.5, 1 - this.cfg.contactInhibition * Math.min(c.contactCount, 4)) : 1.0

      let roleSpeedMod = 1.0
      if (c.role === ROLE_PIONEER) roleSpeedMod = 1.3
      else if (c.role === ROLE_INTERIOR) roleSpeedMod = 0.75
      else if (c.role === ROLE_EDGE) roleSpeedMod = 1.1

      const bold = c.g.boldness ?? 0.5
      const social = c.g.sociality ?? 0.3

      const foodW = gw * (0.3 + bold * 0.4)
      const chemoW = gw * (0.3 + bold * 0.2)
      const wanderW = (1 - gw) * (1.2 - bold * 0.4)
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

      if (social > 0.15 && c.linkCount === 0 && (startCount < 600 || (i + this.t) % 2 === 0)) {
        // Flocking: loose cohesion + separation so species members stay in the
        // same region without collapsing into a single lockstep blob.
        // Inspired by Boids: attract when far, repel when too close, align headings.
        let cohX = 0,
          cohY = 0,
          sepX = 0,
          sepY = 0,
          aliX = 0,
          aliY = 0
        let nNear = 0
        const searchR = 12 + social * 20
        const searchR2 = searchR * searchR
        const comfortR = 4 + social * 4 // personal space radius
        const comfortR2 = comfortR * comfortR
        const scanW = startCount > 1000 ? 15 : 30
        for (let j = Math.max(0, i - scanW); j < Math.min(startCount, i + scanW); j++) {
          if (j === i) continue
          const other = this.cells[j]
          if (other.clade !== c.clade) continue
          let ddx = other.x - c.x,
            ddy = other.y - c.y
          if (ddx > this.w / 2) ddx -= this.w
          else if (ddx < -this.w / 2) ddx += this.w
          if (ddy > this.h / 2) ddy -= this.h
          else if (ddy < -this.h / 2) ddy += this.h
          const d2 = ddx * ddx + ddy * ddy
          if (d2 > searchR2 || d2 < 0.01) continue
          const dist = Math.sqrt(d2)
          nNear++
          // Cohesion: gentle pull toward neighbor (weakens as they get closer)
          const cohStr = Math.max(0, dist - comfortR) / searchR
          cohX += (ddx / dist) * cohStr
          cohY += (ddy / dist) * cohStr
          // Separation: push away when inside comfort zone
          if (d2 < comfortR2) {
            const sepStr = (comfortR - dist) / comfortR
            sepX -= (ddx / dist) * sepStr
            sepY -= (ddy / dist) * sepStr
          }
          // Alignment: loosely match heading of neighbors
          aliX += other.vx
          aliY += other.vy
        }
        if (nNear > 0) {
          const inv = 1 / nNear
          // Cohesion — weak pull to keep species in same area
          wx += cohX * inv * social * 0.15
          wy += cohY * inv * social * 0.15
          // Separation — prevent clumping
          wx += sepX * inv * social * 0.25
          wy += sepY * inv * social * 0.25
          // Alignment — subtle heading match (much weaker than cohesion)
          const aliLen = Math.sqrt(aliX * aliX + aliY * aliY) || 1
          wx += (aliX / aliLen) * social * 0.06
          wy += (aliY / aliLen) * social * 0.06
        }
      }

      // ── Predator-prey behavioral AI ──
      // Only compute every few ticks for performance, cache the result
      if ((i + this.t) % 3 === 0 && startCount > 5) {
        let fleeX = 0,
          fleeY = 0
        let chaseX = 0,
          chaseY = 0
        const senseR = (sense * 2.5 + 4) * (1 + recBonus * 0.5)
        const senseR2 = senseR * senseR
        const scanRange = Math.min(40, Math.max(10, Math.floor(startCount * 0.02)))

        for (let j = Math.max(0, i - scanRange); j < Math.min(startCount, i + scanRange); j++) {
          if (j === i) continue
          const o = this.cells[j]
          if (o.clade === c.clade) continue
          const ddx = torusDelta(o.x - c.x, this.w)
          const ddy = torusDelta(o.y - c.y, this.h)
          const d2 = ddx * ddx + ddy * ddy
          if (d2 > senseR2 || d2 < 0.01) continue
          const dist = Math.sqrt(d2)
          const nx = ddx / dist,
            ny = ddy / dist

          // FLEE: if I'm herbivorous and they're carnivorous, run away
          // Scientific basis: prey species detect predator chemical cues
          // (kairomones) and flee — seen in zooplankton, fish, mammals
          if (c.g.diet < 0.5 && o.g.diet > 0.5) {
            const threat = o.g.diet * o.energy * 0.5 // how dangerous they are
            const urgency = 1.0 / (1.0 + dist * 0.15) // closer = more urgent
            const fleeStr = threat * urgency * (1 - c.g.diet) * sense
            fleeX -= nx * fleeStr
            fleeY -= ny * fleeStr
          }

          // CHASE: if I'm carnivorous and they're smaller/weaker, pursue
          // Scientific basis: predators use visual/chemical tracking to
          // actively pursue prey — wolves, sharks, amoeba phagocytosis
          if (c.g.diet > 0.4 && o.energy < c.energy * 1.5) {
            const preyValue = (1 - o.g.diet) * o.energy * 0.3 // prefer herbivores
            const proximity = 1.0 / (1.0 + dist * 0.1)
            const chaseStr = preyValue * proximity * c.g.diet * speed
            chaseX += nx * chaseStr
            chaseY += ny * chaseStr
          }
        }

        c._fleeX = fleeX
        c._fleeY = fleeY
        c._chaseX = chaseX
        c._chaseY = chaseY
      }

      // Apply cached flee/chase vectors
      const fleeScale = 0.6 * (1 - c.g.diet) // herbivores flee more
      const chaseScale = 0.5 * c.g.diet // carnivores chase more
      wx += (c._fleeX || 0) * fleeScale
      wy += (c._fleeY || 0) * fleeScale
      wx += (c._chaseX || 0) * chaseScale
      wy += (c._chaseY || 0) * chaseScale

      // ── Phototropism: move toward sunlight ──
      // Herbivores with high phototropism gene chase the lit side of the world
      const photoGene = c.g.phototropism || 0
      if (photoGene > 0.05) {
        const photoStr = photoGene * (1 - c.g.diet) * 0.4 // only herbivores benefit
        const sunDx = Math.cos(this.sunAngle)
        const sunDy = Math.sin(this.sunAngle)
        wx += sunDx * photoStr
        wy += sunDy * photoStr
      }

      if (c.g.flagella > 0.05) {
        const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
        wx += (c.vx / vLen) * flagellaBoost
        wy += (c.vy / vLen) * flagellaBoost
      }
      if (c.g.flipper > 0.1) {
        const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
        wx += (c.vx / vLen) * flipperBoost
        wy += (c.vy / vLen) * flipperBoost
      }
      // Elongation: strong forward thrust along current heading, resists turning
      if ((c.g.elongation || 0) > 0.1) {
        const el = c.g.elongation
        const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
        wx += (c.vx / vLen) * el * 1.2
        wy += (c.vy / vLen) * el * 1.2
      }
      // Paddle fins: broad directional thrust with slight lateral stability
      if ((c.g.paddleFin || 0) > 0.1) {
        const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
        wx += (c.vx / vLen) * paddleFinBoost
        wy += (c.vy / vLen) * paddleFinBoost
      }
      if (c.g.amoeboid > 0.05) {
        wx += randNorm(this.rng) * amoeboidBoost
        wy += randNorm(this.rng) * amoeboidBoost
      }
      if (c.g.jet > 0.1 && c.jetCooldown === 0 && c.energy > 0.8) {
        const jetPower = c.g.jet * 2.5
        const vLen = Math.sqrt(wx * wx + wy * wy) || 0.001
        c.vx += (wx / vLen) * jetPower
        c.vy += (wy / vLen) * jetPower
        c.energy -= c.g.jet * 0.15
        c.jetCooldown = Math.max(8, 30 - c.g.jet * 20) | 0
      }

      c.vx += wx * moveAmt * cilFactor * roleSpeedMod
      c.vy += wy * moveAmt * cilFactor * roleSpeedMod

      const v = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.0001
      const mechSpeedBonus = c.g.flagella * 0.3 + c.g.jet * 0.5
      // Elongation: streamlined body = higher top speed (like a fish vs a sphere)
      const elongSpeedBonus = (c.g.elongation || 0) * 0.4
      const vmax = (0.55 + 0.65 * speed + mechSpeedBonus + elongSpeedBonus) * roleSpeedMod
      if (v > vmax) {
        c.vx = (c.vx / v) * vmax
        c.vy = (c.vy / v) * vmax
      }

      if (c.eatFlash > 0) c.eatFlash--
      if (c.engulfing > 0) c.engulfing--

      const prevEnergy = c.energy

      const depthPenalty = c.organismDepth > 0 ? Math.max(0.65, 1.0 - c.organismDepth * 0.08) : 1.0
      const orgFeedBonus = c.organismSize > 1 ? 1.0 + Math.min(c.organismSize, 8) * 0.06 : 1.0
      // Local resource competition: uptake drops in crowded areas
      // Scientific basis: scramble competition — more individuals sharing
      // the same food patch means each gets a smaller share
      const cachedDens = c._cachedDensity || 5
      const competitionPenalty = cachedDens > 6 ? Math.max(0.5, 1.0 - (cachedDens - 6) * 0.02) : 1.0
      const uptakeBase =
        this.cfg.uptake *
        (0.75 + 0.35 * sense) *
        (1 + recBonus * 0.5) *
        depthPenalty *
        orgFeedBonus *
        competitionPenalty

      // Bioluminescence: pull nearby food toward this cell
      if ((c.g.biolum || 0) > 0.1 && this.t % 8 === 0) {
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
        const pVLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
        feedX = c.x + (c.vx / pVLen) * probRange
        feedY = c.y + (c.vy / pVLen) * probRange
      }
      // Amoeboid: pseudopods extend surface area for absorption — sample food in a ring
      const amoeboidUptakeBonus = (c.g.amoeboid || 0) > 0.15 ? 1.0 + c.g.amoeboid * 0.8 : 1.0
      // Stalk: sessile filter feeding — anchored cells get +50% ground food uptake
      // Scientific basis: stalked ciliates (Vorticella), barnacles, sea lilies —
      // sessile organisms compensate for immobility with enhanced local resource extraction
      const stalkUptakeBonus = (c.g.stalk || 0) > 0.1 ? 1.0 + (c.g.stalk || 0) * 0.5 : 1.0
      // Sample sunlight at cell position (used by chloroplast photosynthesis later)
      const localSunlight = this._sampleSunlight(c.x, c.y)
      const plantTake = this._takeFood(
        feedX,
        feedY,
        uptakeBase * herbivoreAff * amoeboidUptakeBonus * stalkUptakeBonus
      )
      c.energy += plantTake
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
      if (c.g.cilia > 0.15 && (i + this.t) % 4 === 0) {
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
      if ((c.g.symbiosis || 0) > 0.15 && (i + this.t) % 6 === 0) {
        const sym = c.g.symbiosis
        const shareR = 5 + sym * 8
        const shareR2 = shareR * shareR
        const scanW = Math.min(20, Math.max(5, Math.floor(startCount * 0.01)))
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

      // Amoeboid: pseudopods also absorb minerals better (engulfing particles)
      if ((c.g.amoeboid || 0) > 0.15) {
        const amoebMineralBonus = this._takeMineral(c.x, c.y, uptakeBase * c.g.amoeboid * 0.3)
        c.energy += amoebMineralBonus * this.cfg.mineralEnergy
      }

      // Proboscis: parasitic energy drain — siphon energy from nearby non-kin cells
      if ((c.g.proboscis || 0) > 0.2 && c.g.diet > 0.3 && this.t % 8 === 0) {
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

      // ── Density-dependent metabolism (logistic growth / Verhulst) ──
      // Crowded cells pay more energy — this creates natural carrying capacity.
      // Scientific basis: intraspecific competition for resources increases
      // metabolic stress when population density is high locally.
      const localDens = (i + this.t) % 4 === 0 ? this._localDensity(c, spatial) : c._cachedDensity || 5
      c._cachedDensity = localDens
      // crowdingStress: 1.0 at low density, up to ~1.6 at very high density
      const crowdingStress = 1.0 + Math.max(0, localDens - 8) * 0.025
      // Organisms buffer crowding via cooperation (division of labor)
      const orgCrowdBuffer = c.organismSize > 1 ? Math.max(0.7, 1.0 - c.organismSize * 0.03) : 1.0

      // Multicellular metabolic efficiency
      const orgMetabBonus =
        c.organismSize > 1 ? Math.max(0.6, 1.0 - Math.min(c.organismSize, 10) * 0.04) : 1.0
      // Solitary penalty: as environment gets harsher, unlinked cells pay more
      const solitaryPenalty = c.linkCount === 0 ? envHarshness : Math.max(1.0, envHarshness * 0.7)
      // PaddleFin: energy-efficient locomotion at speed
      const paddleEfficiency = (c.g.paddleFin || 0) > 0.15 ? 1.0 - c.g.paddleFin * 0.25 : 1.0
      // Carnivore metabolic discount: predators have efficient resting metabolism
      // (feast-famine adaptation — cats, snakes, crocodiles all have low BMR)
      const carnivoreMetab = c.g.diet > 0.5 ? Math.max(0.55, 1.0 - c.g.diet * 0.45) : 1.0
      // Biome-specific metabolism multiplier
      let biomeMetab = 1.0
      const _biomes = this.cfg.biomes
      if (_biomes && _biomes.length > 0) {
        const _regionW = this.w / _biomes.length
        const _bi = Math.min(_biomes.length - 1, (c.x / _regionW) | 0)
        biomeMetab = _biomes[_bi].metabolismMult || 1.0
      }
      c.energy -=
        this.cfg.metabolismBase *
        metabolism *
        (1 + 0.7 * speed * paddleEfficiency) *
        this.cfg.dt *
        orgMetabBonus *
        solitaryPenalty *
        crowdingStress *
        orgCrowdBuffer *
        carnivoreMetab *
        biomeMetab
      c.energy -= spinesCost
      c.energy -= c.g.flipper * 0.001
      c.energy -= c.g.cilia * 0.0008
      c.energy -= c.g.flagella * 0.0012
      c.energy -= c.g.jet * 0.002
      c.energy -= c.g.amoeboid * 0.0003
      c.energy -= c.g.toxin * 0.0015
      c.energy -= c.g.spike * 0.001
      c.energy -= c.g.constrict * 0.0008
      c.energy -= camoEnergyCost
      c.energy -= (c.g.toxinResist || 0) * 0.0005
      c.energy -= (c.g.elongation || 0) * 0.0004
      c.energy -= (c.g.biolum || 0) * 0.0018
      c.energy -= (c.g.vesicles || 0) * 0.001
      c.energy -= Math.max(0, (c.g.bodyScale || 1) - 1) * 0.0008
      c.energy -= (c.g.brightness || 0) * 0.0006
      c.energy -= (c.g.proboscis || 0) * 0.0005
      c.energy -= (c.g.paddleFin || 0) * 0.0008
      c.energy -= (c.g.scavenger || 0) * 0.0006
      c.energy -= (c.g.shell || 0) * 0.0015
      c.energy -= (c.g.symbiosis || 0) * 0.0008
      c.energy -= (c.g.eyespot || 0) * 0.0006
      c.energy -= (c.g.stalk || 0) * 0.0004

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
      let bestFitDist = Infinity
      const gPeaks = this.gradientPeaks || [this.gradientPeak]
      for (let gpi = 0; gpi < gPeaks.length; gpi++) {
        const gdx = torusDelta(c.x - gPeaks[gpi].x, this.w)
        const gdy = torusDelta(c.y - gPeaks[gpi].y, this.h)
        const gd = Math.sqrt(gdx * gdx + gdy * gdy)
        if (gd < bestFitDist) bestFitDist = gd
      }
      c.fitnessDist = bestFitDist
      c.fitnessAccum += 1.0 / (1.0 + c.fitnessDist * 0.02)

      if (!isFinite(c.vx)) c.vx = 0
      if (!isFinite(c.vy)) c.vy = 0
      c.x = (((c.x + c.vx) % this.w) + this.w) % this.w
      c.y = (((c.y + c.vy) % this.h) + this.h) % this.h
      if (!isFinite(c.x)) c.x = this.w * 0.5
      if (!isFinite(c.y)) c.y = this.h * 0.5
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
        this._dropMeat(c.x, c.y, c.energy * this.cfg.meatDropEnergy)
        c.energy = -1
      }

      // ── Natural aging death for solitary (single-cell) organisms ──
      // Scientific basis: Hayflick limit — cells have finite replicative lifespan.
      // Multicellular organisms buffer aging via cell replacement and cooperation.
      // Solitary cells accumulate damage and eventually senesce.
      // Lifespan is determined by many factors:
      //   longevity gene, membrane integrity, toughness, body scale,
      //   energy reserves, complexity, and metabolic rate.
      // Natural deaths drop generous carrion, creating a scavenger niche.
      if (c.organismSize <= 1 && c.age > 800) {
        const longevityGene = c.g.longevity || 0.5
        // Base lifespan: 2000-8000 ticks depending on longevity gene
        const baseLifespan = 2000 + longevityGene * 6000
        // Modifiers that extend lifespan
        const membraneBonus = 1.0 + (c.g.membrane || 0) * 0.4 // tough membrane protects
        const toughnessBonus = 1.0 + (c.g.toughness || 0) * 0.3 // structural integrity
        const bodyScaleBonus = 1.0 + Math.max(0, (c.g.bodyScale || 1) - 0.8) * 0.2 // larger = longer-lived
        const complexityBonus = 1.0 + (c.complexity || 0) * 0.05 // more complex = better repair
        // Modifiers that shorten lifespan
        const speedPenalty = 1.0 / (1.0 + (c.g.speed || 1) * 0.1) // fast metabolism = shorter life
        const toxinPenalty = 1.0 / (1.0 + (c.g.toxin || 0) * 0.3) // toxin production is costly
        // Energy reserves extend life (well-fed organisms live longer)
        const energyBonus = 1.0 + Math.min(1.0, c.energy * 0.15)

        const maxAge =
          baseLifespan *
          membraneBonus *
          toughnessBonus *
          bodyScaleBonus *
          complexityBonus *
          speedPenalty *
          toxinPenalty *
          energyBonus

        if (c.age > maxAge) {
          // Senescence: increasing probability of death as age exceeds lifespan
          const overAge = (c.age - maxAge) / (maxAge * 0.3) // 0..1 over 30% of lifespan
          const deathProb = Math.min(0.15, overAge * overAge * 0.05)
          if (this.rng() < deathProb) {
            // Natural death — drop generous carrion (more than predation kills)
            // This creates the ecological niche for scavengers
            const carrionAmount = c.energy * 0.8 + 0.5 // generous drop
            this._dropMeat(c.x, c.y, carrionAmount)
            c._deathCause = 'senescence'
            c.energy = -1 // mark for death
          }
        }
      }

      // Division — sexual or asexual depending on complexity & sexuality gene
      // Body scale: large cells store more energy before dividing (fat reserves)
      const bodyScaleStorage = (c.g.bodyScale || 1.0) > 1.1 ? 1.0 + ((c.g.bodyScale || 1.0) - 1.0) * 0.5 : 1.0

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

      const sizeCost =
        (1.0 + Math.max(0, c.organismSize - 4) * 0.03) * bodyScaleStorage * logisticPenalty * alleeEffect
      // Hard cap is now a performance safety valve only (set very high)
      if (c.energy > divisionThreshold * sizeCost && orgCount < maxOrganisms) {
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
        let childEnergy
        if (useSexual) {
          childEnergy = c.energy * 0.35 + mateCell.energy * 0.15
          c.energy *= 0.65
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
        const childGenome = useSexual ? this._recombineGenomes(c.g, mateCell.g) : this._mutateGenome(c.g)

        const child = this._makeCell({
          x: ((budX % this.w) + this.w) % this.w,
          y: ((budY % this.h) + this.h) % this.h,
          energy: childEnergy,
          clade: c.clade,
          genome: childGenome
        })
        this._registerClade(c.clade, c.g.diet)
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
        this.cells.push(child)
        if (this.birthEvents.length < 20)
          this.birthEvents.push({ x: child.x, y: child.y, clade: child.clade, sexual: useSexual })

        if (c.g.adhesion > 0.25 && c.linkCount < this.cfg.linkMax && child.linkCount < this.cfg.linkMax) {
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

    // Linking
    if (this.cells.length > 1) {
      const pop = this.cells.length
      const linkStride = pop > 3200 ? 8 : pop > 2200 ? 4 : pop > 1400 ? 2 : 1
      if (this.t % linkStride === 0) this._maybeLink(spatial)
    }

    this._applyLinksForces()

    if (this.t % predStride === 0 && this.cells.length > 1) {
      this._predation(spatial)
    }

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
        const agingAccel = Math.min(3, (popN / K - 0.5) * 4) // 0-3 extra age ticks
        for (let i = 0; i < this.cells.length; i++) {
          this.cells[i].age += agingAccel | 0
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
  }
}
