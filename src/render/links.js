import { clamp, hsla, cladeHue } from './color.js'

const TAU = Math.PI * 2

export function installLinks(Renderer) {
  const P = Renderer.prototype

  P._drawLinks = function (sim) {
    const ctx = this.ctx
    const cells = sim.cells
    const t = this._frameTick

    ctx.save()
    ctx.globalCompositeOperation = 'source-over'

    const stride = Math.max(1, this.linkStride)
    const halfW = sim.w * 0.5
    const halfH = sim.h * 0.5

    // Inline worldToScreen constants to avoid array allocation per link
    const _vs = this.view.scale
    const _vcx = this.view.cx
    const _vcy = this.view.cy
    const _hw = this.canvas.width * 0.5
    const _hh = this.canvas.height * 0.5
    const _cw = this.canvas.width
    const _ch = this.canvas.height
    const maxLinkScreenDist = Math.min(2500, 900 * _vs * _vs)

    // Batch dots by building a single path, then fill once
    // Use a fixed dotR for batching (avoids per-link fill calls)
    const batchDotR = stride > 1 ? 0.8 : 1.2
    ctx.globalAlpha = 0.2
    ctx.fillStyle = 'rgba(180,200,230,0.5)'
    ctx.beginPath()

    let dotCount = 0
    const maxDots = 4000 // cap to prevent path explosion

    for (let i = 0; i < sim.links.length; i += stride) {
      const L = sim.links[i]
      if (L.a >= cells.length || L.b >= cells.length) continue
      const a = cells[L.a]
      const b = cells[L.b]
      if (!a || !b) continue
      if (a.clade !== b.clade) continue

      let bx2 = b.x,
        by2 = b.y
      const dx = b.x - a.x
      const dy = b.y - a.y
      if (dx > halfW) bx2 -= sim.w
      else if (dx < -halfW) bx2 += sim.w
      if (dy > halfH) by2 -= sim.h
      else if (dy < -halfH) by2 += sim.h

      // Inline worldToScreen
      const ax = (a.x - _vcx) * _vs + _hw
      const ay = (a.y - _vcy) * _vs + _hh
      const bx = (bx2 - _vcx) * _vs + _hw
      const by = (by2 - _vcy) * _vs + _hh

      // Cull off-screen links
      if (ax < -50 && bx < -50) continue
      if (ax > _cw + 50 && bx > _cw + 50) continue
      if (ay < -50 && by < -50) continue
      if (ay > _ch + 50 && by > _ch + 50) continue

      const sdx = bx - ax,
        sdy = by - ay
      if (sdx * sdx + sdy * sdy > maxLinkScreenDist) continue

      if (dotCount < maxDots) {
        // Add both endpoint dots to the batch path
        ctx.moveTo(ax + batchDotR, ay)
        ctx.arc(ax, ay, batchDotR, 0, TAU)
        ctx.moveTo(bx + batchDotR, by)
        ctx.arc(bx, by, batchDotR, 0, TAU)
        dotCount += 2
      }
    }
    ctx.fill()
    ctx.restore()
  }
}
