// ══════════════════════════════════════════════════════════════════════════════
// Raw DNA Strand System
// ══════════════════════════════════════════════════════════════════════════════
//
// Scientific basis: real genomes are linear sequences of nucleotides (A,T,G,C)
// grouped into codons (triplets) that encode amino acids. Genes are codon
// sequences flanked by promoter/start and stop signals. Most of the genome is
// non-coding ("junk DNA") but can become functional via mutation (exaptation).
//
// Our model:
//   - DNA = Float32Array of bases, each in [0, 1)
//   - Codons = groups of 3 consecutive bases
//   - A codon is interpreted as [target, value, modifier]:
//       target:   which phenotype trait this codon influences (0..1 maps to trait slots)
//       value:    how much it contributes to that trait
//       modifier: regulatory weight (how strongly this codon is expressed)
//   - Genes = regions between START markers (base < 0.02) and STOP markers (base > 0.98)
//   - Non-coding regions (between genes) are "junk DNA" — silent but can mutate into genes
//   - Multiple codons can target the same trait (polygenic inheritance)
//   - One codon can influence nearby trait slots too (pleiotropy)
//
// Meaning is NOT predefined. A codon that happens to produce "speed" survives
// only if speed helps the organism. The trait mapping is just math — evolution
// discovers which codon patterns are useful.
// ══════════════════════════════════════════════════════════════════════════════

import { randRange, randNorm } from '../rng.js'

// ── Phenotype trait slots ──
// These are the output channels that codons can target.
// The index is determined by the codon's target base value.
// This list defines the ORDER of trait slots — the DNA doesn't know these names.
const TRAIT_SLOTS = [
  'speed', // 0
  'metabolism', // 1
  'sense', // 2
  'adhesion', // 3
  'division', // 4
  'persistence', // 5
  'diet', // 6
  'flagella', // 7
  'cilia', // 8
  'jet', // 9
  'amoeboid', // 10
  'toxin', // 11
  'spike', // 12
  'constrict', // 13
  'membrane', // 14
  'spines', // 15
  'camouflage', // 16
  'toxinResist', // 17
  'flipper', // 18
  'mutRate', // 19
  'boldness', // 20
  'sociality', // 21
  'toughness', // 22
  'apoptosis', // 23
  'elongation', // 24
  'biolum', // 25
  'vesicles', // 26
  'bodyScale', // 27
  'hueShift', // 28
  'brightness', // 29
  'proboscis', // 30
  'paddleFin', // 31
  'sexuality', // 32
  'growthSymmetry', // 33
  'branchAngle', // 34
  'compactness', // 35
  'budOffset', // 36
  'phototropism', // 37
  'chloroplast', // 38
  'longevity', // 39
  'scavenger', // 40
  'shell', // 41
  'symbiosis', // 42
  'eyespot', // 43
  'stalk', // 44
  'fragmentation', // 45
  'propaguleSize', // 46
  'respiration', // 47
  'wasteExpel', // 48
  'curiosity', // 49
  'aggression', // 50
  'fear', // 51
  'territorial', // 52
  'nocturnal', // 53
  'migratory', // 54
  'nurturing', // 55
  'regulatoryComplexity', // 56
  'devTiming', // 57
  'growthRate', // 58
  'dnaRepair', // 59
  'immuneStrength', // 60
  'signaling', // 61
  'hgt', // 62
  'plasticity', // 63
  'pattern', // 64
  'patternScale' // 65
]
const NUM_TRAITS = TRAIT_SLOTS.length

