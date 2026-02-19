import { torusDelta } from './helpers.js'
import { makeRng } from '../rng.js'

export function installWorld(Sim) {
  const P = Sim.prototype

  P._initGradient = function () {
    const peakCount = this.cfg.gradientPeaks || 1
    this.gradientPeaks = []
    for (let pi = 0; pi < peakCount; pi++) {
      this.gradientPeaks.push(this._randomBlobInteriorPoint())
    }
    this.gradientPeak = this.gradientPeaks[0] // backward compat
    this._rebuildGradientField()
  }

  P._rebuildGradientField = function () {
    const w = this.w,
      h = this.h
    this.gradientField = new Float32Array(w * h)
    const maxDist = Math.sqrt(w * w + h * h)
    const slope = this.cfg.gradientSlope
    const noise = this.cfg.gradientNoise
    const peaks = this.gradientPeaks || [this.gradientPeak]
    const nPeaks = peaks.length
    // Downsample: compute gradient at 1/4 resolution, then upscale
    const ds = 4
    const dsw = Math.ceil(w / ds)
    const dsh = Math.ceil(h / ds)
    const dsField = new Float32Array(dsw * dsh)
    for (let diy = 0; diy < dsh; diy++) {
      const iy = diy * ds
      for (let dix = 0; dix < dsw; dix++) {
        const ix = dix * ds
        let best = 0
        for (let pi = 0; pi < nPeaks; pi++) {
          const pk = peaks[pi]
          let dx = ix - pk.x
          if (dx > w * 0.5) dx -= w
          else if (dx < -w * 0.5) dx += w
          let dy = iy - pk.y
          if (dy > h * 0.5) dy -= h
          else if (dy < -h * 0.5) dy += h
          const d = Math.sqrt(dx * dx + dy * dy)
          const val = 1.0 + slope * (maxDist - d)
          if (val > best) best = val
        }
        dsField[dix + diy * dsw] = best
      }
    }
    // Upscale with bilinear interpolation + noise
    const invDs = 1.0 / ds
    for (let iy = 0; iy < h; iy++) {
      const fy = iy * invDs
      const diy0 = Math.min(dsh - 1, fy | 0)
      const diy1 = Math.min(dsh - 1, diy0 + 1)
      const ty = fy - diy0
      const rowOff = iy * w
      for (let ix = 0; ix < w; ix++) {
        const fx = ix * invDs
        const dix0 = Math.min(dsw - 1, fx | 0)
        const dix1 = Math.min(dsw - 1, dix0 + 1)
        const tx = fx - dix0
        const v00 = dsField[dix0 + diy0 * dsw]
        const v10 = dsField[dix1 + diy0 * dsw]
        const v01 = dsField[dix0 + diy1 * dsw]
        const v11 = dsField[dix1 + diy1 * dsw]
        let val = v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
        if (this.rng() < noise) val = 0
        this.gradientField[ix + rowOff] = val > 0 ? val : 0
      }
    }
  }

  P._shiftSeason = function () {
    this.season++
    this.seasonTick = 0
    const peaks = this.gradientPeaks || [this.gradientPeak]
    // Shift each peak to a new well-separated location
    for (let pi = 0; pi < peaks.length; pi++) {
      const oldPeak = peaks[pi]
      let pick
      for (let attempts = 0; attempts < 20; attempts++) {
        pick = this._randomBlobInteriorPoint()
        // Ensure new peak is far from old position
        const dx = Math.abs(pick.x - oldPeak.x)
        const dy = Math.abs(pick.y - oldPeak.y)
        if (dx > this.w * 0.15 || dy > this.h * 0.15) {
          // Also ensure it's not too close to other new peaks
          let tooClose = false
          for (let oi = 0; oi < pi; oi++) {
            const odx = Math.abs(pick.x - peaks[oi].x)
            const ody = Math.abs(pick.y - peaks[oi].y)
            if (odx < this.w * 0.15 && ody < this.h * 0.15) {
              tooClose = true
              break
            }
          }
          if (!tooClose) break
        }
      }
      peaks[pi] = pick
    }
    this.gradientPeak = peaks[0] // backward compat
    this._rebuildGradientField()
  }

  P._generateBarriers = function () {
    this.barriers = []
    const count = 6 + ((this.rng() * 8) | 0)
    for (let i = 0; i < count; i++) {
      const angle = this.rng() * Math.PI * 2
      const frac = 0.2 + this.rng() * 0.55
      const r = this._blobRadiusAt(angle) * frac
      const cx = this.blobCenter.x + Math.cos(angle) * r
      const cy = this.blobCenter.y + Math.sin(angle) * r
      const bRadius = 10 + this.rng() * 20
      const verts = 12 + ((this.rng() * 8) | 0)
      const points = []
      const harmonics = []
      for (let h = 0; h < 4; h++) {
        harmonics.push({
          amp: this.rng() * 0.25,
          freq: 2 + ((this.rng() * 4) | 0),
          phase: this.rng() * Math.PI * 2
        })
      }
      for (let v = 0; v < verts; v++) {
        const va = (v / verts) * Math.PI * 2
        let vr = bRadius
        for (let h = 0; h < harmonics.length; h++) {
          vr += bRadius * harmonics[h].amp * Math.sin(va * harmonics[h].freq + harmonics[h].phase)
        }
        vr = Math.max(bRadius * 0.5, vr)
        points.push({
          x: cx + Math.cos(va) * vr,
          y: cy + Math.sin(va) * vr
        })
      }
      this.barriers.push({ cx, cy, radius: bRadius, points })
    }
  }

  P.isInsideBarrier = function (x, y) {
    for (let i = 0; i < this.barriers.length; i++) {
      const b = this.barriers[i]
      const dx = x - b.cx,
        dy = y - b.cy
      if (dx * dx + dy * dy < b.radius * b.radius) return true
    }
    return false
  }

  P._enforceBarriers = function (c) {
    for (let i = 0; i < this.barriers.length; i++) {
      const b = this.barriers[i]
      const dx = c.x - b.cx,
        dy = c.y - b.cy
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001
      if (dist < b.radius + 1.5) {
        const pushR = b.radius + 2
        c.x = b.cx + (dx / dist) * pushR
        c.y = b.cy + (dy / dist) * pushR
        const nx = dx / dist,
          ny = dy / dist
        const dot = c.vx * nx + c.vy * ny
        if (dot < 0) {
          c.vx -= 1.8 * dot * nx
          c.vy -= 1.8 * dot * ny
        }
      }
    }
  }

  P._randomBlobInteriorPoint = function () {
    const angle = this.rng() * Math.PI * 2
    const frac = 0.3 + this.rng() * 0.4
    const r = this._blobRadiusAt(angle) * frac
    return {
      x: this.blobCenter.x + Math.cos(angle) * r,
      y: this.blobCenter.y + Math.sin(angle) * r
    }
  }

  // ── Single-blob world with biome regions ──
  // One amorphous body of water spanning the full world width.
  // Biomes are just x-regions within it — no separate blobs or channels.
  P._generateWorldBlob = function () {
    const cx = this.w / 2
    const cy = this.h / 2
    // Mildly elliptical blob — wide enough to cover biome regions, tall enough to look round
    const baseRy = this.h * 0.46 // vertical radius fits height
    const baseRx = baseRy * 1.6 // horizontal radius ~1.6x taller for mild ellipse
    const harmonics = 8 + ((this.rng() * 5) | 0)
    const harms = []
    for (let i = 0; i < harmonics; i++) {
      harms.push({
        freq: i + 2,
        amp: (this.rng() * 0.06) / (i + 1),
        phase: this.rng() * Math.PI * 2
      })
    }

    this.blobCenter = { x: cx, y: cy }
    this.blobBaseRx = baseRx
    this.blobBaseRy = baseRy
    this.blobBaseR = baseRy // backward compat (used by barriers etc)
    this.blobHarmonics = harms
    this.biomeBlobs = null // no separate blobs

    // Generate outline points for rendering
    const n = 96 // more points for the wider shape
    this.blobPoints = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const r = this._blobRadiusAt(a)
      this.blobPoints.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r
      })
    }
  }

  P._regenerateBlobShape = function (weirdness) {
    // Use a separate deterministic RNG seeded from the sim seed so dragging
    // the slider doesn't corrupt the main simulation RNG sequence.
    const blobRng = makeRng(this.cfg.seed + '-blob')

    const cx = this.w / 2
    const cy = this.h / 2
    const baseRy = this.h * 0.46
    const baseRx = baseRy * 1.6
    const harmonics = 8 + ((blobRng() * 5) | 0)
    const harms = []
    for (let i = 0; i < harmonics; i++) {
      harms.push({
        freq: i + 2,
        amp: (blobRng() * 0.06 * weirdness * 3.3) / (i + 1),
        phase: blobRng() * Math.PI * 2
      })
    }

    this.blobCenter = { x: cx, y: cy }
    this.blobBaseRx = baseRx
    this.blobBaseRy = baseRy
    this.blobBaseR = baseRy
    this.blobHarmonics = harms
    this.biomeBlobs = null

    const n = 96
    this.blobPoints = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const r = this._blobRadiusAt(a)
      this.blobPoints.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r
      })
    }
    this._buildBlobMask()
  }

  // Precompute a pixel mask of the blob interior (1 = inside, 0 = outside).
  // Used to gate food/mineral/meat growth so resources don't accumulate
  // outside the blob and diffuse inward, causing edge-bunching.
  P._buildBlobMask = function () {
    const w = this.w,
      h = this.h
    // Downsample by 4x to avoid expensive per-pixel isInsideBlob calls
    const ds = 4
    const dsw = Math.ceil(w / ds)
    const dsh = Math.ceil(h / ds)
    const dsMask = new Uint8Array(dsw * dsh)
    for (let dy = 0; dy < dsh; dy++) {
      const wy = dy * ds + ds * 0.5
      for (let dx = 0; dx < dsw; dx++) {
        const wx = dx * ds + ds * 0.5
        dsMask[dx + dy * dsw] = this.isInsideBlob(wx, wy) ? 1 : 0
      }
    }
    // Upscale to full resolution — a pixel is inside if its downsample cell is inside
    this.blobMask = new Uint8Array(w * h)
    for (let iy = 0; iy < h; iy++) {
      const diy = Math.min(dsh - 1, (iy / ds) | 0)
      const rowOff = iy * w
      const dsRowOff = diy * dsw
      for (let ix = 0; ix < w; ix++) {
        const dix = Math.min(dsw - 1, (ix / ds) | 0)
        this.blobMask[ix + rowOff] = dsMask[dix + dsRowOff]
      }
    }
  }

  // Elliptical blob radius at angle with harmonic perturbation
  P._blobRadiusAt = function (angle) {
    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)
    // Ellipse radius at this angle
    const rx = this.blobBaseRx || this.blobBaseR
    const ry = this.blobBaseRy || this.blobBaseR
    let r = (rx * ry) / Math.sqrt(ry * ry * cosA * cosA + rx * rx * sinA * sinA)
    // Add harmonic perturbation
    for (const h of this.blobHarmonics) {
      r += ry * h.amp * Math.sin(angle * h.freq + h.phase)
    }
    return r
  }

  P.isInsideBlob = function (x, y) {
    const dx = x - this.blobCenter.x
    const dy = y - this.blobCenter.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    // Fast reject
    const maxR = (this.blobBaseRx || this.blobBaseR) * 1.15
    if (dist > maxR) return false
    const angle = Math.atan2(dy, dx)
    return dist < this._blobRadiusAt(angle)
  }

  // Biome index is simply based on x-position (left=0, middle=1, right=2, ...)
  P.getBiomeAt = function (x, _y) {
    const biomes = this.cfg.biomes
    if (!biomes || biomes.length === 0) return 0
    const regionW = this.w / biomes.length
    return Math.min(biomes.length - 1, (x / regionW) | 0)
  }

  // Get biome config object at world position
  P.getBiomeConfigAt = function (x, y) {
    const biomes = this.cfg.biomes
    if (!biomes || biomes.length === 0) return null
    return biomes[this.getBiomeAt(x, y)]
  }

  // ── Shelter grid helpers ──
  P._shelterIdx = function (x, y) {
    const ix = Math.max(0, Math.min(this.shelterW - 1, (x / 4) | 0))
    const iy = Math.max(0, Math.min(this.shelterH - 1, (y / 4) | 0))
    return ix + iy * this.shelterW
  }

  P.sampleShelter = function (x, y) {
    return this.shelterGrid[this._shelterIdx(x, y)]
  }

  P.depositShelter = function (x, y, amount) {
    const bi = this.getBiomeAt(x, y)
    const biome = this.cfg.biomes && this.cfg.biomes[bi]
    const cap = biome ? biome.shelterCap || 2.0 : 2.0
    const idx = this._shelterIdx(x, y)
    this.shelterGrid[idx] = Math.min(cap, this.shelterGrid[idx] + amount)
  }

  // Slow biome-driven shelter growth + decay
  P._growShelter = function () {
    const biomes = this.cfg.biomes
    if (!biomes || biomes.length === 0) return
    const sw = this.shelterW,
      sh = this.shelterH
    const grid = this.shelterGrid
    const nb = biomes.length
    const regionW = this.w / nb
    // Process a fraction each tick for performance
    const stride = 8
    const offset = this.t % stride
    for (let i = offset; i < sw * sh; i += stride) {
      const wx = (i % sw) * 4
      const bi = Math.min(nb - 1, (wx / regionW) | 0)
      const biome = biomes[bi]
      const rate = (biome.shelterRate || 0.5) * 0.00002
      const cap = biome.shelterCap || 2.0
      // Slow biome-driven growth (coral reefs build structure, kelp holdfasts grow)
      if (grid[i] < cap) {
        grid[i] += rate * stride
      }
      // Slow decay — structures erode over time
      grid[i] *= 1 - 0.00001 * stride
      if (grid[i] < 0.001) grid[i] = 0
    }
  }

  // ── Alarm pheromone grid helpers ──
  // Uses same index as shelter grid (1/4 resolution)
  P.depositAlarm = function (x, y, amount) {
    if (!this.alarmGrid) return
    const idx = this._shelterIdx(x, y)
    this.alarmGrid[idx] = Math.min(5.0, this.alarmGrid[idx] + amount)
  }

  P.sampleAlarm = function (x, y) {
    if (!this.alarmGrid) return 0
    return this.alarmGrid[this._shelterIdx(x, y)]
  }

  // Fast alarm decay — pheromone is transient, not persistent
  P._decayAlarm = function () {
    if (!this.alarmGrid) return
    const grid = this.alarmGrid
    const len = grid.length
    // Process all cells every tick — alarm must fade fast
    // Decay factor ~0.97 per tick → half-life ~23 ticks
    for (let i = 0; i < len; i++) {
      if (grid[i] > 0.001) {
        grid[i] *= 0.97
      } else {
        grid[i] = 0
      }
    }
  }

  // ── Terrain object generation ──
  // Spawns static biome features: kelp stalks, coral heads, vent chimneys, etc.
  // These provide shelter, visual interest, and biome identity.
  P._generateTerrain = function () {
    this.terrainObjects = []
    const biomes = this.cfg.biomes
    if (!biomes || biomes.length === 0) return
    const nb = biomes.length
    const regionW = this.w / nb

    // Terrain types per biome flora
    const floraTypes = {
      kelp: ['kelp_stalk', 'kelp_stalk', 'kelp_stalk', 'seagrass_patch', 'sponge', 'rock'],
      coral: ['coral_head', 'coral_fan', 'coral_head', 'anemone', 'sponge', 'rock'],
      plankton: ['rock', 'jellyfish_bloom'],
      detritus: ['rock', 'bone_pile', 'sponge'],
      tubeworm: ['vent_chimney', 'tube_cluster', 'vent_chimney', 'tube_cluster', 'rock']
    }

    for (let bi = 0; bi < nb; bi++) {
      const biome = biomes[bi]
      const flora = biome.flora || 'plankton'
      const types = floraTypes[flora] || ['rock']
      // Density: more objects in structured biomes, fewer in open ocean
      const density = flora === 'plankton' ? 8 : flora === 'detritus' ? 14 : 30
      const x0 = bi * regionW
      const x1 = (bi + 1) * regionW

      for (let k = 0; k < density; k++) {
        // Random position within biome region and inside blob
        let ox, oy
        let found = false
        for (let attempt = 0; attempt < 20; attempt++) {
          ox = x0 + this.rng() * regionW
          oy = this.h * 0.15 + this.rng() * this.h * 0.7
          if (this.isInsideBlob(ox, oy) && !this.isInsideBarrier(ox, oy)) {
            found = true
            break
          }
        }
        if (!found) continue

        const type = types[(k * 7 + bi * 3) % types.length]
        const seed = ((ox * 31 + oy * 17 + k * 137) | 0) & 0xffff
        let size = 0.5 + this.rng() * 1.0
        let hue = 0

        // Type-specific sizing and coloring
        switch (type) {
          case 'kelp_stalk':
            size = 0.8 + this.rng() * 1.5
            hue = 90 + this.rng() * 30 // olive-green
            break
          case 'seagrass_patch':
            size = 0.6 + this.rng() * 0.8
            hue = 110 + this.rng() * 20 // bright green
            break
          case 'coral_head':
            size = 0.6 + this.rng() * 1.2
            hue = this.rng() * 360 // any color — corals are wildly varied
            break
          case 'coral_fan':
            size = 0.4 + this.rng() * 0.8
            hue = 300 + this.rng() * 60 // pink-purple
            break
          case 'anemone':
            size = 0.3 + this.rng() * 0.6
            hue = 30 + this.rng() * 40 // orange-yellow
            break
          case 'sponge':
            size = 0.3 + this.rng() * 0.5
            hue = 40 + this.rng() * 30 // yellow-brown
            break
          case 'vent_chimney':
            size = 1.0 + this.rng() * 2.0
            hue = 15 + this.rng() * 20 // dark amber
            break
          case 'tube_cluster':
            size = 0.5 + this.rng() * 1.0
            hue = 0 + this.rng() * 15 // deep red
            break
          case 'bone_pile':
            size = 0.3 + this.rng() * 0.5
            hue = 45 // pale bone
            break
          case 'jellyfish_bloom':
            size = 0.2 + this.rng() * 0.4
            hue = 200 + this.rng() * 40 // cyan-blue
            break
          case 'rock':
            size = 0.4 + this.rng() * 0.8
            hue = 200 + this.rng() * 30 // blue-grey
            break
        }

        this.terrainObjects.push({
          x: ox,
          y: oy,
          type,
          size,
          biome: bi,
          age: 0,
          hue,
          seed
        })

        // Deposit initial shelter at terrain object locations
        this.depositShelter(ox, oy, size * 0.5)
      }
    }
  }

  P._enforceBlobBoundary = function (c) {
    if (this.isInsideBlob(c.x, c.y)) return
    const dx = c.x - this.blobCenter.x
    const dy = c.y - this.blobCenter.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001
    const angle = Math.atan2(dy, dx)
    const maxR = this._blobRadiusAt(angle) - 2
    c.x = this.blobCenter.x + (dx / dist) * maxR
    c.y = this.blobCenter.y + (dy / dist) * maxR
    const nx = dx / dist,
      ny = dy / dist
    const dot = c.vx * nx + c.vy * ny
    if (dot > 0) {
      c.vx -= 2 * dot * nx
      c.vy -= 2 * dot * ny
    }
  }

  // ── Sun / Day-Night Cycle ──
  // The sun sweeps across the world as a directional light source.
  // Scientific basis: phytoplankton photosynthesis depends on light availability.
  // Day/night cycles drive circadian rhythms and niche partitioning.
  P._initSun = function () {
    this.sunAngle = 0 // current angle of the sun (radians, 0 = right)
    this.dayPhase = 0 // 0..1 through the day cycle
    this.dayCount = 0 // how many full days have passed
    this.sunIntensity = 1.0 // global brightness (0=midnight, 1=noon)
  }

  P._updateSun = function () {
    const dayLen = this.cfg.dayLength || 800
    this.dayPhase = (this.t % dayLen) / dayLen // 0..1
    this.dayCount = Math.floor(this.t / dayLen)

    // Sun angle sweeps 360° per day
    this.sunAngle = this.dayPhase * Math.PI * 2

    // Intensity follows a smooth raised cosine: bright at noon, dark at midnight.
    // Phase 0.0 = midnight, 0.125 = dawn, 0.25 = noon, 0.375 = dusk, 0.5 = midnight again.
    // The curve is symmetric around 0.25 (noon) with period matching dayLength.
    this.sunIntensity = Math.max(0, Math.cos((this.dayPhase - 0.25) * Math.PI * 2)) * 0.85 + 0.15
    // sunIntensity: 0.15 at midnight (dim moonlight), 1.0 at noon
  }

  // Sample sunlight at a world position. Returns 0..1.
  // Light comes from the sun direction — positions facing the sun get more light.
  // Creates a moving light/shadow band across the world.
  P._sampleSunlight = function (x, y) {
    const cx = this.w * 0.5,
      cy = this.h * 0.5
    // Normalized position relative to world center
    const nx = (x - cx) / (this.w * 0.5)
    const ny = (y - cy) / (this.h * 0.5)
    // Dot product with sun direction = how much this point faces the sun
    const sunDx = Math.cos(this.sunAngle)
    const sunDy = Math.sin(this.sunAngle)
    const facing = nx * sunDx + ny * sunDy // -1 (shadow) to +1 (lit)
    // Map to 0..1 with smooth falloff
    const directLight = 0.5 + facing * 0.5 // 0 (full shadow) to 1 (full sun)
    // Combine with global intensity (day/night)
    return directLight * this.sunIntensity
  }

  P.setConfigPatch = function (patch) {
    Object.assign(this.cfg, patch)
    this.cfg.w = this.w
    this.cfg.h = this.h
  }
}
