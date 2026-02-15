import { torusDelta } from './helpers.js'
import { FOOD_MEAT } from './constants.js'

export function installPredation(Sim) {
  const P = Sim.prototype

  P._predation = function (spatial) {
    const { grid, gw, gh } = spatial
    const rangeSq = this.cfg.predationRange * this.cfg.predationRange
    const n = this.cells.length
    const toKill = new Set()

    for (let i = 0; i < n; i++) {
      const c = this.cells[i]
      if (c.attackCooldown > 0) {
        c.attackCooldown--
        continue
      }

      // Toxin secretion: area damage to nearby non-kin
      if (c.g.toxin > 0.1 && c.toxinTimer === 0 && c.energy > 0.5) {
        const toxRange = this.cfg.predationRange * (0.8 + c.g.toxin * 0.5)
        const toxRangeSq = toxRange * toxRange
        const bx = Math.floor((c.x / this.w) * gw) % gw
        const by = Math.floor((c.y / this.h) * gh) % gh
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
              const dx = torusDelta(c.x - o.x, this.w)
              const dy = torusDelta(c.y - o.y, this.h)
              if (dx * dx + dy * dy < toxRangeSq) {
                const resist = o.g.toxinResist || 0
                const dmg = c.g.toxin * 0.08 * (1 - resist * 0.8)
                o.energy -= Math.max(0, dmg)
              }
            }
          }
        }
        c.energy -= c.g.toxin * 0.03
        c.toxinTimer = Math.max(3, 12 - c.g.toxin * 8) | 0
      }

      const hasAttack = c.g.diet > 0.2 || c.g.spike > 0.15 || c.g.constrict > 0.15
      if (!hasAttack) continue

      const bx = Math.floor((c.x / this.w) * gw) % gw
      const by = Math.floor((c.y / this.h) * gh) % gh

      let bestPrey = -1,
        bestD2 = Infinity
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx2 = (((bx + ox) % gw) + gw) % gw
          const gy2 = (((by + oy) % gh) + gh) % gh
          const bucket = grid[gx2 + gy2 * gw]
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k]
            if (j === i || toKill.has(j)) continue
            const o = this.cells[j]
            if (o.clade === c.clade) continue

            const camo = o.g.camouflage || 0
            // Eyespot: predators with eyespot see through camouflage
            // Scientific basis: evolved visual acuity in predators (eagle eyes, mantis shrimp)
            const eyeCounter = (c.g.eyespot || 0) > 0.1 ? 1.0 - (c.g.eyespot || 0) * 0.7 : 1.0
            if (camo > 0.1 && this.rng() < camo * 0.6 * eyeCounter) continue

            const dx = torusDelta(c.x - o.x, this.w)
            const dy = torusDelta(c.y - o.y, this.h)
            const d2 = dx * dx + dy * dy
            // Proboscis: extended strike range (like a mosquito or cnidarian tentacle)
            const probReach = (c.g.proboscis || 0) > 0.15 ? 1.0 + c.g.proboscis * 0.6 : 1.0
            const effectiveRangeSq = rangeSq * probReach * probReach
            if (d2 < effectiveRangeSq && d2 < bestD2) {
              // Elongation: dodge chance — streamlined prey dart away from attacks
              const preyElong = o.g.elongation || 0
              const preySpd = Math.sqrt(o.vx * o.vx + o.vy * o.vy)
              if (preyElong > 0.2 && preySpd > 0.15) {
                const dodgeChance = preyElong * 0.35 * Math.min(1, preySpd * 2)
                if (this.rng() < dodgeChance) continue // prey dodged!
              }

              let attackPower = c.energy * (1 + c.g.diet * 1.5)
              attackPower += c.g.spike * c.energy * 2.0
              attackPower += c.g.constrict * c.linkCount * c.energy * 0.5
              attackPower *= 1 + Math.min(c.organismSize, 6) * 0.3
              // Amoeboid: engulfing attack — pseudopods wrap around prey
              if ((c.g.amoeboid || 0) > 0.15) {
                attackPower *= 1 + c.g.amoeboid * 0.6
              }

              let defensePower = o.energy
              defensePower *= 1 + (o.g.membrane || 0) * 1.2
              defensePower += (o.g.spines || 0) * o.energy * 1.0
              defensePower *= 1 + (o.g.vesicles || 0) * 0.8
              // Shell: massive defense boost — hard carapace deflects attacks
              // Scientific basis: mollusc shells, turtle carapace, diatom frustules
              defensePower *= 1 + (o.g.shell || 0) * 2.0
              defensePower *= 1 + preySpd * 0.5
              defensePower *= 1 + o.organismSize * 0.3
              // Body scale: intimidation — large prey are harder to take down
              const preyScale = o.g.bodyScale || 1.0
              if (preyScale > 1.1) {
                defensePower *= 1 + (preyScale - 1.0) * 1.5
              }
              // Cilia: defensive currents push attackers away slightly
              if ((o.g.cilia || 0) > 0.2) {
                defensePower *= 1 + o.g.cilia * 0.4
              }

              if (attackPower > defensePower * this.cfg.predationMinSize) {
                bestPrey = j
                bestD2 = d2
              }
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
      }
    }

    for (const j of toKill) {
      this.cells[j].energy = 0
    }
  }
}