// ── Trait ranges: [min, max] for each trait slot ──
// These define the valid phenotype range. The raw DNA accumulator gets
// normalized into this range after interpretation.
const TRAIT_RANGES = {
  speed: [0.35, 2.6],
  metabolism: [0.35, 2.6],
  sense: [0.25, 4.0],
  adhesion: [0, 1],
  division: [2.0, 7.5],
  persistence: [0.1, 0.95],
  diet: [0, 1],
  flagella: [0, 1],
  cilia: [0, 1],
  jet: [0, 1],
  amoeboid: [0, 1],
  toxin: [0, 1],
  spike: [0, 1],
  constrict: [0, 1],
  membrane: [0, 1],
  spines: [0, 1],
  camouflage: [0, 1],
  toxinResist: [0, 1],
  flipper: [0, 1],
  mutRate: [0.01, 0.25],
  boldness: [0, 1],
  sociality: [0, 1],
  toughness: [0, 1],
  apoptosis: [0, 1],
  elongation: [0, 1],
  biolum: [0, 1],
  vesicles: [0, 1],
  bodyScale: [0.5, 2.0],
  hueShift: [-1, 1],
  brightness: [0, 1],
  proboscis: [0, 1],
  paddleFin: [0, 1],
  sexuality: [0, 1],
  growthSymmetry: [0, 1],
  branchAngle: [0, 1],
  compactness: [0, 1],
  budOffset: [0, 1],
  phototropism: [0, 1],
  chloroplast: [0, 1],
  longevity: [0, 1],
  scavenger: [0, 1],
  shell: [0, 1],
  symbiosis: [0, 1],
  eyespot: [0, 1],
  stalk: [0, 1],
  fragmentation: [0, 1],
  propaguleSize: [0, 1],
  respiration: [0, 1],
  wasteExpel: [0, 1],
  curiosity: [0, 1],
  aggression: [0, 1],
  fear: [0, 1],
  territorial: [0, 1],
  nocturnal: [0, 1],
  migratory: [0, 1],
  nurturing: [0, 1],
  regulatoryComplexity: [0, 1],
  devTiming: [0, 1],
  growthRate: [0, 1],
  dnaRepair: [0, 1],
  immuneStrength: [0, 1],
  signaling: [0, 1],
  hgt: [0, 1],
  plasticity: [0, 1],
  pattern: [0, 1],
  patternScale: [0.2, 0.8]
}

// Default initial strand length (in bases). Real E. coli has ~4.6M base pairs;
// we use ~192 bases (64 codons) for a minimal viable genome.
const INITIAL_STRAND_LENGTH = 192
// Maximum strand length (prevents runaway genome bloat)
const MAX_STRAND_LENGTH = 600

// ── Codon interpretation constants ──
const START_THRESHOLD = 0.03 // base < this = start codon (like ATG)
const STOP_THRESHOLD = 0.97 // base > this = stop codon (like TAA/TAG/TGA)

// ══════════════════════════════════════════════════════════════════════════════
// Create a random DNA strand
// ══════════════════════════════════════════════════════════════════════════════
export function createStrand(rng, length) {
  const n = length || INITIAL_STRAND_LENGTH
  const strand = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    strand[i] = rng()
  }
  return strand
}

// ══════════════════════════════════════════════════════════════════════════════
// Interpret a DNA strand into phenotype trait values
// ══════════════════════════════════════════════════════════════════════════════
//
// Walks the strand looking for genes (start→codons→stop).
// Each codon triplet [target, value, modifier] contributes to a trait accumulator.
// After reading all genes, accumulators are normalized into trait ranges.
//
// Non-coding regions between genes are skipped (junk DNA).
// This means most of the strand may be silent — exactly like real genomes
// where only ~1.5% of human DNA codes for proteins.
//
export function interpretStrand(strand) {
  const accum = new Float32Array(NUM_TRAITS) // raw accumulator per trait
  const counts = new Float32Array(NUM_TRAITS) // how many codons targeted each trait
  const n = strand.length
  let i = 0
  let inGene = false
  let geneExpressionLevel = 1.0 // regulatory: how strongly current gene is expressed

  while (i < n) {
    const base = strand[i]

    if (!inGene) {
      // Looking for a start codon
      if (base < START_THRESHOLD && i + 3 < n) {
        inGene = true
        // The base right after start modulates expression level (promoter strength)
        // Scientific basis: promoter sequences (TATA box, etc.) control transcription rate
        geneExpressionLevel = 0.3 + strand[Math.min(i + 1, n - 1)] * 1.4
        i += 2 // skip start + promoter
        continue
      }
      i++
      continue
    }

    // Inside a gene: read codons
    if (base > STOP_THRESHOLD) {
      // Stop codon — end of gene
      inGene = false
      i++
      continue
    }

    // Need at least 3 bases for a codon
    if (i + 2 >= n) break

    // Read codon triplet
    const target = strand[i]
    const value = strand[i + 1]
    const modifier = strand[i + 2]

    // Map target to trait slot
    const traitIdx = Math.min(NUM_TRAITS - 1, (target * NUM_TRAITS) | 0)

    // Contribution = value * modifier * expression level
    // modifier acts as a weight: 0.5 = neutral, >0.5 = enhancer, <0.5 = suppressor
    const weight = (modifier - 0.3) * 2.0 // range roughly [-0.6, 1.4]
    const contribution = value * weight * geneExpressionLevel

    accum[traitIdx] += contribution
    counts[traitIdx]++

    // Pleiotropy: nearby trait slots get a fraction of the contribution
    // Scientific basis: many genes affect multiple traits (e.g., melanocortin
    // receptor affects both pigmentation and appetite)
    if (modifier > 0.7) {
      // Strong modifier = pleiotropic effect on adjacent traits
      const neighbor = (traitIdx + 1) % NUM_TRAITS
      accum[neighbor] += contribution * 0.15
      counts[neighbor] += 0.15
    }
    if (modifier < 0.2) {
      const neighbor = (traitIdx - 1 + NUM_TRAITS) % NUM_TRAITS
      accum[neighbor] += contribution * 0.1
      counts[neighbor] += 0.1
    }

    i += 3 // advance past codon
  }

  // Normalize accumulators into phenotype values
  const phenotype = {}
  for (let t = 0; t < NUM_TRAITS; t++) {
    const name = TRAIT_SLOTS[t]
    const range = TRAIT_RANGES[name]
    const lo = range[0],
      hi = range[1]

    // Sigmoid-like normalization: maps any accumulator value into [0, 1]
    // More codons targeting a trait = stronger signal (but diminishing returns)
    const raw = counts[t] > 0 ? accum[t] / Math.max(1, counts[t] * 0.5) : 0
    const sigmoid = 1.0 / (1.0 + Math.exp(-raw * 2.5))
    phenotype[name] = lo + sigmoid * (hi - lo)
  }

  return phenotype
}

