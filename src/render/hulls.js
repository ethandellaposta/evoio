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

    // Inline worldToScreen constants
    const _vs = this.view.scale
    const _vcx = this.view.cx
    const _vcy = this.view.cy
    const _hw = this.canvas.width * 0.5
    const _hh = this.canvas.height * 0.5
    const _cw = this.canvas.width
    const _ch = this.canvas.height

    const cellR = sim.cfg.cellRadius * _vs
    const pad = cellR * 2.8
    const baseSpan = sim.cfg.linkDist * sim.cfg.linkMax * 4
    const maxSpan = baseSpan * _vs
    const maxSpanSq = maxSpan * maxSpan

    // Reusable point buffer to avoid per-organism allocation
    const maxPts = 128
    if (!this._hullPtsBuf) {
      this._hullPtsBuf = new Array(maxPts)
      for (let i = 0; i < maxPts; i++) this._hullPtsBuf[i] = { x: 0, y: 0 }
    }
    const ptsBuf = this._hullPtsBuf

    for (const [, indices] of organisms) {
      if (indices.length < 2) continue

      const firstCell = sim.cells[indices[0]]
      if (!firstCell) continue
      const clade = firstCell.clade
      const orgIdHash = indices[0] * 137.508 + indices.length * 51.7
      const hueOffset = (orgIdHash % 40) - 20
      const hue = cladeHue(clade) + hueOffset

      let ptCount = 0
      let avgEnergy = 0
      const len = Math.min(indices.length, maxPts)
      for (let k = 0; k < len; k++) {
        const c = sim.cells[indices[k]]
        if (!c) continue
        ptsBuf[ptCount].x = (c.x - _vcx) * _vs + _hw
        ptsBuf[ptCount].y = (c.y - _vcy) * _vs + _hh
        avgEnergy += c.energy
        ptCount++
      }
      if (ptCount < 2) continue
      avgEnergy /= ptCount

      let tooWide = false
      for (let k = 1; k < ptCount; k++) {
        const dx = ptsBuf[k].x - ptsBuf[0].x
        const dy = ptsBuf[k].y - ptsBuf[0].y
        if (dx * dx + dy * dy > maxSpanSq) {
          tooWide = true
          break
        }
      }
      if (tooWide) continue

      let cx = 0,
        cy = 0
      for (let k = 0; k < ptCount; k++) {
        cx += ptsBuf[k].x
        cy += ptsBuf[k].y
      }
      cx /= ptCount
      cy /= ptCount

      if (cx < -100 || cx > _cw + 100 || cy < -100 || cy > _ch + 100) continue

      // Need to slice for convex hull since it sorts in place
      const pts = []
      for (let k = 0; k < ptCount; k++) pts.push({ x: ptsBuf[k].x, y: ptsBuf[k].y })
      const convex = _convexHull(pts)
      if (convex.length < 2) continue

      const breathe = 1.0 + 0.06 * Math.sin(t * 0.04 + clade * 1.7) + 0.03 * Math.sin(t * 0.09 + clade * 0.3)
      const energyPad = pad * (0.9 + Math.min(avgEnergy / 4, 0.4))
      const livePad = energyPad * breathe

      for (let i = 0; i < convex.length; i++) {
        const p = convex[i]
        const a = Math.atan2(p.y - cy, p.x - cx)
        const wobble = 1.0 + 0.08 * Math.sin(t * 0.05 + a * 3 + clade * 2.1 + i * 0.7)
        const d = livePad * wobble
        p.x += Math.cos(a) * d
        p.y += Math.sin(a) * d
      }

      ctx.globalCompositeOperation = 'source-over'
      const groupSize = indices.length

      this._smoothHullPath(ctx, convex)
      ctx.globalAlpha = 0.08 + Math.min(groupSize * 0.008, 0.1)
      ctx.strokeStyle = hsla(hue, 45, 55, 0.35)
      ctx.lineWidth = 1.5 + Math.min(groupSize * 0.15, 2.5)
      ctx.stroke()
    }

    ctx.globalAlpha = 1
    ctx.restore()
  }
}
