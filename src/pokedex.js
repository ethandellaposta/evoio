// ══════════════════════════════════════════════════════════════════════════════
// Pokédex-Style Organism Image Export
// Renders a full visual catalog of every multicellular organism as PNG cards
// bundled into a ZIP (via JSZip) or downloaded individually as fallback.
// ══════════════════════════════════════════════════════════════════════════════

import { buildOrganisms } from './render/index.js'
import { cladeHue, cladeSatOffset, cladeLumOffset, cladeColor } from './render/index.js'

const TAU = Math.PI * 2
const CARD_W = 512
const CARD_H = 640

// ── Color helpers ──
function _clamp(x, a, b) { return x < a ? a : x > b ? b : x }
function _hsl(h, s, l) { return `hsl(${h | 0} ${s | 0}% ${l | 0}%)` }
function _hsla(h, s, l, a) { return `hsla(${h | 0} ${s | 0}% ${l | 0}% / ${a.toFixed(3)})` }

// ══════════════════════════════════════════════════════════════════════════════
// Collect all multicellular organisms, deduplicated by clade (best per clade)
// ══════════════════════════════════════════════════════════════════════════════
function collectOrganisms(sim, ensureCladeName, organismNames) {
  const organisms = buildOrganisms(sim.cells, sim.links, sim.w, sim.h, sim.cfg.linkDist)
  const byCladeMap = new Map() // clade → best org data

  for (const [, indices] of organisms) {
    if (indices.length < 2) continue
    const cells = indices.map(i => sim.cells[i])
    const clade = cells[0].clade
    let totalEnergy = 0, dietSum = 0, maxAge = 0, complexitySum = 0
    for (const c of cells) {
      totalEnergy += c.energy
      dietSum += c.g.diet
      if (c.age > maxAge) maxAge = c.age
      complexitySum += c.complexity || 0
    }
    const avgDiet = dietSum / cells.length
    let dietLabel = 'Herbivore'
    if (avgDiet > 0.6) dietLabel = 'Carnivore'
    else if (avgDiet > 0.3) dietLabel = 'Omnivore'

    const score = indices.length * 10 + totalEnergy * 2 +
      Math.min(maxAge / 200, 10) * 3 + (complexitySum / cells.length) * 5

    // Pick representative cell (highest energy)
    let repCell = cells[0]
    for (const c of cells) { if (c.energy > repCell.energy) repCell = c }

    ensureCladeName(clade, sim)
    const entry = organismNames.get(clade) || {}

    const orgData = {
      clade,
      name: entry.displayName || `Clade ${clade}`,
      sciName: entry.scientificName || '',
      size: indices.length,
      energy: totalEnergy,
      maxAge,
      avgComplexity: complexitySum / cells.length,
      score,
      diet: dietLabel,
      avgDiet,
      color: cladeColor(clade),
      rep: repCell,
      cells
    }

    // Keep best organism per clade
    if (!byCladeMap.has(clade) || orgData.score > byCladeMap.get(clade).score) {
      byCladeMap.set(clade, orgData)
    }
  }

  return [...byCladeMap.values()].sort((a, b) => b.score - a.score)
}

