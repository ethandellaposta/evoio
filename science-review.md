# EvoIO Scientific Review & Improvement Plan

A comprehensive review of EvoIO as a scientific tool for studying genomes, evolution, and ecology — benchmarked against established platforms (Avida, SLiM, ALIEN) — with a prioritized roadmap to transform it from an impressive visual toy into a publication-grade research instrument.

---

## 1. What EvoIO Already Does Well

EvoIO is a browser-based, real-time 2D artificial life simulation with an unusually rich feature set for a web app:

| Strength | Details |
|---|---|
| **Realistic DNA system** | Raw `Float32Array` strand with start/stop codons, promoter strength, pleiotropy, junk DNA. 6 mutation types (SNP, insertion, deletion, duplication, inversion, transposition). Meiotic crossover with 1–3 chiasmata. This is genuinely more biologically grounded than most ALife tools. |
| **66 phenotype traits** | From locomotion (flagella, cilia, jet, amoeboid) to defense (shell, spines, toxin, camouflage) to metabolism (chloroplast, respiration) to behavior (curiosity, aggression, fear, territorial). |
| **Multicellularity** | Cell adhesion, link-based organisms, cell roles (edge/interior/pioneer), division of labor, surface tension via receptor/ligand bit-matching. |
| **Ecological richness** | 3 biomes, day/night cycle, seasons, 3 food types (plant/mineral/meat), predator-prey dynamics, food chains, conspecific flocking. |
| **Advanced genetics** | Muller's ratchet, drift load, sexual reproduction purging, epigenetic marks, horizontal gene transfer, ploidy/polyploidy, regulatory complexity, DNA repair. |
| **Phylogenetics** | Phylogenetic tree tracking, speciation via genome distance threshold, clade registry, founder genomes preserved. |
| **Save/load & sharing** | JSON serialization of full state, URL parameter sharing, seed-based reproducibility. |
| **Performance** | WASM-accelerated food sensing and gas diffusion, adaptive quality system, LOD rendering, spatial indexing. |

**Verdict:** The biological model is surprisingly sophisticated — more mechanistically detailed than Avida (which uses instruction-set genomes) and more visually engaging than SLiM (which is headless/CLI-focused). The DNA→phenotype pipeline with real codon interpretation is a genuine differentiator.

---

## 2. What's Missing for Scientific Use

Benchmarked against what researchers actually need (drawn from Avida, SLiM, and population genetics literature):

### 2.1 — Experiment Infrastructure (CRITICAL)

| Gap | Why It Matters |
|---|---|
| **No batch/headless mode** | Scientists need to run 100+ replicates with different seeds to get statistical power. Currently requires a browser tab per run. |
| **No experiment scripting** | SLiM has Eidos; Avida has config files. EvoIO has no way to define "at tick 5000, introduce predator pressure" or "every 1000 ticks, log allele frequencies." |
| **No parameter sweep support** | Can't systematically vary mutation rate from 0.01–0.20 across 20 runs and compare outcomes. |
| **No controlled variable isolation** | Can't freeze one gene while letting others evolve, can't knock out a trait, can't introduce a specific genotype. |
| **No hypothesis testing framework** | No way to define null models, run controls, or compare treatment vs. control populations. |

### 2.2 — Data Export & Analysis (CRITICAL)

| Gap | Why It Matters |
|---|---|
| **No CSV/TSV time-series export** | The `stats()` function computes 60+ metrics per tick but they're only shown in the UI. Scientists need downloadable data files. |
| **No per-organism data export** | Can't export a table of all organisms with their genomes, positions, fitness, lineage. |
| **No phylogenetic tree export** | The `phyloTree` Map is internal only. Scientists need Newick/Nexus format for use in R/Python phylogenetics packages. |
| **No genome export** | Can't export raw DNA strands or phenotype vectors for external analysis. |
| **No fitness landscape visualization** | No way to see the genotype→fitness mapping, which is the central object of study in evolutionary biology. |
| **No allele frequency tracking** | Population genetics fundamentally studies how allele frequencies change over time. This isn't tracked. |

### 2.3 — Population Genetics Metrics (HIGH)

| Missing Metric | Standard In |
|---|---|
| **Effective population size (Ne)** | Every pop-gen study |
| **Heterozygosity (observed/expected)** | Hardy-Weinberg analysis |
| **Fst (population differentiation)** | Spatial population structure |
| **Nucleotide diversity (π)** | Molecular evolution |
| **dN/dS ratio** | Selection detection |
| **Tajima's D** | Neutrality testing |
| **Fixation index** | Drift vs. selection |
| **Generation time** | Scaling evolutionary rate |
| **Fitness variance** | Selection intensity |
| **Mutation accumulation rate** | Mutation-selection balance |

