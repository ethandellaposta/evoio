import { hsla, cladeHue } from './color.js'
import { buildOrganisms } from './organisms.js'

// Graham scan convex hull — returns points in CCW order
function _convexHull(points) {
  if (points.length <= 2) return points.slice()
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (let i = 0; i < pts.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0)
      lower.pop()
    lower.push(pts[i])
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0)
      upper.pop()
    upper.push(pts[i])
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

export function installHulls(Renderer) {
  const P = Renderer.prototype

  P._smoothHullPath = function (ctx, pts) {
    if (pts.length < 2) return
    ctx.beginPath()
    const last = pts[pts.length - 1]
    ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2)
    for (let i = 0; i < pts.length; i++) {
      const next = pts[(i + 1) % pts.length]
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + next.x) / 2, (pts[i].y + next.y) / 2)
    }
    ctx.closePath()
  }

  P._drawOrganismHulls = function (sim) {
    const ctx = this.ctx
    const t = this._frameTick
    if (!this._cachedOrganisms || t % 8 === 0) {
      this._cachedOrganisms = buildOrganisms(sim.cells, sim.links, sim.w, sim.h, sim.cfg.linkDist)
    }
    const organisms = this._cachedOrganisms

    ctx.save()

    const cellR = sim.cfg.cellRadius * this.view.scale
    const pad = cellR * 2.8
    const baseSpan = sim.cfg.linkDist * sim.cfg.linkMax * 4
    const maxSpan = baseSpan * this.view.scale
    const maxSpanSq = maxSpan * maxSpan

    let orgIdx = 0
    for (const [, indices] of organisms) {
      if (indices.length < 2) continue

      const firstCell = sim.cells[indices[0]]
      if (!firstCell) continue
      const clade = firstCell.clade
      // Per-organism hue offset so same-species organisms are distinguishable
      const orgIdHash = indices[0] * 137.508 + indices.length * 51.7
      const hueOffset = (orgIdHash % 40) - 20 // ±20° shift per organism
      const hue = cladeHue(clade) + hueOffset
      orgIdx++

      const pts = []
      let avgEnergy = 0
      for (let k = 0; k < indices.length; k++) {
        const c = sim.cells[indices[k]]
        if (!c) continue
        const [sx, sy] = this.worldToScreen(c.x, c.y)
        pts.push({ x: sx, y: sy })
        avgEnergy += c.energy
      }
      if (pts.length < 2) continue
      avgEnergy /= pts.length

      let tooWide = false
      for (let k = 1; k < pts.length; k++) {
        const dx = pts[k].x - pts[0].x
        const dy = pts[k].y - pts[0].y
        if (dx * dx + dy * dy > maxSpanSq) {
          tooWide = true
          break
        }
      }
      if (tooWide) continue

      let cx = 0,
        cy = 0
      for (let k = 0; k < pts.length; k++) {
        cx += pts[k].x
        cy += pts[k].y
      }
      cx /= pts.length
      cy /= pts.length

      if (cx < -100 || cx > this.canvas.width + 100 || cy < -100 || cy > this.canvas.height + 100) continue

      const convex = _convexHull(pts)
      if (convex.length < 2) continue

      // Breathing hull — pad pulses gently with organism energy
      const breathe = 1.0 + 0.06 * Math.sin(t * 0.04 + clade * 1.7) + 0.03 * Math.sin(t * 0.09 + clade * 0.3)
      const energyPad = pad * (0.9 + Math.min(avgEnergy / 4, 0.4))
      const livePad = energyPad * breathe

      // Pad each hull vertex outward from centroid with organic wobble
      const hull = convex.map((p, i) => {
        const a = Math.atan2(p.y - cy, p.x - cx)
        const wobble = 1.0 + 0.08 * Math.sin(t * 0.05 + a * 3 + clade * 2.1 + i * 0.7)
        const d = livePad * wobble
        return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }
      })

      ctx.globalCompositeOperation = 'source-over'
      const groupSize = indices.length
      const fillStr = Math.min(groupSize * 0.012, 0.18)

      // Outer soft glow
      ctx.save()
      ctx.globalAlpha = 0.04 + fillStr * 0.3
      ctx.fillStyle = hsla(hue, 35, 30, 1)
      const outerHull = hull.map((p) => {
        const a = Math.atan2(p.y - cy, p.x - cx)
        return { x: p.x + Math.cos(a) * cellR * 1.5, y: p.y + Math.sin(a) * cellR * 1.5 }
      })
      this._smoothHullPath(ctx, outerHull)
      ctx.fill()
      ctx.restore()

      // Main fill — gradient from center
      ctx.globalAlpha = 0.07 + fillStr
      ctx.fillStyle = hsla(hue, 40, 22, 1)
      this._smoothHullPath(ctx, hull)
      ctx.fill()

      // Outer membrane glow
      ctx.globalAlpha = 0.15 + Math.min(groupSize * 0.015, 0.18)
      ctx.strokeStyle = hsla(hue, 55, 50, 0.5)
      ctx.lineWidth = 5.0 + Math.min(groupSize * 0.3, 5.0)
      ctx.stroke()

      // Inner bright membrane — distinct per organism
      ctx.globalAlpha = 0.55 + Math.min(groupSize * 0.025, 0.35)
      ctx.strokeStyle = hsla(hue, 90, 65, 1)
      ctx.lineWidth = 1.5 + Math.min(groupSize * 0.08, 1.5)
      // Per-organism dash pattern for extra distinction
      const dashLen = 3 + ((orgIdx * 2.3) % 5)
      const gapLen = 1 + ((orgIdx * 1.7) % 3)
      ctx.setLineDash([dashLen, gapLen])
      ctx.lineDashOffset = -t * 0.08 + orgIdx * 7
      ctx.stroke()
      ctx.setLineDash([])

      // Connective tissue between linked cells
      if (sim.links.length < 800 && groupSize < 30) {
        const idxSet = new Set(indices)
        for (let li = 0; li < sim.links.length; li++) {
          const L = sim.links[li]
          if (L.a >= sim.cells.length || L.b >= sim.cells.length) continue
          if (!idxSet.has(L.a) || !idxSet.has(L.b)) continue
          const cA = sim.cells[L.a],
            cB = sim.cells[L.b]
          if (!cA || !cB) continue
          const [ax, ay] = this.worldToScreen(cA.x, cA.y)
          const [bx, by] = this.worldToScreen(cB.x, cB.y)
          const dx = bx - ax,
            dy = by - ay
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > 60 || dist < 1) continue
          const mx = (ax + bx) / 2,
            my = (ay + by) / 2
          const angle = Math.atan2(dy, dx)
          // Pulsing tissue bridge
          const tissuePulse = 1.0 + 0.1 * Math.sin(t * 0.06 + li * 0.5)
          ctx.save()
          ctx.translate(mx, my)
          ctx.rotate(angle)
          ctx.globalAlpha = (0.1 + fillStr * 0.4) * tissuePulse
          ctx.fillStyle = hsla(hue, 35, 28, 1)
          ctx.beginPath()
          ctx.ellipse(0, 0, dist * 0.48, cellR * 1.3 * tissuePulse, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }
    }

    ctx.globalAlpha = 1
    ctx.restore()
  }
}