// ══════════════════════════════════════════════════════════════════════════════
// Mutate a DNA strand (like real DNA replication errors)
// ══════════════════════════════════════════════════════════════════════════════
//
// Mutation types (all occur in real biology):
//   1. Point mutation: single base changes value (SNP — most common)
//   2. Insertion: new random base inserted (frameshift)
//   3. Deletion: base removed (frameshift)
//   4. Duplication: segment copied and inserted nearby (gene duplication — Ohno 1970)
//   5. Inversion: segment reversed (chromosomal inversion)
//   6. Transposition: segment moves to new location (transposons — "jumping genes")
//
export function mutateStrand(rng, strand, mutRate) {
  const m = mutRate || 0.06
  let bases = Array.from(strand) // work with mutable array

  // 1. Point mutations (most common — like DNA polymerase errors)
  for (let i = 0; i < bases.length; i++) {
    if (rng() < m * 0.3) {
      // Small jitter (like a transition mutation — purine↔purine, pyrimidine↔pyrimidine)
      bases[i] = Math.max(0, Math.min(1, bases[i] + (rng() - 0.5) * 0.3))
    }
    if (rng() < m * 0.03) {
      // Large jump (like a transversion mutation — purine↔pyrimidine)
      bases[i] = rng()
    }
  }

  // 2. Insertion (rare — adds new genetic material)
  if (rng() < m * 0.15 && bases.length < MAX_STRAND_LENGTH) {
    const pos = (rng() * bases.length) | 0
    const insertLen = 1 + ((rng() * 5) | 0) // 1-5 bases
    const insert = []
    for (let j = 0; j < insertLen; j++) insert.push(rng())
    bases.splice(pos, 0, ...insert)
  }

  // 3. Deletion (rare — removes genetic material)
  if (rng() < m * 0.12 && bases.length > 30) {
    const pos = (rng() * bases.length) | 0
    const delLen = 1 + ((rng() * 4) | 0) // 1-4 bases
    bases.splice(pos, Math.min(delLen, bases.length - 20))
  }

  // 4. Duplication (rare but important — primary source of new genes)
  // Scientific basis: Ohno 1970 — gene duplication followed by divergence
  // is the main mechanism for evolving new gene functions
  if (rng() < m * 0.04 && bases.length < MAX_STRAND_LENGTH - 20) {
    const srcPos = (rng() * (bases.length - 10)) | 0
    const dupLen = 3 + ((rng() * 15) | 0) // 3-17 bases (1-5 codons)
    const segment = bases.slice(srcPos, srcPos + dupLen)
    const destPos = (rng() * bases.length) | 0
    bases.splice(destPos, 0, ...segment)
  }

  // 5. Inversion (rare — flips a segment)
  // Scientific basis: chromosomal inversions are common in Drosophila,
  // can create reproductive isolation (speciation mechanism)
  if (rng() < m * 0.02) {
    const pos = (rng() * (bases.length - 6)) | 0
    const invLen = 3 + ((rng() * 12) | 0)
    const end = Math.min(pos + invLen, bases.length)
    const segment = bases.slice(pos, end).reverse()
    for (let j = 0; j < segment.length; j++) {
      bases[pos + j] = segment[j]
    }
  }

  // 6. Transposition (very rare — "jumping genes", Barbara McClintock 1948)
  if (rng() < m * 0.01 && bases.length > 20) {
    const srcPos = (rng() * (bases.length - 6)) | 0
    const transLen = 3 + ((rng() * 9) | 0)
    const end = Math.min(srcPos + transLen, bases.length)
    const segment = bases.splice(srcPos, end - srcPos)
    const destPos = (rng() * bases.length) | 0
    bases.splice(destPos, 0, ...segment)
  }

  // Enforce max length
  if (bases.length > MAX_STRAND_LENGTH) {
    bases = bases.slice(0, MAX_STRAND_LENGTH)
  }

  return new Float32Array(bases)
}

