import { torusDelta } from './helpers.js'
import { ROLE_INTERIOR } from './constants.js'

export function installLinks(Sim) {
  const P = Sim.prototype

  P._buildSpatialIndex = function () {
    const dist = this.cfg.linkDist
    // Cap grid resolution for large worlds — avoid 778K+ empty buckets
    // Target ~200x200 = 40K max buckets
    const maxBuckets = 40000
    const area = this.w * this.h
    const idealCellSize = Math.max(dist * 1.4, 2)
    const idealBuckets = Math.ceil(this.w / idealCellSize) * Math.ceil(this.h / idealCellSize)
    const cellSize = idealBuckets > maxBuckets ? Math.sqrt(area / maxBuckets) : idealCellSize
    const gw = Math.max(1, Math.ceil(this.w / cellSize))
    const gh = Math.max(1, Math.ceil(this.h / cellSize))
    const totalBuckets = gw * gh
    // Reuse grid array between calls to reduce GC pressure
    if (!this._spatialGrid || this._spatialGrid.length !== totalBuckets) {
      this._spatialGrid = new Array(totalBuckets)
      for (let i = 0; i < totalBuckets; i++) this._spatialGrid[i] = []
    } else {
      for (let i = 0; i < totalBuckets; i++) this._spatialGrid[i].length = 0
    }
    const grid = this._spatialGrid
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      let bx = Math.floor((c.x / this.w) * gw)
      let by = Math.floor((c.y / this.h) * gh)
      if (!(bx >= 0 && bx < gw)) bx = 0
      if (!(by >= 0 && by < gh)) by = 0
      grid[bx + by * gw].push(i)
    }
    return { grid, gw, gh }
  }

  P._nearestKinNearbyIndex = function (idx, spatial) {
    const c = this.cells[idx]
    const { grid, gw, gh } = spatial
    let bx = Math.floor((c.x / this.w) * gw)
    let by = Math.floor((c.y / this.h) * gh)
    if (!(bx >= 0 && bx < gw)) bx = 0
    if (!(by >= 0 && by < gh)) by = 0
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

  P._maybeLink = function (spatial) {
    if (!spatial) spatial = this._buildSpatialIndex()
    const n = this.cells.length
    const maxAttempts = Math.max(20, Math.floor(n * (this.cfg.sampleScale ?? 1)))

    // Build a Set of existing link pairs for O(1) duplicate check
    if (!this._linkSet) this._linkSet = new Set()
    const linkSet = this._linkSet
    linkSet.clear()
    for (let k = 0; k < this.links.length; k++) {
      const l = this.links[k]
      const lo = l.a < l.b ? l.a : l.b
      const hi = l.a < l.b ? l.b : l.a
      linkSet.add(lo * 131072 + hi)
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const i = (this.rng() * n) | 0
      const c = this.cells[i]
      const nearest = this._nearestKinNearbyIndex(i, spatial)
      if (!nearest) continue
      // Link formation range scales with the pair's compactness
      // so loose organisms can link at longer range (matching their wider spacing)
      const o2 = this.cells[nearest.idx]
      const pairCompact = ((c.g.compactness ?? 0.5) + (o2.g.compactness ?? 0.5)) * 0.5
      const pairRest = 2.5 + (1 - pairCompact) * 3.0
      const linkDistForPair = pairRest * 1.8
      if (nearest.d2 > linkDistForPair * linkDistForPair) continue
      const j = nearest.idx
      const o = this.cells[j]
      if (c.linkCount >= this.cfg.linkMax || o.linkCount >= this.cfg.linkMax) continue
      // Diffusion limit: organisms beyond ~20 cells can't sustain more growth without vasculature
      if (c.organismSize >= 20 || o.organismSize >= 20) continue

      const gamma = this._surfaceTension(c, o)
      // Staps/Tarnita adhesion co-option: environmental responsiveness
      // _adhesionBoost is set by step.js based on local food conditions
      const boostC = c._adhesionBoost || 0
      const boostO = o._adhesionBoost || 0
      const adhesionAvg = Math.max(
        0,
        Math.min(1, (c.g.adhesion + o.g.adhesion) * 0.5 + (boostC + boostO) * 0.5)
      )
      const p = 0.02 + 0.22 * adhesionAvg * (0.5 + gamma)
      if (this.rng() > p) continue

      const lo = i < j ? i : j
      const hi = i < j ? j : i
      const key = lo * 131072 + hi
      if (linkSet.has(key)) continue
      linkSet.add(key)
      const s = (c.g.adhesion + o.g.adhesion) * 0.5
      const compact = ((c.g.compactness ?? 0.5) + (o.g.compactness ?? 0.5)) * 0.5
      const rest = 2.5 + (1 - compact) * 3.0
      this.links.push({ a: i, b: j, rest, s, gamma })
      c.linkCount++
      o.linkCount++
    }
  }

  P._applyLinksForces = function () {
    const next = []

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
      // Staps/Tarnita life cycle: fragmented cells sever all links
      if (a._fragmented || b._fragmented) {
        a.linkCount = Math.max(0, a.linkCount - 1)
        b.linkCount = Math.max(0, b.linkCount - 1)
        continue
      }
      const dx = torusDelta(b.x - a.x, this.w)
      const dy = torusDelta(b.y - a.y, this.h)
      const d = Math.sqrt(dx * dx + dy * dy) || 0.0001
      const toughAvg = (a.g.toughness + b.g.toughness) * 0.5
      // Break distance proportional to each link's own rest length
      // so all shapes have equal relative stability (no compactness bias)
      const maxKeep = l.rest * 2.4 * (1.0 + toughAvg * 3.0)
      if (d > maxKeep) {
        a.linkCount = Math.max(0, a.linkCount - 1)
        b.linkCount = Math.max(0, b.linkCount - 1)
        continue
      }
      const springK = this.cfg.linkSpring * (0.7 + 0.6 * (l.gamma || 0.5)) * (1.0 + toughAvg * 2.0)
      const f = springK * (d - l.rest)
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
      // Velocity damping scales with adhesion: tight multicellular bodies
      // move as a unit, but loosely bonded mates/flockmates keep individual motion
      const pairAdhesion = (a.g.adhesion + b.g.adhesion) * 0.5
      const damp = this.cfg.linkDamp * (0.3 + 0.7 * pairAdhesion)
      const dvx = b.vx - a.vx,
        dvy = b.vy - a.vy
      a.vx += dvx * damp
      a.vy += dvy * damp
      b.vx -= dvx * damp
      b.vy -= dvy * damp
      // Energy sharing
      const shareBoost = a.role === ROLE_INTERIOR || b.role === ROLE_INTERIOR ? 2.0 : 1.2
      const diff = a.energy - b.energy
      const share = diff * this.cfg.shareRate * l.s * shareBoost
      a.energy -= share
      b.energy += share
      const shareAmt = Math.abs(share)
      if (shareAmt > 0.001) {
        a.cooperationScore = (a.cooperationScore || 0) * 0.99 + shareAmt * 0.01
        b.cooperationScore = (b.cooperationScore || 0) * 0.99 + shareAmt * 0.01
      }
      next.push(l)
    }
    this.links = next

    // Recompute linkCount from surviving links (prevents drift)
    for (let i = 0; i < this.cells.length; i++) this.cells[i].linkCount = 0
    for (let k = 0; k < this.links.length; k++) {
      const L = this.links[k]
      if (L.a < this.cells.length) this.cells[L.a].linkCount++
      if (L.b < this.cells.length) this.cells[L.b].linkCount++
    }
  }
}
