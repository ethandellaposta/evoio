// ══════════════════════════════════════════════════════════════════════════════
// Science Tools — Data export, population genetics, and analysis utilities
// for turning EvoIO into a publication-grade research instrument.
// ══════════════════════════════════════════════════════════════════════════════

import { strandStats, TRAIT_SLOTS } from './sim/dna.js'

// ── Helper: trigger file download ──
function downloadFile(content, filename, mime) {
  const dataUri = 'data:' + (mime || 'text/plain') + ';charset=utf-8,' + encodeURIComponent(content)
  const a = document.createElement('a')
  a.setAttribute('href', dataUri)
  a.setAttribute('download', filename)
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. CSV Time-Series Export
// ══════════════════════════════════════════════════════════════════════════════
// Exports the full history of population-level statistics as a CSV file.
// One row per sample point, columns for every tracked metric.

export function exportTimeSeriesCSV(history, sim) {
  if (!history || !history.t || history.t.length === 0) {
    alert('No time-series data collected yet. Let the simulation run first.')
    return
  }

  const keys = Object.keys(history)
  const header = keys.join(',')
  const rows = []
  for (let i = 0; i < history.t.length; i++) {
    const row = keys.map((k) => {
      const v = history[k][i]
      return v !== undefined && v !== null ? v : ''
    })
    rows.push(row.join(','))
  }

  const csv = header + '\n' + rows.join('\n')
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  downloadFile(csv, `evoio-timeseries-t${sim.t}-${ts}.csv`, 'text/csv')
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Per-Organism Snapshot Export
// ══════════════════════════════════════════════════════════════════════════════
// Exports every living cell with its full genome, position, energy, lineage.

export function exportCellSnapshotCSV(sim) {
  if (!sim.cells || sim.cells.length === 0) {
    alert('No cells in simulation.')
    return
  }

  // Build header: fixed fields + all genome trait fields
  const fixedFields = [
    'id',
    'clade',
    'x',
    'y',
    'vx',
    'vy',
    'energy',
    'age',
    'linkCount',
    'role',
    'complexity',
    'organismSize',
    'organismDepth',
    'divisionCount',
    'senescence',
    'o2Store',
    'waste',
    'foragingEff',
    'explorationScore',
    'cooperationScore',
    'behavioralFitness',
    'lifetimeEnergyGain',
    'lifetimeMoveDist',
    'peakEnergy'
  ]

  // Genome fields from the first cell
  const genomeFields = []
  const firstG = sim.cells[0].g
  for (const k of Object.keys(firstG)) {
    if (
      k === 'epiMarks' ||
      k === 'receptorBits' ||
      k === 'ligandBits' ||
      k === 'immuneBits' ||
      k === 'signalBits'
    )
      continue
    genomeFields.push(k)
  }

  // DNA stats fields
  const dnaFields = ['dna_length', 'dna_geneCount', 'dna_codingFraction', 'dna_junkFraction']

  const header = [...fixedFields, ...genomeFields.map((k) => `g_${k}`), ...dnaFields].join(',')

  const rows = []
  for (let i = 0; i < sim.cells.length; i++) {
    const c = sim.cells[i]
    const fixed = fixedFields.map((f) => {
      const v = c[f]
      return v !== undefined && v !== null ? v : ''
    })

    const genome = genomeFields.map((f) => {
      const v = c.g[f]
      return v !== undefined && v !== null ? v : ''
    })

    // DNA strand statistics
    let dnaVals
    if (c.dna) {
      const ds = strandStats(c.dna)
      dnaVals = [ds.length, ds.geneCount, ds.codingFraction.toFixed(4), ds.junkFraction.toFixed(4)]
    } else {
      dnaVals = ['', '', '', '']
    }

    rows.push([...fixed, ...genome, ...dnaVals].join(','))
  }

  const csv = header + '\n' + rows.join('\n')
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  downloadFile(csv, `evoio-cells-t${sim.t}-${ts}.csv`, 'text/csv')
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. Phylogenetic Tree Newick Export
// ══════════════════════════════════════════════════════════════════════════════
// Converts the internal phyloTree Map to Newick format for use in R/Python
// phylogenetics packages (ape, dendropy, ETE3, etc.)

export function exportPhyloNewick(sim, cladeNames) {
  if (!sim.phyloTree || sim.phyloTree.size === 0) {
    alert('No phylogenetic tree data yet.')
    return
  }

  // Find alive clades
  const aliveClades = new Set()
  for (let i = 0; i < sim.cells.length; i++) aliveClades.add(sim.cells[i].clade)

  // Count living descendants for pruning
  const livingDesc = new Map()
  function countLiving(clade) {
    if (livingDesc.has(clade)) return livingDesc.get(clade)
    let count = aliveClades.has(clade) ? 1 : 0
    const node = sim.phyloTree.get(clade)
    if (node && node.children) {
      for (const child of node.children) count += countLiving(child)
    }
    livingDesc.set(clade, count)
    return count
  }

  // Find roots
  const roots = []
  for (const [clade, node] of sim.phyloTree) {
    if (node.parentClade === null || node.parentClade === undefined) {
      roots.push(clade)
    }
  }
  for (const r of roots) countLiving(r)

  // Build Newick string recursively
  function toNewick(clade) {
    const node = sim.phyloTree.get(clade)
    const kids = node && node.children ? node.children.filter((c) => (livingDesc.get(c) || 0) > 0) : []

    // Get name
    let name = ''
    if (cladeNames && cladeNames.has(clade)) {
      const entry = cladeNames.get(clade)
      name = (entry.scientificName || entry.displayName || `clade_${clade}`).replace(/[^a-zA-Z0-9_.]/g, '_')
    } else {
      name = `clade_${clade}`
    }

    // Branch length = ticks since parent
    const parentNode = node && node.parentClade != null ? sim.phyloTree.get(node.parentClade) : null
    const parentBirth = parentNode ? parentNode.birthTick || 0 : 0
    const branchLen = (node ? node.birthTick || 0 : 0) - parentBirth

    if (kids.length === 0) {
      // Leaf
      return `${name}:${Math.max(0, branchLen)}`
    }

    const childStrs = kids.map((k) => toNewick(k))
    return `(${childStrs.join(',')})${name}:${Math.max(0, branchLen)}`
  }

  // Build tree for each root that has living descendants
  const activeRoots = roots.filter((r) => (livingDesc.get(r) || 0) > 0)
  let newick
  if (activeRoots.length === 1) {
    newick = toNewick(activeRoots[0]) + ';'
  } else if (activeRoots.length > 1) {
    const rootStrs = activeRoots.map((r) => toNewick(r))
    newick = `(${rootStrs.join(',')});`
  } else {
    alert('No active lineages to export.')
    return
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  downloadFile(newick, `evoio-phylo-t${sim.t}-${ts}.nwk`, 'text/plain')
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Genome Detail Export (single organism's raw DNA + annotations)
// ══════════════════════════════════════════════════════════════════════════════

export function exportGenomeDetail(cell, cladeName) {
  if (!cell || !cell.dna) {
    alert('Selected cell has no DNA strand data.')
    return
  }

  const ds = strandStats(cell.dna)
  const strand = Array.from(cell.dna)

  const output = {
    cellId: cell.id,
    clade: cell.clade,
    cladeName: cladeName || `clade_${cell.clade}`,
    age: cell.age,
    energy: cell.energy,
    strandLength: ds.length,
    geneCount: ds.geneCount,
    codingBases: ds.codingBases,
    codingFraction: ds.codingFraction,
    junkFraction: ds.junkFraction,
    phenotype: { ...cell.g },
    rawStrand: strand
  }

  const json = JSON.stringify(output, null, 2)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  downloadFile(json, `evoio-genome-cell${cell.id}-${ts}.json`, 'application/json')
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. Experiment Log
// ══════════════════════════════════════════════════════════════════════════════

export class ExperimentLog {
  constructor() {
    this.entries = []
    this.startTime = new Date().toISOString()
  }

  log(type, data) {
    this.entries.push({
      wallTime: new Date().toISOString(),
      simTick: data.tick || 0,
      type,
      ...data
    })
  }

  logParamChange(tick, param, oldVal, newVal) {
    this.log('param_change', { tick, param, oldVal, newVal })
  }

  logEvent(tick, event, details) {
    this.log('event', { tick, event, details })
  }

  logReset(tick, seed, config) {
    this.log('reset', { tick, seed, config: { ...config } })
  }

  export(sim) {
    const output = {
      experimentStart: this.startTime,
      exportTime: new Date().toISOString(),
      finalTick: sim.t,
      totalEntries: this.entries.length,
      entries: this.entries
    }
    const json = JSON.stringify(output, null, 2)
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    downloadFile(json, `evoio-experiment-log-${ts}.json`, 'application/json')
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. Population Genetics Metrics
// ══════════════════════════════════════════════════════════════════════════════

export function computePopGenMetrics(sim) {
  const cells = sim.cells
  const n = cells.length
  if (n < 2) return null

  // ── Trait-level allele frequency statistics ──
  const traitKeys = [
    'speed',
    'metabolism',
    'sense',
    'adhesion',
    'division',
    'diet',
    'flagella',
    'cilia',
    'jet',
    'amoeboid',
    'toxin',
    'spike',
    'constrict',
    'membrane',
    'spines',
    'camouflage',
    'toxinResist',
    'elongation',
    'biolum',
    'chloroplast',
    'shell',
    'symbiosis',
    'eyespot',
    'stalk',
    'sexuality',
    'boldness',
    'sociality',
    'mutRate'
  ]

  // Compute mean and variance for each trait
  const traitStats = {}
  for (const k of traitKeys) {
    let sum = 0,
      sum2 = 0
    for (let i = 0; i < n; i++) {
      const v = cells[i].g[k] || 0
      sum += v
      sum2 += v * v
    }
    const mean = sum / n
    const variance = sum2 / n - mean * mean
    traitStats[k] = { mean, variance, sd: Math.sqrt(Math.max(0, variance)) }
  }

  // ── Heterozygosity (trait-level analog) ──
  // Expected heterozygosity: He = 1 - sum(pi^2) where pi = frequency of each "allele"
  // We discretize continuous traits into 10 bins to compute allele frequencies
  let totalHe = 0
  for (const k of traitKeys) {
    const bins = new Float64Array(10)
    for (let i = 0; i < n; i++) {
      const v = Math.min(0.999, Math.max(0, cells[i].g[k] || 0))
      const bin = Math.floor(v * 10)
      bins[bin]++
    }
    let sumPi2 = 0
    for (let b = 0; b < 10; b++) {
      const pi = bins[b] / n
      sumPi2 += pi * pi
    }
    totalHe += 1 - sumPi2
  }
  const meanHeterozygosity = totalHe / traitKeys.length

  // ── Nucleotide diversity (pi) — average pairwise distance ──
  // Sample-based: pick up to 200 random pairs to avoid O(n^2)
  const maxPairs = Math.min(200, (n * (n - 1)) / 2)
  let piSum = 0
  let pairCount = 0
  for (let p = 0; p < maxPairs; p++) {
    const i = Math.floor(Math.random() * n)
    let j = Math.floor(Math.random() * (n - 1))
    if (j >= i) j++
    let dist = 0
    for (const k of traitKeys) {
      const d = (cells[i].g[k] || 0) - (cells[j].g[k] || 0)
      dist += d * d
    }
    piSum += Math.sqrt(dist / traitKeys.length)
    pairCount++
  }
  const nucleotideDiversity = pairCount > 0 ? piSum / pairCount : 0

  // ── Fst between clades (population differentiation) ──
  // Fst = (Ht - Hs) / Ht where Ht = total heterozygosity, Hs = mean within-subpop heterozygosity
  const cladePops = new Map()
  for (let i = 0; i < n; i++) {
    const cl = cells[i].clade
    if (!cladePops.has(cl)) cladePops.set(cl, [])
    cladePops.get(cl).push(i)
  }

  let Hs = 0
  let cladeCount = 0
  for (const [, indices] of cladePops) {
    if (indices.length < 2) continue
    let subHe = 0
    for (const k of traitKeys) {
      const bins = new Float64Array(10)
      for (const idx of indices) {
        const v = Math.min(0.999, Math.max(0, cells[idx].g[k] || 0))
        bins[Math.floor(v * 10)]++
      }
      let sumPi2 = 0
      for (let b = 0; b < 10; b++) {
        const pi = bins[b] / indices.length
        sumPi2 += pi * pi
      }
      subHe += 1 - sumPi2
    }
    Hs += subHe / traitKeys.length
    cladeCount++
  }
  Hs = cladeCount > 0 ? Hs / cladeCount : 0
  const Fst = meanHeterozygosity > 0 ? (meanHeterozygosity - Hs) / meanHeterozygosity : 0

  // ── Effective population size (Ne) estimate ──
  // Using the variance in reproductive success proxy: Ne ≈ N / (1 + Var(k)/mean(k))
  // We use divisionCount as a proxy for reproductive success
  let sumK = 0,
    sumK2 = 0
  for (let i = 0; i < n; i++) {
    const k = cells[i].divisionCount || 0
    sumK += k
    sumK2 += k * k
  }
  const meanK = sumK / n
  const varK = sumK2 / n - meanK * meanK
  const Ne = meanK > 0 ? Math.round(n / (1 + varK / meanK)) : n

  // ── Fitness variance ──
  // Using energy as fitness proxy
  let sumE = 0,
    sumE2 = 0
  for (let i = 0; i < n; i++) {
    sumE += cells[i].energy
    sumE2 += cells[i].energy * cells[i].energy
  }
  const meanFitness = sumE / n
  const fitnessVariance = sumE2 / n - meanFitness * meanFitness

  // ── Species count and Shannon diversity ──
  const speciesCounts = new Map()
  for (let i = 0; i < n; i++) {
    const cl = cells[i].clade
    speciesCounts.set(cl, (speciesCounts.get(cl) || 0) + 1)
  }
  const speciesCount = speciesCounts.size
  let shannonH = 0
  for (const [, count] of speciesCounts) {
    const p = count / n
    if (p > 0) shannonH -= p * Math.log(p)
  }

  // ── Mean generation time ──
  let sumAge = 0,
    dividers = 0
  for (let i = 0; i < n; i++) {
    if (cells[i].divisionCount > 0) {
      sumAge += cells[i].age / cells[i].divisionCount
      dividers++
    }
  }
  const meanGenerationTime = dividers > 0 ? sumAge / dividers : 0

  return {
    populationSize: n,
    effectivePopSize: Ne,
    speciesCount,
    shannonDiversity: shannonH,
    meanHeterozygosity,
    nucleotideDiversity,
    Fst,
    meanFitness,
    fitnessVariance,
    fitnessSD: Math.sqrt(Math.max(0, fitnessVariance)),
    meanGenerationTime,
    traitStats
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. Allele Frequency Tracking
// ══════════════════════════════════════════════════════════════════════════════

export class AlleleTracker {
  constructor(maxHistory = 600) {
    this.maxHistory = maxHistory
    this.trackedTraits = [
      'speed',
      'adhesion',
      'diet',
      'metabolism',
      'sense',
      'flagella',
      'cilia',
      'toxin',
      'membrane',
      'shell',
      'sexuality',
      'chloroplast',
      'elongation',
      'boldness',
      'sociality'
    ]
    this.history = { t: [] }
    for (const k of this.trackedTraits) {
      this.history[`${k}_mean`] = []
      this.history[`${k}_sd`] = []
    }
    // Pop-gen metrics history
    this.history.heterozygosity = []
    this.history.Fst = []
    this.history.Ne = []
    this.history.shannonH = []
    this.history.nucleotideDiversity = []
  }

  record(sim, popGenMetrics) {
    this.history.t.push(sim.t)

    const n = sim.cells.length
    if (n === 0) {
      for (const k of this.trackedTraits) {
        this.history[`${k}_mean`].push(0)
        this.history[`${k}_sd`].push(0)
      }
      this.history.heterozygosity.push(0)
      this.history.Fst.push(0)
      this.history.Ne.push(0)
      this.history.shannonH.push(0)
      this.history.nucleotideDiversity.push(0)
    } else {
      for (const k of this.trackedTraits) {
        let sum = 0,
          sum2 = 0
        for (let i = 0; i < n; i++) {
          const v = sim.cells[i].g[k] || 0
          sum += v
          sum2 += v * v
        }
        const mean = sum / n
        const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean))
        this.history[`${k}_mean`].push(mean)
        this.history[`${k}_sd`].push(sd)
      }

      if (popGenMetrics) {
        this.history.heterozygosity.push(popGenMetrics.meanHeterozygosity)
        this.history.Fst.push(popGenMetrics.Fst)
        this.history.Ne.push(popGenMetrics.effectivePopSize)
        this.history.shannonH.push(popGenMetrics.shannonDiversity)
        this.history.nucleotideDiversity.push(popGenMetrics.nucleotideDiversity)
      } else {
        this.history.heterozygosity.push(0)
        this.history.Fst.push(0)
        this.history.Ne.push(0)
        this.history.shannonH.push(0)
        this.history.nucleotideDiversity.push(0)
      }
    }

    // Trim
    if (this.history.t.length > this.maxHistory) {
      for (const key of Object.keys(this.history)) this.history[key].shift()
    }
  }

  exportCSV(sim) {
    if (this.history.t.length === 0) {
      alert('No allele frequency data collected yet.')
      return
    }
    const keys = Object.keys(this.history)
    const header = keys.join(',')
    const rows = []
    for (let i = 0; i < this.history.t.length; i++) {
      const row = keys.map((k) => {
        const v = this.history[k][i]
        return v !== undefined && v !== null ? (typeof v === 'number' ? v.toFixed(6) : v) : ''
      })
      rows.push(row.join(','))
    }
    const csv = header + '\n' + rows.join('\n')
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    downloadFile(csv, `evoio-alleles-t${sim.t}-${ts}.csv`, 'text/csv')
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. Muller Plot Data (clade frequency over time)
// ══════════════════════════════════════════════════════════════════════════════

export class MullerTracker {
  constructor(maxHistory = 600) {
    this.maxHistory = maxHistory
    this.ticks = []
    this.cladeFreqs = [] // array of Map<clade, fraction>
    this.allClades = new Set()
  }

  record(sim) {
    const n = sim.cells.length
    if (n === 0) return

    const counts = new Map()
    for (let i = 0; i < n; i++) {
      const cl = sim.cells[i].clade
      counts.set(cl, (counts.get(cl) || 0) + 1)
    }

    const freqs = new Map()
    for (const [cl, count] of counts) {
      freqs.set(cl, count / n)
      this.allClades.add(cl)
    }

    this.ticks.push(sim.t)
    this.cladeFreqs.push(freqs)

    if (this.ticks.length > this.maxHistory) {
      this.ticks.shift()
      this.cladeFreqs.shift()
    }
  }

  // Get sorted clade list (by total frequency across all time points)
  getSortedClades() {
    const totalFreq = new Map()
    for (const freqs of this.cladeFreqs) {
      for (const [cl, f] of freqs) {
        totalFreq.set(cl, (totalFreq.get(cl) || 0) + f)
      }
    }
    return [...totalFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cl]) => cl)
      .slice(0, 20) // cap at top 20 clades
  }

  exportCSV(sim) {
    if (this.ticks.length === 0) {
      alert('No Muller plot data collected yet.')
      return
    }
    const clades = this.getSortedClades()
    const header = ['tick', ...clades.map((cl) => `clade_${cl}`)].join(',')
    const rows = []
    for (let i = 0; i < this.ticks.length; i++) {
      const freqs = this.cladeFreqs[i]
      const row = [this.ticks[i], ...clades.map((cl) => (freqs.get(cl) || 0).toFixed(6))]
      rows.push(row.join(','))
    }
    const csv = header + '\n' + rows.join('\n')
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    downloadFile(csv, `evoio-muller-t${sim.t}-${ts}.csv`, 'text/csv')
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. Muller Plot Renderer
// ══════════════════════════════════════════════════════════════════════════════

export function drawMullerPlot(canvas, mullerTracker, cladeColorFn) {
  if (!canvas || !mullerTracker || mullerTracker.ticks.length < 2) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr
    canvas.height = ch * dpr
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)

  const pad = { l: 30, r: 6, t: 18, b: 16 }
  const gw = cw - pad.l - pad.r
  const gh = ch - pad.t - pad.b

  const clades = mullerTracker.getSortedClades()
  const n = mullerTracker.ticks.length

  if (clades.length === 0 || n < 2) {
    ctx.fillStyle = 'rgba(140,155,183,0.4)'
    ctx.font = '10px ui-sans-serif,system-ui,sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Collecting Muller data...', cw / 2, ch / 2)
    return
  }

  // Compute stacked values
  const stacks = [] // stacks[timeIdx][cladeLayerIdx] = cumulative fraction
  for (let i = 0; i < n; i++) {
    const freqs = mullerTracker.cladeFreqs[i]
    let cum = 0
    const row = [0]
    for (const cl of clades) {
      cum += freqs.get(cl) || 0
      row.push(cum)
    }
    stacks.push(row)
  }

  // Background grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 0.5
  for (let gi = 0; gi <= 4; gi++) {
    const gy = pad.t + gh * (1 - gi / 4)
    ctx.beginPath()
    ctx.moveTo(pad.l, gy)
    ctx.lineTo(pad.l + gw, gy)
    ctx.stroke()
  }

  // Y-axis labels
  ctx.fillStyle = 'rgba(140,155,183,0.5)'
  ctx.font = '8px ui-sans-serif,system-ui,sans-serif'
  ctx.textAlign = 'right'
  for (let gi = 0; gi <= 4; gi++) {
    const val = ((gi / 4) * 100).toFixed(0) + '%'
    const gy = pad.t + gh * (1 - gi / 4)
    ctx.fillText(val, pad.l - 3, gy + 3)
  }

  // X-axis
  ctx.textAlign = 'center'
  ctx.fillText(`${mullerTracker.ticks[0]}`, pad.l, ch - 2)
  ctx.fillText(`${mullerTracker.ticks[n - 1]}`, pad.l + gw, ch - 2)

  // Title
  ctx.fillStyle = 'rgba(200,210,230,0.7)'
  ctx.font = '9px ui-sans-serif,system-ui,sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`Muller Plot (${clades.length} clades)`, pad.l, pad.t - 5)

  // Draw stacked areas (bottom to top)
  for (let li = clades.length - 1; li >= 0; li--) {
    const cl = clades[li]
    const color = cladeColorFn ? cladeColorFn(cl) : `hsl(${(cl * 137) % 360}, 65%, 55%)`

    ctx.beginPath()
    // Top edge
    for (let i = 0; i < n; i++) {
      const x = pad.l + (i / (n - 1)) * gw
      const y = pad.t + gh * (1 - stacks[i][li + 1])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    // Bottom edge (reverse)
    for (let i = n - 1; i >= 0; i--) {
      const x = pad.l + (i / (n - 1)) * gw
      const y = pad.t + gh * (1 - stacks[i][li])
      ctx.lineTo(x, y)
    }
    ctx.closePath()

    // Parse color and add alpha
    ctx.fillStyle = color.replace(')', ', 0.5)').replace('hsl(', 'hsla(').replace('rgb(', 'rgba(')
    if (!ctx.fillStyle.includes('a(')) ctx.fillStyle = color
    ctx.globalAlpha = 0.6
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. Pop-Gen Metrics Panel Renderer
// ══════════════════════════════════════════════════════════════════════════════

export function drawPopGenPanel(canvas, alleleTracker) {
  if (!canvas || !alleleTracker || alleleTracker.history.t.length < 2) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr
    canvas.height = ch * dpr
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)

  const pad = { l: 30, r: 6, t: 18, b: 16 }
  const gw = cw - pad.l - pad.r
  const gh = ch - pad.t - pad.b
  const h = alleleTracker.history
  const n = h.t.length

  // Draw multiple metrics as overlaid lines
  const metrics = [
    { key: 'heterozygosity', color: '#4fc3f7', label: 'He' },
    { key: 'Fst', color: '#ef5350', label: 'Fst' },
    { key: 'nucleotideDiversity', color: '#81c784', label: 'pi' },
    { key: 'shannonH', color: '#ffb74d', label: "H'" }
  ]

  // Find max across all metrics for scaling
  let maxVal = 0.01
  for (const m of metrics) {
    for (let i = 0; i < n; i++) {
      const v = h[m.key][i] || 0
      if (v > maxVal) maxVal = v
    }
  }

  // Background grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 0.5
  for (let gi = 0; gi <= 4; gi++) {
    const gy = pad.t + gh * (1 - gi / 4)
    ctx.beginPath()
    ctx.moveTo(pad.l, gy)
    ctx.lineTo(pad.l + gw, gy)
    ctx.stroke()
  }

  // Y-axis
  ctx.fillStyle = 'rgba(140,155,183,0.5)'
  ctx.font = '8px ui-sans-serif,system-ui,sans-serif'
  ctx.textAlign = 'right'
  for (let gi = 0; gi <= 4; gi++) {
    const val = (maxVal * gi) / 4
    const gy = pad.t + gh * (1 - gi / 4)
    ctx.fillText(val.toFixed(2), pad.l - 3, gy + 3)
  }

  // X-axis
  ctx.textAlign = 'center'
  ctx.fillText(`${h.t[0]}`, pad.l, ch - 2)
  ctx.fillText(`${h.t[n - 1]}`, pad.l + gw, ch - 2)

  // Title
  ctx.fillStyle = 'rgba(200,210,230,0.7)'
  ctx.font = '9px ui-sans-serif,system-ui,sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('Population Genetics', pad.l, pad.t - 5)

  // Draw each metric line
  for (const m of metrics) {
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = pad.l + (i / (n - 1)) * gw
      const y = pad.t + gh * (1 - (h[m.key][i] || 0) / maxVal)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = m.color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  // Legend
  ctx.font = '7px ui-sans-serif,system-ui,sans-serif'
  const legendX = pad.l + gw - 70
  for (let li = 0; li < metrics.length; li++) {
    const m = metrics[li]
    const ly = pad.t + 2 + li * 10
    ctx.fillStyle = m.color
    ctx.fillRect(legendX, ly, 6, 6)
    ctx.globalAlpha = 0.8
    ctx.textAlign = 'left'
    const lastVal = h[m.key][n - 1] || 0
    ctx.fillText(`${m.label} ${lastVal.toFixed(3)}`, legendX + 9, ly + 5.5)
    ctx.globalAlpha = 1
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 11. Genome Browser Data (for rendering a cell's DNA strand)
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 12. Selection Coefficient Estimation
// ══════════════════════════════════════════════════════════════════════════════
// Estimates selection coefficients from allele frequency changes over time.
// Uses the delta-p method: s ≈ Δp / (p * q * generationTime)
// where p = allele frequency, q = 1-p, Δp = change per tick interval.

export class SelectionTracker {
  constructor(windowSize = 60) {
    this.windowSize = windowSize // number of samples to use for estimation
    this.trackedTraits = [
      'speed',
      'adhesion',
      'diet',
      'metabolism',
      'sense',
      'flagella',
      'cilia',
      'toxin',
      'membrane',
      'shell',
      'sexuality',
      'chloroplast',
      'elongation',
      'boldness',
      'sociality'
    ]
    this.history = { t: [] }
    for (const k of this.trackedTraits) {
      this.history[`${k}_mean`] = []
    }
    this.selectionCoeffs = {} // latest estimated s for each trait
  }

  record(sim) {
    const n = sim.cells.length
    if (n < 2) return

    this.history.t.push(sim.t)
    for (const k of this.trackedTraits) {
      let sum = 0
      for (let i = 0; i < n; i++) sum += sim.cells[i].g[k] || 0
      this.history[`${k}_mean`].push(sum / n)
    }

    // Trim to window
    if (this.history.t.length > this.windowSize * 2) {
      for (const key of Object.keys(this.history)) this.history[key].shift()
    }

    // Estimate selection coefficients using linear regression of Δp/p(1-p)
    this._estimateCoeffs()
  }

  _estimateCoeffs() {
    const h = this.history
    const len = h.t.length
    if (len < 10) return // need enough data points

    const window = Math.min(this.windowSize, len - 1)
    const startIdx = len - 1 - window

    for (const k of this.trackedTraits) {
      const means = h[`${k}_mean`]
      let sumS = 0
      let count = 0

      for (let i = startIdx + 1; i < len; i++) {
        const p = means[i - 1]
        const pNext = means[i]
        const q = 1 - p
        // Avoid division by zero near fixation/loss
        if (p < 0.02 || p > 0.98 || q < 0.02) continue
        const deltaP = pNext - p
        const dt = h.t[i] - h.t[i - 1]
        if (dt <= 0) continue
        // s ≈ Δp / (p * q) normalized per tick
        const sEst = deltaP / (p * q)
        sumS += sEst
        count++
      }

      this.selectionCoeffs[k] = count > 0 ? sumS / count : 0
    }
  }

  // Get sorted selection coefficients (strongest selection first)
  getSorted() {
    return Object.entries(this.selectionCoeffs)
      .map(([trait, s]) => ({ trait, s, absS: Math.abs(s) }))
      .sort((a, b) => b.absS - a.absS)
  }

  exportCSV(sim) {
    const sorted = this.getSorted()
    if (sorted.length === 0) {
      alert('No selection coefficient data yet. Let the simulation run.')
      return
    }
    const header = 'trait,selection_coefficient,direction,abs_s'
    const rows = sorted.map(
      ({ trait, s, absS }) =>
        `${trait},${s.toFixed(6)},${s > 0 ? 'positive' : s < 0 ? 'negative' : 'neutral'},${absS.toFixed(6)}`
    )
    const csv = header + '\n' + rows.join('\n')
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    downloadFile(csv, `evoio-selection-t${sim.t}-${ts}.csv`, 'text/csv')
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 13. Environment Scripting Engine
// ══════════════════════════════════════════════════════════════════════════════
// Simple event system: schedule parameter changes at specific ticks.
// Events: { tick, action, params }
// Actions: 'set_param', 'set_food', 'set_mutation', 'knockout', 'restore_gene',
//          'inject_organism', 'log_snapshot'

export class EnvironmentScript {
  constructor() {
    this.events = [] // scheduled events (sorted by tick)
    this.executed = [] // already-fired events
    this.repeating = [] // { every, action, params, lastFired }
    this.active = true
  }

  // Schedule a one-time event
  addEvent(tick, action, params = {}) {
    this.events.push({ tick, action, params })
    this.events.sort((a, b) => a.tick - b.tick)
  }

  // Schedule a repeating event
  addRepeating(every, action, params = {}) {
    this.repeating.push({ every, action, params, lastFired: -Infinity })
  }

  // Clear all events
  clear() {
    this.events = []
    this.executed = []
    this.repeating = []
  }

  // Check and fire events for the current tick
  tick(simTick, sim, callbacks) {
    if (!this.active) return

    // One-time events
    while (this.events.length > 0 && this.events[0].tick <= simTick) {
      const evt = this.events.shift()
      this._execute(evt, sim, callbacks)
      this.executed.push({ ...evt, firedAt: simTick })
    }

    // Repeating events
    for (const rep of this.repeating) {
      if (simTick - rep.lastFired >= rep.every) {
        rep.lastFired = simTick
        this._execute({ tick: simTick, action: rep.action, params: rep.params }, sim, callbacks)
      }
    }
  }

  _execute(evt, sim, callbacks) {
    const { action, params } = evt
    switch (action) {
      case 'set_param':
        if (params.key && params.value !== undefined) {
          sim.cfg[params.key] = params.value
        }
        break
      case 'set_food':
        if (params.value !== undefined) sim.cfg.foodGrowth = params.value
        break
      case 'set_mutation':
        if (params.value !== undefined) sim.cfg.mutationRate = params.value
        break
      case 'knockout':
        if (params.trait) {
          sim.geneOverrides[params.trait] = { mode: 'knockout' }
        }
        break
      case 'restore_gene':
        if (params.trait) {
          delete sim.geneOverrides[params.trait]
        }
        break
      case 'log_snapshot':
        if (callbacks && callbacks.onSnapshot) callbacks.onSnapshot(sim)
        break
      default:
        break
    }
  }

  // Parse a simple script text format:
  // "1000 set_food 0.5"
  // "2000 knockout toxin"
  // "every 500 log_snapshot"
  // "5000 set_mutation 0.15"
  parseScript(text) {
    this.clear()
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))

    for (const line of lines) {
      const parts = line.split(/\s+/)
      if (parts.length < 2) continue

      if (parts[0] === 'every') {
        const every = parseInt(parts[1], 10)
        const action = parts[2] || 'log_snapshot'
        const params = this._parseParams(action, parts.slice(3))
        if (!isNaN(every) && every > 0) {
          this.addRepeating(every, action, params)
        }
      } else {
        const tick = parseInt(parts[0], 10)
        const action = parts[1]
        const params = this._parseParams(action, parts.slice(2))
        if (!isNaN(tick)) {
          this.addEvent(tick, action, params)
        }
      }
    }
  }

  _parseParams(action, args) {
    switch (action) {
      case 'set_param':
        return { key: args[0], value: parseFloat(args[1]) }
      case 'set_food':
      case 'set_mutation':
        return { value: parseFloat(args[0]) }
      case 'knockout':
      case 'restore_gene':
        return { trait: args[0] }
      default:
        return {}
    }
  }

  // Export script as text
  toText() {
    const lines = []
    for (const evt of [...this.executed, ...this.events]) {
      const paramStr = this._paramsToStr(evt.action, evt.params)
      lines.push(`${evt.tick} ${evt.action}${paramStr ? ' ' + paramStr : ''}`)
    }
    for (const rep of this.repeating) {
      const paramStr = this._paramsToStr(rep.action, rep.params)
      lines.push(`every ${rep.every} ${rep.action}${paramStr ? ' ' + paramStr : ''}`)
    }
    return lines.join('\n')
  }

  _paramsToStr(action, params) {
    switch (action) {
      case 'set_param':
        return `${params.key} ${params.value}`
      case 'set_food':
      case 'set_mutation':
        return `${params.value}`
      case 'knockout':
      case 'restore_gene':
        return params.trait
      default:
        return ''
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 14. A/B Split World
// ══════════════════════════════════════════════════════════════════════════════
// Divides the world into two halves with independently configurable parameters.
// Tracks divergence metrics between the two populations.

export class SplitWorld {
  constructor() {
    this.active = false
    this.axis = 'x' // 'x' = left/right split, 'y' = top/bottom
    this.barrier = true // whether to block migration between halves
    // Parameter overrides for side B (side A uses sim defaults)
    this.sideB = {
      foodGrowthMult: 1.0,
      mutationRateMult: 1.0,
      metabolismMult: 1.0
    }
    // Tracked divergence metrics
    this.divergence = {
      traitDistance: 0,
      fst: 0,
      popA: 0,
      popB: 0,
      meanFitnessA: 0,
      meanFitnessB: 0
    }
    this.history = { t: [], traitDistance: [], fst: [], popA: [], popB: [] }
    this.maxHistory = 300
  }

  // Determine which side a cell is on
  getSide(cell, sim) {
    if (this.axis === 'x') {
      return cell.x < sim.w / 2 ? 'A' : 'B'
    } else {
      return cell.y < sim.h / 2 ? 'A' : 'B'
    }
  }

  // Apply per-side parameter modifications during simulation step
  getCellMultipliers(cell, sim) {
    if (!this.active) return null
    const side = this.getSide(cell, sim)
    if (side === 'A') return null // side A uses defaults
    return this.sideB
  }

  // Enforce barrier: push cells back if they cross the midline
  enforceBarrier(sim) {
    if (!this.active || !this.barrier) return
    const mid = this.axis === 'x' ? sim.w / 2 : sim.h / 2
    const margin = 3
    for (let i = 0; i < sim.cells.length; i++) {
      const c = sim.cells[i]
      const pos = this.axis === 'x' ? c.x : c.y
      const vel = this.axis === 'x' ? 'vx' : 'vy'
      if (Math.abs(pos - mid) < margin) {
        // Push back to whichever side they were on
        if (pos < mid) {
          if (this.axis === 'x') c.x = mid - margin
          else c.y = mid - margin
        } else {
          if (this.axis === 'x') c.x = mid + margin
          else c.y = mid + margin
        }
        c[vel] *= -0.5 // bounce
      }
    }
  }

  // Compute divergence metrics between the two populations
  computeDivergence(sim) {
    if (!this.active) return

    const traitKeys = [
      'speed',
      'adhesion',
      'diet',
      'metabolism',
      'sense',
      'flagella',
      'toxin',
      'membrane',
      'shell',
      'chloroplast',
      'sexuality',
      'elongation',
      'boldness',
      'sociality'
    ]

    const cellsA = []
    const cellsB = []
    for (let i = 0; i < sim.cells.length; i++) {
      if (this.getSide(sim.cells[i], sim) === 'A') cellsA.push(sim.cells[i])
      else cellsB.push(sim.cells[i])
    }

    this.divergence.popA = cellsA.length
    this.divergence.popB = cellsB.length

    if (cellsA.length < 2 || cellsB.length < 2) return

    // Mean trait vectors
    const meanA = {}
    const meanB = {}
    for (const k of traitKeys) {
      let sA = 0,
        sB = 0
      for (const c of cellsA) sA += c.g[k] || 0
      for (const c of cellsB) sB += c.g[k] || 0
      meanA[k] = sA / cellsA.length
      meanB[k] = sB / cellsB.length
    }

    // Euclidean distance between mean trait vectors
    let dist2 = 0
    for (const k of traitKeys) {
      const d = meanA[k] - meanB[k]
      dist2 += d * d
    }
    this.divergence.traitDistance = Math.sqrt(dist2 / traitKeys.length)

    // Mean fitness (energy)
    let eA = 0,
      eB = 0
    for (const c of cellsA) eA += c.energy
    for (const c of cellsB) eB += c.energy
    this.divergence.meanFitnessA = eA / cellsA.length
    this.divergence.meanFitnessB = eB / cellsB.length

    // Fst between the two sides
    let totalHe = 0,
      hsA = 0,
      hsB = 0
    for (const k of traitKeys) {
      // Total heterozygosity
      const binsT = new Float64Array(10)
      const binsA = new Float64Array(10)
      const binsB = new Float64Array(10)
      const nT = cellsA.length + cellsB.length
      for (const c of cellsA) {
        const v = Math.min(0.999, Math.max(0, c.g[k] || 0))
        const bin = Math.floor(v * 10)
        binsT[bin]++
        binsA[bin]++
      }
      for (const c of cellsB) {
        const v = Math.min(0.999, Math.max(0, c.g[k] || 0))
        const bin = Math.floor(v * 10)
        binsT[bin]++
        binsB[bin]++
      }
      let pi2T = 0,
        pi2A = 0,
        pi2B = 0
      for (let b = 0; b < 10; b++) {
        pi2T += (binsT[b] / nT) ** 2
        pi2A += (binsA[b] / cellsA.length) ** 2
        pi2B += (binsB[b] / cellsB.length) ** 2
      }
      totalHe += 1 - pi2T
      hsA += 1 - pi2A
      hsB += 1 - pi2B
    }
    totalHe /= traitKeys.length
    const Hs = (hsA / traitKeys.length + hsB / traitKeys.length) / 2
    this.divergence.fst = totalHe > 0 ? (totalHe - Hs) / totalHe : 0

    // Record history
    this.history.t.push(sim.t)
    this.history.traitDistance.push(this.divergence.traitDistance)
    this.history.fst.push(this.divergence.fst)
    this.history.popA.push(this.divergence.popA)
    this.history.popB.push(this.divergence.popB)
    if (this.history.t.length > this.maxHistory) {
      for (const key of Object.keys(this.history)) this.history[key].shift()
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 15. Draw Selection Coefficient Panel
// ══════════════════════════════════════════════════════════════════════════════

export function drawSelectionPanel(container, selectionTracker) {
  if (!container || !selectionTracker) return
  const sorted = selectionTracker.getSorted()
  if (sorted.length === 0) {
    container.innerHTML = '<div style="color:#667;font-size:8px">Collecting data...</div>'
    return
  }

  let html = ''
  for (const { trait, s } of sorted.slice(0, 12)) {
    const absS = Math.abs(s)
    const barW = Math.min(100, absS * 2000).toFixed(0)
    const color = s > 0 ? '#81c784' : s < 0 ? '#ef5350' : '#667'
    const dir = s > 0 ? '+' : s < 0 ? '−' : '·'
    html +=
      `<div style="display:flex;align-items:center;gap:3px;margin:1px 0">` +
      `<span style="width:55px;overflow:hidden;text-overflow:ellipsis;font-size:7px;color:#aab">${trait}</span>` +
      `<div style="flex:1;height:3px;background:rgba(255,255,255,0.04);border-radius:2px;position:relative">` +
      `<div style="width:${barW}%;height:100%;background:${color};border-radius:2px;` +
      `margin-left:${s < 0 ? 'auto' : '0'}"></div></div>` +
      `<span style="width:40px;text-align:right;font-size:7px;color:${color}">${dir}${absS.toFixed(4)}</span></div>`
  }
  container.innerHTML = html
}

// ══════════════════════════════════════════════════════════════════════════════
// 16. Draw Split World Divergence Panel
// ══════════════════════════════════════════════════════════════════════════════

export function drawSplitWorldPanel(canvas, splitWorld) {
  if (!canvas || !splitWorld || !splitWorld.active || splitWorld.history.t.length < 2) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr
    canvas.height = ch * dpr
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)

  const pad = { l: 30, r: 6, t: 18, b: 16 }
  const gw = cw - pad.l - pad.r
  const gh = ch - pad.t - pad.b
  const h = splitWorld.history
  const n = h.t.length

  const metrics = [
    { key: 'traitDistance', color: '#ffb74d', label: 'Divergence' },
    { key: 'fst', color: '#ef5350', label: 'Fst' }
  ]

  let maxVal = 0.01
  for (const m of metrics) {
    for (let i = 0; i < n; i++) {
      const v = h[m.key][i] || 0
      if (v > maxVal) maxVal = v
    }
  }

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 0.5
  for (let gi = 0; gi <= 4; gi++) {
    const gy = pad.t + gh * (1 - gi / 4)
    ctx.beginPath()
    ctx.moveTo(pad.l, gy)
    ctx.lineTo(pad.l + gw, gy)
    ctx.stroke()
  }

  // Y-axis
  ctx.fillStyle = 'rgba(140,155,183,0.5)'
  ctx.font = '8px ui-sans-serif,system-ui,sans-serif'
  ctx.textAlign = 'right'
  for (let gi = 0; gi <= 4; gi++) {
    ctx.fillText(((maxVal * gi) / 4).toFixed(3), pad.l - 3, pad.t + gh * (1 - gi / 4) + 3)
  }

  // Title
  ctx.fillStyle = 'rgba(200,210,230,0.7)'
  ctx.font = '9px ui-sans-serif,system-ui,sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(
    `A/B Divergence (A:${splitWorld.divergence.popA} B:${splitWorld.divergence.popB})`,
    pad.l,
    pad.t - 5
  )

  // Lines
  for (const m of metrics) {
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = pad.l + (i / (n - 1)) * gw
      const y = pad.t + gh * (1 - (h[m.key][i] || 0) / maxVal)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = m.color
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // Legend
  ctx.font = '7px ui-sans-serif,system-ui,sans-serif'
  for (let li = 0; li < metrics.length; li++) {
    const m = metrics[li]
    const ly = pad.t + 2 + li * 10
    ctx.fillStyle = m.color
    ctx.fillRect(pad.l + gw - 65, ly, 6, 6)
    ctx.textAlign = 'left'
    ctx.fillText(`${m.label} ${(h[m.key][n - 1] || 0).toFixed(4)}`, pad.l + gw - 56, ly + 5.5)
  }
}

export function getGenomeBrowserData(cell) {
  if (!cell || !cell.dna) return null

  const strand = cell.dna
  const n = strand.length
  const START_THRESHOLD = 0.03
  const STOP_THRESHOLD = 0.97
  const NUM_TRAITS = 66

  // Find genes and their boundaries
  const genes = []
  let inGene = false
  let geneStart = 0
  let geneExpression = 1.0

  for (let i = 0; i < n; i++) {
    if (!inGene && strand[i] < START_THRESHOLD) {
      inGene = true
      geneStart = i
      geneExpression = 0.3 + strand[Math.min(i + 1, n - 1)] * 1.4
    } else if (inGene && strand[i] > STOP_THRESHOLD) {
      genes.push({
        start: geneStart,
        end: i,
        length: i - geneStart,
        expression: geneExpression
      })
      inGene = false
    }
  }

  // Annotate codons within genes
  const codons = []
  for (const gene of genes) {
    let pos = gene.start + 2 // skip start + promoter
    while (pos + 2 < gene.end) {
      if (strand[pos] > STOP_THRESHOLD) break
      const target = strand[pos]
      const value = strand[pos + 1]
      const modifier = strand[pos + 2]
      const traitIdx = Math.min(NUM_TRAITS - 1, (target * NUM_TRAITS) | 0)
      const traitName = TRAIT_SLOTS[traitIdx] || `trait_${traitIdx}`
      const weight = (modifier - 0.3) * 2.0
      const contribution = value * weight * gene.expression

      codons.push({
        pos,
        gene: genes.indexOf(gene),
        traitIdx,
        traitName,
        target,
        value,
        modifier,
        contribution
      })
      pos += 3
    }
  }

  return {
    strandLength: n,
    genes,
    codons,
    phenotype: { ...cell.g },
    stats: strandStats(strand)
  }
}