// ══════════════════════════════════════════════════════════════════════════════
// Draw organism illustration (replicates _drawMiniCell from main.js)
// ══════════════════════════════════════════════════════════════════════════════
function drawOrganismIllustration(ctx, org, cx, cy, radius) {
  const allCells = org.cells || [org.rep]

  // Compute centroid
  let sumX = 0, sumY = 0
  for (const c of allCells) { sumX += c.x; sumY += c.y }
  const centX = sumX / allCells.length, centY = sumY / allCells.length

  // Find max distance from centroid
  let maxDist = 4
  for (const c of allCells) {
    const dx = c.x - centX, dy = c.y - centY
    const g = c.g
    const baseCell = 4.0 * (g.bodyScale || 1)
    const eScale = Math.min(1.25, 0.9 + c.energy * 0.05)
    const vScale = 1 + (c.organelles ? c.organelles[4] : 0) * 0.15
    const mScale = 1 + (g.membrane || 0) * 0.15
    const cellR = baseCell * eScale * vScale * mScale
    const glowMult = 1.9 + Math.min(c.energy / 3.5, 1) * 1.0
    let visualR = cellR * glowMult
    if ((g.flagella || 0) > 0.08) visualR = Math.max(visualR, cellR * (2.0 + (g.flagella || 0) * 4.5))
    if ((g.spines || 0) > 0.08) visualR = Math.max(visualR, cellR * (1.0 + (g.spines || 0) * 0.8))
    if ((g.spike || 0) > 0.1) visualR = Math.max(visualR, cellR * (1.0 + (g.spike || 0) * 1.8))
    if ((g.cilia || 0) > 0.15) visualR = Math.max(visualR, cellR * (1.0 + (g.cilia || 0) * 0.6))
    if ((g.toxin || 0) > 0.2) visualR = Math.max(visualR, cellR * (1.6 + (g.toxin || 0) * 2.0))
    const d = Math.sqrt(dx * dx + dy * dy) + visualR
    if (d > maxDist) maxDist = d
  }

  const scale = (radius * 0.72) / maxDist
  const baseR = 4.0 * scale
  const _bpX = new Float64Array(32)
  const _bpY = new Float64Array(32)

  function toLocal(wx, wy) {
    return [cx + (wx - centX) * scale, cy + (wy - centY) * scale]
  }

  function _blobPath(ctx, x, y, r, phase, id, nLobes, amoeboid, shape) {
    const lobes = nLobes || 7
    const am = amoeboid || 0
    const depth = shape ? shape.depth : 0.12
    const chaos = shape ? shape.chaos : 0
    const facet = shape ? shape.facet : 0
    const stream = shape ? shape.streamline : 0
    const sFdx = shape ? shape.faceDx || 0 : 0
    const sFdy = shape ? shape.faceDy || 0 : 0
    const lobeAngle = TAU / lobes
    for (let i = 0; i < lobes; i++) {
      const a = i * lobeAngle
      const cosA = Math.cos(a), sinA = Math.sin(a)
      let deform = 1.0 +
        depth * Math.sin(phase + a * 2.0 + id * 1.7) +
        depth * 0.58 * Math.sin(phase * 0.7 + a * 3.0 + id * 0.9) +
        depth * 0.42 * Math.cos(a * 5.0 + id * 2.3)
      if (chaos > 0.01) {
        const hash = Math.sin(id * 12.9898 + i * 78.233) * 43758.5453
        deform += chaos * 0.18 * ((hash - (hash | 0)) * 2 - 1)
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
        deform += am * 0.3 * Math.sin(a * 1.5 + id * 2.1)
        deform += am * 0.2 * Math.sin(a * 2.7 + id * 0.6)
        deform += am * 0.15 * Math.cos(a * 0.8 + id * 3.4)
      }
      _bpX[i] = x + cosA * r * deform
      _bpY[i] = y + sinA * r * deform
    }
    ctx.beginPath()
    ctx.moveTo((_bpX[lobes - 1] + _bpX[0]) * 0.5, (_bpY[lobes - 1] + _bpY[0]) * 0.5)
    for (let i = 0; i < lobes; i++) {
      const ni = i + 1 < lobes ? i + 1 : 0
      ctx.quadraticCurveTo(_bpX[i], _bpY[i], (_bpX[i] + _bpX[ni]) * 0.5, (_bpY[i] + _bpY[ni]) * 0.5)
    }
    ctx.closePath()
  }

  function _elongPath(ctx, x, y, r, phase, id, elongation, faceDx, faceDy) {
    const elong = 0.3 + elongation * 1.4
    const lobes = 12
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * TAU
      const cosA = Math.cos(a), sinA = Math.sin(a)
      const dot = cosA * faceDx + sinA * faceDy
      const stretch = 1.0 + Math.abs(dot) * elong
      const squeeze = 1.0 - Math.abs(cosA * -faceDy + sinA * faceDx) * elong * 0.3
      const deform = stretch * squeeze * (1.0 +
        0.06 * Math.sin(phase + a * 2.0 + id * 1.7) +
        0.04 * Math.sin(phase * 0.7 + a * 3.0 + id * 0.9))
      _bpX[i] = x + cosA * r * deform
      _bpY[i] = y + sinA * r * deform
    }
    ctx.beginPath()
    ctx.moveTo((_bpX[lobes - 1] + _bpX[0]) * 0.5, (_bpY[lobes - 1] + _bpY[0]) * 0.5)
    for (let i = 0; i < lobes; i++) {
      const ni = (i + 1) % lobes
      ctx.quadraticCurveTo(_bpX[i], _bpY[i], (_bpX[i] + _bpX[ni]) * 0.5, (_bpY[i] + _bpY[ni]) * 0.5)
    }
    ctx.closePath()
  }

  // Render each cell
  for (const c of allCells) {
    const [x, y] = toLocal(c.x, c.y)
    const g = c.g

    // Color
    const baseHue = cladeHue(c.clade)
    const dietShift = g.diet * 55 - 15
    const hueShiftVal = (g.hueShift || 0) * 180
    const morphHueShift =
      (g.toxin || 0) * -40 + (g.spines || 0) * 25 + (g.flagella || 0) * -18 +
      (g.biolum || 0) * 35 + (g.amoeboid || 0) * -15 + (g.membrane || 0) * 12 +
      (g.chloroplast || 0) * -30 + (g.elongation || 0) * 10
    const hue = (baseHue + dietShift + hueShiftVal + morphHueShift + 720) % 360
    const brightnessGene = g.brightness || 0
    const cSatOff = cladeSatOffset(c.clade)
    const cLumOff = cladeLumOffset(c.clade)
    const sat = _clamp(60 + g.diet * 25 - brightnessGene * 15 + cSatOff * 1.5 -
      (g.membrane || 0) * 18 + (g.chloroplast || 0) * 12 + (g.toxin || 0) * 10, 15, 100)
    const lum = _clamp(44 + 14 * g.adhesion + brightnessGene * 28 + cLumOff * 1.5 -
      (g.toxin || 0) * 12 - (g.membrane || 0) * 6 + (g.biolum || 0) * 10, 18, 88)

    // Radius
    const energyScale = _clamp(0.9 + c.energy * 0.05, 0.85, 1.25)
    const vacScale = 1 + (c.organelles ? c.organelles[4] : 0) * 0.15
    const memScale = 1 + g.membrane * 0.15
    const bodyScaleGene = g.bodyScale || 1.0
    const drawR = Math.max(3, baseR * energyScale * vacScale * memScale * bodyScaleGene)

    // Facing
    const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
    const faceDx = c.vx / vLen, faceDy = c.vy / vLen

    // Shape params
    const ageMorph = Math.min((c.age || 0) / 800, 1)
    const cxMorph = Math.min((c.complexity || 0) / 5, 1)
    const cellElong = g.elongation || 0
    const fullness = _clamp(c.energy / (g.division * 0.6), 0, 1)
    let lobes
    if (g.diet > 0.6) lobes = 3 + Math.floor(ageMorph * 1 + cxMorph * 1 + (g.membrane || 0) * 2)
    else if (g.diet < 0.25) lobes = 10 + Math.floor(ageMorph * 3 + cxMorph * 3 + (g.adhesion || 0) * 3)
    else lobes = 6 + Math.floor(ageMorph * 2 + cxMorph * 2 + (g.spines || 0) * 4)
    const shapeDepth = 0.05 + (1 - fullness) * 0.22 + g.diet * 0.1 + (g.spines || 0) * 0.08
    const shapeChaos = _clamp(((g.mutRate || 0.05) - 0.03) * 4, 0, 1)
    const shapeFacet = _clamp((g.membrane || 0) - 0.1, 0, 1) * 1.2
    const shapeStream = _clamp(g.speed - 0.6, 0, 1) * 0.8
    const morphPhase = (c.membranePhase || 0) + ageMorph * 0.5
    const shapeDesc = { depth: shapeDepth, chaos: shapeChaos, facet: shapeFacet,
      streamline: shapeStream, faceDx, faceDy }

    // Glow
    const orgSize = c.organismSize || 1
    const _orgGlowDamp = orgSize > 1 ? 1.0 / (1.0 + (orgSize - 1) * 0.35) : 1.0
    const eLev = _clamp(c.energy / 3.5, 0, 1)
    const biolum = g.biolum || 0
    const glowR = drawR * (1.9 + eLev * 1.0 + cxMorph * 0.5 + biolum * 0.7)
    const glowAlpha = (0.04 + eLev * 0.05 + cxMorph * 0.015 + biolum * 0.07) * _orgGlowDamp
    if (glowAlpha > 0.005 && glowR > 1) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = glowAlpha
      const gGrad = ctx.createRadialGradient(x, y, 0, x, y, glowR)
      gGrad.addColorStop(0, _hsla(hue, sat, lum + 20, 0.6))
      gGrad.addColorStop(0.5, _hsla(hue, sat, lum, 0.2))
      gGrad.addColorStop(1, _hsla(hue, sat, lum, 0))
      ctx.fillStyle = gGrad
      ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2)
      ctx.restore()
    }

    // Toxin cloud
    if ((g.toxin || 0) > 0.2) {
      const tx = g.toxin
      const toxR = drawR * (1.6 + tx * 2.0)
      ctx.globalAlpha = 0.05 + tx * 0.12
      ctx.fillStyle = 'rgba(60,200,30,0.2)'
      ctx.beginPath(); ctx.arc(x, y, toxR, 0, TAU); ctx.fill()
    }

    // Flagella
    if ((g.flagella || 0) > 0.08) {
      const fl = g.flagella
      const tailCount = fl > 0.5 ? 3 : 2
      const tailLen = drawR * (2.0 + fl * 4.5)
      const tailX = -faceDx, tailY = -faceDy
      ctx.lineCap = 'round'
      for (let fi = 0; fi < tailCount; fi++) {
        const spread = (fi - (tailCount - 1) / 2) * drawR * 0.22
        const phaseOff = fi * 1.7 + c.id
        const tSegs = 8
        const tPts = []
        tPts[0] = [x + tailY * spread, y - tailX * spread]
        for (let s = 1; s <= tSegs; s++) {
          const frac = s / tSegs
          const amp = frac * frac
          const wave = Math.sin(frac * Math.PI * 3.5 + phaseOff) * drawR * 0.6 * fl * amp
          tPts[s] = [
            x + tailY * spread + tailX * tailLen * frac + tailY * wave,
            y - tailX * spread + tailY * tailLen * frac - tailX * wave
          ]
        }
        ctx.strokeStyle = _hsla(hue, 75, 72, 0.25 + fl * 0.45)
        ctx.lineWidth = 0.6 + fl * 1.4
        ctx.beginPath()
        ctx.moveTo(tPts[0][0], tPts[0][1])
        for (let s = 0; s < tSegs; s++) {
          const mx = (tPts[s][0] + tPts[s + 1][0]) * 0.5
          const my = (tPts[s][1] + tPts[s + 1][1]) * 0.5
          ctx.quadraticCurveTo(tPts[s][0], tPts[s][1], mx, my)
        }
        ctx.lineTo(tPts[tSegs][0], tPts[tSegs][1])
        ctx.stroke()
      }
    }

    // Spines
    if ((g.spines || 0) > 0.08) {
      const sn = g.spines
      ctx.lineCap = 'round'
      const barbCount = Math.min(10, 6 + Math.floor(sn * 6))
      ctx.globalAlpha = 0.4 + sn * 0.35
      ctx.strokeStyle = _hsla(40, 65, 72, 0.6)
      ctx.lineWidth = 0.5 + sn * 0.7
      for (let bi = 0; bi < barbCount; bi++) {
        const ba = (bi / barbCount) * TAU + c.id * 1.3
        const lenVar = 0.7 + 0.6 * ((c.id * 5 + bi * 3.7) % 1)
        const bLen = drawR * (0.3 + sn * 0.8) * lenVar
        const bx0 = x + Math.cos(ba) * drawR * 0.95
        const by0 = y + Math.sin(ba) * drawR * 0.95
        const tipX = x + Math.cos(ba) * (drawR + bLen)
        const tipY = y + Math.sin(ba) * (drawR + bLen)
        ctx.beginPath(); ctx.moveTo(bx0, by0); ctx.lineTo(tipX, tipY); ctx.stroke()
      }
    }

    // Spike
    if ((g.spike || 0) > 0.1) {
      const sp = g.spike
      const spikeLen = drawR * (0.6 + sp * 1.8)
      const spikeCount = 3 + Math.floor(sp * 5)
      ctx.fillStyle = _hsla(0, 75, 55, 0.35 + sp * 0.2)
      for (let si = 0; si < spikeCount; si++) {
        const sa = (si / spikeCount) * TAU + c.id * 0.5
        const tipX = x + Math.cos(sa) * (drawR + spikeLen)
        const tipY = y + Math.sin(sa) * (drawR + spikeLen)
        const b1x = x + Math.cos(sa - 0.12) * drawR * 0.92
        const b1y = y + Math.sin(sa - 0.12) * drawR * 0.92
        const b2x = x + Math.cos(sa + 0.12) * drawR * 0.92
        const b2y = y + Math.sin(sa + 0.12) * drawR * 0.92
        ctx.beginPath(); ctx.moveTo(b1x, b1y); ctx.lineTo(tipX, tipY); ctx.lineTo(b2x, b2y)
        ctx.closePath(); ctx.fill()
      }
    }

    // Body shape
    if (drawR < 3.5) {
      ctx.beginPath(); ctx.arc(x, y, drawR, 0, TAU)
    } else if (cellElong > 0.2) {
      _elongPath(ctx, x, y, drawR, morphPhase, c.clade, cellElong, faceDx, faceDy)
    } else {
      _blobPath(ctx, x, y, drawR, morphPhase, c.clade, lobes, g.amoeboid || 0, shapeDesc)
    }

    // Body fill
    const fillAlpha = 0.4 + fullness * 0.35
    ctx.globalAlpha = fillAlpha
    const fillHueShift = ((g.pattern ?? 0.5) - 0.5) * 30
    const fillHue = (hue + fillHueShift + 360) % 360
    ctx.fillStyle = _hsl(fillHue, sat * 0.55, _clamp(lum + 6 + brightnessGene * 8, 32, 82))
    ctx.fill()

    // Membrane stroke
    ctx.globalAlpha = 1
    const neonLum = _clamp(lum + 22, 55, 88)
    const neonSat = _clamp(sat + 15, 60, 100)
    const memThick = 0.8 + g.membrane * 2.5 + cxMorph * 0.6
    ctx.strokeStyle = _hsla(hue, neonSat, neonLum, 0.65 + g.membrane * 0.25)
    ctx.lineWidth = memThick
    ctx.stroke()

    // Body patterns
    if (drawR > 4) {
      const pat = g.pattern ?? 0.5
      const pScale = g.patternScale ?? 0.5
      const patHue = (hue + 150 + pat * 60) % 360
      const patAlpha = 0.12 + pScale * 0.18
      if (pat < 0.33) {
        const spotCount = 3 + Math.floor(pScale * 5)
        const spotR = drawR * (0.08 + pScale * 0.1)
        ctx.fillStyle = _hsla(patHue, sat * 0.8, lum + 15, patAlpha * 2.5)
        for (let si = 0; si < spotCount; si++) {
          const sa = (si / spotCount) * TAU + c.clade * 2.3
          const sd = drawR * (0.25 + 0.35 * ((c.clade * 7 + si * 5.3) % 1))
          ctx.globalAlpha = patAlpha
          ctx.beginPath(); ctx.arc(x + Math.cos(sa) * sd, y + Math.sin(sa) * sd, spotR, 0, TAU); ctx.fill()
        }
      } else if (pat < 0.66) {
        const stripeCount = 2 + Math.floor(pScale * 3)
        ctx.strokeStyle = _hsla(patHue, sat * 0.7, lum + 10, patAlpha * 2.0)
        ctx.lineWidth = 0.5 + pScale * 1.5
        ctx.lineCap = 'round'
        const stripeAngle = (c.clade * 1.618) % Math.PI
        const cosS = Math.cos(stripeAngle), sinS = Math.sin(stripeAngle)
        for (let si = 0; si < stripeCount; si++) {
          const offset = ((si + 0.5) / stripeCount - 0.5) * drawR * 1.4
          const sx = x + cosS * offset, sy = y + sinS * offset
          const perpLen = drawR * 0.7
          ctx.globalAlpha = patAlpha * (1 - Math.abs(offset) / (drawR * 0.8))
          ctx.beginPath()
          ctx.moveTo(sx - sinS * perpLen, sy + cosS * perpLen)
          ctx.lineTo(sx + sinS * perpLen, sy - cosS * perpLen)
          ctx.stroke()
        }
      } else {
        const ringCount = 1 + Math.floor(pScale * 2)
        ctx.strokeStyle = _hsla(patHue, sat * 0.7, lum + 12, patAlpha * 2.2)
        ctx.lineWidth = 0.4 + pScale * 1.0
        for (let ri = 0; ri < ringCount; ri++) {
          const ringR = drawR * (0.35 + ri * 0.25)
          if (ringR > drawR * 0.9) continue
          ctx.globalAlpha = patAlpha * (1 - ri * 0.25)
          ctx.beginPath(); ctx.arc(x, y, ringR, 0, TAU); ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
    }

    // Organelles
    if (c.organelles) {
      const nucLevel = c.organelles[0]
      if (nucLevel > 0.05) {
        const nucR = drawR * 0.28 + nucLevel * drawR * 0.22
        const nucHue = (hue + 180) % 360
        ctx.globalAlpha = 0.75 + nucLevel * 0.2
        ctx.fillStyle = _hsl(nucHue, 80, 68)
        ctx.beginPath(); ctx.arc(x, y, nucR, 0, TAU); ctx.fill()
        if (nucLevel > 0.2) {
          ctx.globalAlpha = 0.65 + nucLevel * 0.3
          ctx.fillStyle = _hsla(nucHue, 65, 95, 0.95)
          ctx.beginPath(); ctx.arc(x - nucR * 0.15, y - nucR * 0.1, nucR * 0.25, 0, TAU); ctx.fill()
        }
      }
      const mitoLevel = c.organelles[1]
      if (mitoLevel > 0.06) {
        const mitoCount = Math.min(3, 1 + Math.floor(mitoLevel * 3))
        for (let mi = 0; mi < mitoCount; mi++) {
          const ma = (mi / mitoCount) * TAU + c.clade * 0.7
          const md = drawR * 0.4
          const mr = drawR * 0.07 * (1.0 + mitoLevel * 0.6)
          ctx.globalAlpha = 0.7 + mitoLevel * 0.25
          ctx.fillStyle = _hsl(15, 92, 58)
          ctx.beginPath(); ctx.arc(x + Math.cos(ma) * md, y + Math.sin(ma) * md, mr, 0, TAU); ctx.fill()
        }
      }
      const vacLevel = c.organelles[4]
      if (vacLevel > 0.08) {
        const vr = drawR * 0.3 * vacLevel + drawR * 0.12
        ctx.globalAlpha = 0.35 + vacLevel * 0.3
        ctx.fillStyle = _hsla(200, 50, 72, 0.5)
        ctx.beginPath(); ctx.arc(x + drawR * 0.2, y + drawR * 0.2, vr, 0, TAU); ctx.fill()
      }
      const recLevel = c.organelles[3]
      if (recLevel > 0.08) {
        const recCount = 4 + Math.floor(recLevel * 6)
        for (let ri = 0; ri < recCount; ri++) {
          const ra = (ri / recCount) * TAU + c.id * 1.1
          const rDist = drawR * 0.9
          const rr = 0.6 + recLevel * 1.0
          ctx.globalAlpha = 0.6 + recLevel * 0.3
          ctx.fillStyle = _hsla(45, 95, 75, 0.9)
          ctx.beginPath(); ctx.arc(x + Math.cos(ra) * rDist, y + Math.sin(ra) * rDist, rr, 0, TAU); ctx.fill()
        }
        ctx.globalAlpha = 1
      }
    }

    // Cilia
    if ((g.cilia || 0) > 0.15) {
      const cl = g.cilia
      const count = Math.min(16, Math.floor(8 + cl * 16))
      const ciliaLen = drawR * (0.3 + cl * 0.6)
      ctx.save()
      ctx.lineCap = 'round'
      ctx.strokeStyle = _hsla(hue, sat - 10, lum + 22, 0.6)
      ctx.lineWidth = 0.3 + cl * 0.3
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU
        const bx = x + Math.cos(a) * (drawR + 0.3)
        const by = y + Math.sin(a) * (drawR + 0.3)
        const tipAngle = a + Math.sin(a * 3.5 + c.id * 0.5) * 0.35
        const tipLen = ciliaLen * 0.85
        ctx.globalAlpha = 0.25 + cl * 0.35
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(bx + Math.cos(tipAngle) * tipLen, by + Math.sin(tipAngle) * tipLen)
        ctx.stroke()
      }
      ctx.restore()
    }

    ctx.globalAlpha = 1
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Draw radar chart for trait fingerprint
// ══════════════════════════════════════════════════════════════════════════════
function drawRadarChart(ctx, cx, cy, radius, traits, hue) {
  const keys = Object.keys(traits)
  const n = keys.length
  if (n < 3) return
  const angleStep = TAU / n

  // Background web
  ctx.globalAlpha = 0.15
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.lineWidth = 0.5
  for (let ring = 1; ring <= 3; ring++) {
    const r = radius * (ring / 3)
    ctx.beginPath()
    for (let i = 0; i <= n; i++) {
      const a = i * angleStep - Math.PI / 2
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }

  // Axes
  ctx.globalAlpha = 0.1
  for (let i = 0; i < n; i++) {
    const a = i * angleStep - Math.PI / 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius)
    ctx.stroke()
  }

  // Data polygon
  ctx.globalAlpha = 0.25
  ctx.fillStyle = _hsla(hue, 70, 55, 0.3)
  ctx.beginPath()
  for (let i = 0; i <= n; i++) {
    const idx = i % n
    const a = idx * angleStep - Math.PI / 2
    const v = _clamp(traits[keys[idx]] || 0, 0, 1)
    const r = radius * (0.08 + v * 0.92)
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.fill()

  ctx.globalAlpha = 0.6
  ctx.strokeStyle = _hsla(hue, 80, 65, 0.8)
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i <= n; i++) {
    const idx = i % n
    const a = idx * angleStep - Math.PI / 2
    const v = _clamp(traits[keys[idx]] || 0, 0, 1)
    const r = radius * (0.08 + v * 0.92)
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.stroke()

  // Labels
  ctx.globalAlpha = 0.55
  ctx.fillStyle = '#c8d0e8'
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < n; i++) {
    const a = i * angleStep - Math.PI / 2
    const lx = cx + Math.cos(a) * (radius + 14)
    const ly = cy + Math.sin(a) * (radius + 14)
    ctx.fillText(keys[i], lx, ly)
  }
  ctx.globalAlpha = 1
}

// ══════════════════════════════════════════════════════════════════════════════
// Render a single Pokédex card
// ══════════════════════════════════════════════════════════════════════════════
function renderCard(org, index, simTick) {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  const hue = cladeHue(org.clade)

  // ── Background ──
  const bgGrad = ctx.createLinearGradient(0, 0, 0, CARD_H)
  bgGrad.addColorStop(0, _hsla(hue, 20, 8, 1))
  bgGrad.addColorStop(0.4, _hsla(hue, 15, 5, 1))
  bgGrad.addColorStop(1, _hsla(hue, 10, 3, 1))
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // ── Border ──
  ctx.strokeStyle = _hsla(hue, 60, 45, 0.5)
  ctx.lineWidth = 3
  const bR = 12
  ctx.beginPath()
  ctx.roundRect(1.5, 1.5, CARD_W - 3, CARD_H - 3, bR)
  ctx.stroke()

  // ── Top accent line ──
  ctx.fillStyle = _hsla(hue, 70, 50, 0.8)
  ctx.fillRect(16, 0, CARD_W - 32, 3)

  // ── Header: Number + Name ──
  const numStr = `#${String(index + 1).padStart(3, '0')}`
  ctx.font = 'bold 12px ui-monospace, monospace'
  ctx.fillStyle = _hsla(hue, 50, 60, 0.6)
  ctx.textAlign = 'right'
  ctx.fillText(numStr, CARD_W - 20, 28)

  ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = '#e8ecff'
  ctx.textAlign = 'left'
  ctx.fillText(org.name, 20, 32)

  ctx.font = 'italic 12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = _hsla(hue, 30, 65, 0.7)
  ctx.fillText(org.sciName, 20, 50)

  // ── Diet badge ──
  const dietColors = { Herbivore: '#4ade80', Omnivore: '#facc15', Carnivore: '#f87171' }
  const badgeX = 20, badgeY = 60
  ctx.font = 'bold 10px ui-sans-serif, system-ui, sans-serif'
  const badgeW = ctx.measureText(org.diet).width + 14
  ctx.fillStyle = dietColors[org.diet] || '#888'
  ctx.globalAlpha = 0.2
  ctx.beginPath(); ctx.roundRect(badgeX, badgeY, badgeW, 18, 4); ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = dietColors[org.diet] || '#888'
  ctx.fillText(org.diet, badgeX + 7, badgeY + 13)

  // ── Organism illustration area ──
  const illustY = 90
  const illustH = 300
  const illustCx = CARD_W / 2
  const illustCy = illustY + illustH / 2
  const illustR = Math.min(CARD_W, illustH) * 0.45

  // Circular clip for illustration
  ctx.save()
  ctx.beginPath()
  ctx.arc(illustCx, illustCy, illustR, 0, TAU)
  ctx.clip()

  // Dark radial bg
  const illBg = ctx.createRadialGradient(illustCx, illustCy, 0, illustCx, illustCy, illustR)
  illBg.addColorStop(0, _hsla(hue, 25, 10, 1))
  illBg.addColorStop(0.7, _hsla(hue, 15, 5, 1))
  illBg.addColorStop(1, _hsla(hue, 10, 2, 1))
  ctx.fillStyle = illBg
  ctx.fillRect(illustCx - illustR, illustCy - illustR, illustR * 2, illustR * 2)

  // Draw the organism
  drawOrganismIllustration(ctx, org, illustCx, illustCy, illustR)
  ctx.restore()

  // Illustration ring
  ctx.strokeStyle = _hsla(hue, 50, 40, 0.3)
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(illustCx, illustCy, illustR, 0, TAU); ctx.stroke()

  // ── Stats section ──
  const statsY = illustY + illustH + 16
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = '#8f9bb7'
  ctx.textAlign = 'left'

  const stats = [
    ['Cells', `${org.size}`],
    ['Energy', `${org.energy.toFixed(1)}`],
    ['Max Age', `${org.maxAge}`],
    ['Complexity', `${org.avgComplexity.toFixed(1)}`],
    ['Score', `${org.score.toFixed(0)}`]
  ]

  const colW = (CARD_W - 40) / stats.length
  for (let i = 0; i < stats.length; i++) {
    const sx = 20 + i * colW
    ctx.fillStyle = '#6b7394'
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(stats[i][0], sx, statsY)
    ctx.fillStyle = '#e8ecff'
    ctx.font = 'bold 14px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(stats[i][1], sx, statsY + 16)
  }

  // ── Divider ──
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(20, statsY + 28)
  ctx.lineTo(CARD_W - 20, statsY + 28)
  ctx.stroke()

  // ── Radar chart ──
  const rep = org.rep
  const radarTraits = {
    speed: rep.g.speed || 0,
    sense: rep.g.sense || 0,
    adhesion: rep.g.adhesion || 0,
    membrane: rep.g.membrane || 0,
    toxin: rep.g.toxin || 0,
    diet: rep.g.diet || 0
  }
  const radarCx = CARD_W / 2
  const radarCy = statsY + 88
  const radarR = 48
  drawRadarChart(ctx, radarCx, radarCy, radarR, radarTraits, hue)

  // ── Footer: tick stamp ──
  ctx.globalAlpha = 0.3
  ctx.font = '9px ui-monospace, monospace'
  ctx.fillStyle = '#8f9bb7'
  ctx.textAlign = 'right'
  ctx.fillText(`tick ${simTick}`, CARD_W - 16, CARD_H - 10)
  ctx.textAlign = 'left'
  ctx.fillText('EvoIO', 16, CARD_H - 10)
  ctx.globalAlpha = 1

  return canvas
}

// ══════════════════════════════════════════════════════════════════════════════
// Main export function
// ══════════════════════════════════════════════════════════════════════════════
export async function exportPokedex(sim, ensureCladeName, organismNames, onProgress) {
  const orgList = collectOrganisms(sim, ensureCladeName, organismNames)

  if (orgList.length === 0) {
    alert('No multicellular organisms found. Let the simulation run until organisms form.')
    return
  }

  if (onProgress) onProgress(`Rendering ${orgList.length} organisms...`, 0)

  // Render all cards
  const cards = []
  const manifest = []
  for (let i = 0; i < orgList.length; i++) {
    const org = orgList[i]
    const canvas = renderCard(org, i, sim.t)
    const safeName = org.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
    const filename = `${String(i + 1).padStart(3, '0')}_${safeName}.png`

    cards.push({ canvas, filename })
    manifest.push({
      index: i + 1,
      clade: org.clade,
      displayName: org.name,
      scientificName: org.sciName,
      cellCount: org.size,
      totalEnergy: +org.energy.toFixed(2),
      maxAge: org.maxAge,
      avgComplexity: +org.avgComplexity.toFixed(2),
      diet: org.diet,
      score: +org.score.toFixed(1),
      imageFile: filename,
      topTraits: {
        speed: +(org.rep.g.speed || 0).toFixed(3),
        sense: +(org.rep.g.sense || 0).toFixed(3),
        adhesion: +(org.rep.g.adhesion || 0).toFixed(3),
        membrane: +(org.rep.g.membrane || 0).toFixed(3),
        toxin: +(org.rep.g.toxin || 0).toFixed(3),
        diet: +(org.rep.g.diet || 0).toFixed(3)
      }
    })

    if (onProgress) onProgress(`Rendered ${i + 1}/${orgList.length}`, (i + 1) / orgList.length)

    // Yield to UI every 5 cards
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 0))
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  // Try ZIP export via JSZip
  if (typeof JSZip !== 'undefined') {
    if (onProgress) onProgress('Bundling ZIP...', 0.95)
    const zip = new JSZip()
    const folder = zip.folder(`evoio-pokedex-t${sim.t}`)

    // Add manifest
    folder.file('pokedex.json', JSON.stringify(manifest, null, 2))

    // Add card PNGs
    for (let i = 0; i < cards.length; i++) {
      const blob = await new Promise(resolve => cards[i].canvas.toBlob(resolve, 'image/png'))
      folder.file(cards[i].filename, blob)
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `evoio-pokedex-t${sim.t}-${ts}.zip`
    a.click()
    URL.revokeObjectURL(url)
    if (onProgress) onProgress(`Exported ${orgList.length} organisms!`, 1)
  } else {
    // Fallback: download individual PNGs + JSON manifest
    if (onProgress) onProgress('Downloading PNGs (no JSZip)...', 0.95)

    // Download manifest
    const manifestUri = 'data:application/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(manifest, null, 2))
    const mA = document.createElement('a')
    mA.href = manifestUri
    mA.download = `evoio-pokedex-t${sim.t}-${ts}.json`
    mA.click()

    // Download each PNG with small delay to avoid browser blocking
    for (let i = 0; i < cards.length; i++) {
      const dataUrl = cards[i].canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = cards[i].filename
      a.click()
      await new Promise(r => setTimeout(r, 100))
    }
    if (onProgress) onProgress(`Exported ${orgList.length} organisms!`, 1)
  }
}
