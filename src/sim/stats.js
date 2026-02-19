import { clamp } from './helpers.js'
import {
  ORGANELLE_NUCLEUS,
  ORGANELLE_MITOCHONDRIA,
  ORGANELLE_FLAGELLUM,
  ORGANELLE_RECEPTOR,
  ORGANELLE_VACUOLE,
  ORGANELLE_COUNT
} from './constants.js'

export function installStats(Sim) {
  const P = Sim.prototype

  // Compute normalized genetic distance between two genomes (0..1)
  // Used for speciation detection — when distance exceeds threshold, a new species forms
  const DISTANCE_GENES = [
    'speed',
    'metabolism',
    'sense',
    'adhesion',
    'diet',
    'toughness',
    'flipper',
    'membrane',
    'cilia',
    'spines',
    'flagella',
    'jet',
    'amoeboid',
    'toxin',
    'spike',
    'constrict',
    'elongation',
    'biolum',
    'chloroplast',
    'shell',
    'symbiosis',
    'eyespot',
    'stalk',
    'fragmentation'
  ]

  P._genomeDistance = function (gA, gB) {
    let sum = 0
    for (let i = 0; i < DISTANCE_GENES.length; i++) {
      const k = DISTANCE_GENES[i]
      const d = (gA[k] || 0) - (gB[k] || 0)
      sum += d * d
    }
    return Math.sqrt(sum / DISTANCE_GENES.length)
  }

  // Check if a child genome has diverged enough from its clade founder to speciate
  // Returns the new clade ID if speciation occurs, or the parent clade if not
  P._maybeSpeciate = function (parentClade, childGenome) {
    const node = this.phyloTree.get(parentClade)
    if (!node || !node.founderGenome) return parentClade

    const dist = this._genomeDistance(node.founderGenome, childGenome)
    // Speciation threshold: ~0.18 normalized distance triggers a new species
    // This means ~18% average gene divergence from the founder
    if (dist > 0.18) {
      const newClade = this._nextClade++
      this._registerClade(newClade, childGenome.diet)
      // Record in phylogenetic tree
      this.phyloTree.set(newClade, {
        parentClade,
        founderGenome: { ...childGenome },
        birthTick: this.t,
        extinctTick: null,
        depth: (node.depth || 0) + 1,
        children: []
      })
      // Add child reference to parent node
      if (node.children) node.children.push(newClade)
      else node.children = [newClade]
      return newClade
    }
    return parentClade
  }

  P._registerClade = function (clade, diet) {
    if (!this.cladeRegistry.has(clade)) {
      this.cladeRegistry.set(clade, {
        firstTick: this.t,
        lastTick: this.t,
        peakPop: 1,
        diet,
        maxOrganismSize: 0,
        currentMaxSize: 0,
        totalComplexity: 0
      })
    }
    const entry = this.cladeRegistry.get(clade)
    entry.lastTick = this.t
    entry.diet = diet
  }

  P._updateCladeStats = function () {
    const cellCount = this.cells.length
    const pop = new Map()
    const complexitySum = new Map()
    // At very high pop, skip expensive BFS entirely — use organismSize from cells
    const skipBFS = cellCount > 6000
    const cladeBuckets = skipBFS ? null : new Map()
    const cladeMaxOrgSize = new Map() // fallback: track max organismSize per clade
    for (let i = 0; i < cellCount; i++) {
      const c = this.cells[i]
      pop.set(c.clade, (pop.get(c.clade) || 0) + 1)
      complexitySum.set(c.clade, (complexitySum.get(c.clade) || 0) + c.complexity)
      // Track max organismSize as cheap proxy (always available)
      const prev = cladeMaxOrgSize.get(c.clade) || 0
      if (c.organismSize > prev) cladeMaxOrgSize.set(c.clade, c.organismSize)
      if (!skipBFS && c.linkCount > 0) {
        if (!cladeBuckets.has(c.clade)) cladeBuckets.set(c.clade, [])
        const bucket = cladeBuckets.get(c.clade)
        // Cap bucket size to prevent O(n²) BFS — 200 linked cells per clade is enough
        if (bucket.length < 200) bucket.push(i)
      }
    }

    const cladeMaxSize = new Map()

    if (!skipBFS) {
      const maxDist = this.cfg.linkDist * 2.5
      const maxD2 = maxDist * maxDist

      for (const [clade, indices] of cladeBuckets) {
        const visited = new Uint8Array(indices.length)
        let biggest = 0
        for (let start = 0; start < indices.length; start++) {
          if (visited[start]) continue
          visited[start] = 1
          let size = 1
          const queue = [start]
          while (queue.length > 0) {
            const cur = queue.pop()
            const ci = indices[cur]
            const cx = this.cells[ci].x,
              cy = this.cells[ci].y
            for (let j = 0; j < indices.length; j++) {
              if (visited[j]) continue
              const ji = indices[j]
              let dx = this.cells[ji].x - cx,
                dy = this.cells[ji].y - cy
              if (dx > this.w / 2) dx -= this.w
              else if (dx < -this.w / 2) dx += this.w
              if (dy > this.h / 2) dy -= this.h
              else if (dy < -this.h / 2) dy += this.h
              if (dx * dx + dy * dy <= maxD2) {
                visited[j] = 1
                size++
                queue.push(j)
              }
            }
          }
          if (size > biggest) biggest = size
        }
        cladeMaxSize.set(clade, biggest)
      }
    }

    for (const [clade, count] of pop) {
      const entry = this.cladeRegistry.get(clade)
      if (entry) {
        entry.lastTick = this.t
        if (count > entry.peakPop) entry.peakPop = count
        // Use BFS result if available, otherwise fall back to organismSize proxy
        const orgSize = cladeMaxSize.get(clade) || cladeMaxOrgSize.get(clade) || 0
        entry.currentMaxSize = orgSize
        if (orgSize > entry.maxOrganismSize) entry.maxOrganismSize = orgSize
        entry.totalComplexity = complexitySum.get(clade) || 0
      }
    }
  }

  P.stats = function () {
    const n = this.cells.length || 1
    let a = 0,
      s = 0,
      m = 0
    let totalOrganelles = new Float32Array(ORGANELLE_COUNT)
    let roles = [0, 0, 0, 0]
    let multicellCount = 0
    let dietSum = 0,
      flipperSum = 0,
      membraneSum = 0,
      ciliaSum = 0,
      spinesSum = 0
    let flagellaGSum = 0,
      ciliaGSum = 0,
      jetSum = 0,
      amoeboidSum = 0
    let toxinSum = 0,
      spikeSum = 0,
      constrictSum = 0
    let camoSum = 0,
      toxResistSum = 0
    let elongSum = 0,
      biolumSum = 0,
      vesiclesSum = 0
    let paddleFinSum = 0,
      proboscisSum = 0,
      bodyScaleSum = 0,
      brightnessSum = 0,
      sexualitySum = 0,
      chloroplastSum = 0,
      longevitySum = 0,
      scavengerSum = 0,
      shellSum = 0,
      symbiosisSum = 0,
      eyespotSum = 0,
      stalkSum = 0
    let fragmentationSum = 0,
      propaguleSizeSum = 0,
      driftLoadSum = 0
    let herbivores = 0,
      omnivores = 0,
      carnivores = 0

    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      const g = c.g
      a += g.adhesion
      s += g.speed
      m += g.metabolism
      dietSum += g.diet
      flipperSum += g.flipper
      membraneSum += g.membrane
      ciliaSum += g.cilia
      spinesSum += g.spines
      flagellaGSum += g.flagella || 0
      ciliaGSum += g.cilia || 0
      jetSum += g.jet || 0
      amoeboidSum += g.amoeboid || 0
      toxinSum += g.toxin || 0
      spikeSum += g.spike || 0
      constrictSum += g.constrict || 0
      camoSum += g.camouflage || 0
      toxResistSum += g.toxinResist || 0
      elongSum += g.elongation || 0
      biolumSum += g.biolum || 0
      vesiclesSum += g.vesicles || 0
      paddleFinSum += g.paddleFin || 0
      proboscisSum += g.proboscis || 0
      bodyScaleSum += g.bodyScale || 1
      brightnessSum += g.brightness || 0
      sexualitySum += g.sexuality || 0
      chloroplastSum += g.chloroplast || 0
      longevitySum += g.longevity || 0.5
      scavengerSum += g.scavenger || 0
      shellSum += g.shell || 0
      symbiosisSum += g.symbiosis || 0
      eyespotSum += g.eyespot || 0
      stalkSum += g.stalk || 0
      fragmentationSum += g.fragmentation || 0
      propaguleSizeSum += g.propaguleSize || 0
      driftLoadSum += g.driftLoad || 0
      if (g.diet < 0.3) herbivores++
      else if (g.diet < 0.6) omnivores++
      else carnivores++
      for (let oi = 0; oi < ORGANELLE_COUNT; oi++) {
        totalOrganelles[oi] += c.organelles[oi]
      }
      roles[c.role]++
      if (c.linkCount > 0) multicellCount++
    }

    return {
      t: this.t,
      pop: this.cells.length,
      links: this.links.length,
      meanAdhesion: a / n,
      meanSpeed: s / n,
      meanMetabolism: m / n,
      season: this.season,
      seasonProgress: this.seasonTick / this.cfg.seasonLength,
      meanNucleus: totalOrganelles[ORGANELLE_NUCLEUS] / n,
      meanMito: totalOrganelles[ORGANELLE_MITOCHONDRIA] / n,
      meanFlagella: totalOrganelles[ORGANELLE_FLAGELLUM] / n,
      meanReceptor: totalOrganelles[ORGANELLE_RECEPTOR] / n,
      meanVacuole: totalOrganelles[ORGANELLE_VACUOLE] / n,
      rolesNone: roles[0],
      rolesEdge: roles[1],
      rolesInterior: roles[2],
      rolesPioneer: roles[3],
      multicellFraction: multicellCount / n,
      gradientPeak: this.gradientPeak,
      meanDiet: dietSum / n,
      herbivores,
      omnivores,
      carnivores,
      meanFlipper: flipperSum / n,
      meanMembrane: membraneSum / n,
      meanCilia: ciliaSum / n,
      meanSpines: spinesSum / n,
      kills: this.killCount,
      cladeRegistry: this.cladeRegistry,
      foodChain: this.foodChain,
      meanFlagellaG: flagellaGSum / n,
      meanCiliaG: ciliaGSum / n,
      meanJet: jetSum / n,
      meanAmoeboid: amoeboidSum / n,
      meanToxin: toxinSum / n,
      meanSpike: spikeSum / n,
      meanConstrict: constrictSum / n,
      meanCamo: camoSum / n,
      meanToxResist: toxResistSum / n,
      meanElongation: elongSum / n,
      meanBiolum: biolumSum / n,
      meanVesicles: vesiclesSum / n,
      meanPaddleFin: paddleFinSum / n,
      meanProboscis: proboscisSum / n,
      meanBodyScale: bodyScaleSum / n,
      meanBrightness: brightnessSum / n,
      meanSexuality: sexualitySum / n,
      meanChloroplast: chloroplastSum / n,
      meanLongevity: longevitySum / n,
      meanScavenger: scavengerSum / n,
      meanShell: shellSum / n,
      meanSymbiosis: symbiosisSum / n,
      meanEyespot: eyespotSum / n,
      meanStalk: stalkSum / n,
      meanFragmentation: fragmentationSum / n,
      meanPropaguleSize: propaguleSizeSum / n,
      meanDriftLoad: driftLoadSum / n,
      dayPhase: this.dayPhase || 0,
      dayCount: this.dayCount || 0,
      sunIntensity: this.sunIntensity || 1.0,
      organismCount: this.organismCount || this.cells.length
    }
  }

  P.densestRegion = function () {
    const binsX = 18
    const binsY = 14
    const counts = new Uint16Array(binsX * binsY)
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      const bx = clamp(((c.x / this.w) * binsX) | 0, 0, binsX - 1)
      const by = clamp(((c.y / this.h) * binsY) | 0, 0, binsY - 1)
      counts[bx + by * binsX]++
    }
    let best = 0,
      bi = 0
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > best) {
        best = counts[i]
        bi = i
      }
    }
    const bx = bi % binsX
    const by = (bi / binsX) | 0
    return {
      x: ((bx + 0.5) / binsX) * this.w,
      y: ((by + 0.5) / binsY) * this.h,
      density: best
    }
  }
}