### 2.4 — Experimental Controls (HIGH)

| Missing Control | Why It Matters |
|---|---|
| **Freeze evolution** | Hold a population static as a control while varying environment |
| **Inject genotype** | Introduce a specific organism to test invasion fitness |
| **Knockout genes** | Disable a single trait to measure its fitness contribution |
| **Clonal populations** | Start with identical genomes to measure divergence rate |
| **Migration corridors** | Connect/disconnect subpopulations to study gene flow |
| **Selective sweep detection** | Identify when a beneficial mutation sweeps through |

### 2.5 — Visualization for Science (MEDIUM)

| Gap | Why It Matters |
|---|---|
| **No genome browser/viewer** | Can't inspect a single organism's DNA strand, see its genes, coding regions, junk DNA |
| **No trait correlation heatmap** | Can't see which traits co-evolve (pleiotropy detection) |
| **No fitness landscape plot** | The central concept in evolutionary biology has no visualization |
| **No Muller plot** | Standard visualization for clonal dynamics over time |
| **No PCA/UMAP of genotype space** | Can't see population structure in genome space |
| **No allele frequency spectrum** | Site frequency spectrum is basic pop-gen diagnostic |

### 2.6 — Reproducibility & Documentation (MEDIUM)

| Gap | Why It Matters |
|---|---|
| **No experiment log** | No automatic record of what parameters were used, when they changed |
| **No version-stamped saves** | Can't guarantee a save from v1.0 runs identically in v1.1 |
| **No methods section generator** | Scientists need to describe their simulation setup for papers |
| **No unit tests for simulation logic** | Can't verify that mutation rates, selection coefficients, etc. are correct |
| **Model documentation** | The code comments are good but there's no formal model description document (ODD protocol or equivalent) |

---

## 3. Prioritized Implementation Roadmap

### Phase 1: Data Pipeline (makes EvoIO immediately useful for research)

1. **CSV time-series export** — Button to download all `stats()` metrics as a CSV file with one row per sample point. Minimal effort, massive value.
2. **Per-organism snapshot export** — Export all living cells with their full genome vectors, position, energy, clade, organism size, fitness metrics as CSV/JSON.
3. **Phylogenetic tree export** — Convert `phyloTree` Map to Newick format string. Add download button.
4. **Raw DNA strand export** — Export selected organism's `Float32Array` strand as a downloadable file with gene annotations.
5. **Experiment log** — Auto-record all parameter changes, events, and timestamps to a downloadable log file.

### Phase 2: Population Genetics Metrics

6. **Allele frequency tracking** — Track frequency of each trait across the population over time. Store as time-series.
7. **Core pop-gen statistics** — Compute and display: effective population size (Ne), heterozygosity, nucleotide diversity (π), Fst between biomes/clades.
8. **Fitness tracking** — Define and track explicit fitness (lifetime reproductive output) per organism. Currently fitness is implicit.
9. **Selection coefficient estimation** — From allele frequency changes, estimate s for each trait.
10. **Muller plot** — Stacked area chart showing clade frequencies over time (the phyloTree data already supports this).

### Phase 3: Experiment Controls

11. **Gene knockout/freeze UI** — Slider or toggle per trait: "evolving" / "frozen at X" / "knocked out (0)".
12. **Inject organism** — UI to design a custom genome and place it in the world.
13. **Clonal population start** — Option to seed all organisms with identical genomes.
14. **Environment scripting** — Simple event system: "at tick N, set food to X" / "every N ticks, log snapshot".
15. **A/B split world** — Divide world into two halves with different parameters, measure divergence.

### Phase 4: Advanced Visualization

16. **Genome browser** — Click an organism to see its DNA strand visualized: coding regions highlighted, gene boundaries marked, trait contributions shown.
17. **Trait correlation matrix** — Heatmap of pairwise correlations between all 66 traits across the population.
18. **Fitness landscape slice** — 2D plot of fitness vs. one or two traits, with population distribution overlaid.
19. **Genotype space PCA** — Reduce 66-trait genome to 2D via PCA, plot all organisms as dots colored by clade.
20. **Site frequency spectrum** — Histogram of allele frequencies across the genome.

### Phase 5: Batch & Automation