// ══════════════════════════════════════════════════════════════════════════════
// Recombine two DNA strands (sexual reproduction — meiotic crossover)
// ══════════════════════════════════════════════════════════════════════════════
//
// Scientific basis: during meiosis, homologous chromosomes align and exchange
// segments at random crossover points (chiasmata). This shuffles genetic
// material between parents, creating novel combinations.
//
// We do 1-3 crossover points, alternating which parent's strand we copy from.
// If strands differ in length, we handle it like real unequal crossover
// (which can create duplications/deletions — a source of genome size evolution).
//
export function recombineStrands(rng, strandA, strandB) {
  const lenA = strandA.length
  const lenB = strandB.length
  const maxLen = Math.max(lenA, lenB)
  const minLen = Math.min(lenA, lenB)

  // Number of crossover points (1-3, like real meiosis)
  const numCrossovers = 1 + ((rng() * 3) | 0)
  const crossPoints = []
  for (let i = 0; i < numCrossovers; i++) {
    crossPoints.push((rng() * minLen) | 0)
  }
  crossPoints.sort((a, b) => a - b)

  // Build child strand by alternating between parents at crossover points
  const child = []
  let useA = rng() < 0.5
  let cpIdx = 0

  for (let i = 0; i < maxLen; i++) {
    // Check if we've hit a crossover point
    if (cpIdx < crossPoints.length && i >= crossPoints[cpIdx]) {
      useA = !useA
      cpIdx++
    }

    if (useA && i < lenA) {
      child.push(strandA[i])
    } else if (!useA && i < lenB) {
      child.push(strandB[i])
    } else if (i < lenA) {
      child.push(strandA[i])
    } else if (i < lenB) {
      child.push(strandB[i])
    }
  }

  // Enforce max length
  const result = child.length > MAX_STRAND_LENGTH ? child.slice(0, MAX_STRAND_LENGTH) : child
  return new Float32Array(result)
}

// ══════════════════════════════════════════════════════════════════════════════
// Compute genome statistics from a strand (for stats display)
// ══════════════════════════════════════════════════════════════════════════════
export function strandStats(strand) {
  let geneCount = 0
  let codingBases = 0
  let inGene = false
  let geneStart = 0

  for (let i = 0; i < strand.length; i++) {
    if (!inGene && strand[i] < START_THRESHOLD) {
      inGene = true
      geneStart = i
    } else if (inGene && strand[i] > STOP_THRESHOLD) {
      geneCount++
      codingBases += i - geneStart
      inGene = false
    }
  }

  return {
    length: strand.length,
    geneCount,
    codingBases,
    codingFraction: strand.length > 0 ? codingBases / strand.length : 0,
    junkFraction: strand.length > 0 ? 1 - codingBases / strand.length : 1
  }
}

export { TRAIT_SLOTS, NUM_TRAITS, TRAIT_RANGES, INITIAL_STRAND_LENGTH, MAX_STRAND_LENGTH }
