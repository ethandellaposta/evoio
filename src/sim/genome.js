import { randRange, randNorm } from '../rng.js'
import { clamp } from './helpers.js'
import { ORGANELLE_COUNT, ROLE_NONE } from './constants.js'

export function installGenome(Sim) {
  const P = Sim.prototype

  P._makeCell = function ({ x, y, energy, clade, genome } = {}) {
    const g = genome ?? {
      speed: randRange(this.rng, 0.65, 1.5),
      metabolism: randRange(this.rng, 0.7, 1.4),
      sense: randRange(this.rng, 0.6, 2.2),
      adhesion: randRange(this.rng, 0.0, 1.0),
      division: randRange(this.rng, 3.2, 5.0),
      nucleusApt: randRange(this.rng, 0.05, 0.5),
      mitoApt: randRange(this.rng, 0.05, 0.5),
      flagellaApt: randRange(this.rng, 0.05, 0.5),
      receptorApt: randRange(this.rng, 0.05, 0.5),
      vacuoleApt: randRange(this.rng, 0.05, 0.5),
      receptorBits: this._randomBits(12),
      ligandBits: this._randomBits(12),
      persistence: randRange(this.rng, 0.3, 0.8),
      diet: randRange(this.rng, 0.0, 0.6),
      flagella: randRange(this.rng, 0.0, 0.3),
      cilia: randRange(this.rng, 0.0, 0.2),
      jet: randRange(this.rng, 0.0, 0.05),
      amoeboid: randRange(this.rng, 0.0, 0.2),
      toxin: randRange(this.rng, 0.0, 0.05),
      spike: randRange(this.rng, 0.0, 0.05),
      constrict: randRange(this.rng, 0.0, 0.02),
      membrane: randRange(this.rng, 0.1, 0.4),
      spines: randRange(this.rng, 0.0, 0.1),
      camouflage: randRange(this.rng, 0.0, 0.05),
      toxinResist: randRange(this.rng, 0.0, 0.05),
      flipper: randRange(this.rng, 0.0, 0.2),
      mutRate: randRange(this.rng, 0.02, 0.12),
      boldness: randRange(this.rng, 0.2, 0.8),
      sociality: randRange(this.rng, 0.0, 0.6),
      toughness: randRange(this.rng, 0.0, 0.2),
      apoptosis: randRange(this.rng, 0.0, 0.05),
      elongation: randRange(this.rng, 0.0, 0.3),
      biolum: randRange(this.rng, 0.0, 0.15),
      vesicles: randRange(this.rng, 0.0, 0.1),
      bodyScale: randRange(this.rng, 0.8, 1.2),
      hueShift: randRange(this.rng, -0.5, 0.5),
      brightness: randRange(this.rng, 0.0, 0.3),
      proboscis: randRange(this.rng, 0.0, 0.1),
      paddleFin: randRange(this.rng, 0.0, 0.15),
      sexuality: randRange(this.rng, 0.05, 0.5),
      growthSymmetry: randRange(this.rng, 0.0, 1.0),
      branchAngle: randRange(this.rng, 0.2, 0.8),
      compactness: randRange(this.rng, 0.3, 0.7),
      budOffset: randRange(this.rng, 0.0, 1.0),
      phototropism: randRange(this.rng, 0.0, 0.3),
      chloroplast: randRange(this.rng, 0.0, 0.4),
      longevity: randRange(this.rng, 0.2, 0.8),
      scavenger: randRange(this.rng, 0.0, 0.1),
      shell: randRange(this.rng, 0.0, 0.05),
      symbiosis: randRange(this.rng, 0.0, 0.1),
      eyespot: randRange(this.rng, 0.0, 0.08),
      stalk: randRange(this.rng, 0.0, 0.03)
    }

    return {
      id: this._nextId++,
      clade: clade ?? this._nextClade++,
      x: x ?? randRange(this.rng, 0, this.w),
      y: y ?? randRange(this.rng, 0, this.h),
      vx: randNorm(this.rng) * 0.02,
      vy: randNorm(this.rng) * 0.02,
      energy: energy ?? randRange(this.rng, 1.0, 2.5),
      age: 0,
      g,
      linkCount: 0,
      organelles: new Float32Array(ORGANELLE_COUNT),
      persistDir: { x: randNorm(this.rng), y: randNorm(this.rng) },
      persistTimer: 0,
      role: ROLE_NONE,
      contactCount: 0,
      chemoVec: { x: 0, y: 0 },
      fitnessDist: 0,
      fitnessAccum: 0,
      membranePhase: this.rng() * Math.PI * 2,
      attackCooldown: 0,
      lastAte: 0,
      eatFlash: 0,
      engulfTarget: null,
      engulfing: 0,
      complexity: 0,
      jetCooldown: 0,
      toxinTimer: 0,
      foragingEff: 0,
      explorationScore: 0,
      cooperationScore: 0,
      behavioralFitness: 0,
      divisionCount: 0,
      moveAccum: 0,
      energyGainAccum: 0,
      peakEnergy: 0,
      activeMoveTicks: 0,
      organismSize: 1,
      organismDepth: 0
    }
  }

  P._randomBits = function (n) {
    let bits = 0
    for (let i = 0; i < n; i++) {
      if (this.rng() > 0.5) bits |= 1 << i
    }
    return bits
  }

  P._surfaceTension = function (cellA, cellB) {
    const compAB = this._bitComplement(cellA.g.receptorBits, cellB.g.ligandBits, 12)
    const compBA = this._bitComplement(cellB.g.receptorBits, cellA.g.ligandBits, 12)
    const Jcc = 52 - 4 * (compAB + compBA)
    const JcmA = 20 - 2 * (cellA.g.receptorBits & 0x3f)
    const JcmB = 20 - 2 * (cellB.g.receptorBits & 0x3f)
    const Jcm = (JcmA + JcmB) * 0.5
    const gamma = Jcm - Jcc / 2
    return clamp((gamma + 18) / 36, 0, 1)
  }

  P._bitComplement = function (receptor, ligand, len) {
    let xor = (receptor ^ ligand) & ((1 << len) - 1)
    let count = 0
    while (xor) {
      count += xor & 1
      xor >>= 1
    }
    return (len - count) / len
  }

  P._mutateGenome = function (parentG) {
    const m = parentG.mutRate ?? this.cfg.mutationRate
    const om = this.cfg.organelleMutRate * (m / this.cfg.mutationRate)
    const mm = this.cfg.morphMutRate * (m / this.cfg.mutationRate)
    const g = {
      speed: parentG.speed,
      metabolism: parentG.metabolism,
      sense: parentG.sense,
      adhesion: parentG.adhesion,
      division: parentG.division,
      nucleusApt: parentG.nucleusApt,
      mitoApt: parentG.mitoApt,
      flagellaApt: parentG.flagellaApt,
      receptorApt: parentG.receptorApt,
      vacuoleApt: parentG.vacuoleApt,
      receptorBits: parentG.receptorBits,
      ligandBits: parentG.ligandBits,
      persistence: parentG.persistence,
      diet: parentG.diet,
      flagella: parentG.flagella ?? 0.1,
      cilia: parentG.cilia ?? 0.1,
      jet: parentG.jet ?? 0,
      amoeboid: parentG.amoeboid ?? 0.1,
      toxin: parentG.toxin ?? 0,
      spike: parentG.spike ?? 0,
      constrict: parentG.constrict ?? 0,
      membrane: parentG.membrane,
      spines: parentG.spines,
      camouflage: parentG.camouflage ?? 0,
      toxinResist: parentG.toxinResist ?? 0,
      flipper: parentG.flipper,
      mutRate: parentG.mutRate ?? this.cfg.mutationRate,
      boldness: parentG.boldness ?? 0.5,
      sociality: parentG.sociality ?? 0.3,
      toughness: parentG.toughness ?? 0.1,
      apoptosis: parentG.apoptosis ?? 0.02,
      elongation: parentG.elongation ?? 0.1,
      biolum: parentG.biolum ?? 0.05,
      vesicles: parentG.vesicles ?? 0.03,
      bodyScale: parentG.bodyScale ?? 1.0,
      hueShift: parentG.hueShift ?? 0,
      brightness: parentG.brightness ?? 0.1,
      proboscis: parentG.proboscis ?? 0.03,
      paddleFin: parentG.paddleFin ?? 0.05,
      sexuality: parentG.sexuality ?? 0.05,
      growthSymmetry: parentG.growthSymmetry ?? 0.5,
      branchAngle: parentG.branchAngle ?? 0.5,
      compactness: parentG.compactness ?? 0.5,
      budOffset: parentG.budOffset ?? 0.5,
      phototropism: parentG.phototropism ?? 0.1,
      chloroplast: parentG.chloroplast ?? 0.1,
      longevity: parentG.longevity ?? 0.5,
      scavenger: parentG.scavenger ?? 0.03,
      shell: parentG.shell ?? 0,
      symbiosis: parentG.symbiosis ?? 0,
      eyespot: parentG.eyespot ?? 0,
      stalk: parentG.stalk ?? 0
    }

    g.mutRate = clamp(g.mutRate * Math.exp(randNorm(this.rng) * 0.2), 0.005, 0.25)

    const jitter = (x, scale, lo, hi) => clamp(x + randNorm(this.rng) * m * scale, lo, hi)

    g.speed = jitter(g.speed, 0.55, 0.35, 2.6)
    g.metabolism = jitter(g.metabolism, 0.55, 0.35, 2.6)
    g.sense = jitter(g.sense, 0.85, 0.25, 4.0)
    g.adhesion = jitter(g.adhesion, 0.9, 0, 1)
    g.division = jitter(g.division, 1.05, 2.0, 7.5)
    g.persistence = jitter(g.persistence, 0.5, 0.1, 0.95)

    g.diet = clamp(g.diet + randNorm(this.rng) * m * 0.6, 0, 1)

    const nucleusProtection = parentG.nucleusApt * 0.3
    const effectiveOm = om * (1 - nucleusProtection)
    const oje = (x, scale) => clamp(x + randNorm(this.rng) * effectiveOm * scale, 0, 1)
    g.nucleusApt = oje(g.nucleusApt, 0.7)
    g.mitoApt = oje(g.mitoApt, 0.7)
    g.flagellaApt = oje(g.flagellaApt, 0.7)
    g.receptorApt = oje(g.receptorApt, 0.7)
    g.vacuoleApt = oje(g.vacuoleApt, 0.7)

    const mj = (x, scale) => clamp(x + randNorm(this.rng) * mm * scale, 0, 1)
    g.flagella = mj(g.flagella, 0.8)
    g.cilia = mj(g.cilia, 0.7)
    g.jet = mj(g.jet, 0.9)
    g.amoeboid = mj(g.amoeboid, 0.7)
    g.toxin = mj(g.toxin, 0.9)
    g.spike = mj(g.spike, 0.9)
    g.constrict = mj(g.constrict, 0.8)
    g.membrane = mj(g.membrane, 0.6)
    g.spines = mj(g.spines, 0.9)
    g.camouflage = mj(g.camouflage, 0.8)
    g.toxinResist = mj(g.toxinResist, 0.7)
    g.flipper = mj(g.flipper, 0.8)

    g.boldness = jitter(g.boldness, 0.6, 0, 1)
    g.sociality = jitter(g.sociality, 0.5, 0, 1)

    g.toughness = mj(g.toughness, 0.7)
    g.apoptosis = mj(g.apoptosis, 0.6)
    g.elongation = mj(g.elongation, 0.7)
    g.biolum = mj(g.biolum, 0.8)
    g.vesicles = mj(g.vesicles, 0.7)
    g.bodyScale = clamp(g.bodyScale + randNorm(this.rng) * mm * 0.3, 0.5, 2.0)
    g.hueShift = clamp(g.hueShift + randNorm(this.rng) * mm * 0.4, -1, 1)
    g.brightness = mj(g.brightness, 0.7)
    g.proboscis = mj(g.proboscis, 0.8)
    g.paddleFin = mj(g.paddleFin, 0.7)
    g.sexuality = mj(g.sexuality, 0.6)

    // Formation genes — low mutation rate so species keep consistent shapes
    g.growthSymmetry = clamp(g.growthSymmetry + randNorm(this.rng) * mm * 0.3, 0, 1)
    g.branchAngle = clamp(g.branchAngle + randNorm(this.rng) * mm * 0.25, 0, 1)
    g.compactness = clamp(g.compactness + randNorm(this.rng) * mm * 0.25, 0, 1)
    g.budOffset = clamp(g.budOffset + randNorm(this.rng) * mm * 0.15, 0, 1)
    g.phototropism = mj(g.phototropism, 0.7)
    g.chloroplast = mj(g.chloroplast, 0.7)
    g.longevity = mj(g.longevity, 0.5)
    g.scavenger = mj(g.scavenger, 0.8)
    g.shell = mj(g.shell, 0.7)
    g.symbiosis = mj(g.symbiosis, 0.6)
    g.eyespot = mj(g.eyespot, 0.7)
    g.stalk = mj(g.stalk, 0.7)

    for (let i = 0; i < 12; i++) {
      if (this.rng() < m * 0.5) g.receptorBits ^= 1 << i
      if (this.rng() < m * 0.5) g.ligandBits ^= 1 << i
    }

    return g
  }

  // Sexual reproduction: crossover two parent genomes then mutate
  // Each gene is picked from one parent at random (uniform crossover)
  // Receptor/ligand bits do bitwise crossover
  P._recombineGenomes = function (gA, gB) {
    const pick = (a, b) => (this.rng() < 0.5 ? a : b)
    const blend = (a, b) => {
      const t = this.rng()
      return a * t + b * (1 - t)
    }
    const child = {
      speed: blend(gA.speed, gB.speed),
      metabolism: blend(gA.metabolism, gB.metabolism),
      sense: blend(gA.sense, gB.sense),
      adhesion: blend(gA.adhesion, gB.adhesion),
      division: blend(gA.division, gB.division),
      nucleusApt: pick(gA.nucleusApt, gB.nucleusApt),
      mitoApt: pick(gA.mitoApt, gB.mitoApt),
      flagellaApt: pick(gA.flagellaApt, gB.flagellaApt),
      receptorApt: pick(gA.receptorApt, gB.receptorApt),
      vacuoleApt: pick(gA.vacuoleApt, gB.vacuoleApt),
      receptorBits: this._crossoverBits(gA.receptorBits, gB.receptorBits, 12),
      ligandBits: this._crossoverBits(gA.ligandBits, gB.ligandBits, 12),
      persistence: blend(gA.persistence, gB.persistence),
      diet: blend(gA.diet, gB.diet),
      flagella: pick(gA.flagella, gB.flagella),
      cilia: pick(gA.cilia, gB.cilia),
      jet: pick(gA.jet, gB.jet),
      amoeboid: pick(gA.amoeboid, gB.amoeboid),
      toxin: pick(gA.toxin, gB.toxin),
      spike: pick(gA.spike, gB.spike),
      constrict: pick(gA.constrict, gB.constrict),
      membrane: blend(gA.membrane, gB.membrane),
      spines: pick(gA.spines, gB.spines),
      camouflage: pick(gA.camouflage, gB.camouflage),
      toxinResist: pick(gA.toxinResist, gB.toxinResist),
      flipper: pick(gA.flipper, gB.flipper),
      mutRate: blend(gA.mutRate, gB.mutRate),
      boldness: blend(gA.boldness, gB.boldness),
      sociality: blend(gA.sociality, gB.sociality),
      toughness: pick(gA.toughness, gB.toughness),
      apoptosis: pick(gA.apoptosis, gB.apoptosis),
      elongation: pick(gA.elongation, gB.elongation),
      biolum: pick(gA.biolum, gB.biolum),
      vesicles: pick(gA.vesicles, gB.vesicles),
      bodyScale: blend(gA.bodyScale, gB.bodyScale),
      hueShift: blend(gA.hueShift, gB.hueShift),
      brightness: blend(gA.brightness, gB.brightness),
      proboscis: pick(gA.proboscis, gB.proboscis),
      paddleFin: pick(gA.paddleFin, gB.paddleFin),
      sexuality: blend(gA.sexuality, gB.sexuality),
      growthSymmetry: blend(gA.growthSymmetry, gB.growthSymmetry),
      branchAngle: blend(gA.branchAngle, gB.branchAngle),
      compactness: blend(gA.compactness, gB.compactness),
      budOffset: blend(gA.budOffset, gB.budOffset),
      phototropism: blend(gA.phototropism, gB.phototropism),
      chloroplast: blend(gA.chloroplast, gB.chloroplast),
      longevity: blend(gA.longevity, gB.longevity),
      scavenger: pick(gA.scavenger, gB.scavenger),
      shell: pick(gA.shell ?? 0, gB.shell ?? 0),
      symbiosis: blend(gA.symbiosis ?? 0, gB.symbiosis ?? 0),
      eyespot: pick(gA.eyespot ?? 0, gB.eyespot ?? 0),
      stalk: pick(gA.stalk ?? 0, gB.stalk ?? 0)
    }
    // Apply mutation on top of recombined genome
    return this._mutateGenome(child)
  }

  // Bitwise crossover: each bit independently from one parent
  P._crossoverBits = function (bitsA, bitsB, len) {
    let result = 0
    for (let i = 0; i < len; i++) {
      const bit = this.rng() < 0.5 ? (bitsA >> i) & 1 : (bitsB >> i) & 1
      result |= bit << i
    }
    return result
  }
}
