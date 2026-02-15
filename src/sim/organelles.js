import {
  ORGANELLE_NUCLEUS,
  ORGANELLE_MITOCHONDRIA,
  ORGANELLE_FLAGELLUM,
  ORGANELLE_RECEPTOR,
  ORGANELLE_VACUOLE,
  ORGANELLE_COUNT
} from './constants.js'

export function installOrganelles(Sim) {
  const P = Sim.prototype

  P._developOrganelles = function (c) {
    const rate = this.cfg.organelleGrowthRate
    const atrophyRate = 0.001
    const energyThreshold = 0.5

    if (c.energy < energyThreshold) {
      for (let i = 0; i < ORGANELLE_COUNT; i++) {
        c.organelles[i] = Math.max(0, c.organelles[i] - atrophyRate * 3)
      }
      return
    }

    const aptitudes = [c.g.nucleusApt, c.g.mitoApt, c.g.flagellaApt, c.g.receptorApt, c.g.vacuoleApt]

    // Nucleus signal: matures with age and complexity (control center of the cell)
    // Also boosted by division history — experienced cells develop larger nuclei
    const ageSignal = Math.min(c.age * 0.004, 0.7)
    const complexitySignal = Math.min((c.complexity || 0) * 0.12, 0.5)
    const divSignal = Math.min(c.divisionCount * 0.08, 0.4)
    const nucSignal = Math.min(ageSignal + complexitySignal + divSignal, 1.0)
    this._growOrAtrophy(c, ORGANELLE_NUCLEUS, aptitudes[0], nucSignal, rate, atrophyRate)

    const mitoSignal = Math.min(c.activeMoveTicks * 0.003, 1.0)
    this._growOrAtrophy(c, ORGANELLE_MITOCHONDRIA, aptitudes[1], mitoSignal, rate, atrophyRate)

    const flagSignal = Math.min(c.moveAccum * 0.02, 1.0)
    this._growOrAtrophy(c, ORGANELLE_FLAGELLUM, aptitudes[2], flagSignal, rate, atrophyRate)

    const recSignal = Math.min(c.energyGainAccum * 0.5, 1.0)
    this._growOrAtrophy(c, ORGANELLE_RECEPTOR, aptitudes[3], recSignal, rate, atrophyRate)

    const vacSignal = Math.min(c.peakEnergy * 0.15, 1.0)
    this._growOrAtrophy(c, ORGANELLE_VACUOLE, aptitudes[4], vacSignal, rate, atrophyRate)

    c.moveAccum *= 0.95
    c.energyGainAccum *= 0.95
    c.activeMoveTicks = Math.max(0, c.activeMoveTicks - 1)
  }

  P._growOrAtrophy = function (c, idx, aptitude, signal, rate, atrophyRate) {
    const current = c.organelles[idx]
    const target = aptitude * signal
    if (current < target) {
      const growth = rate * (1 + c.energy * 0.15) * (target - current) * (0.3 + signal * 0.7)
      c.organelles[idx] = Math.min(aptitude, current + growth)
      c.energy -= growth * 0.04
    } else {
      const decay = atrophyRate * (1 - signal * 0.8)
      c.organelles[idx] = Math.max(0, current - decay)
    }
  }
}
