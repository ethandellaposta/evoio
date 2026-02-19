import { randRange, randNorm } from '../rng.js'
import { clamp } from './helpers.js'
import { ORGANELLE_COUNT, ROLE_NONE } from './constants.js'
import { createStrand, interpretStrand, mutateStrand, recombineStrands } from './dna.js'

export function installGenome(Sim) {
  const P = Sim.prototype

  P._makeCell = function ({ x, y, energy, clade, genome, dnaStrand } = {}) {
    // ══════════════════════════════════════════════════════════════════════
    // DNA strand: the TRUE genome
    // ══════════════════════════════════════════════════════════════════════
    // If no strand provided and no legacy genome, create a random strand.
    // The strand gets interpreted into phenotype values (the named genes).
    // Legacy genome objects (from old saves) bypass the strand entirely.
    const strand = dnaStrand ? dnaStrand : genome ? null : createStrand(this.rng)
    const phenotype = strand ? interpretStrand(strand) : null

    let g
    if (genome) {
      // Legacy path: old save or manually specified genome — use as-is
      g = genome
    } else if (phenotype) {
      // DNA strand path: phenotype decoded from raw strand
      // Add non-strand genes that aren't encoded in the codon system
      // (bit fields, organelle aptitudes, epigenetics, genome architecture)
      g = phenotype
      // Organelle aptitudes (not in strand — these are cellular machinery, not DNA-encoded traits)
      g.nucleusApt = g.nucleusApt ?? randRange(this.rng, 0.05, 0.5)
      g.mitoApt = g.mitoApt ?? randRange(this.rng, 0.05, 0.5)
      g.flagellaApt = g.flagellaApt ?? randRange(this.rng, 0.05, 0.5)
      g.receptorApt = g.receptorApt ?? randRange(this.rng, 0.05, 0.5)
      g.vacuoleApt = g.vacuoleApt ?? randRange(this.rng, 0.05, 0.5)
      // Bit-field genes (surface proteins — encoded separately like real antigen diversity)
      g.receptorBits = this._randomBits(12)
      g.ligandBits = this._randomBits(12)
      g.immuneBits = this._randomBits(12)
      g.signalBits = this._randomBits(8)
      // Genome architecture (meta-properties of the DNA itself)
      g.genomeSize = strand ? strand.length / 192 : 1.0
      g.ploidy = 1.0
      g.driftLoad = 0
      // Epigenetic marks (not DNA — chromatin modifications)
      g.epiMarks = {
        stressResponse: 0,
        abundanceMemory: 0,
        socialPriming: 0,
        predatorMemory: 0,
        darkAdapt: 0
      }
    }

    // Apply gene overrides (knockouts / freezes)
    this._applyGeneOverrides(g)

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
      dna: strand, // raw DNA strand (Float32Array) — the TRUE genome
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
      organismDepth: 0,
      senescence: 0,
      starveTicks: 0,
      lifetimeEnergyGain: 0,
      lifetimeMoveDist: 0,
      o2Store: 0.5,
      waste: 0
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

  P._applyGeneOverrides = function (g) {
    const overrides = this.geneOverrides
    if (!overrides) return
    for (const [trait, override] of Object.entries(overrides)) {
      if (override.mode === 'knockout') {
        g[trait] = 0
      } else if (override.mode === 'freeze') {
        g[trait] = override.value
      }
    }
  }

  // Mutate a genome. If parentDna is provided, mutation operates on the raw
  // DNA strand (realistic: point mutations, insertions, deletions, duplications,
  // inversions, transpositions). The strand is then re-interpreted into phenotype.
  // Non-strand genes (bit fields, organelle aptitudes, epigenetics) are mutated separately.
  // If no parentDna, falls through to legacy named-gene mutation.
  P._mutateGenome = function (parentG, parentDna) {
    const m = parentG.mutRate ?? this.cfg.mutationRate

    // ── DNA strand mutation path ──
    if (parentDna) {
      const childDna = mutateStrand(this.rng, parentDna, m)
      const phenotype = interpretStrand(childDna)

      // Overlay non-strand genes from parent (mutated independently)
      const om = this.cfg.organelleMutRate * (m / this.cfg.mutationRate)
      const oje = (x, scale) => clamp(x + randNorm(this.rng) * om * scale, 0, 1)
      phenotype.nucleusApt = oje(parentG.nucleusApt ?? 0.2, 0.7)
      phenotype.mitoApt = oje(parentG.mitoApt ?? 0.2, 0.7)
      phenotype.flagellaApt = oje(parentG.flagellaApt ?? 0.2, 0.7)
      phenotype.receptorApt = oje(parentG.receptorApt ?? 0.2, 0.7)
      phenotype.vacuoleApt = oje(parentG.vacuoleApt ?? 0.2, 0.7)

      // Bit-field mutations (surface proteins evolve independently of DNA codons)
      phenotype.receptorBits = parentG.receptorBits ?? 0
      phenotype.ligandBits = parentG.ligandBits ?? 0
      phenotype.immuneBits = parentG.immuneBits ?? 0
      phenotype.signalBits = parentG.signalBits ?? 0
      for (let i = 0; i < 12; i++) {
        if (this.rng() < m * 0.5) phenotype.receptorBits ^= 1 << i
        if (this.rng() < m * 0.5) phenotype.ligandBits ^= 1 << i
        if (this.rng() < m * 0.3) phenotype.immuneBits ^= 1 << i
      }
      for (let i = 0; i < 8; i++) {
        if (this.rng() < m * 0.2) phenotype.signalBits ^= 1 << i
      }

      // Genome architecture (derived from strand properties)
      phenotype.genomeSize = childDna.length / 192
      phenotype.ploidy = parentG.ploidy ?? 1.0
      // Rare whole-genome duplication
      if (this.rng() < 0.001 * m) {
        phenotype.ploidy = Math.min(4.0, Math.ceil(phenotype.ploidy * 1.5))
      }

      // DNA repair counteracts drift load
      const repairProtection = (phenotype.dnaRepair || 0) * 0.6
      const driftChance = 0.03 * (1 - repairProtection)
      const driftIncrement = this.rng() < driftChance ? randRange(this.rng, 0.001, 0.008) : 0
      phenotype.driftLoad = Math.min(1.0, (parentG.driftLoad || 0) + driftIncrement)

      // Transgenerational epigenetic inheritance (50% decay per generation)
      phenotype.epiMarks = {
        stressResponse: ((parentG.epiMarks || {}).stressResponse || 0) * 0.5,
        abundanceMemory: ((parentG.epiMarks || {}).abundanceMemory || 0) * 0.5,
        socialPriming: ((parentG.epiMarks || {}).socialPriming || 0) * 0.5,
        predatorMemory: ((parentG.epiMarks || {}).predatorMemory || 0) * 0.5,
        darkAdapt: ((parentG.epiMarks || {}).darkAdapt || 0) * 0.5
      }

      this._applyGeneOverrides(phenotype)
      return { g: phenotype, dna: childDna }
    }

    // ── Legacy named-gene mutation path (for old saves without DNA strands) ──
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
      pattern: parentG.pattern ?? 0.5,
      patternScale: parentG.patternScale ?? 0.5,
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
      stalk: parentG.stalk ?? 0,
      fragmentation: parentG.fragmentation ?? 0.05,
      propaguleSize: parentG.propaguleSize ?? 0.1,
      driftLoad: parentG.driftLoad ?? 0,
      genomeSize: parentG.genomeSize ?? 1.0,
      ploidy: parentG.ploidy ?? 1.0,
      regulatoryComplexity: parentG.regulatoryComplexity ?? 0.05,
      devTiming: parentG.devTiming ?? 0.5,
      growthRate: parentG.growthRate ?? 0.5,
      dnaRepair: parentG.dnaRepair ?? 0.1,
      immuneBits: parentG.immuneBits ?? 0,
      immuneStrength: parentG.immuneStrength ?? 0.1,
      signaling: parentG.signaling ?? 0.05,
      signalBits: parentG.signalBits ?? 0,
      hgt: parentG.hgt ?? 0.05,
      plasticity: parentG.plasticity ?? 0.15,
      respiration: parentG.respiration ?? 0.4,
      wasteExpel: parentG.wasteExpel ?? 0.3,
      curiosity: parentG.curiosity ?? 0.3,
      aggression: parentG.aggression ?? 0.1,
      fear: parentG.fear ?? 0.3,
      territorial: parentG.territorial ?? 0.1,
      nocturnal: parentG.nocturnal ?? 0.1,
      migratory: parentG.migratory ?? 0.1,
      nurturing: parentG.nurturing ?? 0.1,
      // Transgenerational epigenetic inheritance: marks decay ~50% per generation
      // Scientific basis: Heard & Martienssen 2014 — epigenetic marks can persist
      // across generations but are progressively diluted without reinforcement.
      epiMarks: {
        stressResponse: ((parentG.epiMarks || {}).stressResponse || 0) * 0.5,
        abundanceMemory: ((parentG.epiMarks || {}).abundanceMemory || 0) * 0.5,
        socialPriming: ((parentG.epiMarks || {}).socialPriming || 0) * 0.5,
        predatorMemory: ((parentG.epiMarks || {}).predatorMemory || 0) * 0.5,
        darkAdapt: ((parentG.epiMarks || {}).darkAdapt || 0) * 0.5
      }
    }

    g.mutRate = clamp(g.mutRate * Math.exp(randNorm(this.rng) * 0.2), 0.005, 0.25)

    const jitter = (x, scale, lo, hi) => clamp(x + randNorm(this.rng) * m * scale, lo, hi)

    g.speed = jitter(g.speed, 0.55, 0.35, 2.6)
    g.metabolism = jitter(g.metabolism, 0.55, 0.35, 2.6)
    g.sense = jitter(g.sense, 0.85, 0.25, 4.0)
    g.adhesion = jitter(g.adhesion, 0.9, 0, 1)
    g.division = jitter(g.division, 1.05, 2.0, 7.5)
    g.persistence = jitter(g.persistence, 0.5, 0.1, 0.95)

    g.diet = clamp(g.diet + randNorm(this.rng) * m * 0.9, 0, 1)

    const nucleusProtection = parentG.nucleusApt * 0.3
    const effectiveOm = om * (1 - nucleusProtection)
    const oje = (x, scale) => clamp(x + randNorm(this.rng) * effectiveOm * scale, 0, 1)
    g.nucleusApt = oje(g.nucleusApt, 0.7)
    g.mitoApt = oje(g.mitoApt, 0.7)
    g.flagellaApt = oje(g.flagellaApt, 0.7)
    g.receptorApt = oje(g.receptorApt, 0.7)
    g.vacuoleApt = oje(g.vacuoleApt, 0.7)

    const mj = (x, scale) => clamp(x + randNorm(this.rng) * mm * scale, 0, 1)
    g.flagella = mj(g.flagella, 1.0)
    g.cilia = mj(g.cilia, 0.9)
    g.jet = mj(g.jet, 1.1)
    g.amoeboid = mj(g.amoeboid, 0.9)
    g.toxin = mj(g.toxin, 1.1)
    g.spike = mj(g.spike, 1.1)
    g.constrict = mj(g.constrict, 1.0)
    g.membrane = mj(g.membrane, 0.6)
    g.spines = mj(g.spines, 1.0)
    g.camouflage = mj(g.camouflage, 1.0)
    g.toxinResist = mj(g.toxinResist, 0.9)
    g.flipper = mj(g.flipper, 0.8)

    g.boldness = jitter(g.boldness, 0.6, 0, 1)
    g.sociality = jitter(g.sociality, 0.5, 0, 1)

    g.toughness = mj(g.toughness, 0.7)
    g.apoptosis = mj(g.apoptosis, 0.6)
    g.elongation = mj(g.elongation, 0.7)
    g.biolum = mj(g.biolum, 0.8)
    g.vesicles = mj(g.vesicles, 0.7)
    g.bodyScale = clamp(g.bodyScale + randNorm(this.rng) * mm * 0.5, 0.4, 2.2)
    g.hueShift = clamp(g.hueShift + randNorm(this.rng) * mm * 0.6, -1, 1)
    g.pattern = clamp((g.pattern ?? 0.5) + randNorm(this.rng) * mm * 0.25, 0, 1)
    g.patternScale = clamp((g.patternScale ?? 0.5) + randNorm(this.rng) * mm * 0.2, 0.1, 1.0)
    g.brightness = mj(g.brightness, 0.7)
    g.proboscis = mj(g.proboscis, 1.0)
    g.paddleFin = mj(g.paddleFin, 0.9)
    g.sexuality = mj(g.sexuality, 0.6)

    // Formation genes — low mutation rate so species keep consistent shapes
    g.growthSymmetry = clamp(g.growthSymmetry + randNorm(this.rng) * mm * 0.3, 0, 1)
    g.branchAngle = clamp(g.branchAngle + randNorm(this.rng) * mm * 0.25, 0, 1)
    g.compactness = clamp(g.compactness + randNorm(this.rng) * mm * 0.25, 0, 1)
    g.budOffset = clamp(g.budOffset + randNorm(this.rng) * mm * 0.15, 0, 1)
    g.phototropism = mj(g.phototropism, 0.9)
    g.chloroplast = mj(g.chloroplast, 0.9)
    g.longevity = mj(g.longevity, 0.5)
    g.scavenger = mj(g.scavenger, 1.0)
    g.shell = mj(g.shell, 0.9)
    g.symbiosis = mj(g.symbiosis, 0.8)
    g.eyespot = mj(g.eyespot, 0.9)
    g.stalk = mj(g.stalk, 0.9)
    g.fragmentation = mj(g.fragmentation, 0.6)
    g.propaguleSize = mj(g.propaguleSize, 0.5)
    g.respiration = mj(g.respiration, 0.6)
    g.wasteExpel = mj(g.wasteExpel, 0.6)

    // Behavioral genes
    g.curiosity = jitter(g.curiosity, 0.5, 0, 1)
    g.aggression = jitter(g.aggression, 0.6, 0, 1)
    g.fear = jitter(g.fear, 0.5, 0, 1)
    g.territorial = jitter(g.territorial, 0.5, 0, 1)
    g.nocturnal = jitter(g.nocturnal, 0.4, 0, 1)
    g.migratory = jitter(g.migratory, 0.4, 0, 1)
    g.nurturing = jitter(g.nurturing, 0.5, 0, 1)

    // ── Genome architecture mutations ──

    // Gene duplication: rare events that increase genome size
    // Scientific basis: Ohno 1970 — gene duplication is the primary source of
    // new genetic material. Duplicated genes can diverge (neofunctionalization)
    // or be lost (pseudogenization). Larger genomes enable more complex regulation.
    if (this.rng() < m * 0.08) {
      // Duplication event: genome grows slightly
      g.genomeSize = Math.min(4.0, (g.genomeSize || 1.0) + randRange(this.rng, 0.02, 0.1))
    }
    // Genome can also shrink via deletion (streamlining, seen in parasites/endosymbionts)
    if (this.rng() < m * 0.04) {
      g.genomeSize = Math.max(0.5, (g.genomeSize || 1.0) - randRange(this.rng, 0.01, 0.05))
    }

    // Whole-genome duplication (polyploidy): very rare, major evolutionary event
    // Scientific basis: 2R hypothesis — two rounds of WGD in vertebrate ancestor.
    // Polyploidy is common in plants, some fish, amphibians.
    if (this.rng() < 0.001 * m) {
      g.ploidy = Math.min(4.0, Math.ceil((g.ploidy || 1.0) * 1.5))
    }

    // Regulatory complexity: grows via accretion of new regulatory elements
    // Larger genomes have more room for regulatory sequences
    const regGrowth = (g.genomeSize || 1.0) > 1.5 ? 0.003 : 0.001
    g.regulatoryComplexity = clamp(
      (g.regulatoryComplexity || 0) + randNorm(this.rng) * m * 0.4 + regGrowth,
      0,
      1
    )

    // Developmental timing and growth rate
    g.devTiming = clamp((g.devTiming || 0.5) + randNorm(this.rng) * m * 0.3, 0, 1)
    g.growthRate = clamp((g.growthRate || 0.5) + randNorm(this.rng) * m * 0.3, 0, 1)

    // DNA repair: mutates slowly, higher = fewer drift load mutations
    g.dnaRepair = clamp((g.dnaRepair || 0.1) + randNorm(this.rng) * m * 0.3, 0, 1)

    // Immune system: bits mutate for Red Queen coevolution
    g.immuneStrength = mj(g.immuneStrength || 0.1, 0.6)
    for (let i = 0; i < 12; i++) {
      if (this.rng() < m * 0.3) g.immuneBits ^= 1 << i
    }

    // Cell signaling
    g.signaling = mj(g.signaling || 0.05, 0.7)
    for (let i = 0; i < 8; i++) {
      if (this.rng() < m * 0.2) g.signalBits ^= 1 << i
    }

    // Horizontal gene transfer capacity
    g.hgt = mj(g.hgt || 0.05, 0.5)

    // Phenotypic plasticity
    g.plasticity = clamp((g.plasticity || 0.15) + randNorm(this.rng) * m * 0.4, 0, 1)

    // Muller's ratchet: asexual lineages accumulate deleterious mutations
    // Scientific basis: Muller 1964 — without recombination, the least-loaded
    // class of genomes is lost by drift and can never be restored.
    // Sexual reproduction (recombination) can purge drift load.
    // DNA repair reduces drift load accumulation rate
    const repairProtection = (g.dnaRepair || 0) * 0.6 // up to 60% reduction
    const driftChance = 0.03 * (1 - repairProtection)
    const driftIncrement = this.rng() < driftChance ? randRange(this.rng, 0.001, 0.008) : 0
    g.driftLoad = Math.min(1.0, (g.driftLoad || 0) + driftIncrement)

    for (let i = 0; i < 12; i++) {
      if (this.rng() < m * 0.5) g.receptorBits ^= 1 << i
      if (this.rng() < m * 0.5) g.ligandBits ^= 1 << i
    }

    this._applyGeneOverrides(g)
    return { g, dna: null }
  }

  // Sexual reproduction: crossover two parent genomes then mutate.
  // If both parents have DNA strands, do real meiotic crossover on the strands.
  // Otherwise fall through to legacy named-gene recombination.
  P._recombineGenomes = function (gA, gB, dnaA, dnaB) {
    // ── DNA strand recombination path ──
    if (dnaA && dnaB) {
      // Real meiotic crossover: strands align and exchange segments
      const childStrand = recombineStrands(this.rng, dnaA, dnaB)
      // Apply mutation on top of recombined strand
      return this._mutateGenome(gA, childStrand)
    }
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
      pattern: blend(gA.pattern ?? 0.5, gB.pattern ?? 0.5),
      patternScale: blend(gA.patternScale ?? 0.5, gB.patternScale ?? 0.5),
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
      stalk: pick(gA.stalk ?? 0, gB.stalk ?? 0),
      fragmentation: blend(gA.fragmentation ?? 0, gB.fragmentation ?? 0),
      propaguleSize: blend(gA.propaguleSize ?? 0, gB.propaguleSize ?? 0),
      // Sexual recombination purges drift load (Kondrashov's deterministic mutation hypothesis)
      // Offspring get the MINIMUM of both parents' loads, minus a purging bonus
      driftLoad: Math.max(0, Math.min(gA.driftLoad ?? 0, gB.driftLoad ?? 0) * 0.6),
      genomeSize: blend(gA.genomeSize ?? 1.0, gB.genomeSize ?? 1.0),
      // Ploidy: offspring gets max of parents (polyploidy is dominant)
      ploidy: Math.max(gA.ploidy ?? 1, gB.ploidy ?? 1),
      regulatoryComplexity: blend(gA.regulatoryComplexity ?? 0.05, gB.regulatoryComplexity ?? 0.05),
      devTiming: blend(gA.devTiming ?? 0.5, gB.devTiming ?? 0.5),
      growthRate: blend(gA.growthRate ?? 0.5, gB.growthRate ?? 0.5),
      dnaRepair: blend(gA.dnaRepair ?? 0.1, gB.dnaRepair ?? 0.1),
      immuneBits: this._crossoverBits(gA.immuneBits ?? 0, gB.immuneBits ?? 0, 12),
      immuneStrength: blend(gA.immuneStrength ?? 0.1, gB.immuneStrength ?? 0.1),
      signaling: blend(gA.signaling ?? 0.05, gB.signaling ?? 0.05),
      signalBits: this._crossoverBits(gA.signalBits ?? 0, gB.signalBits ?? 0, 8),
      hgt: pick(gA.hgt ?? 0.05, gB.hgt ?? 0.05),
      plasticity: blend(gA.plasticity ?? 0.15, gB.plasticity ?? 0.15),
      respiration: blend(gA.respiration ?? 0.4, gB.respiration ?? 0.4),
      wasteExpel: blend(gA.wasteExpel ?? 0.3, gB.wasteExpel ?? 0.3),
      curiosity: blend(gA.curiosity ?? 0.3, gB.curiosity ?? 0.3),
      aggression: blend(gA.aggression ?? 0.1, gB.aggression ?? 0.1),
      fear: blend(gA.fear ?? 0.3, gB.fear ?? 0.3),
      territorial: pick(gA.territorial ?? 0.1, gB.territorial ?? 0.1),
      nocturnal: pick(gA.nocturnal ?? 0.1, gB.nocturnal ?? 0.1),
      migratory: blend(gA.migratory ?? 0.1, gB.migratory ?? 0.1),
      nurturing: blend(gA.nurturing ?? 0.1, gB.nurturing ?? 0.1),
      // Epigenetic marks: averaged from both parents, then decayed
      // Sexual reproduction partially resets epigenetic state (reprogramming)
      epiMarks: {
        stressResponse:
          ((gA.epiMarks || {}).stressResponse || 0) * 0.25 + ((gB.epiMarks || {}).stressResponse || 0) * 0.25,
        abundanceMemory:
          ((gA.epiMarks || {}).abundanceMemory || 0) * 0.25 +
          ((gB.epiMarks || {}).abundanceMemory || 0) * 0.25,
        socialPriming:
          ((gA.epiMarks || {}).socialPriming || 0) * 0.25 + ((gB.epiMarks || {}).socialPriming || 0) * 0.25,
        predatorMemory:
          ((gA.epiMarks || {}).predatorMemory || 0) * 0.25 + ((gB.epiMarks || {}).predatorMemory || 0) * 0.25,
        darkAdapt: ((gA.epiMarks || {}).darkAdapt || 0) * 0.25 + ((gB.epiMarks || {}).darkAdapt || 0) * 0.25
      }
    }
    // Apply mutation on top of recombined genome (legacy path — no DNA strand)
    return this._mutateGenome(child, null)
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
