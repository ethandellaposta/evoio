import { clamp, hsl, hsla, cladeHue, cladeSatOffset, cladeLumOffset } from './color.js'
import { ROLE_COLORS } from './organisms.js'
import {
  FOOD_PLANT,
  FOOD_MINERAL,
  FOOD_MEAT,
  ORGANELLE_NUCLEUS,
  ORGANELLE_MITOCHONDRIA,
  ORGANELLE_FLAGELLUM,
  ORGANELLE_RECEPTOR,
  ORGANELLE_VACUOLE,
  ROLE_NONE,
  ROLE_EDGE,
  ROLE_INTERIOR,
  ROLE_PIONEER
} from '../sim/index.js'

const TAU = Math.PI * 2

// Reusable point buffers to avoid per-frame allocations
const _tPts = new Array(32)
for (let i = 0; i < 32; i++) _tPts[i] = [0, 0]
const _cPts = new Array(16)
for (let i = 0; i < 16; i++) _cPts[i] = [0, 0]
// Reusable blob point buffer (max 32 lobes)
const _blobPtsX = new Float64Array(32)
const _blobPtsY = new Float64Array(32)
// Reusable shape descriptor to avoid per-cell object allocation
const _shapeDesc = { depth: 0.12, chaos: 0, facet: 0, streamline: 0, faceDx: 0, faceDy: 0, phaseSpeed: 1 }

// ── Cached glow texture system ──
// Pre-render radial glow circles to small offscreen canvases.
// Keyed by size bucket (rounded to nearest 2px) to limit cache entries.
// Reuse via drawImage instead of creating radial gradients per cell per frame.
const _glowCache = new Map()
const _GLOW_CACHE_MAX = 64

function _getGlowTexture(radius) {
  // Bucket to nearest 2px to limit cache size
  const r = Math.max(2, (radius + 1) | 0) & ~1
  let tex = _glowCache.get(r)
  if (tex) return tex

  // Evict oldest if cache is full
  if (_glowCache.size >= _GLOW_CACHE_MAX) {
    const firstKey = _glowCache.keys().next().value
    _glowCache.delete(firstKey)
  }

  const size = r * 2 + 2
  const c = new OffscreenCanvas(size, size)
  const ctx = c.getContext('2d')
  const cx = size / 2,
    cy = size / 2
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.5)')
  grad.addColorStop(0.7, 'rgba(255,255,255,0.15)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  tex = { canvas: c, size, r }
  _glowCache.set(r, tex)
  return tex
}

// ── Cached color string memoization ──
// hsla() string creation is expensive when called 5000+ times per frame.
// Cache the last N unique color strings.
const _colorCache = new Map()
const _COLOR_CACHE_MAX = 256

function _cachedHsla(h, s, l, a) {
  const key = (h | 0) * 1000000 + (s | 0) * 10000 + (l | 0) * 100 + ((a * 100) | 0)
  let v = _colorCache.get(key)
  if (v) return v
  if (_colorCache.size >= _COLOR_CACHE_MAX) {
    const firstKey = _colorCache.keys().next().value
    _colorCache.delete(firstKey)
  }
  v = `hsla(${h | 0},${s | 0}%,${l | 0}%,${a})`
  _colorCache.set(key, v)
  return v
}

