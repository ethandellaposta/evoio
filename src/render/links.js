import { clamp, hsla, cladeHue } from './color.js'

const TAU = Math.PI * 2

export function installLinks(Renderer) {
  const P = Renderer.prototype

  P._drawLinks = function (sim) {
    const ctx = this.ctx
    const cells = sim.cells
    const t = this._frameTick

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    const stride = Math.max(1, this.linkStride)
    const halfW = sim.w / 2
    const halfH = sim.h / 2

    for (let i = 0; i < sim.links.length; i += stride) {
      const L = sim.links[i]
      if (L.a >= cells.length || L.b >= cells.length) continue
      const a = cells[L.a]
      const b = cells[L.b]
      if (!a || !b) continue
      if (a.clade !== b.clade) continue

      let bx2 = b.x,
        by2 = b.y
      let dx = b.x - a.x
      let dy = b.y - a.y
      if (dx > halfW) bx2 -= sim.w
      else if (dx < -halfW) bx2 += sim.w
      if (dy > halfH) by2 -= sim.h
      else if (dy < -halfH) by2 += sim.h

      const [ax, ay] = this.worldToScreen(a.x, a.y)
      const [bx, by] = this.worldToScreen(bx2, by2)

      const sdx = bx - ax,
        sdy = by - ay
      const maxLinkScreenDist = Math.min(2500, 900 * this.view.scale * this.view.scale)
      if (sdx * sdx + sdy * sdy > maxLinkScreenDist) continue

      const gamma = L.gamma || 0.5
      const alpha = clamp(0.06 + 0.25 * L.s * gamma, 0.03, 0.4)

      const linkHue = cladeHue(a.clade)

      // Animated pulse traveling along the link
      const phase = L.a * 3.17 + L.b * 7.31
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.08 + phase)
      const dotR = stride > 1 ? 0.8 : 1.0 + 0.7 * gamma * pulse

      // Endpoint dots with glow
      ctx.fillStyle = hsla(linkHue, 80, 70, alpha)
      ctx.beginPath()
      ctx.arc(ax, ay, dotR, 0, TAU)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(bx, by, dotR, 0, TAU)
      ctx.fill()

      // Traveling energy dot along the link
      if (stride <= 1 && gamma > 0.3) {
        const travelPos = (t * 0.03 + phase * 0.7) % 1.0
        const tx = ax + sdx * travelPos
        const ty = ay + sdy * travelPos
        const tAlpha = alpha * 0.6 * (0.5 + 0.5 * Math.sin(travelPos * TAU))
        ctx.fillStyle = hsla(linkHue, 90, 80, tAlpha)
        ctx.beginPath()
        ctx.arc(tx, ty, dotR * 0.7, 0, TAU)
        ctx.fill()
      }
    }
    ctx.restore()
  }
}
