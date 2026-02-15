import { torusDelta } from './helpers.js'
import { ROLE_NONE, ROLE_EDGE, ROLE_INTERIOR, ROLE_PIONEER } from './constants.js'

export function installRoles(Sim) {
  const P = Sim.prototype

  P._assignRoles = function (spatial) {
    const { grid, gw, gh } = spatial
    const linkDistSq = this.cfg.linkDist * this.cfg.linkDist * 2.5

    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      if (c.linkCount === 0) {
        c.role = ROLE_NONE
        c.contactCount = 0
        continue
      }

      let bx = Math.floor((c.x / this.w) * gw)
      let by = Math.floor((c.y / this.h) * gh)
      if (!(bx >= 0 && bx < gw)) bx = 0
      if (!(by >= 0 && by < gh)) by = 0
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
      c.organismDepth = kinNear

      if (kinNear >= 3 && totalNear >= 4) {
        c.role = ROLE_INTERIOR
      } else if (kinNear >= 1) {
        // Use nearest gradient peak for pioneer direction
        let gdx = 0,
          gdy = 0,
          gBestD = Infinity
        const rPeaks = this.gradientPeaks || [this.gradientPeak]
        for (let rpi = 0; rpi < rPeaks.length; rpi++) {
          const rdx = torusDelta(rPeaks[rpi].x - c.x, this.w)
          const rdy = torusDelta(rPeaks[rpi].y - c.y, this.h)
          const rd = Math.sqrt(rdx * rdx + rdy * rdy)
          if (rd < gBestD) {
            gBestD = rd
            gdx = rdx
            gdy = rdy
          }
        }
        const gLen = gBestD || 1
        const dot = (c.vx * gdx + c.vy * gdy) / gLen
        if (dot > 0.02 && c.g.flagellaApt > 0.3) {
          c.role = ROLE_PIONEER
        } else {
          c.role = ROLE_EDGE
        }
      } else {
        c.role = ROLE_NONE
      }
    }

    // Union-Find for organism sizes
    const parent = new Int32Array(this.cells.length)
    const rank = new Uint8Array(this.cells.length)
    for (let i = 0; i < parent.length; i++) parent[i] = i
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]]
        x = parent[x]
      }
      return x
    }
    function union(a, b) {
      a = find(a)
      b = find(b)
      if (a === b) return
      if (rank[a] < rank[b]) {
        const t = a
        a = b
        b = t
      }
      parent[b] = a
      if (rank[a] === rank[b]) rank[a]++
    }
    for (let k = 0; k < this.links.length; k++) {
      const L = this.links[k]
      if (L.a < this.cells.length && L.b < this.cells.length) union(L.a, L.b)
    }
    const sizes = new Map()
    for (let i = 0; i < this.cells.length; i++) {
      const r = find(i)
      sizes.set(r, (sizes.get(r) || 0) + 1)
    }
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i].organismSize = sizes.get(find(i)) || 1
    }
    // Track total number of distinct organisms (connected components)
    this.organismCount = sizes.size
  }
}