21. **Headless mode** — Run simulation without rendering, output data to files. Could be a Node.js CLI wrapper.
22. **Parameter sweep config** — JSON file defining parameter ranges and number of replicates.
23. **Batch results aggregator** — Combine results from multiple runs, compute means/CIs.
24. **API for external tools** — Expose simulation state via a programmatic interface for R/Python integration.

---

## 4. Quick Wins (< 1 day each, high impact)

These require minimal code changes but dramatically increase scientific utility:

| Quick Win | Effort | Impact |
|---|---|---|
| CSV export button for time-series stats | ~2 hours | ★★★★★ |
| Newick tree export | ~2 hours | ★★★★ |
| Per-cell data snapshot export | ~3 hours | ★★★★★ |
| Muller plot (clade frequencies over time) | ~4 hours | ★★★★ |
| Genome browser panel (click cell → see DNA) | ~6 hours | ★★★★ |
| Gene knockout toggles | ~4 hours | ★★★★ |
| Explicit fitness metric (lifetime offspring count) | ~3 hours | ★★★★ |
| Experiment log auto-recording | ~2 hours | ★★★ |
| Allele frequency time-series | ~4 hours | ★★★★ |
| Heterozygosity / diversity metrics | ~3 hours | ★★★ |

---

## 5. What Makes EvoIO Unique (Lean Into These)

Rather than trying to replicate SLiM (which excels at population genetics math) or Avida (which excels at digital organism computation), EvoIO should lean into its unique strengths:

1. **Visual, real-time, browser-based** — No installation, no command line. A professor can share a URL and students see evolution happening. This is Avida-ED's value proposition but with far richer biology.
2. **Embodied organisms in continuous space** — Unlike grid-based Avida or abstract SLiM, organisms have physical bodies, move through space, form multicellular structures. This enables studying spatial ecology, morphogenesis, and collective behavior.
3. **Integrated genotype→phenotype→ecology** — The DNA strand → codon interpretation → 66 traits → ecological interactions pipeline is unusually complete. Most tools model either genetics OR ecology, not both.
4. **Multicellularity emergence** — Very few tools model the transition from unicellular to multicellular life. This is EvoIO's killer feature for studying major evolutionary transitions.

---

## 6. Comparison with Established Tools

| Feature | EvoIO | Avida | SLiM | ALIEN |
|---|---|---|---|---|
| Browser-based | ✅ | ❌ | ❌ | ❌ |
| Visual real-time | ✅ | Partial | Partial | ✅ |
| Realistic DNA model | ✅ | ❌ (instruction set) | ✅ | ❌ |
| Multicellularity | ✅ | ❌ | ❌ | ✅ |
| Spatial ecology | ✅ | Grid only | Optional | ✅ |
| Data export | ❌ | ✅ | ✅ | Partial |
| Batch experiments | ❌ | ✅ | ✅ | ❌ |
| Scripting language | ❌ | Config files | Eidos | ❌ |
| Pop-gen metrics | ❌ | Limited | ✅ | ❌ |
| Phylogenetic export | ❌ | ✅ | ✅ | ❌ |
| Publication-ready output | ❌ | ✅ | ✅ | ❌ |
| Reproducibility tools | Partial (seed) | ✅ | ✅ | Partial |

**Bottom line:** EvoIO has the richest biological model of any browser-based ALife tool, but it's trapped behind a glass wall — scientists can watch evolution happen but can't extract, analyze, or systematically study the data it generates.

---

## 7. Target User Personas

1. **Evolutionary biology professor** — Wants to demonstrate concepts (drift, selection, speciation, multicellularity) in lectures. Needs: shareable URLs, clear visualizations, preset scenarios.
2. **Graduate student** — Wants to run experiments on evolutionary dynamics for a thesis. Needs: data export, batch runs, statistical analysis, reproducibility.
3. **Population geneticist** — Wants to test hypotheses about allele frequency dynamics. Needs: pop-gen metrics, controlled experiments, parameter sweeps.
4. **ALife researcher** — Wants to study open-ended evolution and major transitions. Needs: long-run stability, complexity metrics, phylogenetic analysis.
5. **Science communicator** — Wants to create engaging demonstrations of evolution. Needs: beautiful visuals, preset scenarios, annotation tools.

---

## 8. Recommended Implementation Order

**Start with Phase 1 (Data Pipeline)** — this is the single biggest barrier to scientific use. A researcher who can export CSV data can immediately start writing papers. Everything else is secondary.

The suggested first sprint (Phases 1 items 1–5 + a few quick wins) would transform EvoIO from "cool demo" to "I can actually use this for my research" in roughly 2–3 days of focused work.
