import { hsla } from './color.js'
import {
  ORGANELLE_NUCLEUS,
  ORGANELLE_MITOCHONDRIA,
  ORGANELLE_FLAGELLUM,
  ORGANELLE_RECEPTOR,
  ORGANELLE_VACUOLE
} from '../sim/index.js'

const TAU = Math.PI * 2

// Reusable point buffer for flagellum drawing
const _fPts = new Array(16)
for (let i = 0; i < 16; i++) _fPts[i] = [0, 0]

export function installMorphology(Renderer) {
  const P = Renderer.prototype

  P._drawMorphology = function (ctx, c, x, y, r, hue, sat, lum) {
    const t = this._frameTick

    // ── Flippers — organic fin-like wings that flap smoothly ──
    if (c.g.flipper > 0.05) {
      ctx.save()
      const fl = c.g.flipper
      const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
      const dirX = c.vx / vLen,
        dirY = c.vy / vLen
      const perpX = -dirY,
        perpY = dirX
      const fLen = r * (0.9 + fl * 2.0)
      const fWid = r * (0.25 + fl * 0.45)
      // Fluid flapping with layered waves
      const speed = Math.min(vLen * 20, 1)
      const flapFreq = 0.18 + speed * 0.12
      const flapAmp = 0.4 * fl * (0.5 + speed * 0.5)
      const flap = Math.sin(t * flapFreq + c.id) * flapAmp
      // Secondary undulation — slower, gives organic flex
      const flex = Math.sin(t * flapFreq * 0.6 + c.id * 2.3 + 1.2) * 0.15 * fl

      for (const side of [-1, 1]) {
        const baseX = x + perpX * r * 0.65 * side
        const baseY = y + perpY * r * 0.65 * side
        // Tip sweeps back and flaps with secondary flex
        const flapOff = flap * side
        const flexOff = flex * side
        const tipX = baseX + (perpX * side * fLen * 0.55 + dirX * fLen * 0.35) * (1 + flapOff)
        const tipY = baseY + (perpY * side * fLen * 0.55 + dirY * fLen * 0.35) * (1 + flapOff)
        // Mid control points bend with flex for organic wiggle
        const mid1X = (baseX + tipX) / 2 + dirX * fWid * 0.6 + perpX * side * fWid * (0.2 + flexOff)
        const mid1Y = (baseY + tipY) / 2 + dirY * fWid * 0.6 + perpY * side * fWid * (0.2 + flexOff)
        const mid2X = (baseX + tipX) / 2 - dirX * fWid * 0.4 - perpX * side * fWid * (0.15 - flexOff * 0.5)
        const mid2Y = (baseY + tipY) / 2 - dirY * fWid * 0.4 - perpY * side * fWid * (0.15 - flexOff * 0.5)

        ctx.globalAlpha = 0.4 + fl * 0.4
        ctx.fillStyle = hsla(hue, sat - 10, lum + 8, 0.55)
        ctx.beginPath()
        ctx.moveTo(baseX - perpX * side * fWid * 0.2, baseY - perpY * side * fWid * 0.2)
        ctx.bezierCurveTo(mid1X, mid1Y, mid1X, mid1Y, tipX, tipY)
        ctx.bezierCurveTo(
          mid2X,
          mid2Y,
          mid2X,
          mid2Y,
          baseX + perpX * side * fWid * 0.2,
          baseY + perpY * side * fWid * 0.2
        )
        ctx.closePath()
        ctx.fill()

        // Fin vein lines — smooth curves
        ctx.globalAlpha = 0.25 + fl * 0.2
        ctx.strokeStyle = hsla(hue, sat * 0.6, lum * 0.7, 0.5)
        ctx.lineWidth = 0.4 + fl * 0.3
        for (let v = 0; v < 3; v++) {
          const vf = (v + 1) / 4
          const vx1 = baseX + (tipX - baseX) * vf * 0.3
          const vy1 = baseY + (tipY - baseY) * vf * 0.3
          const vx2 = baseX + (tipX - baseX) * (vf * 0.7 + 0.3)
          const vy2 = baseY + (tipY - baseY) * (vf * 0.7 + 0.3)
          const veinBow = Math.sin(t * 0.05 + v * 1.8 + c.id) * fWid * 0.15
          const vcx = (vx1 + vx2) / 2 + perpX * side * veinBow
          const vcy = (vy1 + vy2) / 2 + perpY * side * veinBow
          ctx.beginPath()
          ctx.moveTo(vx1, vy1)
          ctx.quadraticCurveTo(vcx, vcy, vx2, vy2)
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // ── Cilia — flowing hair-like fringe with fluid metachronal waves ──
    if (c.g.cilia > 0.15) {
      const cl = c.g.cilia
      const count = Math.min(20, Math.floor(10 + cl * 20))
      const ciliaLen = r * (0.3 + cl * 0.6)
      const speed = Math.sqrt(c.vx * c.vx + c.vy * c.vy)
      const beatSpeed = 0.28 + Math.min(speed * 8, 0.15)
      ctx.save()
      ctx.lineCap = 'round'
      ctx.strokeStyle = hsla(hue, sat - 10, lum + 22, 0.6)
      ctx.lineWidth = 0.3 + cl * 0.3
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU
        // Metachronal wave — smooth traveling wave around the body
        const phase = t * beatSpeed + a * 3.5 + c.id * 0.5
        const beat = Math.sin(phase)
        // Secondary shimmer for organic feel
        const shimmer = Math.sin(phase * 2.3 + i * 0.7) * 0.25
        const beatAmp = ciliaLen * 0.45 * cl
        const bx = x + Math.cos(a) * (r + 0.3)
        const by = y + Math.sin(a) * (r + 0.3)
        // Tip curves with beat + shimmer
        const tipAngle = a + (beat + shimmer) * 0.35
        const tipLen = ciliaLen * (0.75 + 0.25 * Math.sin(phase * 0.6))
        const ex = bx + Math.cos(tipAngle) * tipLen
        const ey = by + Math.sin(tipAngle) * tipLen
        // Control point — S-curve with beat
        const cx2 =
          bx + Math.cos(a) * tipLen * 0.5 + Math.cos(a + Math.PI / 2) * beatAmp * (beat + shimmer * 0.5)
        const cy2 =
          by + Math.sin(a) * tipLen * 0.5 + Math.sin(a + Math.PI / 2) * beatAmp * (beat + shimmer * 0.5)

        ctx.globalAlpha = 0.25 + cl * 0.35 + Math.abs(beat) * 0.1
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.quadraticCurveTo(cx2, cy2, ex, ey)
        ctx.stroke()
      }
      ctx.restore()
    }

    // ── Organelle flagellum — rope-like whip tail that wiggles fluidly ──
    const flagLevel = c.organelles[ORGANELLE_FLAGELLUM]
    if (flagLevel > 0.1) {
      ctx.save()
      const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
      const tailDx = -c.vx / vLen,
        tailDy = -c.vy / vLen
      const perpX = -tailDy,
        perpY = tailDx
      const tailLen = r * (2.0 + flagLevel * 3.5)
      const speed = Math.min(vLen * 15, 1)
      // Wave travels from base to tip like a cracking whip
      const waveSpeed = 0.35 + speed * 0.15
      // Precompute point positions along the tentacle
      const N = 10
      for (let s = 0; s < N; s++) {
        const frac = s / (N - 1)
        // Amplitude ramps up cubically toward tip — whip physics
        const amp = frac * frac * r * 0.9 * flagLevel
        // Primary wave — fast traveling wave
        const w1 = Math.sin(t * waveSpeed - frac * Math.PI * 3.0 + c.id * 0.3) * amp
        // Secondary wave — slower, wider, gives rope-like sway
        const w2 = Math.sin(t * waveSpeed * 0.4 - frac * Math.PI * 1.2 + c.id * 1.7) * amp * 0.5
        // Tertiary flick — fast small vibration at the tip
        const w3 = Math.sin(t * waveSpeed * 2.5 + frac * Math.PI * 8.0 + c.id * 0.9) * amp * frac * 0.25
        const wave = w1 + w2 + w3
        _fPts[s][0] = x + tailDx * (r * 0.7 + tailLen * frac) + perpX * wave
        _fPts[s][1] = y + tailDy * (r * 0.7 + tailLen * frac) + perpY * wave
      }
      // Draw smooth bezier curve through all points
      ctx.globalAlpha = 0.4 + flagLevel * 0.45
      ctx.strokeStyle = hsla(160, 65, 55, 0.7)
      ctx.lineWidth = 1.0 + flagLevel * 1.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(_fPts[0][0], _fPts[0][1])
      // Catmull-Rom-like smooth curve using quadratic bezier through midpoints
      for (let s = 0; s < N - 1; s++) {
        const mx = (_fPts[s][0] + _fPts[s + 1][0]) * 0.5
        const my = (_fPts[s][1] + _fPts[s + 1][1]) * 0.5
        ctx.quadraticCurveTo(_fPts[s][0], _fPts[s][1], mx, my)
      }
      // Final segment to last point
      ctx.lineTo(_fPts[N - 1][0], _fPts[N - 1][1])
      ctx.stroke()
      ctx.restore()
    }
  }

  // ── Paddle fins — broad translucent paddles that row back and forth ──
  P._drawPaddleFins = function (ctx, c, x, y, r, hue, sat, lum) {
    const pf = c.g.paddleFin || 0
    if (pf < 0.05 || r < 4) return
    const t = this._frameTick
    ctx.save()

    const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
    const dirX = c.vx / vLen,
      dirY = c.vy / vLen
    const perpX = -dirY,
      perpY = dirX

    const padLen = r * (1.2 + pf * 2.5)
    const padWid = r * (0.4 + pf * 0.8)
    const speed = Math.min(vLen * 15, 1)
    // Fluid rowing — faster frequency, layered wave for organic feel
    const rowFreq = 0.14 + speed * 0.1
    const rowPhase = t * rowFreq + c.id * 1.3
    const rowAngle = Math.sin(rowPhase) * 0.65 * (0.4 + speed * 0.6)
    // Secondary flex wave — makes the paddle blade ripple
    const bladeFlex = Math.sin(rowPhase * 1.4 + 0.8) * 0.2 * pf

    for (const side of [-1, 1]) {
      const baseX = x + perpX * r * 0.5 * side - dirX * r * 0.2
      const baseY = y + perpY * r * 0.5 * side - dirY * r * 0.2
      // Paddle sweeps backward with rowing motion
      const sweep = rowAngle * side
      const padDirX = perpX * side * 0.6 + dirX * (-0.4 + sweep * 0.5)
      const padDirY = perpY * side * 0.6 + dirY * (-0.4 + sweep * 0.5)
      const pLen = Math.sqrt(padDirX * padDirX + padDirY * padDirY) || 1
      const ndx = padDirX / pLen,
        ndy = padDirY / pLen
      const tipX = baseX + ndx * padLen
      const tipY = baseY + ndy * padLen
      // Perpendicular to paddle direction for width
      const pwx = -ndy,
        pwy = ndx

      // Paddle blade — broad oval with flex ripple
      ctx.globalAlpha = 0.35 + pf * 0.4
      ctx.fillStyle = hsla(hue, sat - 10, lum + 8, 0.5)
      ctx.beginPath()
      ctx.moveTo(baseX, baseY)
      const bfx = bladeFlex * side
      const mid1X = baseX + ndx * padLen * 0.35 + pwx * padWid * (0.5 + bfx)
      const mid1Y = baseY + ndy * padLen * 0.35 + pwy * padWid * (0.5 + bfx)
      const mid2X = baseX + ndx * padLen * 0.65 + pwx * padWid * (0.35 + bfx * 0.7)
      const mid2Y = baseY + ndy * padLen * 0.65 + pwy * padWid * (0.35 + bfx * 0.7)
      ctx.bezierCurveTo(mid1X, mid1Y, mid2X, mid2Y, tipX, tipY)
      const mid3X = baseX + ndx * padLen * 0.65 - pwx * padWid * (0.35 - bfx * 0.7)
      const mid3Y = baseY + ndy * padLen * 0.65 - pwy * padWid * (0.35 - bfx * 0.7)
      const mid4X = baseX + ndx * padLen * 0.35 - pwx * padWid * (0.5 - bfx)
      const mid4Y = baseY + ndy * padLen * 0.35 - pwy * padWid * (0.5 - bfx)
      ctx.bezierCurveTo(mid3X, mid3Y, mid4X, mid4Y, baseX, baseY)
      ctx.closePath()
      ctx.fill()

      // Paddle ridge line — curves with flex
      ctx.globalAlpha = 0.25 + pf * 0.25
      ctx.strokeStyle = hsla(hue, sat * 0.6, lum + 15, 0.6)
      ctx.lineWidth = 0.5 + pf * 0.5
      ctx.beginPath()
      ctx.moveTo(baseX, baseY)
      const ridgeMidX = (baseX + tipX) / 2 + pwx * padWid * bfx * 0.5
      const ridgeMidY = (baseY + tipY) / 2 + pwy * padWid * bfx * 0.5
      ctx.quadraticCurveTo(ridgeMidX, ridgeMidY, tipX, tipY)
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── Proboscis — feeding siphon tube extending forward ──
  P._drawProboscis = function (ctx, c, x, y, r, hue, sat, lum) {
    const prob = c.g.proboscis || 0
    if (prob < 0.1 || r < 4) return
    const t = this._frameTick
    ctx.save()

    const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
    const dirX = c.vx / vLen,
      dirY = c.vy / vLen

    const tubeLen = r * (1.0 + prob * 3.5)
    const tubeWid = r * (0.12 + prob * 0.15)
    // Fluid searching wave — multi-frequency for organic wiggle
    const w1 = Math.sin(t * 0.12 + c.id * 2.1) * 0.18 * prob
    const w2 = Math.sin(t * 0.19 + c.id * 0.7 + 1.5) * 0.08 * prob
    const wave = w1 + w2
    const tipDx = dirX + -dirY * wave
    const tipDy = dirY + dirX * wave
    const tLen = Math.sqrt(tipDx * tipDx + tipDy * tipDy) || 1
    const ndx = tipDx / tLen,
      ndy = tipDy / tLen

    const baseX = x + dirX * r * 0.85
    const baseY = y + dirY * r * 0.85
    const tipX = baseX + ndx * tubeLen
    const tipY = baseY + ndy * tubeLen
    const perpX = -ndy,
      perpY = ndx

    // Tube body — tapered cylinder
    ctx.globalAlpha = 0.35 + prob * 0.3
    ctx.fillStyle = hsla(hue, sat - 8, lum + 3, 0.5)
    ctx.beginPath()
    ctx.moveTo(baseX + perpX * tubeWid, baseY + perpY * tubeWid)
    // Slight taper toward tip
    const tipWid = tubeWid * 0.6
    const midX = (baseX + tipX) / 2 + perpX * tubeWid * 0.15 * Math.sin(t * 0.05 + c.id)
    const midY = (baseY + tipY) / 2 + perpY * tubeWid * 0.15 * Math.sin(t * 0.05 + c.id)
    ctx.quadraticCurveTo(
      midX + perpX * tubeWid * 1.1,
      midY + perpY * tubeWid * 1.1,
      tipX + perpX * tipWid,
      tipY + perpY * tipWid
    )
    // Rounded tip
    ctx.arc(tipX, tipY, tipWid, Math.atan2(perpY, perpX), Math.atan2(-perpY, -perpX))
    ctx.quadraticCurveTo(
      midX - perpX * tubeWid * 1.1,
      midY - perpY * tubeWid * 1.1,
      baseX - perpX * tubeWid,
      baseY - perpY * tubeWid
    )
    ctx.closePath()
    ctx.fill()

    // Tube highlight — smooth curve
    ctx.globalAlpha = 0.12 + prob * 0.1
    ctx.strokeStyle = hsla(hue, sat * 0.5, lum + 20, 0.5)
    ctx.lineWidth = 0.3
    const hlMx = (baseX + tipX) / 2 + perpX * tubeWid * 0.3 * Math.sin(t * 0.06 + c.id)
    const hlMy = (baseY + tipY) / 2 + perpY * tubeWid * 0.3 * Math.sin(t * 0.06 + c.id)
    ctx.beginPath()
    ctx.moveTo(baseX + perpX * tubeWid * 0.5, baseY + perpY * tubeWid * 0.5)
    ctx.quadraticCurveTo(hlMx, hlMy, tipX + perpX * tipWid * 0.5, tipY + perpY * tipWid * 0.5)
    ctx.stroke()

    // Suction opening at tip — darker ring
    ctx.globalAlpha = 0.3 + prob * 0.3
    ctx.strokeStyle = hsla((hue + 20) % 360, sat, lum - 10, 0.7)
    ctx.lineWidth = 0.5 + prob * 0.5
    ctx.beginPath()
    ctx.arc(tipX, tipY, tipWid * 1.2, 0, TAU)
    ctx.stroke()

    // Feeding particles being sucked in (when eating)
    if (c.eatFlash > 0) {
      ctx.globalCompositeOperation = 'lighter'
      for (let fi = 0; fi < 3; fi++) {
        const frac = (t * 0.1 + fi * 0.33 + c.id) % 1.0
        const fx = tipX + ndx * tubeLen * 0.3 * (1 - frac)
        const fy = tipY + ndy * tubeLen * 0.3 * (1 - frac)
        ctx.globalAlpha = 0.3 * frac * (c.eatFlash / 25)
        ctx.fillStyle = hsla(120, 60, 70, 0.7)
        ctx.beginPath()
        ctx.arc(fx, fy, 0.5 + frac * 0.8, 0, TAU)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    ctx.restore()
  }

  // ── Spines — sharp triangular spikes radiating outward (sea urchin / radiolarian) ──
  P._drawSpines = function (ctx, c, x, y, r, hue, sat, lum) {
    const sp = c.g.spines || 0
    if (sp < 0.1 || r < 4) return
    const t = this._frameTick
    ctx.save()

    const count = Math.floor(5 + sp * 12)
    const spineLen = r * (0.4 + sp * 1.2)
    const spineWid = r * (0.06 + sp * 0.08)

    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + c.id * 0.4
      // Animated sway
      const sway = Math.sin(t * 0.08 + i * 2.3 + c.id) * 0.06 * sp
      const angle = a + sway
      const bx = x + Math.cos(angle) * r * 0.92
      const by = y + Math.sin(angle) * r * 0.92
      const tipX = x + Math.cos(angle) * (r + spineLen)
      const tipY = y + Math.sin(angle) * (r + spineLen)
      const perpX = -Math.sin(angle)
      const perpY = Math.cos(angle)
      // Curve offset for organic bend
      const curveAmt = Math.sin(t * 0.06 + i * 1.7 + c.id * 0.5) * spineLen * 0.1

      // Smooth curved spine
      ctx.globalAlpha = 0.4 + sp * 0.35
      ctx.fillStyle = hsla(hue, sat - 5, lum - 8, 0.7)
      const ctrl1x = (bx + tipX) / 2 + perpX * (spineWid * 0.3 + curveAmt)
      const ctrl1y = (by + tipY) / 2 + perpY * (spineWid * 0.3 + curveAmt)
      const ctrl2x = (bx + tipX) / 2 - perpX * (spineWid * 0.3 - curveAmt)
      const ctrl2y = (by + tipY) / 2 - perpY * (spineWid * 0.3 - curveAmt)
      ctx.beginPath()
      ctx.moveTo(bx + perpX * spineWid, by + perpY * spineWid)
      ctx.quadraticCurveTo(ctrl1x, ctrl1y, tipX, tipY)
      ctx.quadraticCurveTo(ctrl2x, ctrl2y, bx - perpX * spineWid, by - perpY * spineWid)
      ctx.closePath()
      ctx.fill()

      // Spine highlight — curved
      ctx.globalAlpha = 0.2 + sp * 0.15
      ctx.strokeStyle = hsla(hue, sat * 0.6, lum + 20, 0.5)
      ctx.lineWidth = 0.3
      ctx.beginPath()
      ctx.moveTo(bx + perpX * spineWid * 0.5, by + perpY * spineWid * 0.5)
      ctx.quadraticCurveTo(ctrl1x, ctrl1y, tipX, tipY)
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── Spike — thick horn/tusk pointing forward (narwhal / rhino beetle) ──
  P._drawSpike = function (ctx, c, x, y, r, hue, sat, lum) {
    const sk = c.g.spike || 0
    if (sk < 0.1 || r < 4) return
    const t = this._frameTick
    ctx.save()

    const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
    const dirX = c.vx / vLen,
      dirY = c.vy / vLen
    const perpX = -dirY,
      perpY = dirX

    const hornLen = r * (0.8 + sk * 2.5)
    const hornWid = r * (0.15 + sk * 0.2)
    const baseX = x + dirX * r * 0.8
    const baseY = y + dirY * r * 0.8
    const tipX = baseX + dirX * hornLen
    const tipY = baseY + dirY * hornLen

    // Thick curved horn
    ctx.globalAlpha = 0.5 + sk * 0.3
    ctx.fillStyle = hsla((hue + 30) % 360, sat * 0.5, lum - 15, 0.8)
    ctx.beginPath()
    ctx.moveTo(baseX + perpX * hornWid, baseY + perpY * hornWid)
    // Slight curve
    const curveOff = Math.sin(t * 0.03 + c.id) * hornLen * 0.05
    const midX = (baseX + tipX) / 2 + perpX * curveOff
    const midY = (baseY + tipY) / 2 + perpY * curveOff
    ctx.quadraticCurveTo(midX + perpX * hornWid * 0.7, midY + perpY * hornWid * 0.7, tipX, tipY)
    ctx.quadraticCurveTo(
      midX - perpX * hornWid * 0.7,
      midY - perpY * hornWid * 0.7,
      baseX - perpX * hornWid,
      baseY - perpY * hornWid
    )
    ctx.closePath()
    ctx.fill()

    // Horn ridge / bone texture — curved arcs
    ctx.globalAlpha = 0.2 + sk * 0.15
    ctx.strokeStyle = hsla((hue + 30) % 360, sat * 0.3, lum + 10, 0.5)
    ctx.lineWidth = 0.4
    const ridges = 3 + Math.floor(sk * 4)
    for (let ri = 0; ri < ridges; ri++) {
      const frac = (ri + 1) / (ridges + 1)
      const rx = baseX + (tipX - baseX) * frac
      const ry = baseY + (tipY - baseY) * frac
      const rw = hornWid * (1 - frac * 0.7)
      // Curved ridge with slight bow
      const bowAmt = rw * 0.3 * Math.sin(t * 0.04 + ri * 1.5 + c.id)
      const rcx = rx + dirX * bowAmt
      const rcy = ry + dirY * bowAmt
      ctx.beginPath()
      ctx.moveTo(rx + perpX * rw, ry + perpY * rw)
      ctx.quadraticCurveTo(rcx, rcy, rx - perpX * rw, ry - perpY * rw)
      ctx.stroke()
    }

    // Tip glint
    ctx.globalAlpha = 0.3 + sk * 0.2
    ctx.fillStyle = hsla(hue, sat * 0.3, lum + 30, 0.6)
    ctx.beginPath()
    ctx.arc(tipX, tipY, hornWid * 0.3, 0, TAU)
    ctx.fill()

    ctx.restore()
  }

  // ── Amoeboid pseudopods — blobby irregular extensions that slowly shift ──
  P._drawPseudopods = function (ctx, c, x, y, r, hue, sat, lum) {
    const am = c.g.amoeboid || 0
    if (am < 0.15 || r < 5) return
    const t = this._frameTick
    ctx.save()

    const podCount = 2 + Math.floor(am * 4)
    const podLen = r * (0.5 + am * 1.0)
    const podWid = r * (0.2 + am * 0.25)

    for (let i = 0; i < podCount; i++) {
      // Pseudopods slowly rotate and extend/retract
      const baseAngle = (i / podCount) * TAU + c.id * 0.6
      const drift = Math.sin(t * 0.015 + i * 2.7 + c.id * 1.3) * 0.4
      const extend = 0.5 + 0.5 * Math.sin(t * 0.02 + i * 3.1 + c.id * 0.8)
      const angle = baseAngle + drift

      const bx = x + Math.cos(angle) * r * 0.7
      const by = y + Math.sin(angle) * r * 0.7
      const curLen = podLen * (0.4 + extend * 0.6)
      const tipX = bx + Math.cos(angle) * curLen
      const tipY = by + Math.sin(angle) * curLen
      const perpX = -Math.sin(angle)
      const perpY = Math.cos(angle)

      // Blobby pseudopod — wide base, bulbous tip
      const bulge = 1.0 + 0.3 * Math.sin(t * 0.03 + i * 1.9)
      ctx.globalAlpha = 0.25 + am * 0.2
      ctx.fillStyle = hsla(hue, sat * 0.7, lum + 5, 0.4)
      ctx.beginPath()
      ctx.moveTo(bx + perpX * podWid * 0.8, by + perpY * podWid * 0.8)
      // Bulging middle
      const mx = (bx + tipX) / 2
      const my = (by + tipY) / 2
      ctx.quadraticCurveTo(
        mx + perpX * podWid * bulge,
        my + perpY * podWid * bulge,
        tipX + perpX * podWid * 0.5,
        tipY + perpY * podWid * 0.5
      )
      // Rounded tip
      ctx.arc(tipX, tipY, podWid * 0.5, Math.atan2(perpY, perpX), Math.atan2(-perpY, -perpX))
      ctx.quadraticCurveTo(
        mx - perpX * podWid * bulge,
        my - perpY * podWid * bulge,
        bx - perpX * podWid * 0.8,
        by - perpY * podWid * 0.8
      )
      ctx.closePath()
      ctx.fill()

      // Internal flow lines
      ctx.globalAlpha = 0.1 + am * 0.08
      ctx.strokeStyle = hsla(hue, sat * 0.4, lum + 15, 0.4)
      ctx.lineWidth = 0.4
      const flowPhase = t * 0.04 + i * 2.0
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.quadraticCurveTo(
        mx + perpX * podWid * 0.3 * Math.sin(flowPhase),
        my + perpY * podWid * 0.3 * Math.sin(flowPhase),
        tipX,
        tipY
      )
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── Constrict bands — segmented ring patterns (worm / snake / annelid) ──
  P._drawConstrictions = function (ctx, c, x, y, r, hue, sat, lum) {
    const cn = c.g.constrict || 0
    if (cn < 0.1 || r < 6) return
    const t = this._frameTick
    ctx.save()

    const bandCount = 3 + Math.floor(cn * 6)
    // Bands are concentric rings inside the cell at different radii
    ctx.globalAlpha = 0.15 + cn * 0.2
    ctx.strokeStyle = hsla(hue, sat * 0.5, lum - 12, 0.5)

    for (let i = 0; i < bandCount; i++) {
      const frac = (i + 1) / (bandCount + 1)
      const bandR = r * frac
      // Slight pulsing — peristaltic wave
      const pulse = 1.0 + 0.06 * Math.sin(t * 0.08 + i * 1.5 + c.id)
      const bw = 0.4 + cn * 0.6
      ctx.lineWidth = bw * (0.7 + frac * 0.6)
      ctx.beginPath()
      ctx.arc(x, y, bandR * pulse, 0, TAU)
      ctx.stroke()
    }

    // Segment dividers — radial lines between bands
    if (cn > 0.3) {
      ctx.globalAlpha = 0.08 + cn * 0.08
      ctx.lineWidth = 0.3
      const divCount = Math.floor(4 + cn * 6)
      for (let d = 0; d < divCount; d++) {
        const da = (d / divCount) * TAU + c.id * 0.5
        ctx.beginPath()
        ctx.moveTo(x + Math.cos(da) * r * 0.2, y + Math.sin(da) * r * 0.2)
        ctx.lineTo(x + Math.cos(da) * r * 0.95, y + Math.sin(da) * r * 0.95)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  // ── Membrane armor — thick layered shell plates (diatom / armadillo) ──
  P._drawArmorPlates = function (ctx, c, x, y, r, hue, sat, lum) {
    const mem = c.g.membrane || 0
    if (mem < 0.25 || r < 7) return
    const t = this._frameTick
    ctx.save()

    const plateCount = 4 + Math.floor(mem * 6)
    const plateThick = r * (0.08 + mem * 0.12)

    for (let i = 0; i < plateCount; i++) {
      const a1 = (i / plateCount) * TAU + c.id * 0.3
      const a2 = ((i + 0.85) / plateCount) * TAU + c.id * 0.3
      const outerR = r * (1.02 + mem * 0.08)
      const innerR = outerR - plateThick

      // Plate — arc segment
      ctx.globalAlpha = 0.2 + mem * 0.25
      ctx.fillStyle = hsla(hue, sat * 0.4, lum - 10, 0.5)
      ctx.beginPath()
      ctx.arc(x, y, outerR, a1, a2)
      ctx.arc(x, y, innerR, a2, a1, true)
      ctx.closePath()
      ctx.fill()

      // Plate edge highlight
      ctx.globalAlpha = 0.15 + mem * 0.12
      ctx.strokeStyle = hsla(hue, sat * 0.3, lum + 15, 0.4)
      ctx.lineWidth = 0.3
      ctx.beginPath()
      ctx.arc(x, y, outerR, a1, a2)
      ctx.stroke()
    }

    // Rivets / attachment points between plates
    if (mem > 0.4) {
      ctx.globalAlpha = 0.2 + mem * 0.15
      ctx.fillStyle = hsla(hue, sat * 0.3, lum + 5, 0.6)
      for (let i = 0; i < plateCount; i++) {
        const a = ((i + 0.425) / plateCount) * TAU + c.id * 0.3
        const rx = x + Math.cos(a) * (r * 1.0 + plateThick * 0.3)
        const ry = y + Math.sin(a) * (r * 1.0 + plateThick * 0.3)
        ctx.beginPath()
        ctx.arc(rx, ry, 0.5 + mem * 0.4, 0, TAU)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  // ── Toxin droplets — visible poison secretion on surface ──
  P._drawToxinDroplets = function (ctx, c, x, y, r, hue, sat, lum) {
    const tx = c.g.toxin || 0
    if (tx < 0.2 || r < 6) return
    const t = this._frameTick
    ctx.save()

    const dropCount = 3 + Math.floor(tx * 5)
    for (let i = 0; i < dropCount; i++) {
      const a = (i / dropCount) * TAU + c.id * 0.9 + t * 0.003
      const drift = r * (1.05 + 0.15 * Math.sin(t * 0.04 + i * 2.5 + c.id))
      const dx = x + Math.cos(a) * drift
      const dy = y + Math.sin(a) * drift
      const dr = (0.6 + tx * 1.0) * (0.7 + 0.3 * Math.sin(t * 0.06 + i * 3.1))

      // Toxic droplet — sickly green
      ctx.globalAlpha = 0.3 + tx * 0.25
      ctx.fillStyle = hsla(90, 75, 40, 0.6)
      ctx.beginPath()
      ctx.arc(dx, dy, dr, 0, TAU)
      ctx.fill()

      // Drip trail
      if (tx > 0.3) {
        const dripLen = dr * 2 * tx
        ctx.globalAlpha = 0.15 + tx * 0.1
        ctx.fillStyle = hsla(85, 65, 35, 0.4)
        ctx.beginPath()
        ctx.ellipse(dx, dy + dripLen * 0.5, dr * 0.4, dripLen * 0.5, 0, 0, TAU)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  // ── Shell — hard geometric carapace plates with iridescent sheen ──
  P._drawShell = function (ctx, c, x, y, r, hue, sat, lum) {
    const sh = c.g.shell || 0
    if (sh < 0.1 || r < 5) return
    const t = this._frameTick
    ctx.save()

    const plateCount = 5 + Math.floor(sh * 4)
    const shellR = r * (1.04 + sh * 0.12)
    const plateThick = r * (0.1 + sh * 0.18)
    const outerR = shellR
    const innerR = shellR - plateThick

    for (let i = 0; i < plateCount; i++) {
      const a1 = (i / plateCount) * TAU + c.id * 0.2
      const a2 = ((i + 0.88) / plateCount) * TAU + c.id * 0.2

      // Plate body — thick arc with slight iridescence
      const iridHue = (hue + i * 18 + Math.sin(t * 0.01 + i) * 8) % 360
      ctx.globalAlpha = 0.35 + sh * 0.35
      ctx.fillStyle = hsla(iridHue, sat * 0.5, lum - 5, 0.6)
      ctx.beginPath()
      ctx.arc(x, y, outerR, a1, a2)
      ctx.arc(x, y, innerR, a2, a1, true)
      ctx.closePath()
      ctx.fill()

      // Bright edge highlight — iridescent sheen
      ctx.globalAlpha = 0.2 + sh * 0.25
      ctx.strokeStyle = hsla(iridHue, sat * 0.7, lum + 20, 0.5)
      ctx.lineWidth = 0.4 + sh * 0.4
      ctx.beginPath()
      ctx.arc(x, y, outerR, a1, a2)
      ctx.stroke()
    }

    // Central ridge lines — growth rings
    if (sh > 0.3) {
      ctx.globalAlpha = 0.1 + sh * 0.1
      ctx.strokeStyle = hsla(hue, sat * 0.3, lum + 10, 0.4)
      ctx.lineWidth = 0.3
      const ringCount = 2 + Math.floor(sh * 3)
      for (let ri = 0; ri < ringCount; ri++) {
        const ringR = innerR + (outerR - innerR) * ((ri + 1) / (ringCount + 1))
        ctx.beginPath()
        ctx.arc(x, y, ringR, 0, TAU)
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  // ── Symbiosis — glowing halo ring with energy thread connections ──
  P._drawSymbiosisAura = function (ctx, c, x, y, r, hue, sat, lum) {
    const sym = c.g.symbiosis || 0
    if (sym < 0.15 || r < 5) return
    const t = this._frameTick
    ctx.save()

    // Pulsing halo ring
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.04 + c.id * 1.7)
    const haloR = r * (1.4 + sym * 1.2) * (0.95 + pulse * 0.1)
    ctx.globalAlpha = (0.06 + sym * 0.1) * (0.7 + pulse * 0.3)
    ctx.strokeStyle = hsla((hue + 40) % 360, sat + 10, lum + 20, 0.4)
    ctx.lineWidth = 0.6 + sym * 1.2
    ctx.setLineDash([2 + sym * 3, 2 + sym * 2])
    ctx.lineDashOffset = -t * 0.15 + (c.id || 0) * 3.1
    ctx.beginPath()
    ctx.arc(x, y, haloR, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])

    // Inner warm glow
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = sym * 0.06 * (0.6 + pulse * 0.4)
    ctx.fillStyle = hsla(40, 60, 65, 0.3)
    ctx.beginPath()
    ctx.arc(x, y, haloR * 0.8, 0, TAU)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'

    // Small orbiting energy motes
    const moteCount = 2 + Math.floor(sym * 3)
    ctx.globalAlpha = 0.3 + sym * 0.3
    ctx.fillStyle = hsla((hue + 40) % 360, 70, 75, 0.7)
    for (let mi = 0; mi < moteCount; mi++) {
      const ma = (mi / moteCount) * TAU + t * 0.02 + c.id * 0.9
      const md = r * (1.1 + sym * 0.5)
      const mx = x + Math.cos(ma) * md
      const my = y + Math.sin(ma) * md
      ctx.beginPath()
      ctx.arc(mx, my, 0.5 + sym * 0.5, 0, TAU)
      ctx.fill()
    }

    ctx.restore()
  }

  // ── Eyespot — dark pigment spot (stigma) with lens highlight ──
  P._drawEyespot = function (ctx, c, x, y, r, hue, sat, lum) {
    const eye = c.g.eyespot || 0
    if (eye < 0.1 || r < 4) return
    const t = this._frameTick
    ctx.save()

    const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
    const dirX = c.vx / vLen
    const dirY = c.vy / vLen

    // Position eyespot at front of cell
    const eyeX = x + dirX * r * 0.55
    const eyeY = y + dirY * r * 0.55
    const eyeR = r * (0.12 + eye * 0.14)

    // Dark pigment cup (stigma)
    ctx.globalAlpha = 0.6 + eye * 0.3
    ctx.fillStyle = hsla(10, 30, 15, 0.9)
    ctx.beginPath()
    ctx.arc(eyeX, eyeY, eyeR * 1.3, 0, TAU)
    ctx.fill()

    // Photoreceptor — bright colored iris
    ctx.globalAlpha = 0.7 + eye * 0.25
    ctx.fillStyle = hsla((hue + 180) % 360, 80, 55, 0.9)
    ctx.beginPath()
    ctx.arc(eyeX, eyeY, eyeR, 0, TAU)
    ctx.fill()

    // Dark pupil
    ctx.globalAlpha = 0.8
    ctx.fillStyle = 'rgba(5,5,15,0.9)'
    ctx.beginPath()
    ctx.arc(eyeX, eyeY, eyeR * 0.45, 0, TAU)
    ctx.fill()

    // Lens highlight — bright specular dot
    const hlOff = eyeR * 0.25
    ctx.globalAlpha = 0.6 + eye * 0.3
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.arc(eyeX - hlOff, eyeY - hlOff, eyeR * 0.22, 0, TAU)
    ctx.fill()

    // Sense range indicator — faint arc in front
    if (eye > 0.3 && r > 8) {
      const senseArcR = r * (1.5 + eye * 2.0)
      const faceAngle = Math.atan2(dirY, dirX)
      ctx.globalAlpha = 0.03 + eye * 0.03
      ctx.strokeStyle = hsla((hue + 180) % 360, 40, 70, 0.2)
      ctx.lineWidth = 0.4
      ctx.beginPath()
      ctx.arc(x, y, senseArcR, faceAngle - 0.4, faceAngle + 0.4)
      ctx.stroke()
    }

    ctx.restore()
  }

  // ── Stalk — rigid peduncle extending downward (sessile anchor) ──
  P._drawStalk = function (ctx, c, x, y, r, hue, sat, lum) {
    const sk = c.g.stalk || 0
    if (sk < 0.1 || r < 4) return
    const t = this._frameTick
    ctx.save()

    const stalkLen = r * (1.5 + sk * 3.0)
    const stalkWid = r * (0.08 + sk * 0.08)
    // Stalk extends "downward" (positive y) — anchoring to substrate
    const baseX = x
    const baseY = y + r * 0.7
    const tipX = baseX + Math.sin(t * 0.008 + c.id) * stalkLen * 0.05
    const tipY = baseY + stalkLen

    // Stalk body — tapered tube
    ctx.globalAlpha = 0.4 + sk * 0.35
    ctx.fillStyle = hsla(hue, sat * 0.4, lum - 12, 0.6)
    ctx.beginPath()
    ctx.moveTo(baseX - stalkWid, baseY)
    const midY = (baseY + tipY) / 2
    const tipWid = stalkWid * 0.5
    // Slight curve for organic feel
    const curveX = Math.sin(t * 0.01 + c.id * 2) * stalkLen * 0.04
    ctx.quadraticCurveTo(baseX - stalkWid * 0.8 + curveX, midY, tipX - tipWid, tipY)
    // Holdfast — wider base at bottom
    const holdfastW = tipWid * 2.5
    ctx.lineTo(tipX - holdfastW, tipY + holdfastW * 0.5)
    ctx.quadraticCurveTo(tipX, tipY + holdfastW * 0.8, tipX + holdfastW, tipY + holdfastW * 0.5)
    ctx.lineTo(tipX + tipWid, tipY)
    ctx.quadraticCurveTo(baseX + stalkWid * 0.8 + curveX, midY, baseX + stalkWid, baseY)
    ctx.closePath()
    ctx.fill()

    // Stalk ridge line
    ctx.globalAlpha = 0.15 + sk * 0.12
    ctx.strokeStyle = hsla(hue, sat * 0.3, lum + 10, 0.4)
    ctx.lineWidth = 0.3
    ctx.beginPath()
    ctx.moveTo(baseX, baseY)
    ctx.quadraticCurveTo(baseX + curveX, midY, tipX, tipY)
    ctx.stroke()

    // Holdfast attachment dots
    if (sk > 0.3) {
      ctx.globalAlpha = 0.2 + sk * 0.15
      ctx.fillStyle = hsla(hue, sat * 0.3, lum - 15, 0.5)
      for (let hi = 0; hi < 3; hi++) {
        const hx = tipX + (hi - 1) * holdfastW * 0.6
        const hy = tipY + holdfastW * 0.3
        ctx.beginPath()
        ctx.arc(hx, hy, holdfastW * 0.15, 0, TAU)
        ctx.fill()
      }
    }

    ctx.restore()
  }

  // Organelles drawn inside cells — now a lightweight pass since cells.js handles most
  P._drawOrganellesInCell = function (ctx, c, x, y, r, baseHue) {
    // This is now handled inline in cells.js for better integration
    // Keep as no-op to avoid breaking the mixin call
  }
}