export function installCells(Renderer) {
  const P = Renderer.prototype

  // Elongated rod/oval path for cells with high elongation gene
  P._elongPath = function (ctx, x, y, r, phase, id, elongation, faceDx, faceDy) {
    const elong = 0.3 + elongation * 1.4
    const lobes = 12
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * TAU
      const cosA = Math.cos(a)
      const sinA = Math.sin(a)
      const dot = cosA * faceDx + sinA * faceDy
      const stretch = 1.0 + Math.abs(dot) * elong
      const squeeze = 1.0 - Math.abs(cosA * -faceDy + sinA * faceDx) * elong * 0.3
      const deform =
        stretch *
        squeeze *
        (1.0 +
          0.06 * Math.sin(phase + a * 2.0 + id * 1.7) +
          0.04 * Math.sin(phase * 0.7 + a * 3.0 + id * 0.9))
      _blobPtsX[i] = x + cosA * r * deform
      _blobPtsY[i] = y + sinA * r * deform
    }
    ctx.beginPath()
    ctx.moveTo((_blobPtsX[lobes - 1] + _blobPtsX[0]) * 0.5, (_blobPtsY[lobes - 1] + _blobPtsY[0]) * 0.5)
    for (let i = 0; i < lobes; i++) {
      const ni = (i + 1) % lobes
      ctx.quadraticCurveTo(
        _blobPtsX[i],
        _blobPtsY[i],
        (_blobPtsX[i] + _blobPtsX[ni]) * 0.5,
        (_blobPtsY[i] + _blobPtsY[ni]) * 0.5
      )
    }
    ctx.closePath()
  }

  // Shape descriptor fields (all optional, defaults produce the old blob):
  //   lobes      — number of radial lobes (diet: carnivore=few deep, herbivore=many smooth)
  //   depth      — lobe amplitude 0..1 (energy fullness: starving=deep/jagged, fed=plump)
  //   chaos      — irregularity 0..1 (mutRate: high=chaotic, low=regular)
  //   facet      — angular faceting 0..1 (membrane gene: armored=angular, soft=round)
  //   streamline — teardrop squash 0..1 toward facing dir (speed gene)
  //   amoeboid   — slow asymmetric bulge 0..1 (amoeboid gene)
  //   phaseSpeed — membrane ripple speed multiplier (metabolism)
  //   faceDx/Dy  — facing direction for streamline
  P._blobPath = function (ctx, x, y, r, phase, id, nLobes, amoeboid, shape) {
    const lobes = nLobes || 7
    const am = amoeboid || 0
    const depth = shape ? shape.depth : 0.12
    const chaos = shape ? shape.chaos : 0
    const facet = shape ? shape.facet : 0
    const stream = shape ? shape.streamline : 0
    const sFdx = shape ? shape.faceDx || 0 : 0
    const sFdy = shape ? shape.faceDy || 0 : 0
    const phaseSpd = shape ? shape.phaseSpeed || 1 : 1

    const effectivePhase = phase * phaseSpd
    const _ft = this._frameTick
    const lobeAngle = TAU / lobes
    for (let i = 0; i < lobes; i++) {
      const a = i * lobeAngle
      const cosA = Math.cos(a)
      const sinA = Math.sin(a)

      let deform =
        1.0 +
        depth * Math.sin(effectivePhase + a * 2.0 + id * 1.7) +
        depth * 0.58 * Math.sin(effectivePhase * 0.7 + a * 3.0 + id * 0.9) +
        depth * 0.42 * Math.cos(a * 5.0 + id * 2.3)

      if (chaos > 0.01) {
        const hash = Math.sin(id * 12.9898 + i * 78.233) * 43758.5453
        deform += chaos * 0.18 * ((hash - (hash | 0)) * 2 - 1)
        deform += chaos * 0.08 * Math.sin(_ft * 0.03 + i * 5.1 + id * 3.3)
      }

      if (facet > 0.01) {
        const nearestLobe = Math.round(a / lobeAngle) * lobeAngle
        const angleDist = Math.abs(a - nearestLobe) / (lobeAngle * 0.5)
        deform += facet * 0.06 * (angleDist * 2 - 1)
      }

      if (stream > 0.01) {
        const dot = cosA * sFdx + sinA * sFdy
        const cross = cosA * -sFdy + sinA * sFdx
        deform += dot * stream * 0.25 - Math.abs(cross) * stream * 0.12
      }

      if (am > 0.1) {
        deform += am * 0.3 * Math.sin(_ft * 0.012 + a * 1.5 + id * 2.1)
        deform += am * 0.2 * Math.sin(_ft * 0.018 + a * 2.7 + id * 0.6)
        deform += am * 0.15 * Math.cos(_ft * 0.008 + a * 0.8 + id * 3.4)
      }

      _blobPtsX[i] = x + cosA * r * deform
      _blobPtsY[i] = y + sinA * r * deform
    }
    ctx.beginPath()
    ctx.moveTo((_blobPtsX[lobes - 1] + _blobPtsX[0]) * 0.5, (_blobPtsY[lobes - 1] + _blobPtsY[0]) * 0.5)
    for (let i = 0; i < lobes; i++) {
      const ni = i + 1 < lobes ? i + 1 : 0
      ctx.quadraticCurveTo(
        _blobPtsX[i],
        _blobPtsY[i],
        (_blobPtsX[i] + _blobPtsX[ni]) * 0.5,
        (_blobPtsY[i] + _blobPtsY[ni]) * 0.5
      )
    }
    ctx.closePath()
  }

  P._drawCells = function (sim) {
    const ctx = this.ctx
    const baseR = sim.cfg.cellRadius * this.view.scale
    const t = this._frameTick

    ctx.save()
    ctx.globalCompositeOperation = 'source-over'

    const margin = sim.cfg.cellRadius * 8

    const fDiet = this._opts ? this._opts.filterDiet : 'all'
    const fRole = this._opts ? this._opts.filterRole : 'all'
    const fSpecies = this._opts ? this._opts.filterSpecies : 'all'

    const trackTarget = this._trackTarget
    const trackClade = trackTarget ? trackTarget.clade : null
    const trackId = trackTarget ? trackTarget.id : null

    const _vs = this.view.scale
    const _paused = this._opts && this._opts.paused
    const _glowDim = _paused ? 1.0 : Math.min(1, 1 / _vs)
    const _vcx = this.view.cx
    const _vcy = this.view.cy
    const _hw = this.canvas.width * 0.5
    const _hh = this.canvas.height * 0.5
    const _cw = this.canvas.width
    const _ch = this.canvas.height
    const _sw = sim.w
    const _sh = sim.h

    // ── Low-fidelity flags (hoisted for inner loop) ──
    const _lf = this.lofi
    const _lofiOn = _lf.enabled
    const _doMorph = !_lofiOn && _lf.morphology
    const _doOrganelles = !_lofiOn && _lf.organelles
    const _doGlow = !_lofiOn && _lf.glow

    // LOD budget caps — driven by adaptive quality feedback loop
    // When paused: no budget caps, no LOD bias — full detail for all
    let _lod3Count = 0,
      _lod4Count = 0
    const _lod3Max = _paused ? Infinity : this._lod3Budget || 200
    const _lod4Max = _paused ? Infinity : this._lod4Budget || 40

    // Population-driven LOD bias: raises pixel thresholds so more cells
    // fall into cheaper LOD tiers at high population
    const _lodBias = _paused ? 0 : this._lodBias || 0

    // ── LOD 0 batching: collect dots into hue buckets, flush once at end ──
    const _LOD0_BUCKETS = 24 // 15° per bucket — more color variety at distance
    const _lod0Buckets = new Array(_LOD0_BUCKETS)
    for (let bi = 0; bi < _LOD0_BUCKETS; bi++) _lod0Buckets[bi] = null
    // Filtered dots go into a separate single bucket
    let _lod0FilteredPath = null

    // ── LOD 1 batching: collect simple circles into hue buckets ──
    const _lod1Buckets = new Array(_LOD0_BUCKETS)
    for (let bi = 0; bi < _LOD0_BUCKETS; bi++) _lod1Buckets[bi] = null

    // ── Pre-compute organism bounding circle for tracked cell ──
    // So the selection highlight covers the whole organism, not just one cell
    let _orgCenterX = 0,
      _orgCenterY = 0,
      _orgRadius = 0
    if (trackId !== null) {
      // Build adjacency list once (only if links changed)
      const nLinks = sim.links.length
      const nCells = sim.cells.length
      let trackedIdx = -1
      for (let i = 0; i < nCells; i++) {
        if (sim.cells[i].id === trackId) {
          trackedIdx = i
          break
        }
      }
      if (trackedIdx >= 0) {
        // Build sparse adjacency from links (much faster than scanning all links per BFS step)
        if (!this._adj || this._adjLinksLen !== nLinks || this._adjCellsLen !== nCells) {
          this._adj = new Array(nCells)
          for (let i = 0; i < nCells; i++) this._adj[i] = []
          for (let li = 0; li < nLinks; li++) {
            const l = sim.links[li]
            if (l.a < nCells && l.b < nCells) {
              this._adj[l.a].push(l.b)
              this._adj[l.b].push(l.a)
            }
          }
          this._adjLinksLen = nLinks
          this._adjCellsLen = nCells
        }
        // BFS using adjacency list
        const visited = new Uint8Array(nCells)
        const queue = [trackedIdx]
        visited[trackedIdx] = 1
        let head = 0
        const trackedCl = sim.cells[trackedIdx].clade
        while (head < queue.length) {
          const ci = queue[head++]
          const neighbors = this._adj[ci]
          if (neighbors) {
            for (let ni = 0; ni < neighbors.length; ni++) {
              const nb = neighbors[ni]
              if (!visited[nb] && nb < nCells && sim.cells[nb].clade === trackedCl) {
                visited[nb] = 1
                queue.push(nb)
              }
            }
          }
        }
        // Compute centroid and bounding radius
        let sumX = 0,
          sumY = 0
        for (let qi = 0; qi < queue.length; qi++) {
          sumX += sim.cells[queue[qi]].x
          sumY += sim.cells[queue[qi]].y
        }
        const orgWorldX = sumX / queue.length
        const orgWorldY = sumY / queue.length
        _orgCenterX = (orgWorldX - _vcx) * _vs + _hw
        _orgCenterY = (orgWorldY - _vcy) * _vs + _hh
        for (let qi = 0; qi < queue.length; qi++) {
          const cc = sim.cells[queue[qi]]
          const sx = (cc.x - _vcx) * _vs + _hw
          const sy = (cc.y - _vcy) * _vs + _hh
          const dx = sx - _orgCenterX,
            dy = sy - _orgCenterY
          const dist = Math.sqrt(dx * dx + dy * dy) + baseR * 1.3
          if (dist > _orgRadius) _orgRadius = dist
        }
        _orgRadius = Math.max(_orgRadius, baseR * 2)
      }
    }

    // Pre-compute a screen-space cull margin that scales with zoom
    const _cullMargin = Math.max(80, 40 / _vs)

    for (let i = 0; i < sim.cells.length; i++) {
      const c = sim.cells[i]

      if (!(isFinite(c.x) && isFinite(c.y))) continue

      const x0 = (c.x - _vcx) * _vs + _hw
      const y0 = (c.y - _vcy) * _vs + _hh

      if (x0 < -_cullMargin || x0 > _cw + _cullMargin || y0 < -_cullMargin || y0 > _ch + _cullMargin) {
        if (c.x >= margin && c.x <= _sw - margin && c.y >= margin && c.y <= _sh - margin) continue
      }

      const isTrackedClade = trackClade !== null && c.clade === trackClade
      const isTrackedCell = trackId !== null && c.id === trackId
      const trackDimmed = trackClade !== null && !isTrackedClade

      let filtered = trackDimmed
      if (fDiet !== 'all') {
        const d = c.g.diet
        if (fDiet === 'herb' && d >= 0.3) filtered = true
        else if (fDiet === 'omni' && (d < 0.3 || d >= 0.6)) filtered = true
        else if (fDiet === 'carn' && d < 0.6) filtered = true
      }
      if (fRole !== 'all') {
        if (fRole === 'none' && c.role !== ROLE_NONE) filtered = true
        else if (fRole === 'edge' && c.role !== ROLE_EDGE) filtered = true
        else if (fRole === 'interior' && c.role !== ROLE_INTERIOR) filtered = true
        else if (fRole === 'pioneer' && c.role !== ROLE_PIONEER) filtered = true
      }
      if (fSpecies !== 'all' && `${c.clade}` !== fSpecies) filtered = true

      const nearLeft = c.x < margin
      const nearRight = c.x > _sw - margin
      const nearTop = c.y < margin
      const nearBot = c.y > _sh - margin

      // Build offsets inline to avoid array allocation per cell
      const needWrap = nearLeft || nearRight || nearTop || nearBot
      const _offCount = needWrap
        ? 1 +
          (nearLeft ? 1 : 0) +
          (nearRight ? 1 : 0) +
          (nearTop ? 1 : 0) +
          (nearBot ? 1 : 0) +
          (nearLeft && nearTop ? 1 : 0) +
          (nearLeft && nearBot ? 1 : 0) +
          (nearRight && nearTop ? 1 : 0) +
          (nearRight && nearBot ? 1 : 0)
        : 1

      for (let _oi = 0; _oi < _offCount; _oi++) {
        let ox = 0,
          oy = 0
        if (_oi > 0) {
          // Compute offset for this wrap index
          let _wi = 0
          if (nearLeft && ++_wi === _oi) {
            ox = _sw
            oy = 0
          } else if (nearRight && ++_wi === _oi) {
            ox = -_sw
            oy = 0
          } else if (nearTop && ++_wi === _oi) {
            ox = 0
            oy = _sh
          } else if (nearBot && ++_wi === _oi) {
            ox = 0
            oy = -_sh
          } else if (nearLeft && nearTop && ++_wi === _oi) {
            ox = _sw
            oy = _sh
          } else if (nearLeft && nearBot && ++_wi === _oi) {
            ox = _sw
            oy = -_sh
          } else if (nearRight && nearTop && ++_wi === _oi) {
            ox = -_sw
            oy = _sh
          } else if (nearRight && nearBot && ++_wi === _oi) {
            ox = -_sw
            oy = -_sh
          } else continue
        }
        const x = (c.x + ox - _vcx) * _vs + _hw
        const y = (c.y + oy - _vcy) * _vs + _hh

        if (x < -50 || x > _cw + 50 || y < -50 || y > _ch + 50) continue

        // ── Filtered cells: skip expensive pipeline, batch as dim dots ──
        if (filtered) {
          const _filtR = baseR * 1.05
          if (!_lod0FilteredPath) _lod0FilteredPath = []
          _lod0FilteredPath.push(x, y, _filtR)
          continue
        }

        // ── Compute creature metrics ──
        const rc = ROLE_COLORS[c.role] || ROLE_COLORS[ROLE_NONE]
        const baseHue = cladeHue(c.clade)
        // Strong diet-driven hue: herbivores → green/cyan, carnivores → red/orange
        // diet 0 = pure herbivore, diet 1 = pure carnivore
        const _diet = c.g.diet
        let dietHue
        if (_diet > 0.6)
          dietHue = 0 + (_diet - 0.6) * 40 // 0-16° (red-orange)
        else if (_diet < 0.25)
          dietHue = 120 + (0.25 - _diet) * 80 // 120-140° (green-cyan)
        else dietHue = 60 - (_diet - 0.25) * 60 // 60-39° (yellow-orange transition)
        // Blend: diet dominance increases with diet extremity
        const dietWeight =
          _diet > 0.6 ? 0.55 + (_diet - 0.6) * 0.6 : _diet < 0.25 ? 0.45 + (0.25 - _diet) * 0.5 : 0.25
        const hueShiftVal = (c.g.hueShift || 0) * 180
        // Morphology-driven hue tints: toxin→sickly green, spines→warm orange, flagella→cool blue
        const morphHueShift =
          (c.g.toxin || 0) * -40 +
          (c.g.spines || 0) * 25 +
          (c.g.flagella || 0) * -18 +
          (c.g.biolum || 0) * 35 +
          (c.g.amoeboid || 0) * -15 +
          (c.g.membrane || 0) * 12 +
          (c.g.chloroplast || 0) * -30 +
          (c.g.elongation || 0) * 10
        const cladeContrib = baseHue + rc.hShift + hueShiftVal + morphHueShift
        const hue = (cladeContrib * (1 - dietWeight) + dietHue * dietWeight + 720) % 360
        const brightnessGene = c.g.brightness || 0
        // Per-clade sat/lum offsets give each species a unique color personality
        const cSatOff = cladeSatOffset(c.clade)
        const cLumOff = cladeLumOffset(c.clade)
        // Wider ranges: membrane→desaturated, adhesion→brighter, diet→more saturated
        // Senescence visual deterioration: aging cells desaturate and dim
        const senLevel = c.senescence || 0
        const senDesaturate = senLevel > 0.2 ? Math.min(30, (senLevel - 0.2) * 38) : 0
        const senDim = senLevel > 0.3 ? Math.min(15, (senLevel - 0.3) * 22) : 0
        // Carnivores: high saturation, warm and intense
        // Herbivores: moderate saturation, cooler and softer
        const dietSatBoost = _diet > 0.6 ? (_diet - 0.6) * 35 : _diet < 0.25 ? (0.25 - _diet) * 15 : 0
        const sat = clamp(
          60 +
            rc.satBoost +
            dietSatBoost -
            brightnessGene * 15 +
            cSatOff * 1.5 -
            (c.g.membrane || 0) * 18 +
            (c.g.chloroplast || 0) * 12 +
            (c.g.toxin || 0) * 10 -
            senDesaturate,
          15,
          100
        )
        // Carnivores: slightly darker/deeper, herbivores: brighter/lighter
        const dietLumShift = _diet > 0.6 ? -(_diet - 0.6) * 14 : _diet < 0.25 ? (0.25 - _diet) * 10 : 0
        const lum = clamp(
          44 +
            14 * c.g.adhesion +
            rc.lumBoost +
            brightnessGene * 28 +
            cLumOff * 1.5 -
            (c.g.toxin || 0) * 12 -
            (c.g.membrane || 0) * 6 +
            (c.g.biolum || 0) * 10 -
            senDim +
            dietLumShift,
          18,
          88
        )

        const energyScale = clamp(0.9 + c.energy * 0.05, 0.85, 1.25)
        const vacScale = 1 + c.organelles[ORGANELLE_VACUOLE] * 0.15
        const memScale = 1 + c.g.membrane * 0.15
        const complexScale = 1 + (c.complexity || 0) * 0.04
        const ageScale = 1 + Math.min(c.age / 600, 1) * 0.25
        const bodyScaleGene = c.g.bodyScale || 1.0
        // Role-based specialization: cells in different positions scale differently
        const roleScale = 1.0 + (rc.scaleBoost || 0)
        // Senescence shrinkage: very old cells physically shrink as they deteriorate
        const senShrink = senLevel > 0.4 ? 1.0 - Math.min(0.25, (senLevel - 0.4) * 0.42) : 1.0
        const r =
          baseR *
          energyScale *
          vacScale *
          memScale *
          complexScale *
          ageScale *
          bodyScaleGene *
          roleScale *
          senShrink

        // Breathing animation — energy-rich cells pulse more visibly
        // Per-cell phase (c.id) so each cell breathes independently
        const senBreathDamp = senLevel > 0.3 ? 1.0 - Math.min(0.7, (senLevel - 0.3) * 1.0) : 1.0
        const breathAmp = (0.02 + clamp(c.energy * 0.012, 0, 0.06)) * senBreathDamp
        const breathFreq = (0.04 + (c.g.metabolism || 1) * 0.025) * (1.0 - senLevel * 0.3)
        const breathe =
          1.0 +
          breathAmp * Math.sin(t * breathFreq + c.id * 2.3) +
          breathAmp * 0.5 * Math.sin(t * breathFreq * 1.8 + c.id * 0.7)
        const eatPulse = c.eatFlash > 0 ? Math.sin(c.eatFlash * 0.3) * 0.15 : 0
        const drawR = r * breathe * (1 + eatPulse)

        const ageMorph = Math.min(c.age / 800, 1)
        const cxMorph = Math.min((c.complexity || 0) / 5, 1)

        // Velocity direction for "facing"
        const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
        const faceDx = c.vx / vLen
        const faceDy = c.vy / vLen

        // Organism glow damping: cells in large organisms reduce additive glow
        // to prevent white blowout from overlapping lighter composites
        const orgSize = c.organismSize || 1
        const _orgGlowDamp = orgSize > 1 ? 1.0 / (1.0 + (orgSize - 1) * 0.35) : 1.0

        // Membrane merge factor: interior cells in multicellular organisms
        // fade their membrane so adjacent cells visually merge together.
        // 0 = full membrane (single cell or edge), 1 = fully suppressed (deep interior)
        const _linkCount = c.linkCount || 0
        const _mergeFade = _linkCount >= 2 ? clamp((_linkCount - 1) * 0.35, 0, 0.85) : 0

        // ── LOD (Level of Detail) based on screen-space size ──
        // LOD 0: drawR < 2   → colored dot only
        // LOD 1: drawR < 5   → blob + membrane stroke
        // LOD 2: drawR < 10  → + basic glow, body shape
        // LOD 3: drawR < 25  → + morphology, organelles, indicators
        // LOD 4: drawR >= 25 → full detail (speed lines, sense cone, etc.)
        // Budget caps prevent catastrophic slowdown at high zoom
        // LOD thresholds shifted by _lodBias (population pressure)
        // Focused cells: ignore _lodBias + lower thresholds for LOD boost
        const _r = drawR
        const _focused = isTrackedClade || isTrackedCell
        const _bias = _focused ? 0 : _lodBias
        let lod
        if (_paused) {
          // Super-res paused mode: minimum LOD 3 for anything visible, LOD 4 if > 1.5px
          lod = _r < 0.5 ? 2 : _r < 1.5 ? 3 : 4
        } else {
          lod =
            _r < 2 + _bias
              ? 0
              : _r < (_focused ? 3 : 5 + _bias * 1.5)
                ? 1
                : _r < (_focused ? 6 : 10 + _bias * 2)
                  ? 2
                  : _r < (_focused ? 14 : 25 + _bias * 2.5)
                    ? 3
                    : 4
        }
        // Focused cells bypass budget caps — they always get full detail
        if (!_focused) {
          if (lod >= 4 && _lod4Count >= _lod4Max) lod = 3
          if (lod >= 3 && _lod3Count >= _lod3Max) lod = 2
        }
        if (lod >= 4) _lod4Count++
        if (lod >= 3) _lod3Count++

        // ── LOD 0: Defer to batched draw ──
        if (lod === 0) {
          const bucket = ((hue / 15) | 0) % _LOD0_BUCKETS
          if (!_lod0Buckets[bucket]) _lod0Buckets[bucket] = { h: hue, s: sat, l: lum, pts: [] }
          _lod0Buckets[bucket].pts.push(x, y, drawR)
          continue
        }

        // ── LOD 1: Batch simple filled+stroked circles ──
        if (lod === 1) {
          const bucket = ((hue / 15) | 0) % _LOD0_BUCKETS
          if (!_lod1Buckets[bucket]) _lod1Buckets[bucket] = { h: hue, s: sat, l: lum, pts: [] }
          _lod1Buckets[bucket].pts.push(x, y, drawR)
          continue
        }

        // ── Speed lines — motion blur streaks behind fast cells ──
        if (lod >= 4 && vLen > 0.3) {
          const speedFactor = Math.min(1, (vLen - 0.3) * 3)
          const lineCount = 2 + Math.floor(speedFactor * 2)
          const lineLen = drawR * (1.5 + speedFactor * 3.0)
          ctx.lineCap = 'round'
          const slStyle = _cachedHsla(hue, sat * 0.5, lum + 20, 0.4)
          for (let li = 0; li < lineCount; li++) {
            const spread = (li / (lineCount - 1 || 1) - 0.5) * 0.6
            const perpX = -faceDy,
              perpY = faceDx
            const sx = x - faceDx * drawR * 0.5 + perpX * drawR * spread
            const sy = y - faceDy * drawR * 0.5 + perpY * drawR * spread
            const ex = sx - faceDx * lineLen * (0.6 + 0.4 * Math.sin(c.clade * 3 + li * 2.1))
            const ey = sy - faceDy * lineLen * (0.6 + 0.4 * Math.sin(c.clade * 3 + li * 2.1))
            ctx.globalAlpha = speedFactor * 0.12 * (1 - (li / lineCount) * 0.5)
            ctx.strokeStyle = slStyle
            ctx.lineWidth = (1.5 - li * 0.3) * (drawR / 12)
            ctx.beginPath()
            ctx.moveTo(sx, sy)
            ctx.lineTo(ex, ey)
            ctx.stroke()
          }
        }

        // ── Sense cone — faint arc showing detection range ──
        if (lod >= 4 && (c.g.sense || 0) > 0.3) {
          const senseR = drawR * (2.0 + c.g.sense * 3.0)
          const coneAngle = 0.5 + (1 - c.g.diet) * 0.4
          const faceAngle = Math.atan2(faceDy, faceDx)
          ctx.globalAlpha = 0.03 + c.g.sense * 0.04
          ctx.fillStyle = _cachedHsla(hue, sat * 0.35, 80, 0.12)
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.arc(x, y, senseR, faceAngle - coneAngle, faceAngle + coneAngle)
          ctx.closePath()
          ctx.fill()
          ctx.globalAlpha = 0.06 + c.g.sense * 0.05
          ctx.strokeStyle = _cachedHsla(hue, sat * 0.3, 85, 0.15)
          ctx.lineWidth = 0.5
          ctx.beginPath()
          ctx.arc(x, y, senseR, faceAngle - coneAngle, faceAngle + coneAngle)
          ctx.stroke()
        }

        // ── Flee/chase behavioral indicators ──
        if (lod >= 4) {
          const fleeStr = Math.sqrt((c._fleeX || 0) * (c._fleeX || 0) + (c._fleeY || 0) * (c._fleeY || 0))
          const chaseStr = Math.sqrt(
            (c._chaseX || 0) * (c._chaseX || 0) + (c._chaseY || 0) * (c._chaseY || 0)
          )

          // Flee indicator: blue chevron pointing away from threat
          if (fleeStr > 0.3) {
            const fleeNx = (c._fleeX || 0) / fleeStr
            const fleeNy = (c._fleeY || 0) / fleeStr
            ctx.globalAlpha = Math.min(0.3, fleeStr * 0.08)
            ctx.strokeStyle = 'rgba(100,180,255,0.7)'
            ctx.lineWidth = 0.8 + drawR * 0.04
            ctx.lineCap = 'round'
            const cd = drawR * 1.6
            const cx2 = x + fleeNx * cd,
              cy2 = y + fleeNy * cd
            const chevLen = drawR * 0.3
            const perpFx = -fleeNy,
              perpFy = fleeNx
            ctx.beginPath()
            ctx.moveTo(cx2 - fleeNx * chevLen + perpFx * chevLen, cy2 - fleeNy * chevLen + perpFy * chevLen)
            ctx.lineTo(cx2, cy2)
            ctx.lineTo(cx2 - fleeNx * chevLen - perpFx * chevLen, cy2 - fleeNy * chevLen - perpFy * chevLen)
            ctx.stroke()
          }

          // Chase indicator: red chevron pointing toward prey
          if (chaseStr > 0.3) {
            const chaseNx = (c._chaseX || 0) / chaseStr
            const chaseNy = (c._chaseY || 0) / chaseStr
            ctx.globalAlpha = Math.min(0.3, chaseStr * 0.06)
            ctx.strokeStyle = 'rgba(255,80,60,0.7)'
            ctx.lineWidth = 0.8 + drawR * 0.04
            ctx.lineCap = 'round'
            const cd = drawR * 1.6
            const cx2 = x + chaseNx * cd,
              cy2 = y + chaseNy * cd
            const chevLen = drawR * 0.3
            const perpCx = -chaseNy,
              perpCy = chaseNx
            ctx.beginPath()
            ctx.moveTo(cx2 - chaseNx * chevLen + perpCx * chevLen, cy2 - chaseNy * chevLen + perpCy * chevLen)
            ctx.lineTo(cx2, cy2)
            ctx.lineTo(cx2 - chaseNx * chevLen - perpCx * chevLen, cy2 - chaseNy * chevLen - perpCy * chevLen)
            ctx.stroke()
          }
        }

        // ── Division stretch — mitosis pinch when near division ──
        if (lod >= 4 && c.energy > 2.5) {
          const divProgress = Math.min(1, (c.energy - 2.5) / 1.5)
          if (divProgress > 0.2) {
            const pinchDepth = divProgress * 0.25
            const perpX = -faceDy,
              perpY = faceDx
            ctx.globalAlpha = divProgress * 0.2
            ctx.strokeStyle = _cachedHsla(hue, sat * 0.3, lum - 20, 0.4)
            ctx.lineWidth = 0.5 + divProgress * 1.0
            ctx.beginPath()
            ctx.moveTo(x + perpX * drawR * (1 - pinchDepth * 0.3), y + perpY * drawR * (1 - pinchDepth * 0.3))
            ctx.lineTo(x - perpX * drawR * (1 - pinchDepth * 0.3), y - perpY * drawR * (1 - pinchDepth * 0.3))
            ctx.stroke()
            ctx.globalAlpha = divProgress * 0.15
            ctx.fillStyle = _cachedHsla((hue + 180) % 360, 70, 75, 0.4)
            ctx.beginPath()
            ctx.arc(x + faceDx * drawR * 0.5, y + faceDy * drawR * 0.5, drawR * 0.2, 0, TAU)
            ctx.fill()
            ctx.beginPath()
            ctx.arc(x - faceDx * drawR * 0.5, y - faceDy * drawR * 0.5, drawR * 0.2, 0, TAU)
            ctx.fill()
          }
        }

        // ── Photosynthesis glow — green shimmer on cells with chloroplasts in sunlight ──
        const cellChloroplast = c.g.chloroplast || 0
        if (_doGlow && lod >= 3 && cellChloroplast > 0.1 && sim.sunIntensity > 0.3) {
          const sunAngle = sim.sunAngle || 0
          const sunDx = Math.cos(sunAngle)
          const sunDy = Math.sin(sunAngle)
          const wcx = sim.w * 0.5,
            wcy = sim.h * 0.5
          const wnx = (c.x - wcx) / (sim.w * 0.5)
          const wny = (c.y - wcy) / (sim.h * 0.5)
          const sunFacing = wnx * sunDx + wny * sunDy
          const localSun = Math.max(0, (0.5 + sunFacing * 0.5) * sim.sunIntensity)
          if (localSun > 0.3) {
            const photoStr = cellChloroplast * (localSun - 0.3) * 1.4
            ctx.globalCompositeOperation = 'lighter'
            const glowX = x + sunDx * drawR * 0.3
            const glowY = y + sunDy * drawR * 0.3
            ctx.globalAlpha = photoStr * 0.04 * _orgGlowDamp
            ctx.fillStyle = 'rgba(80,220,60,0.4)'
            ctx.beginPath()
            ctx.arc(glowX, glowY, drawR * 1.3, 0, TAU)
            ctx.fill()
            if (lod >= 4 && photoStr > 0.2) {
              const spotCount = Math.min(4, 2 + Math.floor(photoStr * 3))
              ctx.globalAlpha = photoStr * 0.06 * _orgGlowDamp
              ctx.fillStyle = 'rgba(100,255,80,0.5)'
              for (let si = 0; si < spotCount; si++) {
                const sa = (si / spotCount) * TAU + c.clade * 1.7 + t * 0.02
                const sd = drawR * (0.3 + 0.2 * Math.sin(c.clade * 3 + si * 2.1))
                ctx.beginPath()
                ctx.arc(x + Math.cos(sa) * sd, y + Math.sin(sa) * sd, drawR * 0.1, 0, TAU)
                ctx.fill()
              }
            }
            ctx.globalCompositeOperation = 'source-over'
          }
        }

        // ── Radiant energy aura (legendary card-art style) ──
        if (_doGlow && lod >= 2) {
          const eLev = clamp(c.energy / 3.5, 0, 1)
          const biolum = c.g.biolum || 0
          const glowBoost = biolum * 2.0
          const _pauseGlowBoost = _paused ? 1.001 : 1.0
          const glowAlpha =
            (0.04 + eLev * 0.05 + cxMorph * 0.015 + biolum * 0.07 + (rc.glowBoost || 0)) *
            _glowDim *
            _orgGlowDamp *
            _pauseGlowBoost
          if (glowAlpha > 0.005) {
            ctx.globalCompositeOperation = 'lighter'
            if (lod >= 3) {
              // Full glow texture (expensive drawImage — only at LOD 3+)
              const glowR = drawR * (1.9 + eLev * 1.0 + cxMorph * 0.5 + glowBoost * 0.7)
              if (glowR > 1) {
                const tex = _getGlowTexture(glowR)
                ctx.globalAlpha = glowAlpha
                ctx.drawImage(tex.canvas, x - tex.size / 2, y - tex.size / 2, tex.size, tex.size)
              }
            } else {
              // LOD 2: cheap circle glow (no drawImage)
              ctx.globalAlpha = glowAlpha * 0.7
              ctx.fillStyle = 'rgba(255,255,255,0.3)'
              ctx.beginPath()
              ctx.arc(x, y, drawR * 1.4, 0, TAU)
              ctx.fill()
            }
            // Layer 2: Complementary shimmer ring (high zoom only)
            if (lod >= 4 && drawR > 10) {
              const shimmerHue = (hue + 30 + ((c.clade * 17) % 60)) % 360
              ctx.globalAlpha = (0.04 + biolum * 0.06) * _glowDim * _orgGlowDamp
              ctx.strokeStyle = _cachedHsla(shimmerHue, 90, 70, 0.5)
              ctx.lineWidth = 0.5 + biolum * 0.8
              ctx.beginPath()
              ctx.arc(x, y, drawR * 1.6, 0, TAU)
              ctx.stroke()
            }
            // Layer 3: Bioluminescent pulse ring
            if (biolum > 0.2 && lod >= 4) {
              const bPulse = 0.5 + 0.5 * Math.sin(t * 0.05 + c.id * 2.1)
              const ringR = drawR * (1.5 + biolum * 1.8) * (0.9 + bPulse * 0.2)
              ctx.globalAlpha = biolum * 0.06 * (0.6 + bPulse * 0.4) * _glowDim * _orgGlowDamp
              ctx.strokeStyle = _cachedHsla((hue + 60) % 360, sat + 20, lum + 30, 0.5)
              ctx.lineWidth = 0.8 + biolum * 1.5
              ctx.beginPath()
              ctx.arc(x, y, ringR, 0, TAU)
              ctx.stroke()
            }
            ctx.globalCompositeOperation = 'source-over'
          }
        }

        // ── Toxin cloud (drawn behind body) ──
        if (_doGlow && (c.g.toxin || 0) > 0.2 && lod >= 2) {
          const tx = c.g.toxin
          const toxR = drawR * (1.6 + tx * 2.0)
          const toxPulse = 0.5 + 0.5 * Math.sin(t * 0.04 + c.id * 3.1)
          ctx.globalAlpha = (0.05 + tx * 0.12) * (0.7 + toxPulse * 0.3)
          ctx.fillStyle = 'rgba(60,200,30,0.2)'
          ctx.beginPath()
          ctx.arc(x, y, toxR, 0, TAU)
          ctx.fill()
        }

        {
          // ── Engulfing prey animation — dramatic absorption with energy drain beam ──
          if (c.engulfing > 0 && c.engulfTarget && lod >= 2) {
            const et = c.engulfTarget
            const [ex2, ey2] = this.worldToScreen(et.x, et.y)
            const progress = 1 - c.engulfing / 30
            const preyR = drawR * 0.6 * (1 - progress)
            const emx = ex2 + (x - ex2) * progress * progress
            const emy = ey2 + (y - ey2) * progress * progress
            ctx.save()
            // Energy drain beam — pulsing line from prey to predator
            if (progress < 0.8) {
              const beamPulse = 0.5 + 0.5 * Math.sin(t * 0.4 + c.id)
              ctx.globalCompositeOperation = 'lighter'
              // Outer glow beam
              ctx.globalAlpha = 0.15 * (1 - progress) * beamPulse
              ctx.strokeStyle = 'rgba(255,120,40,0.6)'
              ctx.lineWidth = 3 + beamPulse * 2
              ctx.beginPath()
              ctx.moveTo(emx, emy)
              ctx.lineTo(x, y)
              ctx.stroke()
              // Core beam
              ctx.globalAlpha = 0.3 * (1 - progress) * beamPulse
              ctx.strokeStyle = 'rgba(255,200,100,0.8)'
              ctx.lineWidth = 0.8 + beamPulse
              ctx.stroke()
              // Traveling energy dots along beam
              for (let di = 0; di < 3; di++) {
                const dotPos = (t * 0.08 + di * 0.33 + c.id) % 1.0
                const dx2 = emx + (x - emx) * dotPos
                const dy2 = emy + (y - emy) * dotPos
                ctx.globalAlpha = 0.4 * (1 - progress) * (0.5 + 0.5 * Math.sin(dotPos * TAU))
                ctx.fillStyle = 'rgba(255,220,120,0.9)'
                ctx.beginPath()
                ctx.arc(dx2, dy2, 1.0 + beamPulse * 0.5, 0, TAU)
                ctx.fill()
              }
              ctx.globalCompositeOperation = 'source-over'
            }
            // Prey body — distorting and dissolving
            if (preyR > 0.3) {
              ctx.globalAlpha = 0.5 * (1 - progress)
              ctx.fillStyle = 'rgba(255,100,40,0.6)'
              ctx.beginPath()
              ctx.arc(emx, emy, preyR, 0, TAU)
              ctx.fill()
            }
            // Absorption aura around predator
            ctx.globalAlpha = 0.06 * (1 - progress * 0.5)
            ctx.fillStyle = 'rgba(255,140,60,0.3)'
            ctx.beginPath()
            ctx.arc(x, y, drawR * 1.8, 0, TAU)
            ctx.fill()
            ctx.restore()
          }

          // ── Morphology appendages (drawn behind body) ──
          // Only draw expensive appendages when cell is large enough to see them
          // Focused cells get morphology at smaller sizes
          if (_doMorph && lod >= 3 && drawR > (_focused ? 6 : 14)) {
            this._drawStalk(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawMorphology(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawPaddleFins(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawProboscis(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawSpines(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawSpike(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawPseudopods(ctx, c, x, y, drawR, hue, sat, lum)
          }

          // ── Body shape — driven by underlying cell metrics ──
          // Lobe count: carnivores few & deep (star/spiky), herbivores many & smooth (round/blobby)
          let lobes
          if (_diet > 0.6) lobes = 3 + Math.floor(ageMorph * 1 + cxMorph * 1 + (c.g.membrane || 0) * 1)
          else if (_diet < 0.25) lobes = 11 + Math.floor(ageMorph * 3 + cxMorph * 3 + (c.g.adhesion || 0) * 3)
          else lobes = 6 + Math.floor(ageMorph * 2 + cxMorph * 2 + (c.g.spines || 0) * 4)

          // Depth: well-fed cells are plump (low deformation), starving cells are jagged
          // Carnivores always have deeper lobes → spikier, more aggressive silhouette
          const fullness = clamp(c.energy / (c.g.division * 0.6), 0, 1)
          const carnDepth = _diet > 0.6 ? (_diet - 0.6) * 0.35 : 0
          const herbSmooth = _diet < 0.25 ? (0.25 - _diet) * -0.08 : 0
          const shapeDepth = 0.05 + (1 - fullness) * 0.22 + carnDepth + herbSmooth + (c.g.spines || 0) * 0.08

          // Chaos: high mutation rate → irregular, chaotic outline
          const shapeChaos = clamp(((c.g.mutRate || 0.05) - 0.03) * 4, 0, 1)

          // Facet: high membrane gene → angular/armored edges (diatom-like)
          const shapeFacet = clamp((c.g.membrane || 0) - 0.1, 0, 1) * 1.2

          // Streamline: fast cells get a subtle teardrop squash toward facing
          const shapeStream = clamp(c.g.speed - 0.6, 0, 1) * 0.8

          // Phase speed: high metabolism → faster membrane ripple
          const shapePhaseSpd = 0.6 + (c.g.metabolism || 1) * 0.5

          const morphPhase = c.membranePhase + ageMorph * 0.5 + Math.sin(c.age * 0.005) * 0.3
          const cellElong = c.g.elongation || 0

          // Reuse pre-allocated shape descriptor
          _shapeDesc.depth = shapeDepth
          _shapeDesc.chaos = shapeChaos
          _shapeDesc.facet = shapeFacet
          _shapeDesc.streamline = shapeStream
          _shapeDesc.faceDx = faceDx
          _shapeDesc.faceDy = faceDy
          _shapeDesc.phaseSpeed = shapePhaseSpd

          if (drawR < 3.5) {
            ctx.beginPath()
            ctx.arc(x, y, drawR, 0, TAU)
          } else if (cellElong > 0.2) {
            this._elongPath(ctx, x, y, drawR, morphPhase, c.clade, cellElong, faceDx, faceDy)
          } else {
            this._blobPath(ctx, x, y, drawR, morphPhase, c.clade, lobes, c.g.amoeboid || 0, _shapeDesc)
          }

          // ── Body fill — flat color + cheap specular highlight at high zoom ──
          const fillAlpha = 0.4 + fullness * 0.35
          ctx.globalAlpha = fillAlpha
          const fillHueShift = ((c.g.pattern ?? 0.5) - 0.5) * 30
          const fillHue = (hue + fillHueShift + 360) % 360
          ctx.fillStyle = hsl(fillHue, sat * 0.55, clamp(lum + 6 + brightnessGene * 8, 32, 82))
          ctx.fill()
          // Specular highlight — small bright arc (cheap metallic look)
          if (_doGlow && lod >= 4 && drawR > 8) {
            ctx.globalAlpha = 0.18 + fullness * 0.12
            ctx.fillStyle = _cachedHsla(fillHue, sat * 0.3, 93, 0.7)
            ctx.beginPath()
            ctx.arc(x - drawR * 0.22, y - drawR * 0.22, drawR * 0.38, 0, TAU)
            ctx.fill()
          }

          // ── Membrane — glowing edge with granular texture ──
          // Interior multicellular cells fade their membrane to merge visually
          const _memAlpha = 1 - _mergeFade
          ctx.globalAlpha = _memAlpha
          const neonLum = clamp(lum + 22, 55, 88)
          const neonSat = clamp(sat + 15, 60, 100)
          const memThick = 0.8 + c.g.membrane * 2.5 + cxMorph * 0.6 + (rc.memBoost || 0) * 2.0

          // Outer glow edge (additive) — legendary card energy border
          if (lod >= 4 && drawR > 8 && _memAlpha > 0.1) {
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = (0.1 + c.g.membrane * 0.12) * _memAlpha
            ctx.strokeStyle = _cachedHsla(hue, 90, 80, 0.4)
            ctx.lineWidth = memThick + 1.5 + c.g.membrane * 1.5
            ctx.stroke()
            ctx.restore()
          }
          // Main bright membrane line
          if (_memAlpha > 0.05) {
            ctx.globalAlpha = _memAlpha
            ctx.strokeStyle = _cachedHsla(hue, neonSat, neonLum, (0.65 + c.g.membrane * 0.25) * _memAlpha)
            ctx.lineWidth = memThick
            ctx.stroke()
          }

          // ── Membrane granules / bumps ──
          if (lod >= 4 && drawR > 22 && _memAlpha > 0.3) {
            const granCount = Math.min(5, 4 + Math.floor(c.g.membrane * 2))
            ctx.globalAlpha = 0.15 + c.g.membrane * 0.15
            ctx.fillStyle = _cachedHsla(hue, neonSat - 5, neonLum + 5, 0.7)
            for (let gi = 0; gi < granCount; gi++) {
              const ga = (gi / granCount) * TAU + c.clade * 0.9
              const gWobble = 1.0 + 0.04 * Math.sin(t * 0.06 + gi * 2.3 + c.clade)
              const gx = x + Math.cos(ga) * drawR * gWobble
              const gy = y + Math.sin(ga) * drawR * gWobble
              const gr = 0.3 + c.g.membrane * 0.5 + 0.2 * Math.sin(c.clade * 3 + gi)
              ctx.beginPath()
              ctx.arc(gx, gy, gr, 0, TAU)
              ctx.fill()
            }
          }

          // ── Body patterns — spots / stripes / rings driven by pattern gene ──
          if (lod >= 3 && drawR > 6) {
            const pat = c.g.pattern ?? 0.5
            const pScale = c.g.patternScale ?? 0.5
            // Pattern type: 0-0.33 = spots, 0.33-0.66 = stripes, 0.66-1 = rings
            const patHue = (hue + 150 + pat * 60) % 360
            const patAlpha = 0.12 + pScale * 0.18
            if (pat < 0.33) {
              // Spots — scattered dots with contrasting color
              const spotCount = 3 + Math.floor(pScale * 5)
              const spotR = drawR * (0.08 + pScale * 0.1)
              ctx.fillStyle = _cachedHsla(patHue, sat * 0.8, lum + 15, patAlpha * 2.5)
              for (let si = 0; si < spotCount; si++) {
                const sa = (si / spotCount) * TAU + c.clade * 2.3
                const sd = drawR * (0.25 + 0.35 * ((c.clade * 7 + si * 5.3) % 1))
                ctx.globalAlpha = patAlpha
                ctx.beginPath()
                ctx.arc(x + Math.cos(sa) * sd, y + Math.sin(sa) * sd, spotR, 0, TAU)
                ctx.fill()
              }
            } else if (pat < 0.66) {
              // Stripes — curved bands across the body
              const stripeCount = 2 + Math.floor(pScale * 3)
              ctx.strokeStyle = _cachedHsla(patHue, sat * 0.7, lum + 10, patAlpha * 2.0)
              ctx.lineWidth = 0.5 + pScale * 1.5
              ctx.lineCap = 'round'
              // Stripe direction based on cell id for consistency
              const stripeAngle = (c.clade * 1.618) % Math.PI
              const cosS = Math.cos(stripeAngle)
              const sinS = Math.sin(stripeAngle)
              for (let si = 0; si < stripeCount; si++) {
                const offset = ((si + 0.5) / stripeCount - 0.5) * drawR * 1.4
                const sx = x + cosS * offset
                const sy = y + sinS * offset
                const perpLen = drawR * 0.7
                ctx.globalAlpha = patAlpha * (1 - Math.abs(offset) / (drawR * 0.8))
                ctx.beginPath()
                ctx.moveTo(sx - sinS * perpLen, sy + cosS * perpLen)
                ctx.quadraticCurveTo(
                  sx + cosS * drawR * 0.1 * Math.sin(c.clade + si),
                  sy + sinS * drawR * 0.1 * Math.sin(c.clade + si),
                  sx + sinS * perpLen,
                  sy - cosS * perpLen
                )
                ctx.stroke()
              }
            } else {
              // Rings — concentric circles
              const ringCount = 1 + Math.floor(pScale * 2)
              ctx.strokeStyle = _cachedHsla(patHue, sat * 0.7, lum + 12, patAlpha * 2.2)
              ctx.lineWidth = 0.4 + pScale * 1.0
              for (let ri = 0; ri < ringCount; ri++) {
                const ringR = drawR * (0.35 + ri * 0.25)
                if (ringR > drawR * 0.9) continue
                ctx.globalAlpha = patAlpha * (1 - ri * 0.25)
                ctx.beginPath()
                ctx.arc(x, y, ringR, 0, TAU)
                ctx.stroke()
              }
            }
            ctx.globalAlpha = 1
          }

          // ── Diet indicator: predator eye / herbivore chloroplast glow ──
          if (lod >= 3 && drawR > 5) {
            if (_diet > 0.55) {
              // Predator: menacing slit-pupil eye in facing direction
              const eyeDist = drawR * 0.35
              const eyeR = drawR * (0.14 + _diet * 0.08)
              const ex = x + faceDx * eyeDist
              const ey = y + faceDy * eyeDist
              // Eye white (slightly warm)
              ctx.globalAlpha = 0.7 + _diet * 0.2
              ctx.fillStyle = _cachedHsla(40, 15, 92, 0.9)
              ctx.beginPath()
              ctx.arc(ex, ey, eyeR, 0, TAU)
              ctx.fill()
              // Pupil — slit for high diet, rounder for omnivores
              const pupilW = eyeR * (0.3 + (1 - _diet) * 0.4)
              const pupilH = eyeR * 0.85
              const faceAngle = Math.atan2(faceDy, faceDx)
              ctx.fillStyle = _diet > 0.75 ? '#1a0505' : '#2a1010'
              ctx.beginPath()
              ctx.ellipse(ex, ey, pupilW, pupilH, faceAngle, 0, TAU)
              ctx.fill()
              // Iris color: red-orange for aggressive predators
              if (drawR > 8) {
                ctx.globalAlpha = 0.4
                ctx.fillStyle = _cachedHsla(hue, 90, 45, 0.6)
                ctx.beginPath()
                ctx.arc(ex, ey, eyeR * 0.7, 0, TAU)
                ctx.fill()
                // Redraw pupil on top
                ctx.globalAlpha = 0.9
                ctx.fillStyle = _diet > 0.75 ? '#1a0505' : '#2a1010'
                ctx.beginPath()
                ctx.ellipse(ex, ey, pupilW, pupilH, faceAngle, 0, TAU)
                ctx.fill()
              }
            } else if (_diet < 0.2 && (c.g.chloroplast || 0) > 0.15) {
              // Herbivore with chloroplast: soft green inner glow
              ctx.globalAlpha = 0.12 + c.g.chloroplast * 0.15
              ctx.fillStyle = _cachedHsla(130, 70, 55, 0.4)
              ctx.beginPath()
              ctx.arc(x, y, drawR * 0.65, 0, TAU)
              ctx.fill()
            }
            ctx.globalAlpha = 1
          }

          // ── On-body morphology overlays ──
          if (_doMorph && lod >= 3 && drawR > (_focused ? 6 : 14)) {
            this._drawConstrictions(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawArmorPlates(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawToxinDroplets(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawShell(ctx, c, x, y, drawR, hue, sat, lum)
            this._drawSymbiosisAura(ctx, c, x, y, drawR, hue, sat, lum)
          }

          // ── Vesicle surface bumps ──
          if (lod >= 4 && (c.g.vesicles || 0) > 0.15) {
            const ves = c.g.vesicles
            const vesCount = Math.min(4, 2 + Math.floor(ves * 3))
            ctx.globalAlpha = 0.4 + ves * 0.3
            ctx.fillStyle = _cachedHsla((hue + 30) % 360, sat * 0.7, lum + 18, 0.8)
            for (let vi = 0; vi < vesCount; vi++) {
              const va = (vi / vesCount) * TAU + c.clade * 1.4
              const vDist = drawR * 0.88
              const vr = 0.6 + ves * 1.8
              ctx.beginPath()
              ctx.arc(x + Math.cos(va) * vDist, y + Math.sin(va) * vDist, vr, 0, TAU)
              ctx.fill()
            }
          }

          // ── Internal ER-like network (only at highest zoom) ──
          if (lod >= 4 && cxMorph > 0.5 && drawR > 22) {
            ctx.globalAlpha = 0.04 + cxMorph * 0.06
            ctx.strokeStyle = _cachedHsla((hue + 90) % 360, sat * 0.3, lum + 15, 0.3)
            ctx.lineWidth = 0.3 + cxMorph * 0.3
            const netCount = Math.min(4, 2 + Math.floor(cxMorph * 2))
            for (let ni = 0; ni < netCount; ni++) {
              const na1 = (ni / netCount) * TAU + c.clade * 0.8
              const na2 = na1 + 0.8 + Math.sin(c.clade * 3 + ni) * 0.5
              const nd1 = drawR * (0.15 + 0.3 * Math.sin(c.clade + ni * 2.1))
              const nd2 = drawR * (0.2 + 0.35 * Math.sin(c.clade * 2 + ni * 1.7))
              ctx.beginPath()
              ctx.moveTo(x + Math.cos(na1) * nd1, y + Math.sin(na1) * nd1)
              ctx.quadraticCurveTo(
                x + Math.cos((na1 + na2) / 2) * drawR * 0.5,
                y + Math.sin((na1 + na2) / 2) * drawR * 0.5,
                x + Math.cos(na2) * nd2,
                y + Math.sin(na2) * nd2
              )
              ctx.stroke()
            }
          }

          // ── Organelles ──
          if (_doOrganelles && lod >= 3) {
            // Nucleus — bright glowing core
            const nucLevel = c.organelles[ORGANELLE_NUCLEUS]
            if (nucLevel > 0.05) {
              const nucPulse = 1.0 + 0.1 * Math.sin(t * 0.045 + c.id)
              const nucR = (drawR * 0.28 + nucLevel * drawR * 0.22) * nucPulse
              const nucHue = (hue + 180) % 360
              // Glow halo behind nucleus (additive, high zoom only)
              if (lod >= 4 && nucR > 3) {
                ctx.save()
                ctx.globalCompositeOperation = 'lighter'
                ctx.globalAlpha = 0.12 + nucLevel * 0.1
                const nucGlowTex = _getGlowTexture(nucR * 1.8)
                ctx.drawImage(
                  nucGlowTex.canvas,
                  x - nucGlowTex.size / 2,
                  y - nucGlowTex.size / 2,
                  nucGlowTex.size,
                  nucGlowTex.size
                )
                ctx.restore()
              }
              // Nucleus body — flat fill
              ctx.globalAlpha = 0.75 + nucLevel * 0.2
              ctx.fillStyle = hsl(nucHue, 80, 68)
              ctx.beginPath()
              ctx.arc(x, y, nucR, 0, TAU)
              ctx.fill()
              // Nucleolus — bright specular spot
              if (nucLevel > 0.2) {
                ctx.globalAlpha = 0.65 + nucLevel * 0.3
                ctx.fillStyle = hsla(nucHue, 65, 95, 0.95)
                ctx.beginPath()
                ctx.arc(x - nucR * 0.15, y - nucR * 0.1, nucR * 0.25, 0, TAU)
                ctx.fill()
              }
            }

            // Mitochondria — power generators with energy halos
            const mitoLevel = c.organelles[ORGANELLE_MITOCHONDRIA]
            if (mitoLevel > 0.06) {
              const mitoCount = Math.min(3, 1 + Math.floor(mitoLevel * 3))
              for (let mi = 0; mi < mitoCount; mi++) {
                const ma = (mi / mitoCount) * TAU + c.clade * 0.7
                const md = drawR * 0.4
                const mr = drawR * 0.07 * (1.0 + mitoLevel * 0.6)
                const mx2 = x + Math.cos(ma) * md,
                  my2 = y + Math.sin(ma) * md
                // Mito energy halo (additive)
                if (lod >= 4) {
                  ctx.save()
                  ctx.globalCompositeOperation = 'lighter'
                  ctx.globalAlpha = 0.12 + mitoLevel * 0.08
                  ctx.fillStyle = 'hsla(15,90%,65%,0.35)'
                  ctx.beginPath()
                  ctx.arc(mx2, my2, mr * 2.0, 0, TAU)
                  ctx.fill()
                  ctx.restore()
                }
                // Mito body
                ctx.globalAlpha = 0.7 + mitoLevel * 0.25
                ctx.fillStyle = hsl(15, 92, 58)
                ctx.beginPath()
                ctx.arc(mx2, my2, mr, 0, TAU)
                ctx.fill()
              }
            }

            // Vacuole — large translucent bubble (like image 2 — visible internal spheres)
            const vacLevel = c.organelles[ORGANELLE_VACUOLE]
            if (vacLevel > 0.08) {
              const vr = drawR * 0.3 * vacLevel + drawR * 0.12
              const vacPulse = 1.0 + 0.07 * Math.sin(t * 0.035 + c.id * 1.7)
              const vx2 = x + drawR * 0.2 * Math.sin(c.id * 2.1 + t * 0.006)
              const vy2 = y + drawR * 0.2 * Math.cos(c.id * 3.7 + t * 0.006)
              const vrp = vr * vacPulse
              ctx.globalAlpha = 0.35 + vacLevel * 0.3
              ctx.fillStyle = hsla(200, 50, 72, 0.5)
              ctx.beginPath()
              ctx.arc(vx2, vy2, vrp, 0, TAU)
              ctx.fill()
            }

            // ── Ingested food visible inside cell (food vacuoles) ──
            // Shows what the cell recently ate as small colored particles
            if (c.eatFlash > 0 && lod >= 3) {
              const digestProgress = 1 - c.eatFlash / 25 // 0 = just ate, 1 = fully digested
              const foodAlpha = (1 - digestProgress * digestProgress) * 0.6
              const foodCount = Math.min(2, Math.ceil(2 * (1 - digestProgress)))
              ctx.save()
              for (let fi = 0; fi < foodCount; fi++) {
                // Scatter food particles inside the cell, slowly drifting inward
                const fa = (fi / foodCount) * TAU + c.id * 1.3 + t * 0.008
                const fDist =
                  drawR * (0.25 + 0.25 * (1 - digestProgress)) * (0.8 + 0.2 * Math.sin(c.id * 5 + fi * 2.7))
                const fx = x + Math.cos(fa) * fDist
                const fy = y + Math.sin(fa) * fDist
                const fr = (0.8 + drawR * 0.06) * (1 - digestProgress * 0.6)

                if (c.lastAte === FOOD_PLANT) {
                  // Green plant blobs — irregular, organic
                  ctx.globalAlpha = foodAlpha * 0.8
                  ctx.fillStyle = hsla(110, 70, 45, 0.7)
                  ctx.beginPath()
                  ctx.ellipse(fx, fy, fr * 1.2, fr * 0.8, fa, 0, TAU)
                  ctx.fill()
                  // Chloroplast-like highlight
                  ctx.globalAlpha = foodAlpha * 0.4
                  ctx.fillStyle = hsla(130, 80, 60, 0.5)
                  ctx.beginPath()
                  ctx.arc(fx, fy, fr * 0.5, 0, TAU)
                  ctx.fill()
                } else if (c.lastAte === FOOD_MINERAL) {
                  // Amber/gold crystal fragments — angular
                  ctx.globalAlpha = foodAlpha * 0.7
                  ctx.fillStyle = hsla(42, 80, 55, 0.7)
                  ctx.save()
                  ctx.translate(fx, fy)
                  ctx.rotate(c.id * 3 + fi * 1.5)
                  ctx.fillRect(-fr * 0.7, -fr * 0.5, fr * 1.4, fr * 1.0)
                  ctx.restore()
                  // Sparkle
                  ctx.globalAlpha = foodAlpha * 0.5
                  ctx.fillStyle = 'rgba(255,240,180,0.6)'
                  ctx.beginPath()
                  ctx.arc(fx, fy, fr * 0.3, 0, TAU)
                  ctx.fill()
                } else {
                  // Red meat chunks — round, darker
                  ctx.globalAlpha = foodAlpha * 0.75
                  ctx.fillStyle = hsla(5, 65, 40, 0.7)
                  ctx.beginPath()
                  ctx.arc(fx, fy, fr, 0, TAU)
                  ctx.fill()
                  // Blood-like highlight
                  ctx.globalAlpha = foodAlpha * 0.3
                  ctx.fillStyle = hsla(0, 80, 55, 0.5)
                  ctx.beginPath()
                  ctx.arc(fx - fr * 0.2, fy - fr * 0.2, fr * 0.4, 0, TAU)
                  ctx.fill()
                }
              }
              ctx.restore()
            }

            // Receptors — bright dots embedded in membrane, slowly rotating
            const recLevel = c.organelles[ORGANELLE_RECEPTOR]
            if (recLevel > 0.08) {
              const recCount = 4 + Math.floor(recLevel * 6)
              for (let ri = 0; ri < recCount; ri++) {
                const ra = (ri / recCount) * TAU + c.id * 1.1 + t * 0.005
                const rDist = drawR * (0.9 + 0.05 * Math.sin(t * 0.07 + ri * 2))
                const rr = 0.6 + recLevel * 1.0
                // Receptor glow
                ctx.globalAlpha = 0.2 + recLevel * 0.2
                ctx.fillStyle = hsla(50, 90, 70, 0.6)
                ctx.beginPath()
                ctx.arc(x + Math.cos(ra) * rDist, y + Math.sin(ra) * rDist, rr * 2, 0, TAU)
                ctx.fill()
                // Receptor dot
                ctx.globalAlpha = 0.6 + recLevel * 0.3
                ctx.fillStyle = hsla(45, 95, 75, 0.9)
                ctx.beginPath()
                ctx.arc(x + Math.cos(ra) * rDist, y + Math.sin(ra) * rDist, rr, 0, TAU)
                ctx.fill()
              }
              ctx.globalAlpha = 1
            }

            // Flagellum organelle — internal motor visible as bright spot
            const flagLevel = c.organelles[ORGANELLE_FLAGELLUM]
            if (flagLevel > 0.1) {
              const fmx = x - faceDx * drawR * 0.3
              const fmy = y - faceDy * drawR * 0.3
              const fmr = drawR * 0.08 + flagLevel * drawR * 0.06
              ctx.globalAlpha = 0.3 + flagLevel * 0.3
              ctx.fillStyle = hsla(160, 80, 65, 0.7)
              ctx.beginPath()
              ctx.arc(fmx, fmy, fmr, 0, TAU)
              ctx.fill()
            }
          }

          // ── Evolved mechanism visuals ──
          if (lod >= 3) {
            // Flagella — long flowing multi-tendrils with bulbous tips (images 2, 4)
            if ((c.g.flagella || 0) > 0.08) {
              const fl = c.g.flagella
              const tailCount = fl > 0.5 ? 3 : 2
              const tailLen = drawR * (2.0 + fl * 4.5)
              const tailX = -faceDx,
                tailY = -faceDy
              ctx.lineCap = 'round'
              for (let fi = 0; fi < tailCount; fi++) {
                const spread = (fi - (tailCount - 1) / 2) * drawR * 0.22
                const phaseOff = fi * 1.7 + c.id
                const segs = 8
                // Outer glow
                ctx.save()
                ctx.globalCompositeOperation = 'lighter'
                ctx.globalAlpha = _glowDim * _orgGlowDamp
                ctx.strokeStyle = hsla(hue, 65, 72, 0.15 + fl * 0.2)
                ctx.lineWidth = 3.0 + fl * 4.0
                // Precompute smooth tendril points
                const tSegs = 10
                _tPts[0][0] = x + tailY * spread
                _tPts[0][1] = y - tailX * spread
                for (let s = 1; s <= tSegs; s++) {
                  const frac = s / tSegs
                  const amp = frac * frac // whip-like ramp
                  const wave = Math.sin(t * 0.2 - frac * Math.PI * 3.5 + phaseOff) * drawR * 0.6 * fl * amp
                  const wave2 = Math.sin(t * 0.12 - frac * Math.PI * 5.5 + phaseOff) * drawR * 0.2 * fl * amp
                  _tPts[s][0] = x + tailY * spread + tailX * tailLen * frac + tailY * (wave + wave2)
                  _tPts[s][1] = y - tailX * spread + tailY * tailLen * frac - tailX * (wave + wave2)
                }
                // Glow pass — smooth bezier
                ctx.beginPath()
                ctx.moveTo(_tPts[0][0], _tPts[0][1])
                for (let s = 0; s < tSegs; s++) {
                  const mx = (_tPts[s][0] + _tPts[s + 1][0]) * 0.5
                  const my = (_tPts[s][1] + _tPts[s + 1][1]) * 0.5
                  ctx.quadraticCurveTo(_tPts[s][0], _tPts[s][1], mx, my)
                }
                ctx.lineTo(_tPts[tSegs][0], _tPts[tSegs][1])
                ctx.stroke()
                ctx.restore()
                // Core line — smooth bezier
                ctx.strokeStyle = hsla(hue, 75, 72, 0.25 + fl * 0.45)
                ctx.lineWidth = 0.6 + fl * 1.4
                ctx.beginPath()
                ctx.moveTo(_tPts[0][0], _tPts[0][1])
                for (let s = 0; s < tSegs; s++) {
                  const mx = (_tPts[s][0] + _tPts[s + 1][0]) * 0.5
                  const my = (_tPts[s][1] + _tPts[s + 1][1]) * 0.5
                  ctx.quadraticCurveTo(_tPts[s][0], _tPts[s][1], mx, my)
                }
                ctx.lineTo(_tPts[tSegs][0], _tPts[tSegs][1])
                ctx.stroke()
                // Bulbous tip (like image 2 — rounded ends on tendrils)
                if (fl > 0.15) {
                  const tipWave = Math.sin(t * 0.15 + Math.PI * 3.0 + phaseOff) * drawR * 0.5 * fl
                  const tipWave2 = Math.sin(t * 0.09 + Math.PI * 5.0 + phaseOff) * drawR * 0.15 * fl
                  const tipX2 = x + tailY * spread + tailX * tailLen + tailY * (tipWave + tipWave2)
                  const tipY2 = y - tailX * spread + tailY * tailLen - tailX * (tipWave + tipWave2)
                  const bulbR = 0.5 + fl * 1.2
                  ctx.globalAlpha = 0.3 + fl * 0.3
                  ctx.fillStyle = hsla(hue, 70, 75, 0.7)
                  ctx.beginPath()
                  ctx.arc(tipX2, tipY2, bulbR, 0, TAU)
                  ctx.fill()
                  ctx.globalAlpha = 1
                }
              }
            }

            // Jet exhaust — bright plasma burst
            if ((c.g.jet || 0) > 0.1 && c.jetCooldown > 0 && c.jetCooldown > 15) {
              const jt = c.g.jet
              const exX = -faceDx,
                exY = -faceDy
              const jPulse = 0.7 + 0.3 * Math.sin(t * 0.4 + c.id)
              ctx.save()
              ctx.globalAlpha = 0.5 * (c.jetCooldown / 30) * jPulse
              const jetLen = drawR * (1.8 + jt * 3.0) * jPulse
              ctx.fillStyle = 'rgba(100,180,255,0.5)'
              ctx.beginPath()
              ctx.moveTo(
                x + exX * drawR * 0.8 + exY * drawR * 0.35,
                y + exY * drawR * 0.8 - exX * drawR * 0.35
              )
              ctx.quadraticCurveTo(
                x + exX * jetLen * 0.6 + exY * drawR * 0.12 * Math.sin(t * 0.3),
                y + exY * jetLen * 0.6 - exX * drawR * 0.12 * Math.sin(t * 0.3),
                x + exX * jetLen,
                y + exY * jetLen
              )
              ctx.quadraticCurveTo(
                x + exX * jetLen * 0.6 - exY * drawR * 0.12 * Math.sin(t * 0.3),
                y + exY * jetLen * 0.6 + exX * drawR * 0.12 * Math.sin(t * 0.3),
                x + exX * drawR * 0.8 - exY * drawR * 0.35,
                y + exY * drawR * 0.8 + exX * drawR * 0.35
              )
              ctx.fill()
              ctx.restore()
            }

            // Amoeboid pseudopods — blobby with bulbous tips (like image 1)
            if ((c.g.amoeboid || 0) > 0.1) {
              const am = c.g.amoeboid
              const podCount = 3 + Math.floor(am * 3)
              for (let pi = 0; pi < podCount; pi++) {
                const pa = (pi / podCount) * TAU + t * 0.018 + c.id
                const pLen = drawR * (0.5 + am * 1.2 + 0.35 * Math.sin(t * 0.04 + pi * 2.3 + c.id))
                const pWid = drawR * (0.12 + am * 0.18)
                const tipBulb = drawR * (0.06 + am * 0.12)
                const tipX = x + Math.cos(pa) * (drawR + pLen)
                const tipY = y + Math.sin(pa) * (drawR + pLen)
                const baseX = x + Math.cos(pa) * drawR * 0.65
                const baseY = y + Math.sin(pa) * drawR * 0.65
                // Arm gradient
                const armGrad = hsla(hue, sat * 0.4, lum + 8, 0.2 + am * 0.1)
                ctx.fillStyle = armGrad
                ctx.beginPath()
                ctx.moveTo(baseX, baseY)
                ctx.bezierCurveTo(
                  x + Math.cos(pa) * (drawR + pLen * 0.4) + Math.cos(pa + 1.0) * pWid * 1.2,
                  y + Math.sin(pa) * (drawR + pLen * 0.4) + Math.sin(pa + 1.0) * pWid * 1.2,
                  x + Math.cos(pa) * (drawR + pLen * 0.7) + Math.cos(pa + 0.8) * pWid * 0.8,
                  y + Math.sin(pa) * (drawR + pLen * 0.7) + Math.sin(pa + 0.8) * pWid * 0.8,
                  tipX,
                  tipY
                )
                ctx.bezierCurveTo(
                  x + Math.cos(pa) * (drawR + pLen * 0.7) - Math.cos(pa + 0.8) * pWid * 0.8,
                  y + Math.sin(pa) * (drawR + pLen * 0.7) - Math.sin(pa + 0.8) * pWid * 0.8,
                  x + Math.cos(pa) * (drawR + pLen * 0.4) - Math.cos(pa + 1.0) * pWid * 1.2,
                  y + Math.sin(pa) * (drawR + pLen * 0.4) - Math.sin(pa + 1.0) * pWid * 1.2,
                  baseX,
                  baseY
                )
                ctx.fill()
                // Bulbous tip (like image 1 branching ends)
                ctx.fillStyle = hsla(hue, sat * 0.5, lum + 15, 0.2 + am * 0.15)
                ctx.beginPath()
                ctx.arc(tipX, tipY, tipBulb, 0, TAU)
                ctx.fill()
              }
            }

            // Spikes — smooth curved protrusions
            if ((c.g.spike || 0) > 0.1) {
              const sp = c.g.spike
              const spikeLen = drawR * (0.6 + sp * 1.8)
              const spikeCount = 3 + Math.floor(sp * 5)
              ctx.fillStyle = hsla(0, 75, 55, 0.35 + sp * 0.2)
              for (let si = 0; si < spikeCount; si++) {
                const sa = (si / spikeCount) * TAU + c.id * 0.5
                const wobble = Math.sin(t * 0.06 + si * 2.1 + c.id) * 0.04 * sp
                const tipX = x + Math.cos(sa + wobble) * (drawR + spikeLen)
                const tipY = y + Math.sin(sa + wobble) * (drawR + spikeLen)
                const b1x = x + Math.cos(sa - 0.12) * drawR * 0.92
                const b1y = y + Math.sin(sa - 0.12) * drawR * 0.92
                const b2x = x + Math.cos(sa + 0.12) * drawR * 0.92
                const b2y = y + Math.sin(sa + 0.12) * drawR * 0.92
                // Smooth curved spike with bezier
                const ctrl1x = (b1x + tipX) / 2 + Math.cos(sa + 0.3) * spikeLen * 0.15
                const ctrl1y = (b1y + tipY) / 2 + Math.sin(sa + 0.3) * spikeLen * 0.15
                const ctrl2x = (b2x + tipX) / 2 + Math.cos(sa - 0.3) * spikeLen * 0.15
                const ctrl2y = (b2y + tipY) / 2 + Math.sin(sa - 0.3) * spikeLen * 0.15
                ctx.beginPath()
                ctx.moveTo(b1x, b1y)
                ctx.quadraticCurveTo(ctrl1x, ctrl1y, tipX, tipY)
                ctx.quadraticCurveTo(ctrl2x, ctrl2y, b2x, b2y)
                ctx.closePath()
                ctx.fill()
              }
            }

            // Spines — sea-urchin radiating needles (single pass for perf)
            if ((c.g.spines || 0) > 0.08) {
              const sn = c.g.spines
              ctx.lineCap = 'round'
              const barbCount = Math.min(10, 6 + Math.floor(sn * 6))
              ctx.globalAlpha = 0.4 + sn * 0.35
              ctx.strokeStyle = hsla(40, 65, 72, 0.6)
              ctx.lineWidth = 0.5 + sn * 0.7
              for (let bi = 0; bi < barbCount; bi++) {
                const ba = (bi / barbCount) * TAU + c.id * 1.3
                const lenVar = 0.7 + 0.6 * ((c.id * 5 + bi * 3.7) % 1)
                const bLen = drawR * (0.3 + sn * 0.8) * lenVar
                const sway = Math.sin(t * 0.07 + bi * 2.1 + c.id) * bLen * 0.12
                const bx0 = x + Math.cos(ba) * drawR * 0.95
                const by0 = y + Math.sin(ba) * drawR * 0.95
                const tipX = x + Math.cos(ba) * (drawR + bLen)
                const tipY = y + Math.sin(ba) * (drawR + bLen)
                const ctrlX = (bx0 + tipX) / 2 + Math.cos(ba + 1.57) * sway
                const ctrlY = (by0 + tipY) / 2 + Math.sin(ba + 1.57) * sway
                ctx.beginPath()
                ctx.moveTo(bx0, by0)
                ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY)
                ctx.stroke()
                if (sn > 0.2 && lenVar > 0.9) {
                  ctx.fillStyle = hsla(50, 90, 88, 0.6)
                  ctx.beginPath()
                  ctx.arc(tipX, tipY, 0.4 + sn * 0.5, 0, TAU)
                  ctx.fill()
                }
              }
              ctx.globalAlpha = 1
            }

            // Camouflage — translucent spots/patches
            if ((c.g.camouflage || 0) > 0.15) {
              const spotCount = 4 + Math.floor(c.g.camouflage * 8)
              for (let ci = 0; ci < spotCount; ci++) {
                const ca = (ci / spotCount) * TAU + c.id * 2.7
                const cd = drawR * (0.25 + (0.45 * ((c.id * 7 + ci * 13) % 10)) / 10)
                const cr = drawR * 0.06 + drawR * 0.05 * Math.sin(c.id + ci)
                ctx.globalAlpha = 0.06 + c.g.camouflage * 0.08
                ctx.fillStyle = hsla(hue, sat * 0.3, lum * 0.5, 0.4)
                ctx.beginPath()
                ctx.arc(x + Math.cos(ca) * cd, y + Math.sin(ca) * cd, cr, 0, TAU)
                ctx.fill()
              }
              ctx.globalAlpha = 1
            }

            // Constriction tentacles — smooth flowing grabbers
            if ((c.g.constrict || 0) > 0.1 && c.linkCount > 0) {
              const cn = c.g.constrict
              ctx.lineCap = 'round'
              for (let ci = 0; ci < 3; ci++) {
                const ca = (ci / 3) * TAU + t * 0.01 + c.id
                const cLen = drawR * (1.0 + cn * 2.2)
                const cSegs = 8
                _cPts[0][0] = x + Math.cos(ca) * drawR * 0.6
                _cPts[0][1] = y + Math.sin(ca) * drawR * 0.6
                for (let s = 1; s <= cSegs; s++) {
                  const frac = s / cSegs
                  const amp = frac * frac
                  const wave =
                    Math.sin(t * 0.12 - frac * TAU * 0.8 + ci * 2.5 + c.id) * drawR * 0.45 * cn * amp
                  const wave2 =
                    Math.sin(t * 0.07 + frac * TAU * 1.5 + ci * 1.3 + c.id) * drawR * 0.15 * cn * amp
                  _cPts[s][0] =
                    x + Math.cos(ca) * (drawR * 0.6 + cLen * frac) + Math.cos(ca + 1.5) * (wave + wave2)
                  _cPts[s][1] =
                    y + Math.sin(ca) * (drawR * 0.6 + cLen * frac) + Math.sin(ca + 1.5) * (wave + wave2)
                }
                // Core — smooth bezier (single pass)
                ctx.strokeStyle = hsla(280, 70, 65, 0.2 + cn * 0.3)
                ctx.lineWidth = 0.6 + cn * 1.2
                ctx.beginPath()
                ctx.moveTo(_cPts[0][0], _cPts[0][1])
                for (let s = 0; s < cSegs; s++) {
                  const mx = (_cPts[s][0] + _cPts[s + 1][0]) * 0.5
                  const my = (_cPts[s][1] + _cPts[s + 1][1]) * 0.5
                  ctx.quadraticCurveTo(_cPts[s][0], _cPts[s][1], mx, my)
                }
                ctx.lineTo(_cPts[cSegs][0], _cPts[cSegs][1])
                ctx.stroke()
              }
            }
          }

          // ── Eating flash — dramatic color-coded burst with ripple + absorption ──
          if (c.eatFlash > 0 && lod >= 2) {
            let flashHue = 120
            if (c.lastAte === FOOD_MEAT) flashHue = 0
            else if (c.lastAte === FOOD_MINERAL) flashHue = 45
            const flashFrac = c.eatFlash / 25
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            // Expanding ripple ring
            const rippleR = drawR * (1.2 + (1 - flashFrac) * 2.5)
            ctx.globalAlpha = flashFrac * flashFrac * 0.35 * _orgGlowDamp
            ctx.strokeStyle = hsla(flashHue, 85, 75, 0.8)
            ctx.lineWidth = 1.0 * flashFrac + 0.3
            ctx.beginPath()
            ctx.arc(x, y, rippleR, 0, TAU)
            ctx.stroke()
            // Inner glow burst — simple fill
            ctx.globalAlpha = flashFrac * 0.3 * _orgGlowDamp
            ctx.fillStyle = hsla(flashHue, 80, 75, 0.5)
            ctx.beginPath()
            ctx.arc(x, y, drawR * 1.2, 0, TAU)
            ctx.fill()
            // Nutrient absorption dots spiraling inward
            if (drawR > 4) {
              const dotCount = 4 + Math.floor(flashFrac * 4)
              for (let di = 0; di < dotCount; di++) {
                const da = (di / dotCount) * TAU + t * 0.15 + c.id
                const dd = drawR * (0.5 + flashFrac * 1.5)
                const dx2 = x + Math.cos(da) * dd
                const dy2 = y + Math.sin(da) * dd
                ctx.globalAlpha = flashFrac * 0.5
                ctx.fillStyle = hsla(flashHue, 80, 80, 0.8)
                ctx.beginPath()
                ctx.arc(dx2, dy2, 0.5 + flashFrac * 0.8, 0, TAU)
                ctx.fill()
              }
            }
            // Bright membrane highlight
            ctx.globalAlpha = flashFrac * 0.3
            ctx.strokeStyle = hsla(flashHue, 90, 80, 0.7)
            ctx.lineWidth = 1.5 + flashFrac * 1.5
            if (cellElong > 0.2) {
              this._elongPath(ctx, x, y, drawR * 1.08, morphPhase, c.id, cellElong, faceDx, faceDy)
            } else {
              this._blobPath(ctx, x, y, drawR * 1.08, morphPhase, c.id, lobes, c.g.amoeboid || 0, _shapeDesc)
            }
            ctx.stroke()
            ctx.restore()
          }

          // ── Role visual indicators ──
          if (c.role === ROLE_INTERIOR && lod >= 2) {
            ctx.globalAlpha = 0.12
            ctx.fillStyle = hsla(hue, sat * 0.4, lum * 0.5, 0.3)
            ctx.beginPath()
            ctx.arc(x, y, drawR * 0.45, 0, TAU)
            ctx.fill()
          }

          // ── Sociality — wispy feeler tendrils with bulb tips ──
          if (lod >= 4) {
            const social = c.g.sociality ?? 0
            if (social > 0.3) {
              ctx.save()
              ctx.lineCap = 'round'
              const antCount = social > 0.6 ? 3 : 2
              for (let ai = 0; ai < antCount; ai++) {
                const aa = (ai / antCount) * TAU + c.id * 1.3 + t * 0.012
                const antLen = drawR * (0.6 + social * 0.9)
                const wave = Math.sin(t * 0.08 + ai * 2 + c.id) * drawR * 0.2
                const tipX = x + Math.cos(aa) * (drawR + antLen)
                const tipY = y + Math.sin(aa) * (drawR + antLen)
                // Tendril glow
                ctx.globalAlpha = Math.min(0.15, (social - 0.25) * 0.2)
                ctx.strokeStyle = hsla(hue, sat - 10, lum + 25, 0.4)
                ctx.lineWidth = 1.0 + social * 1.0
                ctx.beginPath()
                ctx.moveTo(x + Math.cos(aa) * drawR * 0.85, y + Math.sin(aa) * drawR * 0.85)
                ctx.quadraticCurveTo(
                  x + Math.cos(aa) * (drawR + antLen * 0.5) + Math.cos(aa + 1.5) * wave,
                  y + Math.sin(aa) * (drawR + antLen * 0.5) + Math.sin(aa + 1.5) * wave,
                  tipX,
                  tipY
                )
                ctx.stroke()
                // Core line
                ctx.globalAlpha = Math.min(0.35, (social - 0.25) * 0.4)
                ctx.strokeStyle = hsla(hue, sat, lum + 20, 0.5)
                ctx.lineWidth = 0.3 + social * 0.3
                ctx.stroke()
                // Bulb tip
                ctx.globalAlpha = 0.25 + social * 0.2
                ctx.fillStyle = hsla(hue, sat, lum + 25, 0.6)
                ctx.beginPath()
                ctx.arc(tipX, tipY, 0.8 + social * 0.6, 0, TAU)
                ctx.fill()
              }
              ctx.restore()
            }
          }

          // ── Mutation rate — faint sparkle particles ──
          if (lod >= 4) {
            const mr = c.g.mutRate ?? 0.05
            if (mr > 0.12) {
              const mrLevel = Math.min(1, (mr - 0.12) * 6.7)
              ctx.save()
              const sparkCount = Math.min(3, 1 + Math.floor(mrLevel * 2))
              for (let si = 0; si < sparkCount; si++) {
                const sparkPhase = t * 0.2 + c.id * 7 + si * 3.7
                const sparkAlpha = (Math.sin(sparkPhase) * 0.5 + 0.5) * mrLevel * 0.3
                if (sparkAlpha < 0.04) continue
                const sa = sparkPhase * 0.7
                const sd = drawR * (0.4 + 0.5 * Math.sin(sparkPhase * 0.3))
                ctx.globalAlpha = sparkAlpha
                const sparkR = 0.4 + mrLevel * 0.6
                const spx = x + Math.cos(sa) * sd
                const spy = y + Math.sin(sa) * sd
                ctx.fillStyle = 'rgba(255,255,150,0.9)'
                ctx.beginPath()
                ctx.arc(spx, spy, sparkR, 0, TAU)
                ctx.fill()
              }
              ctx.restore()
            }
          }

          // ── Cooperation — warm inner glow ──
          if (lod >= 2 && (c.cooperationScore || 0) > 0.01) {
            const coopLevel = Math.min(1, c.cooperationScore / 0.05)
            ctx.globalAlpha = coopLevel * 0.08 * _orgGlowDamp
            ctx.globalCompositeOperation = 'lighter'
            ctx.fillStyle = hsla(40, 65, 65, 0.4)
            ctx.beginPath()
            ctx.arc(x, y, drawR * 0.7, 0, TAU)
            ctx.fill()
            ctx.globalCompositeOperation = 'source-over'
          }

          // ── Toughness — double membrane ──
          if (lod >= 3 && (c.g.toughness || 0) > 0.15 && _memAlpha > 0.15) {
            const tough = c.g.toughness
            ctx.globalAlpha = (0.08 + tough * 0.15) * _memAlpha
            ctx.strokeStyle = hsla(hue, sat * 0.7, lum * 0.8, 0.5)
            ctx.lineWidth = 0.8 + tough * 2.0
            this._blobPath(
              ctx,
              x,
              y,
              drawR + 1.0 + tough * 1.5,
              morphPhase * 0.98,
              c.id + 50,
              lobes,
              0,
              _shapeDesc
            )
            ctx.stroke()
          }

          // ── Multicellular extra membrane ──
          if (c.linkCount > 0 && lod >= 3 && _memAlpha > 0.15) {
            ctx.globalAlpha = (0.12 + Math.min(c.linkCount * 0.03, 0.1)) * _orgGlowDamp * _memAlpha
            ctx.strokeStyle = hsla(hue, sat + 10, lum + 15, 0.35)
            ctx.lineWidth = 0.5 + c.linkCount * 0.1
            this._blobPath(ctx, x, y, drawR + 1.5, c.membranePhase * 0.97, c.id + 100, 6)
            ctx.stroke()
          }

          // ── Senescence visual deterioration — single dark overlay ──
          if (lod >= 3 && senLevel > 0.35) {
            const decay = Math.min(1, (senLevel - 0.35) * 1.54)
            ctx.globalAlpha = decay * 0.18
            ctx.fillStyle = 'rgba(30,20,10,0.7)'
            ctx.beginPath()
            ctx.arc(x, y, drawR * 0.7, 0, TAU)
            ctx.fill()
          }

          // ── Organism depth — darker interior cells ──
          if (lod >= 3 && c.organismDepth >= 2) {
            ctx.globalAlpha = Math.min(0.2, c.organismDepth * 0.05)
            ctx.fillStyle = hsla(hue, sat * 0.3, lum * 0.35, 0.5)
            ctx.beginPath()
            ctx.arc(x, y, drawR * 0.55, 0, TAU)
            ctx.fill()
          }

          // ── Apoptosis — faint dissolving marks ──
          if (lod >= 3 && (c.g.apoptosis || 0) > 0.15 && c.organismDepth >= 2) {
            ctx.globalAlpha = c.g.apoptosis * 0.2
            ctx.strokeStyle = 'rgba(200,180,255,0.4)'
            ctx.lineWidth = 0.4
            const xs = drawR * 0.12
            ctx.beginPath()
            ctx.moveTo(x - xs, y - xs)
            ctx.lineTo(x + xs, y + xs)
            ctx.moveTo(x + xs, y - xs)
            ctx.lineTo(x - xs, y + xs)
            ctx.stroke()
          }

          // ── Tracked species glow (all members of focused clade) ──
          if (isTrackedClade && !isTrackedCell && lod >= 1) {
            ctx.globalCompositeOperation = 'lighter'
            const sPulse = 0.5 + 0.5 * Math.sin(t * 0.04 + c.id * 0.7)
            ctx.globalAlpha = (0.06 + sPulse * 0.04) * _orgGlowDamp
            ctx.strokeStyle = hsla(hue, sat + 10, lum + 20, 0.4)
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.arc(x, y, drawR + 2, 0, TAU)
            ctx.stroke()
            ctx.globalCompositeOperation = 'source-over'
          }

          // ── Tracked cell highlight — covers whole organism ──
          if (isTrackedCell) {
            const pulse = 0.5 + 0.5 * Math.sin(t * 0.06)
            // Use organism bounding circle if available, else fall back to single cell
            const hlX = _orgRadius > 0 ? _orgCenterX : x
            const hlY = _orgRadius > 0 ? _orgCenterY : y
            const hlR = _orgRadius > 0 ? _orgRadius : drawR
            ctx.save()
            ctx.globalAlpha = 0.5 + pulse * 0.4
            ctx.strokeStyle = `rgba(255,220,60,${(0.6 + pulse * 0.4).toFixed(2)})`
            ctx.lineWidth = 2.0 + pulse * 1.5
            ctx.beginPath()
            ctx.arc(hlX, hlY, hlR + 6 + pulse * 3, 0, TAU)
            ctx.stroke()
            ctx.globalAlpha = 0.15 + pulse * 0.1
            ctx.strokeStyle = `rgba(255,220,60,0.4)`
            ctx.lineWidth = 6 + pulse * 3
            ctx.beginPath()
            ctx.arc(hlX, hlY, hlR + 8 + pulse * 3, 0, TAU)
            ctx.stroke()
            ctx.globalAlpha = 0.7 + pulse * 0.3
            ctx.fillStyle = `rgba(255,220,60,0.9)`
            const arrowY = hlY - hlR - 14 - pulse * 3
            ctx.beginPath()
            ctx.moveTo(hlX, hlY - hlR - 5)
            ctx.lineTo(hlX - 4, arrowY)
            ctx.lineTo(hlX + 4, arrowY)
            ctx.closePath()
            ctx.fill()
            ctx.globalAlpha = 0.8
            ctx.font = 'bold 9px monospace'
            ctx.fillStyle = 'rgba(255,220,60,0.9)'
            ctx.textAlign = 'center'
            const trackLabel = trackTarget && trackTarget.label ? trackTarget.label : 'TRACKING'
            ctx.fillText('★ ' + trackLabel, hlX, arrowY - 4)
            ctx.restore()
          }
        }
      }
    }

    // ── Flush batched LOD 0 dots ──
    // Glow pass first (additive) — makes tiny dots visible against dark water
    ctx.globalCompositeOperation = 'lighter'
    for (let bi = 0; bi < _LOD0_BUCKETS; bi++) {
      const b = _lod0Buckets[bi]
      if (!b || b.pts.length === 0) continue
      ctx.globalAlpha = 0.12
      ctx.fillStyle = hsl(b.h, Math.min(100, b.s + 10), Math.min(85, b.l + 20))
      ctx.beginPath()
      const pts = b.pts
      for (let j = 0; j < pts.length; j += 3) {
        const px = pts[j],
          py = pts[j + 1],
          pr = pts[j + 2]
        const gr = pr * 2.2
        ctx.moveTo(px + gr, py)
        ctx.arc(px, py, gr, 0, TAU)
      }
      ctx.fill()
    }
    // Core dot pass
    ctx.globalCompositeOperation = 'source-over'
    for (let bi = 0; bi < _LOD0_BUCKETS; bi++) {
      const b = _lod0Buckets[bi]
      if (!b || b.pts.length === 0) continue
      ctx.globalAlpha = 0.85
      ctx.fillStyle = hsl(b.h, b.s, b.l)
      ctx.beginPath()
      const pts = b.pts
      for (let j = 0; j < pts.length; j += 3) {
        const px = pts[j],
          py = pts[j + 1],
          pr = pts[j + 2]
        ctx.moveTo(px + pr, py)
        ctx.arc(px, py, pr, 0, TAU)
      }
      ctx.fill()
    }
    if (_lod0FilteredPath && _lod0FilteredPath.length > 0) {
      ctx.globalAlpha = 0.06
      ctx.fillStyle = 'rgba(120,130,150,0.5)'
      ctx.beginPath()
      const fp = _lod0FilteredPath
      for (let j = 0; j < fp.length; j += 3) {
        const px = fp[j],
          py = fp[j + 1],
          pr = fp[j + 2]
        ctx.moveTo(px + pr, py)
        ctx.arc(px, py, pr, 0, TAU)
      }
      ctx.fill()
    }

    // ── Flush batched LOD 1 circles (glow + fill + membrane stroke) ──
    // Glow halo pass (additive) — makes organisms pop against dark water
    ctx.globalCompositeOperation = 'lighter'
    for (let bi = 0; bi < _LOD0_BUCKETS; bi++) {
      const b = _lod1Buckets[bi]
      if (!b || b.pts.length === 0) continue
      ctx.globalAlpha = 0.08
      ctx.fillStyle = hsl(b.h, Math.min(100, b.s + 10), Math.min(85, b.l + 25))
      ctx.beginPath()
      const pts = b.pts
      for (let j = 0; j < pts.length; j += 3) {
        const px = pts[j],
          py = pts[j + 1],
          pr = pts[j + 2]
        const gr = pr * 2.0
        ctx.moveTo(px + gr, py)
        ctx.arc(px, py, gr, 0, TAU)
      }
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    for (let bi = 0; bi < _LOD0_BUCKETS; bi++) {
      const b = _lod1Buckets[bi]
      if (!b || b.pts.length === 0) continue
      const pts = b.pts
      // Fill pass
      ctx.globalAlpha = 0.75
      ctx.fillStyle = hsl(b.h, b.s, b.l)
      ctx.beginPath()
      for (let j = 0; j < pts.length; j += 3) {
        const px = pts[j],
          py = pts[j + 1],
          pr = pts[j + 2]
        ctx.moveTo(px + pr, py)
        ctx.arc(px, py, pr, 0, TAU)
      }
      ctx.fill()
      // Membrane stroke pass — brighter
      ctx.globalAlpha = 0.6
      ctx.strokeStyle = hsl(b.h, Math.min(100, b.s + 15), Math.min(88, b.l + 22))
      ctx.lineWidth = 1.0
      ctx.stroke()
    }
    ctx.restore()
  }
}
