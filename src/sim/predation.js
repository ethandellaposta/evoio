import { torusDelta } from './helpers.js'
import { FOOD_MEAT } from './constants.js'

export function installPredation(Sim) {
  const P = Sim.prototype

  P._predation = function (spatial) {
    const { grid, gw, gh } = spatial
    const rangeSq = this.cfg.predationRange * this.cfg.predationRange
    const n = this.cells.length
    const toKill = new Set()
    const _predMinSize = this.cfg.predationMinSize
    const _w = this.w,
      _h = this.h
    // Stride predation loop at very high pop to keep cost linear
    const _predOuterStride = n > 12000 ? 4 : n > 8000 ? 3 : n > 5000 ? 2 : 1
    const _predPhase = this.t % _predOuterStride

    for (let i = _predPhase; i < n; i += _predOuterStride) {
      const c = this.cells[i]
      if (c.attackCooldown > 0) {
        c.attackCooldown--
        continue
      }

      // Toxin secretion: area damage to nearby non-kin
      if (c.g.toxin > 0.1 && c.toxinTimer === 0 && c.energy > 0.5) {
        const toxRange = this.cfg.predationRange * (0.8 + c.g.toxin * 0.5)
        const toxRangeSq = toxRange * toxRange
        const _toxDmgBase = c.g.toxin * 0.08
        const bx = Math.floor((c.x / _w) * gw) % gw
        const by = Math.floor((c.y / _h) * gh) % gh
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const gx2 = (((bx + ox) % gw) + gw) % gw
            const gy2 = (((by + oy) % gh) + gh) % gh
            const bucket = grid[gx2 + gy2 * gw]
            for (let k = 0; k < bucket.length; k++) {
              const j = bucket[k]
              if (j === i) continue
              const o = this.cells[j]
              if (o.clade === c.clade) continue
              const dx = c.x - o.x,
                dy = c.y - o.y
              const _tdx = dx > _w * 0.5 ? dx - _w : dx < -_w * 0.5 ? dx + _w : dx
              const _tdy = dy > _h * 0.5 ? dy - _h : dy < -_h * 0.5 ? dy + _h : dy
              if (_tdx * _tdx + _tdy * _tdy < toxRangeSq) {
                const resist = o.g.toxinResist || 0
                o.energy -= _toxDmgBase * (1 - resist * 0.8)
              }
            }
          }
        }
        c.energy -= c.g.toxin * 0.03
        c.toxinTimer = Math.max(3, 12 - c.g.toxin * 8) | 0
      }

      const hasAttack = c.g.diet > 0.2 || c.g.spike > 0.15 || c.g.constrict > 0.15
      if (!hasAttack) continue

      // Hoist attacker-invariant values outside inner loop
      const bx = Math.floor((c.x / _w) * gw) % gw
      const by = Math.floor((c.y / _h) * gh) % gh
      const _eyeCounter = (c.g.eyespot || 0) > 0.1 ? 1.0 - (c.g.eyespot || 0) * 0.7 : 1.0
      const _probReach = (c.g.proboscis || 0) > 0.15 ? 1.0 + c.g.proboscis * 0.6 : 1.0
      const _effectiveRangeSq = rangeSq * _probReach * _probReach
      // Precompute attack power (only depends on attacker)
      let _baseAttack = c.energy * (1 + c.g.diet * 1.5)
      _baseAttack += c.g.spike * c.energy * 2.0
      _baseAttack += c.g.constrict * c.linkCount * c.energy * 0.5
      _baseAttack *= 1 + Math.min(c.organismSize, 6) * 0.3
      if ((c.g.amoeboid || 0) > 0.15) _baseAttack *= 1 + c.g.amoeboid * 0.6
      const _cImmuneBits = c.g.immuneBits || 0
      const _cx = c.x,
        _cy = c.y

      let bestPrey = -1,
        bestD2 = Infinity
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx2 = (((bx + ox) % gw) + gw) % gw
          const gy2 = (((by + oy) % gh) + gh) % gh
          const bucket = grid[gx2 + gy2 * gw]
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k]
            if (j === i) continue
            const o = this.cells[j]
            if (o.energy <= 0 || o.clade === c.clade) continue

            // Distance check first (cheapest filter)
            const dx = _cx - o.x,
              dy = _cy - o.y
            const _tdx = dx > _w * 0.5 ? dx - _w : dx < -_w * 0.5 ? dx + _w : dx
            const _tdy = dy > _h * 0.5 ? dy - _h : dy < -_h * 0.5 ? dy + _h : dy
            const d2 = _tdx * _tdx + _tdy * _tdy
            if (d2 >= _effectiveRangeSq || d2 >= bestD2) continue

            const camo = o.g.camouflage || 0
            if (camo > 0.1 && this.rng() < camo * 0.6 * _eyeCounter) continue

            // Elongation: dodge chance — use squared speed to avoid sqrt
            const preyElong = o.g.elongation || 0
            const preySpdSq = o.vx * o.vx + o.vy * o.vy
            if (preyElong > 0.2 && preySpdSq > 0.0225) {
              // 0.15^2
              const preySpd = Math.sqrt(preySpdSq)
              const dodgeChance = preyElong * 0.35 * Math.min(1, preySpd * 2)
              if (this.rng() < dodgeChance) continue
            }

            let defensePower = o.energy
            defensePower *= 1 + (o.g.membrane || 0) * 1.2
            defensePower += (o.g.spines || 0) * o.energy * 1.0
            defensePower *= 1 + (o.g.vesicles || 0) * 0.8
            defensePower *= 1 + (o.g.shell || 0) * 2.0
            // Use squared speed for defense bonus (avoid sqrt when possible)
            defensePower *= 1 + Math.min(preySpdSq, 1) * 0.5
            defensePower *= 1 + o.organismSize * 0.3
            const preyScale = o.g.bodyScale || 1.0
            if (preyScale > 1.1) {
              defensePower *= 1 + (preyScale - 1.0) * 2.0
            }
            // Herbivore herd defense: low-diet cells are tougher in groups
            // Scientific basis: wildebeest, musk ox, schooling fish — herbivores
            // compensate for lack of weapons with group vigilance and bulk
            if (o.g.diet < 0.3 && o.organismSize > 1) {
              defensePower *= 1 + Math.min(o.organismSize, 8) * 0.15
            }
            if ((o.g.cilia || 0) > 0.2) {
              defensePower *= 1 + o.g.cilia * 0.4
            }

            // Quick attack check before expensive shelter/immune lookups
            if (_baseAttack <= defensePower * _predMinSize) continue

            // Shelter protection (only computed if attack might succeed)
            const preyShelter = this.sampleShelter(o.x, o.y)
            if (preyShelter > 0.1) {
              defensePower *= 1 + preyShelter * 0.8
            }
            // Immune defense: popcount via bit tricks instead of loop
            const immuneStr = o.g.immuneStrength || 0
            if (immuneStr > 0.05) {
              let _imm = ((o.g.immuneBits || 0) ^ _cImmuneBits) & 0xfff
              _imm = _imm - ((_imm >> 1) & 0x555)
              _imm = (_imm & 0x333) + ((_imm >> 2) & 0x333)
              const mismatchCount = ((_imm + (_imm >> 4)) & 0x0f0f) % 15
              defensePower *= 1 + immuneStr * (mismatchCount / 12) * 1.5
            }

            if (_baseAttack > defensePower * _predMinSize) {
              bestPrey = j
              bestD2 = d2
            }
          }
        }
      }

      if (bestPrey >= 0) {
        const prey = this.cells[bestPrey]
        const spineRetaliation = (prey.g.spines || 0) * prey.energy * 0.15
        if (spineRetaliation > 0.01) c.energy -= spineRetaliation

        let efficiency = 0.5 + c.g.diet * 0.35
        if (c.g.spike > 0.15) efficiency += c.g.spike * 0.15
        if (c.g.constrict > 0.15) efficiency += c.g.constrict * 0.1
        const gained = prey.energy * Math.min(efficiency, 0.85)
        c.energy += gained
        c.lastAte = FOOD_MEAT
        c.eatFlash = 25
        c.engulfing = 30
        c.engulfTarget = { x: prey.x, y: prey.y, r: prey.energy * 0.3 }
        c.attackCooldown = this.cfg.predationCooldown
        const meatDrop = prey.energy * this.cfg.meatDropEnergy
        this._dropMeat(prey.x, prey.y, meatDrop)
        toKill.add(bestPrey)
        this.killCount++
        const chainKey = `${c.clade}>${prey.clade}`
        this.foodChain.set(chainKey, (this.foodChain.get(chainKey) || 0) + 1)

        // ── Alarm pheromone emission ──
        // Dying prey releases chemical alarm substance (Schreckstoff).
        // Strength scales with signaling gene — organisms that invest in
        // cell-cell communication produce more alarm substance.
        const alarmStr = (prey.g.signaling || 0.05) * 1.5 + 0.2
        this.depositAlarm(prey.x, prey.y, alarmStr)
        // Spread to adjacent grid cells for spatial reach
        this.depositAlarm(prey.x + 4, prey.y, alarmStr * 0.5)
        this.depositAlarm(prey.x - 4, prey.y, alarmStr * 0.5)
        this.depositAlarm(prey.x, prey.y + 4, alarmStr * 0.5)
        this.depositAlarm(prey.x, prey.y - 4, alarmStr * 0.5)
      }
    }

    for (const j of toKill) {
      this.cells[j].energy = 0
    }
  }
}
