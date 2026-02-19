import { defaultConfig, Sim, initWasm } from './sim/index.js'
import {
  Renderer,
  buildOrganisms,
  cladeColor,
  cladeHue,
  cladeSatOffset,
  cladeLumOffset
} from './render/index.js'
import { initPanels } from './panels.js'
import {
  exportTimeSeriesCSV,
  exportCellSnapshotCSV,
  exportPhyloNewick,
  exportGenomeDetail,
  ExperimentLog,
  computePopGenMetrics,
  AlleleTracker,
  MullerTracker,
  drawMullerPlot,
  drawPopGenPanel,
  getGenomeBrowserData,
  SelectionTracker,
  EnvironmentScript,
  SplitWorld,
  drawSelectionPanel,
  drawSplitWorldPanel
} from './science.js'
import { StressTest, drawStressTestChart, renderStressTestSummary } from './stresstest.js'
import { exportPokedex } from './pokedex.js'

// ── Dual naming system ──
// 1. Random fun display names — unique per clade, randomly generated
// 2. Scientific binomial names — Genus species following real taxonomy
//    Genus inherited from parent lineage, species from morphological traits

// Random name syllable pools
const NAME_PRE = [
  'Bub',
  'Zix',
  'Mog',
  'Pip',
  'Taz',
  'Wob',
  'Nix',
  'Kip',
  'Fez',
  'Jub',
  'Glo',
  'Rix',
  'Dop',
  'Yem',
  'Vox',
  'Zum',
  'Pax',
  'Hob',
  'Kel',
  'Fin',
  'Orp',
  'Lux',
  'Bim',
  'Quix',
  'Sev',
  'Dax',
  'Wren',
  'Tig',
  'Olo',
  'Cob'
]
const NAME_MID = [
  'ble',
  'zy',
  'ri',
  'lo',
  'na',
  'ki',
  'pu',
  'ta',
  'mo',
  'xi',
  'fa',
  'du',
  'we',
  'go',
  'si',
  'nu',
  'ba',
  'je',
  'vo',
  'li'
]
const NAME_END = [
  'us',
  'ax',
  'on',
  'ix',
  'or',
  'um',
  'is',
  'el',
  'an',
  'ot',
  'ip',
  'ek',
  'oz',
  'ur',
  'em',
  'at',
  'oo',
  'yn',
  'ob',
  'ik'
]

function generateRandomName(clade) {
  // Deterministic from clade id but looks random
  const a = ((clade * 7919) ^ 0xdead) >>> 0
  const b = ((clade * 104729) ^ 0xbeef) >>> 0
  const c = ((clade * 15485863) ^ 0xcafe) >>> 0
  const pre = NAME_PRE[a % NAME_PRE.length]
  const mid = NAME_MID[b % NAME_MID.length]
  const end = NAME_END[c % NAME_END.length]
  // Sometimes skip mid syllable for shorter names
  if ((a + b) % 3 === 0) return pre + end
  return pre + mid + end
}

// Scientific genus roots — assigned to root clades, inherited by descendants
const GENUS_POOL = [
  'Proto',
  'Archa',
  'Neo',
  'Xeno',
  'Crypto',
  'Para',
  'Pseudo',
  'Micro',
  'Macro',
  'Primo',
  'Mono',
  'Poly',
  'Hemi',
  'Iso',
  'Amphi',
  'Endo',
  'Ecto',
  'Meso',
  'Hyper',
  'Hypo',
  'Chloro',
  'Chromo',
  'Cyano',
  'Rhodo',
  'Thermo',
  'Halo',
  'Pelago',
  'Bentho',
  'Limno',
  'Plankto'
]

// Species epithets — based on dominant morphological trait
const SPECIES_EPITHETS = {
  flagella: ['flagellata', 'caudata', 'filosa'],
  cilia: ['ciliata', 'vibrans', 'trichosa'],
  spike: ['spinosa', 'aculeata', 'armata'],
  spines: ['echinata', 'setosa', 'hispida'],
  toxin: ['toxica', 'venenosa', 'noxia'],
  membrane: ['corticata', 'tunicata', 'lamellosa'],
  shell: ['testata', 'loricata', 'conchata'],
  elongation: ['elongata', 'vermiformis', 'filiformis'],
  amoeboid: ['amoeboides', 'protea', 'flexilis'],
  biolum: ['luminosa', 'lucens', 'fulgida'],
  chloroplast: ['viridis', 'chlorotica', 'photica'],
  adhesion: ['aggregata', 'sociata', 'connexa'],
  eyespot: ['oculata', 'stigmata', 'vigilans'],
  stalk: ['stipitata', 'pedunculata', 'sessilis'],
  symbiosis: ['symbiotica', 'mutualis', 'consociata'],
  default: ['vulgaris', 'communis', 'simplex']
}

// Get the genus for a clade by walking up the phyloTree to find the root genus
function getCladeGenus(clade, phyloTree) {
  // Walk up to find the root ancestor
  let current = clade
  let depth = 0
  const visited = new Set()
  while (current !== null && depth < 100) {
    if (visited.has(current)) break
    visited.add(current)
    const node = phyloTree.get(current)
    if (!node || node.parentClade === null || node.parentClade === undefined) {
      // This is a root clade — assign genus from pool
      return GENUS_POOL[current % GENUS_POOL.length]
    }
    current = node.parentClade
    depth++
  }
  return GENUS_POOL[clade % GENUS_POOL.length]
}

function generateScientificName(clade, genome, phyloTree) {
  const genus = getCladeGenus(clade, phyloTree)

  if (!genome) return `${genus} sp.`

  // Species epithet from dominant morphological trait
  const traits = [
    { key: 'flagella', val: genome.flagella || 0 },
    { key: 'cilia', val: genome.cilia || 0 },
    { key: 'spike', val: genome.spike || 0 },
    { key: 'spines', val: genome.spines || 0 },
    { key: 'toxin', val: genome.toxin || 0 },
    { key: 'membrane', val: genome.membrane || 0 },
    { key: 'shell', val: genome.shell || 0 },
    { key: 'elongation', val: genome.elongation || 0 },
    { key: 'amoeboid', val: genome.amoeboid || 0 },
    { key: 'biolum', val: genome.biolum || 0 },
    { key: 'chloroplast', val: genome.chloroplast || 0 },
    { key: 'adhesion', val: genome.adhesion || 0 },
    { key: 'eyespot', val: genome.eyespot || 0 },
    { key: 'stalk', val: genome.stalk || 0 },
    { key: 'symbiosis', val: genome.symbiosis || 0 }
  ]
  traits.sort((a, b) => b.val - a.val)
  const topTrait = traits[0].val > 0.08 ? traits[0].key : 'default'
  const pool = SPECIES_EPITHETS[topTrait] || SPECIES_EPITHETS.default
  const epithet = pool[clade % pool.length]

  return `${genus} ${epithet}`
}

// Cache: clade → { displayName, scientificName }
const organismNames = new Map()

function ensureCladeName(clade, simRef) {
  if (organismNames.has(clade)) return
  let genome = null
  if (simRef) {
    // Try founder genome from phyloTree first
    const node = simRef.phyloTree ? simRef.phyloTree.get(clade) : null
    if (node && node.founderGenome) {
      genome = node.founderGenome
    } else {
      // Fall back to a living cell
      for (let i = 0; i < simRef.cells.length; i++) {
        if (simRef.cells[i].clade === clade) {
          genome = simRef.cells[i].g
          break
        }
      }
    }
  }
  const phyloTree = simRef ? simRef.phyloTree || new Map() : new Map()
  organismNames.set(clade, {
    displayName: generateRandomName(clade),
    scientificName: generateScientificName(clade, genome, phyloTree)
  })
}

async function main() {
  await initWasm()

  // ── Sidebar panel resize ──
  {
    const handle = document.getElementById('panel-resize')
    const root = document.documentElement
    let dragging = false
    let startX = 0
    let startW = 280

    function getPanelW() {
      const v = getComputedStyle(root).getPropertyValue('--panel-w')
      return v ? parseInt(v, 10) : 280
    }

    if (handle) {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault()
        dragging = true
        startX = e.clientX
        startW = getPanelW()
        handle.classList.add('active')
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      })

      window.addEventListener('mousemove', (e) => {
        if (!dragging) return
        const delta = startX - e.clientX
        const newW = Math.max(180, Math.min(800, startW + delta))
        root.style.setProperty('--panel-w', newW + 'px')
      })

      window.addEventListener('mouseup', () => {
        if (!dragging) return
        dragging = false
        handle.classList.remove('active')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      })
    }
  }

  const TIME_SCALE = 5

  function fmt(x, digits = 2) {
    if (!Number.isFinite(x)) return '-'
    return x.toFixed(digits)
  }

  function readParams() {
    const p = new URLSearchParams(window.location.search)
    const getNum = (k) => {
      const v = p.get(k)
      if (v == null) return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    return {
      seed: p.get('seed'),
      preset: p.get('preset'),
      speed: getNum('speed'),
      mutation: getNum('mutation'),
      food: getNum('food'),
      patch: getNum('patch'),
      maxOrganisms: getNum('maxOrganisms'),
      showFood: p.get('showFood'),
      showLinks: p.get('showLinks'),
      follow: p.get('follow')
    }
  }

  function truthyParam(v, fallback) {
    if (v == null) return fallback
    if (v === '1' || v === 'true' || v === 'yes') return true
    if (v === '0' || v === 'false' || v === 'no') return false
    return fallback
  }

  function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x
  }

  function randomSeed() {
    const a = Math.random().toString(36).slice(2, 7)
    const b = Math.random().toString(36).slice(2, 7)
    return `${a}-${b}`
  }

  const el = {
    canvas: document.getElementById('view'),
    play: document.getElementById('btn-play'),
    step: document.getElementById('btn-step'),
    reset: document.getElementById('btn-reset'),
    reroll: document.getElementById('btn-reroll'),
    save: document.getElementById('btn-save'),
    importBtn: document.getElementById('btn-import'),
    importFile: document.getElementById('import-file'),
    copylink: document.getElementById('btn-copylink'),
    preset: document.getElementById('preset'),
    speed: document.getElementById('speed'),
    speedV: document.getElementById('speed-v'),
    mutation: document.getElementById('mutation'),
    food: document.getElementById('food'),
    patch: document.getElementById('patch'),
    maxOrganisms: document.getElementById('maxOrganisms'),
    showFood: document.getElementById('showFood'),
    showLinks: document.getElementById('showLinks'),
    cameraMode: document.getElementById('cameraMode'),
    filterDiet: document.getElementById('filterDiet'),
    filterRole: document.getElementById('filterRole'),
    filterSpecies: document.getElementById('filterSpecies'),
    seed: document.getElementById('seed'),
    lofiEnabled: document.getElementById('lofiEnabled'),
    lofiWater: document.getElementById('lofiWater'),
    lofiFoodOverlay: document.getElementById('lofiFoodOverlay'),
    lofiFoodBuds: document.getElementById('lofiFoodBuds'),
    lofiTerrain: document.getElementById('lofiTerrain'),
    lofiTrails: document.getElementById('lofiTrails'),
    lofiHulls: document.getElementById('lofiHulls'),
    lofiParticles: document.getElementById('lofiParticles'),
    lofiMorphology: document.getElementById('lofiMorphology'),
    lofiOrganelles: document.getElementById('lofiOrganelles'),
    lofiGlow: document.getElementById('lofiGlow'),
    lofiOptions: document.getElementById('lofi-options'),
    hudT: document.getElementById('hud-t'),
    hudDaynight: document.getElementById('hud-daynight'),
    hudSunIcon: document.getElementById('hud-sun-icon'),
    hudOrgs: document.getElementById('hud-orgs'),
    hudPop: document.getElementById('hud-pop'),
    hudSpecies: document.getElementById('hud-species'),
    hudMulticell: document.getElementById('hud-multicell'),
    hudHerb: document.getElementById('hud-herb'),
    hudOmni: document.getElementById('hud-omni'),
    hudCarn: document.getElementById('hud-carn'),
    hudKills: document.getElementById('hud-kills'),
    hudEnergy: document.getElementById('hud-energy'),
    hudBiome: document.getElementById('hud-biome'),
    hudFps: document.getElementById('hud-fps'),
    hudSimMs: document.getElementById('hud-simms'),
    hudRenderMs: document.getElementById('hud-renderms'),
    hudStepsS: document.getElementById('hud-stepss'),
    perfFpsBar: document.getElementById('perf-fps-bar'),
    perfSimBar: document.getElementById('perf-sim-bar'),
    perfRenderBar: document.getElementById('perf-render-bar'),
    perfStepsBar: document.getElementById('perf-steps-bar'),
    perfBudgetBar: document.getElementById('perf-budget-bar'),
    perfBudgetV: document.getElementById('perf-budget-v'),
    perfFrameBar: document.getElementById('perf-frame-bar'),
    perfFrameV: document.getElementById('perf-frame-v'),
    perfCells: document.getElementById('perf-cells'),
    perfLinks: document.getElementById('perf-links'),
    perfSpecies: document.getElementById('perf-species'),
    perfUsCell: document.getElementById('perf-uscell'),
    perfSubsystems: document.getElementById('perf-subsystems'),
    perfRenderSubs: document.getElementById('perf-render-subs'),
    // New status panel elements
    statusGen: document.getElementById('status-gen'),
    statusBirths: document.getElementById('status-births'),
    statusFood: document.getElementById('status-food'),
    statusSeason: document.getElementById('status-season'),
    statusDaynight: document.getElementById('status-daynight'),
    sunIcon: document.getElementById('sun-icon'),
    // Organelle bars
    orgNucleus: document.getElementById('org-nucleus'),
    orgNucleusV: document.getElementById('org-nucleus-v'),
    orgMito: document.getElementById('org-mito'),
    orgMitoV: document.getElementById('org-mito-v'),
    orgFlagella: document.getElementById('org-flagella'),
    orgFlagellaV: document.getElementById('org-flagella-v'),
    orgReceptor: document.getElementById('org-receptor'),
    orgReceptorV: document.getElementById('org-receptor-v'),
    orgVacuole: document.getElementById('org-vacuole'),
    orgVacuoleV: document.getElementById('org-vacuole-v'),
    // Mechanism bars
    mechFlagella: document.getElementById('mech-flagella'),
    mechFlagellaV: document.getElementById('mech-flagella-v'),
    mechCilia: document.getElementById('mech-cilia'),
    mechCiliaV: document.getElementById('mech-cilia-v'),
    mechJet: document.getElementById('mech-jet'),
    mechJetV: document.getElementById('mech-jet-v'),
    mechAmoeboid: document.getElementById('mech-amoeboid'),
    mechAmoeboidV: document.getElementById('mech-amoeboid-v'),
    mechToxin: document.getElementById('mech-toxin'),
    mechToxinV: document.getElementById('mech-toxin-v'),
    mechSpike: document.getElementById('mech-spike'),
    mechSpikeV: document.getElementById('mech-spike-v'),
    mechConstrict: document.getElementById('mech-constrict'),
    mechConstrictV: document.getElementById('mech-constrict-v'),
    mechMembrane: document.getElementById('mech-membrane'),
    mechMembraneV: document.getElementById('mech-membrane-v'),
    mechSpines: document.getElementById('mech-spines'),
    mechSpinesV: document.getElementById('mech-spines-v'),
    mechCamo: document.getElementById('mech-camo'),
    mechCamoV: document.getElementById('mech-camo-v'),
    mechToxResist: document.getElementById('mech-toxresist'),
    mechToxResistV: document.getElementById('mech-toxresist-v'),
    mechElong: document.getElementById('mech-elong'),
    mechElongV: document.getElementById('mech-elong-v'),
    mechBiolum: document.getElementById('mech-biolum'),
    mechBiolumV: document.getElementById('mech-biolum-v'),
    mechVesicles: document.getElementById('mech-vesicles'),
    mechVesiclesV: document.getElementById('mech-vesicles-v'),
    mechPaddle: document.getElementById('mech-paddle'),
    mechPaddleV: document.getElementById('mech-paddle-v'),
    mechProboscis: document.getElementById('mech-proboscis'),
    mechProboscisV: document.getElementById('mech-proboscis-v'),
    mechBright: document.getElementById('mech-bright'),
    mechBrightV: document.getElementById('mech-bright-v'),
    mechSexuality: document.getElementById('mech-sexuality'),
    mechSexualityV: document.getElementById('mech-sexuality-v'),
    mechShell: document.getElementById('mech-shell'),
    mechShellV: document.getElementById('mech-shell-v'),
    mechSymbiosis: document.getElementById('mech-symbiosis'),
    mechSymbiosisV: document.getElementById('mech-symbiosis-v'),
    mechEyespot: document.getElementById('mech-eyespot'),
    mechEyespotV: document.getElementById('mech-eyespot-v'),
    mechStalk: document.getElementById('mech-stalk'),
    mechStalkV: document.getElementById('mech-stalk-v'),
    // Ecology
    ecoHerb: document.getElementById('eco-herb'),
    ecoOmni: document.getElementById('eco-omni'),
    ecoCarn: document.getElementById('eco-carn'),
    ecoKills: document.getElementById('eco-kills'),
    // Morphology
    morphFlipper: document.getElementById('morph-flipper'),
    morphFlipperV: document.getElementById('morph-flipper-v'),
    morphMembrane: document.getElementById('morph-membrane'),
    morphMembraneV: document.getElementById('morph-membrane-v'),
    morphCilia: document.getElementById('morph-cilia'),
    morphCiliaV: document.getElementById('morph-cilia-v'),
    morphSpines: document.getElementById('morph-spines'),
    morphSpinesV: document.getElementById('morph-spines-v'),
    // Organism list
    organismList: document.getElementById('organism-list'),
    orgLess: document.getElementById('org-less'),
    orgMore: document.getElementById('org-more'),
    orgCountLabel: document.getElementById('org-count-label'),
    // World controls
    worldSize: document.getElementById('worldSize'),
    blobWeird: document.getElementById('blobWeird')
  }

  const cfg = defaultConfig()

  const params = readParams()

  if (params.seed) cfg.seed = params.seed
  el.seed.value = cfg.seed

  const sim = new Sim(cfg)
  const renderer = new Renderer(el.canvas)

  let running = true
  let totalBirths = 0
  let generation = 0

  // Organism panel display count (adjustable via +/- buttons)
  let maxOrgDisplay = 3
  if (el.orgCountLabel) el.orgCountLabel.textContent = maxOrgDisplay
  if (el.orgMore)
    el.orgMore.addEventListener('click', () => {
      maxOrgDisplay = Math.min(20, maxOrgDisplay + 1)
      if (el.orgCountLabel) el.orgCountLabel.textContent = maxOrgDisplay
    })
  if (el.orgLess)
    el.orgLess.addEventListener('click', () => {
      maxOrgDisplay = Math.max(1, maxOrgDisplay - 1)
      if (el.orgCountLabel) el.orgCountLabel.textContent = maxOrgDisplay
    })

  // ── Science tools state ──
  const experimentLog = new ExperimentLog()
  const alleleTracker = new AlleleTracker()
  const mullerTracker = new MullerTracker()
  const selectionTracker = new SelectionTracker()
  const envScript = new EnvironmentScript()
  const splitWorld = new SplitWorld()
  sim.splitWorld = splitWorld // expose for step.js per-cell parameter mods
  let selectedCell = null // for genome browser
  let lastPopGenMetrics = null
  let lastPopGenAt = 0

  experimentLog.logReset(0, cfg.seed, cfg)

  const SAFETY = {
    maxStepsPerFrame: 70,
    frameTimeBudgetMs: 6,
    hardMaxOrganisms: Infinity
  }

  function applyPreset(name) {
    if (name === 'patchy') {
      el.food.value = '1.2'
      el.patch.value = '0.75'
      el.mutation.value = '0.06'
      el.maxOrganisms.value = '900'
    } else if (name === 'uniform') {
      el.food.value = '1.05'
      el.patch.value = '0.18'
      el.mutation.value = '0.05'
      el.maxOrganisms.value = '1100'
    } else if (name === 'harsh') {
      el.food.value = '0.80'
      el.patch.value = '0.85'
      el.mutation.value = '0.08'
      el.maxOrganisms.value = '750'
    }
  }

  function initUiFromParams() {
    const preset =
      params.preset && ['patchy', 'uniform', 'harsh'].includes(params.preset)
        ? params.preset
        : el.preset.value
    el.preset.value = preset
    applyPreset(preset)

    if (params.speed != null) el.speed.value = `${Math.max(1, params.speed)}`
    if (params.mutation != null) el.mutation.value = `${Math.max(0, params.mutation)}`
    if (params.food != null) el.food.value = `${Math.max(0, params.food)}`
    if (params.patch != null) el.patch.value = `${clamp(params.patch, 0, 1)}`
    if (params.maxOrganisms != null) el.maxOrganisms.value = `${Math.max(1, params.maxOrganisms)}`

    el.showFood.checked = truthyParam(params.showFood, el.showFood.checked)
    el.showLinks.checked = truthyParam(params.showLinks, el.showLinks.checked)

    pushUiToSim()
  }

  function makeShareUrl() {
    const u = new URL(window.location.href)
    const p = u.searchParams
    p.set('seed', el.seed.value.trim() || cfg.seed)
    p.set('preset', el.preset.value)
    p.set('speed', `${parseInt(el.speed.value, 10)}`)
    p.set('mutation', `${Number(el.mutation.value)}`)
    p.set('food', `${Number(el.food.value)}`)
    p.set('patch', `${Number(el.patch.value)}`)
    p.set('maxOrganisms', `${parseInt(el.maxOrganisms.value, 10)}`)
    p.set('showFood', el.showFood.checked ? '1' : '0')
    p.set('showLinks', el.showLinks.checked ? '1' : '0')
    p.set('camera', el.cameraMode.value)
    u.search = p.toString()
    return u.toString()
  }

  function pushUiToSim() {
    const patch = {
      mutationRate: parseFloat(el.mutation.value),
      foodGrowth: parseFloat(el.food.value),
      patchiness: parseFloat(el.patch.value),
      maxOrganisms: parseInt(el.maxOrganisms.value, 10)
    }
    // Log parameter changes
    for (const [k, v] of Object.entries(patch)) {
      if (sim.cfg[k] !== v) {
        experimentLog.logParamChange(sim.t, k, sim.cfg[k], v)
      }
    }
    sim.setConfigPatch(patch)

    el.speedV.textContent = `${el.speed.value}`
  }

  initUiFromParams()

  function setRunning(next) {
    if (running === next) return
    running = next
    if (el.play) el.play.textContent = running ? 'Pause' : 'Play'
    if (running) {
      const now = performance.now()
      lastFrameAt = now
      lastSimAt = now
      lastRenderAt = now
      lastStatsAt = now
      stepsWindowAt = now
    }
  }

  el.play.addEventListener('click', () => {
    setRunning(!running)
  })

  el.step.addEventListener('click', () => {
    if (!running) {
      const target = Math.max(1, parseInt(el.speed.value, 10))
      const cap = Math.min(target, SAFETY.maxStepsPerFrame)
      const start = performance.now()
      for (let i = 0; i < cap; i++) {
        sim.step()
        if (performance.now() - start > SAFETY.frameTimeBudgetMs) break
      }
      draw(performance.now())
    }
  })

  function doReset() {
    const seed = el.seed.value?.trim() || randomSeed()
    el.seed.value = seed
    sim.reset(seed)
    totalBirths = 0
    generation = 0
    selectedCell = null
    experimentLog.logReset(sim.t, seed, sim.cfg)
    // Reapply blob weirdness from slider after reset
    if (el.blobWeird) {
      const weird = parseInt(el.blobWeird.value, 10) / 100
      if (weird > 0) {
        sim.blobWeirdness = weird
        sim._regenerateBlobShape(weird)
      }
    }
    pushUiToSim()
  }

  el.reset.addEventListener('click', () => doReset())

  el.reroll.addEventListener('click', () => {
    el.seed.value = randomSeed()
    doReset()
  })

  // ── Save simulation state to JSON file ──
  el.save.addEventListener('click', () => {
    const state = sim.serialize()
    const json = JSON.stringify(state)
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(json)
    const a = document.createElement('a')
    a.setAttribute('href', dataUri)
    a.setAttribute('download', `evoio-save-t${sim.t}-${ts}.json`)
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    el.save.textContent = '✓ Saved'
    setTimeout(() => (el.save.textContent = '💾 Save'), 1200)
  })

  // ── Import simulation state from JSON file ──
  el.importBtn.addEventListener('click', () => {
    el.importFile.click()
  })

  el.importFile.addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const state = JSON.parse(ev.target.result)
        sim.loadState(state)
        organismNames.clear()
        el.importBtn.textContent = '✓ Loaded'
        setTimeout(() => (el.importBtn.textContent = '📂 Import'), 1500)
      } catch (err) {
        console.error('Failed to import save:', err)
        alert('Failed to import save file: ' + err.message)
      }
    }
    reader.readAsText(file)
    el.importFile.value = '' // reset so same file can be re-imported
  })

  el.copylink.addEventListener('click', async () => {
    const url = makeShareUrl()
    try {
      await navigator.clipboard.writeText(url)
      el.copylink.textContent = 'Copied'
      setTimeout(() => (el.copylink.textContent = 'Copy link'), 900)
    } catch {
      window.prompt('Copy this link:', url)
    }
  })

  el.preset.addEventListener('change', () => {
    applyPreset(el.preset.value)
    pushUiToSim()
  })

  for (const input of [el.speed, el.mutation, el.food, el.patch, el.maxOrganisms]) {
    input.addEventListener('input', () => pushUiToSim())
  }

  // World size: requires full reset (new food grids)
  el.worldSize.addEventListener('change', () => {
    const sz = parseInt(el.worldSize.value, 10)
    const h = Math.round(sz / 2) // 2:1 aspect ratio
    // Use the sim's live config so current UI settings (mutation, food, etc.) are preserved
    const liveCfg = structuredClone(sim.cfg)
    liveCfg.w = sz
    liveCfg.h = h
    liveCfg.seed = el.seed.value || liveCfg.seed
    Object.assign(sim, new Sim(liveCfg))
    Object.setPrototypeOf(sim, Sim.prototype)
    // Keep outer cfg in sync
    Object.assign(cfg, liveCfg)
    // Reapply blob weirdness from slider after world resize
    if (el.blobWeird) {
      const weird = parseInt(el.blobWeird.value, 10) / 100
      if (weird > 0) {
        sim.blobWeirdness = weird
        sim._regenerateBlobShape(weird)
      }
    }
    freeCam.x = sim.w / 2
    freeCam.y = sim.h / 2
    camTarget = { x: sim.w / 2, y: sim.h / 2 }
    pushUiToSim()
  })

  // Blob weirdness: regenerate blob shape only
  el.blobWeird.addEventListener('input', () => {
    const weird = parseInt(el.blobWeird.value, 10) / 100 // 0..1
    sim.blobWeirdness = weird
    sim._regenerateBlobShape(weird)
    pushUiToSim()
  })

  el.seed.addEventListener('change', () => {
    el.seed.value = el.seed.value.trim()
  })

  // ── Low Fidelity Mode ──
  const _lofiMap = [
    ['lofiWater', 'water'],
    ['lofiFoodOverlay', 'foodOverlay'],
    ['lofiFoodBuds', 'foodBuds'],
    ['lofiTerrain', 'terrain'],
    ['lofiTrails', 'trails'],
    ['lofiHulls', 'hulls'],
    ['lofiParticles', 'particles'],
    ['lofiMorphology', 'morphology'],
    ['lofiOrganelles', 'organelles'],
    ['lofiGlow', 'glow']
  ]
  function syncLofi() {
    renderer.lofi.enabled = el.lofiEnabled.checked
    for (const [elKey, flag] of _lofiMap) {
      if (el[elKey]) renderer.lofi[flag] = el[elKey].checked
    }
    // Visual feedback: dim individual options when master is on
    if (el.lofiOptions) {
      el.lofiOptions.classList.toggle('lofi-hidden', el.lofiEnabled.checked)
    }
  }
  el.lofiEnabled.addEventListener('change', syncLofi)
  for (const [elKey] of _lofiMap) {
    if (el[elKey]) el[elKey].addEventListener('change', syncLofi)
  }

  // ══════════════════════════════════════
  //  SCIENCE TOOLS — Export buttons
  // ══════════════════════════════════════
  const btnExportCSV = document.getElementById('btn-export-csv')
  const btnExportCells = document.getElementById('btn-export-cells')
  const btnExportNewick = document.getElementById('btn-export-newick')
  const btnExportAlleles = document.getElementById('btn-export-alleles')
  const btnExportMuller = document.getElementById('btn-export-muller')
  const btnExportLog = document.getElementById('btn-export-log')
  const btnExportGenome = document.getElementById('btn-export-genome')

  if (btnExportCSV)
    btnExportCSV.addEventListener('click', () => {
      exportTimeSeriesCSV(history, sim)
      btnExportCSV.textContent = 'Saved'
      setTimeout(() => (btnExportCSV.textContent = 'CSV Stats'), 1200)
    })
  if (btnExportCells)
    btnExportCells.addEventListener('click', () => {
      exportCellSnapshotCSV(sim)
      btnExportCells.textContent = 'Saved'
      setTimeout(() => (btnExportCells.textContent = 'Cells CSV'), 1200)
    })
  if (btnExportNewick)
    btnExportNewick.addEventListener('click', () => {
      exportPhyloNewick(sim, organismNames)
      btnExportNewick.textContent = 'Saved'
      setTimeout(() => (btnExportNewick.textContent = 'Newick Tree'), 1200)
    })
  if (btnExportAlleles)
    btnExportAlleles.addEventListener('click', () => {
      alleleTracker.exportCSV(sim)
      btnExportAlleles.textContent = 'Saved'
      setTimeout(() => (btnExportAlleles.textContent = 'Alleles CSV'), 1200)
    })
  if (btnExportMuller)
    btnExportMuller.addEventListener('click', () => {
      mullerTracker.exportCSV(sim)
      btnExportMuller.textContent = 'Saved'
      setTimeout(() => (btnExportMuller.textContent = 'Muller CSV'), 1200)
    })
  if (btnExportLog)
    btnExportLog.addEventListener('click', () => {
      experimentLog.export(sim)
      btnExportLog.textContent = 'Saved'
      setTimeout(() => (btnExportLog.textContent = 'Exp Log'), 1200)
    })
  if (btnExportGenome)
    btnExportGenome.addEventListener('click', () => {
      if (!selectedCell) {
        alert('No cell selected. Click a cell on the canvas first.')
        return
      }
      const name = organismNames.has(selectedCell.clade)
        ? organismNames.get(selectedCell.clade).scientificName
        : `clade_${selectedCell.clade}`
      exportGenomeDetail(selectedCell, name)
    })

  // ── Pokédex Export ──
  const btnExportPokedex = document.getElementById('btn-export-pokedex')
  if (btnExportPokedex)
    btnExportPokedex.addEventListener('click', async () => {
      btnExportPokedex.disabled = true
      btnExportPokedex.textContent = 'Rendering...'
      try {
        await exportPokedex(sim, ensureCladeName, organismNames, (msg, pct) => {
          btnExportPokedex.textContent = msg
        })
      } catch (e) {
        console.error('Pokédex export failed:', e)
        alert('Pokédex export failed: ' + e.message)
      }
      btnExportPokedex.disabled = false
      btnExportPokedex.textContent = 'Pokédex'
    })

  // ══════════════════════════════════════
  //  STRESS TEST
  // ══════════════════════════════════════
  const stressTest = new StressTest(sim, renderer)
  const stressCanvas = document.getElementById('stress-canvas')
  const stressSummary = document.getElementById('stress-summary')
  const btnStressStart = document.getElementById('btn-stress-start')
  const btnStressStop = document.getElementById('btn-stress-stop')
  const btnStressExport = document.getElementById('btn-stress-export')

  stressTest.onUpdate = () => {
    renderStressTestSummary(stressSummary, stressTest)
    drawStressTestChart(stressCanvas, stressTest)
    if (btnStressExport && stressTest.results.length > 0) {
      btnStressExport.disabled = false
      btnStressExport.textContent = `Export CSV (${stressTest.results.length})`
    }
  }
  stressTest.onDone = () => {
    renderStressTestSummary(stressSummary, stressTest)
    drawStressTestChart(stressCanvas, stressTest)
    if (btnStressStart) {
      btnStressStart.disabled = false
      btnStressStart.textContent = '\u25B6 Start'
    }
    if (btnStressStop) btnStressStop.disabled = true
    if (btnStressExport) {
      btnStressExport.disabled = false
      btnStressExport.textContent = 'Export CSV'
    }
  }

  if (btnStressStart) {
    btnStressStart.addEventListener('click', () => {
      if (stressTest.running) return
      stressTest.start()
      btnStressStart.disabled = true
      btnStressStart.textContent = 'Recording...'
      if (btnStressStop) btnStressStop.disabled = false
      if (btnStressExport) btnStressExport.disabled = true
      if (!running) setRunning(true)
    })
  }
  if (btnStressStop) {
    btnStressStop.addEventListener('click', () => {
      stressTest.stop()
      btnStressStart.disabled = false
      btnStressStart.textContent = '\u25B6 Start'
      btnStressStop.disabled = true
      renderStressTestSummary(stressSummary, stressTest)
    })
  }
  if (btnStressExport) {
    btnStressExport.addEventListener('click', () => {
      stressTest.exportCSV()
      btnStressExport.textContent = 'Saved'
      setTimeout(() => {
        btnStressExport.textContent = 'Export CSV'
      }, 1200)
    })
  }

  // ── Gene knockout toggles ──
  const koControls = document.getElementById('knockout-controls')
  if (koControls) {
    koControls.addEventListener('change', (e) => {
      const cb = e.target
      if (!cb.dataset.ko) return
      const trait = cb.dataset.ko
      if (cb.checked) {
        sim.geneOverrides[trait] = { mode: 'knockout' }
        experimentLog.logEvent(sim.t, 'gene_knockout', { trait })
      } else {
        delete sim.geneOverrides[trait]
        experimentLog.logEvent(sim.t, 'gene_restore', { trait })
      }
    })
  }

  // ── Selection coefficient export ──
  const btnExportSelection = document.getElementById('btn-export-selection')
  const selectionPanel = document.getElementById('selection-panel')
  if (btnExportSelection)
    btnExportSelection.addEventListener('click', () => {
      selectionTracker.exportCSV(sim)
      btnExportSelection.textContent = 'Saved'
      setTimeout(() => (btnExportSelection.textContent = 'Selection CSV'), 1200)
    })

  // ── Inject organism buttons ──
  const btnInjectRandom = document.getElementById('btn-inject-random')
  const btnInjectClone = document.getElementById('btn-inject-clone')
  const btnInjectPredator = document.getElementById('btn-inject-predator')
  const btnInjectPhototroph = document.getElementById('btn-inject-phototroph')

  function injectCell(overrides) {
    const cx = sim.blobCenter ? sim.blobCenter.x : sim.w / 2
    const cy = sim.blobCenter ? sim.blobCenter.y : sim.h / 2
    const clade = sim._nextClade++
    const cell = sim._makeCell({ x: cx, y: cy, energy: 3.0, clade, ...overrides })
    sim.cells.push(cell)
    sim._registerClade(clade, 0.0)
    sim.phyloTree.set(clade, {
      parentClade: null,
      founderGenome: { ...cell.g },
      birthTick: sim.t,
      extinctTick: null,
      depth: 0,
      children: []
    })
    experimentLog.logEvent(sim.t, 'inject_organism', { clade, type: overrides._type || 'custom' })
    return cell
  }

  if (btnInjectRandom)
    btnInjectRandom.addEventListener('click', () => {
      injectCell({ _type: 'random' })
      btnInjectRandom.textContent = 'Injected!'
      setTimeout(() => (btnInjectRandom.textContent = 'Random'), 800)
    })

  if (btnInjectClone)
    btnInjectClone.addEventListener('click', () => {
      if (!selectedCell) {
        alert('No cell selected. Click a cell on the canvas first.')
        return
      }
      const clonedG = { ...selectedCell.g }
      const clonedDna = selectedCell.dna ? new Float32Array(selectedCell.dna) : undefined
      injectCell({ genome: clonedG, dnaStrand: clonedDna, _type: 'clone' })
      btnInjectClone.textContent = 'Cloned!'
      setTimeout(() => (btnInjectClone.textContent = 'Clone Selected'), 800)
    })

  if (btnInjectPredator)
    btnInjectPredator.addEventListener('click', () => {
      // Create a random cell then override predator-relevant traits
      const cell = injectCell({ _type: 'predator' })
      cell.g.diet = 0.9
      cell.g.speed = 0.8
      cell.g.spike = 0.7
      cell.g.toxin = 0.6
      cell.g.aggression = 0.8
      cell.g.boldness = 0.7
      cell.g.sense = 0.7
      cell.g.eyespot = 0.5
      cell.energy = 4.0
      btnInjectPredator.textContent = 'Injected!'
      setTimeout(() => (btnInjectPredator.textContent = 'Predator'), 800)
    })

  if (btnInjectPhototroph)
    btnInjectPhototroph.addEventListener('click', () => {
      const cell = injectCell({ _type: 'phototroph' })
      cell.g.chloroplast = 0.9
      cell.g.diet = 0.05
      cell.g.adhesion = 0.6
      cell.g.elongation = 0.5
      cell.g.shell = 0.3
      cell.g.membrane = 0.6
      cell.g.speed = 0.2
      cell.g.phototropism = 0.7
      cell.energy = 3.0
      btnInjectPhototroph.textContent = 'Injected!'
      setTimeout(() => (btnInjectPhototroph.textContent = 'Phototroph'), 800)
    })

  // ── Clonal start checkbox ──
  const clonalStartCb = document.getElementById('clonal-start')
  if (clonalStartCb)
    clonalStartCb.addEventListener('change', () => {
      sim.cfg.clonalStart = clonalStartCb.checked
      experimentLog.logEvent(sim.t, 'clonal_start_toggle', { enabled: clonalStartCb.checked })
    })

  // ── Environment scripting ──
  const envScriptEl = document.getElementById('env-script')
  const btnScriptRun = document.getElementById('btn-script-run')
  const btnScriptClear = document.getElementById('btn-script-clear')
  const scriptStatus = document.getElementById('script-status')

  if (btnScriptRun)
    btnScriptRun.addEventListener('click', () => {
      const text = envScriptEl ? envScriptEl.value : ''
      envScript.parseScript(text)
      const nEvents = envScript.events.length
      const nRepeating = envScript.repeating.length
      if (scriptStatus) scriptStatus.textContent = `Loaded: ${nEvents} events, ${nRepeating} repeating`
      experimentLog.logEvent(sim.t, 'script_loaded', { nEvents, nRepeating })
    })

  if (btnScriptClear)
    btnScriptClear.addEventListener('click', () => {
      envScript.clear()
      if (envScriptEl) envScriptEl.value = ''
      if (scriptStatus) scriptStatus.textContent = 'Script cleared'
    })

  // ── A/B Split World controls ──
  const splitActiveCb = document.getElementById('split-active')
  const splitBarrierCb = document.getElementById('split-barrier')
  const splitFoodEl = document.getElementById('split-food')
  const splitMutationEl = document.getElementById('split-mutation')
  const splitMetabEl = document.getElementById('split-metab')
  const splitCanvas = document.getElementById('split-canvas')
  const splitStats = document.getElementById('split-stats')

  function updateSplitWorld() {
    splitWorld.active = splitActiveCb ? splitActiveCb.checked : false
    splitWorld.barrier = splitBarrierCb ? splitBarrierCb.checked : true
    splitWorld.sideB.foodGrowthMult = splitFoodEl ? parseFloat(splitFoodEl.value) || 1.0 : 1.0
    splitWorld.sideB.mutationRateMult = splitMutationEl ? parseFloat(splitMutationEl.value) || 1.0 : 1.0
    splitWorld.sideB.metabolismMult = splitMetabEl ? parseFloat(splitMetabEl.value) || 1.0 : 1.0
  }

  if (splitActiveCb)
    splitActiveCb.addEventListener('change', () => {
      updateSplitWorld()
      experimentLog.logEvent(sim.t, 'split_world_toggle', { active: splitWorld.active })
    })
  if (splitBarrierCb) splitBarrierCb.addEventListener('change', updateSplitWorld)
  if (splitFoodEl) splitFoodEl.addEventListener('input', updateSplitWorld)
  if (splitMutationEl) splitMutationEl.addEventListener('input', updateSplitWorld)
  if (splitMetabEl) splitMetabEl.addEventListener('input', updateSplitWorld)

  // Pop-gen metric display elements
  const pgNe = document.getElementById('pg-ne')
  const pgHe = document.getElementById('pg-he')
  const pgFst = document.getElementById('pg-fst')
  const pgPi = document.getElementById('pg-pi')
  const pgShannon = document.getElementById('pg-shannon')
  const pgFitSD = document.getElementById('pg-fitsd')
  const pgGenTime = document.getElementById('pg-gentime')
  const popgenCanvas = document.getElementById('popgen-canvas')
  const mullerCanvas = document.getElementById('muller-canvas')
  const genomeCanvas = document.getElementById('genome-canvas')
  const genomeCellInfo = document.getElementById('genome-cell-info')
  const genomeGenes = document.getElementById('genome-genes')

  function updateGenomeBrowser() {
    if (!selectedCell || !genomeCellInfo) return

    // Check if cell still exists
    let found = false
    for (let i = 0; i < sim.cells.length; i++) {
      if (sim.cells[i].id === selectedCell.id) {
        selectedCell = sim.cells[i] // refresh reference
        found = true
        break
      }
    }
    if (!found) {
      genomeCellInfo.textContent = 'Cell died — click another'
      return
    }

    ensureCladeName(selectedCell.clade, sim)
    const entry = organismNames.get(selectedCell.clade)
    const name = entry ? entry.scientificName : `Clade ${selectedCell.clade}`

    genomeCellInfo.innerHTML =
      `<b>${name}</b> (id:${selectedCell.id}) ` +
      `age:${selectedCell.age} e:${selectedCell.energy.toFixed(2)} ` +
      `links:${selectedCell.linkCount} cx:${(selectedCell.complexity || 0).toFixed(1)}`

    // Draw genome strand visualization
    const browserData = getGenomeBrowserData(selectedCell)
    if (browserData && genomeCanvas) {
      drawGenomeStrand(genomeCanvas, browserData)
    }

    // Gene list
    if (browserData && genomeGenes) {
      let html =
        `<div style="margin-bottom:2px;color:#8f9bb7">` +
        `${browserData.stats.length} bases, ${browserData.stats.geneCount} genes, ` +
        `${(browserData.stats.codingFraction * 100).toFixed(1)}% coding</div>`

      if (browserData.genes.length > 0) {
        html += '<table style="width:100%;border-collapse:collapse">'
        html += '<tr style="color:#667"><td>Gene</td><td>Pos</td><td>Len</td><td>Expr</td></tr>'
        for (let gi = 0; gi < Math.min(browserData.genes.length, 12); gi++) {
          const gene = browserData.genes[gi]
          html +=
            `<tr><td>#${gi + 1}</td><td>${gene.start}-${gene.end}</td>` +
            `<td>${gene.length}</td><td>${gene.expression.toFixed(2)}</td></tr>`
        }
        html += '</table>'
      }

      // Top trait contributions
      if (browserData.codons.length > 0) {
        const traitContrib = {}
        for (const codon of browserData.codons) {
          if (!traitContrib[codon.traitName]) traitContrib[codon.traitName] = 0
          traitContrib[codon.traitName] += Math.abs(codon.contribution)
        }
        const sorted = Object.entries(traitContrib)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
        html += '<div style="margin-top:3px;color:#8f9bb7">Top encoded traits:</div>'
        for (const [trait, contrib] of sorted) {
          const pct = Math.min(100, contrib * 50).toFixed(0)
          html +=
            `<div style="display:flex;align-items:center;gap:4px">` +
            `<span style="width:55px;overflow:hidden;text-overflow:ellipsis">${trait}</span>` +
            `<div style="flex:1;height:4px;background:rgba(255,255,255,0.05);border-radius:2px">` +
            `<div style="width:${pct}%;height:100%;background:#4fc3f7;border-radius:2px"></div></div>` +
            `<span style="width:25px;text-align:right;color:#667">${contrib.toFixed(2)}</span></div>`
        }
      }

      genomeGenes.innerHTML = html
    }
  }

  function drawGenomeStrand(canvas, data) {
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

    const n = data.strandLength
    if (n === 0) return

    const pad = 4
    const w = cw - pad * 2
    const h = ch - pad * 2
    const baseW = w / n

    // Draw junk DNA as dark background
    ctx.fillStyle = 'rgba(40,45,55,0.8)'
    ctx.fillRect(pad, pad, w, h)

    // Draw genes as colored regions
    for (let gi = 0; gi < data.genes.length; gi++) {
      const gene = data.genes[gi]
      const x = pad + (gene.start / n) * w
      const gw = ((gene.end - gene.start) / n) * w
      const hue = (gi * 137 + 200) % 360
      const alpha = 0.3 + gene.expression * 0.3
      ctx.fillStyle = `hsla(${hue}, 65%, 55%, ${alpha})`
      ctx.fillRect(x, pad, Math.max(1, gw), h)

      // Gene boundary markers
      ctx.fillStyle = `hsla(${hue}, 80%, 75%, 0.8)`
      ctx.fillRect(x, pad, Math.max(1, baseW * 0.5), h) // start
      ctx.fillRect(x + gw - Math.max(1, baseW * 0.5), pad, Math.max(1, baseW * 0.5), h) // stop
    }

    // Draw codon dots for top contributions
    for (const codon of data.codons) {
      const x = pad + (codon.pos / n) * w + baseW * 1.5
      const intensity = Math.min(1, Math.abs(codon.contribution) * 3)
      if (intensity < 0.1) continue
      const dotColor =
        codon.contribution > 0
          ? `rgba(100,220,255,${intensity * 0.8})`
          : `rgba(255,100,100,${intensity * 0.8})`
      ctx.fillStyle = dotColor
      const dotY = pad + h * 0.3 + (codon.traitIdx / 66) * h * 0.4
      ctx.fillRect(x, dotY, Math.max(1, baseW * 2), 2)
    }

    // Label
    ctx.fillStyle = 'rgba(200,210,230,0.6)'
    ctx.font = '7px ui-sans-serif,system-ui,sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(`${n} bases`, pad + 2, pad + 8)
    ctx.textAlign = 'right'
    ctx.fillText(`${data.genes.length} genes`, cw - pad - 2, pad + 8)
  }

  // Log parameter changes
  function logParamChange(param, oldVal, newVal) {
    experimentLog.logParamChange(sim.t, param, oldVal, newVal)
  }

  // Initialize draggable collapsible panel system
  initPanels()

  // ══════════════════════════════════════
  //  TIME-SERIES GRAPH
  // ══════════════════════════════════════
  const MAX_HISTORY = 600
  const history = {
    t: [],
    multicell: [],
    pop: [],
    diversity: [],
    adhesion: [],
    speed: [],
    diet: [],
    herb: [],
    omni: [],
    carn: [],
    kills: []
  }
  let graphMetric = 'multicell'
  let graphScale = 'true'
  const graphCanvas = document.getElementById('graph-canvas')
  const graphCtx = graphCanvas ? graphCanvas.getContext('2d') : null

  // Listen for metric radio changes
  document.querySelectorAll('input[name="graph-metric"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      graphMetric = e.target.value
    })
  })

  document.querySelectorAll('input[name="graph-scale"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      graphScale = e.target.value
    })
  })

  function recordHistory(s) {
    history.t.push(s.t)
    history.multicell.push(s.multicellFraction)
    history.pop.push(s.pop)
    // Diversity: count unique clades
    const clades = new Set()
    for (let i = 0; i < sim.cells.length; i++) clades.add(sim.cells[i].clade)
    history.diversity.push(clades.size)
    history.adhesion.push(s.meanAdhesion)
    history.speed.push(s.meanSpeed)
    history.diet.push(s.meanDiet || 0)
    history.herb.push(s.herbivores)
    history.omni.push(s.omnivores)
    history.carn.push(s.carnivores)
    history.kills.push(s.kills)
    // Trim to max
    if (history.t.length > MAX_HISTORY) {
      for (const key of Object.keys(history)) history[key].shift()
    }
  }

  function drawGraph() {
    if (!graphCtx || !graphCanvas) return
    const ctx = graphCtx
    const dpr = window.devicePixelRatio || 1
    const cw = graphCanvas.clientWidth
    const ch = graphCanvas.clientHeight
    if (graphCanvas.width !== cw * dpr || graphCanvas.height !== ch * dpr) {
      graphCanvas.width = cw * dpr
      graphCanvas.height = ch * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)

    const pad = { l: 30, r: 6, t: 18, b: 16 }
    const gw = cw - pad.l - pad.r
    const gh = ch - pad.t - pad.b

    // ── Ecology mode: stacked area chart ──
    if (graphMetric === 'ecology') {
      const useLogScale = graphScale === 'log'
      const n = history.herb.length
      if (n < 2) {
        ctx.fillStyle = 'rgba(140,155,183,0.4)'
        ctx.font = '10px ui-sans-serif,system-ui,sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Collecting data...', cw / 2, ch / 2)
        return
      }
      // Find max total population for scaling
      let maxTotal = 1
      for (let i = 0; i < n; i++) {
        const total = (history.herb[i] || 0) + (history.omni[i] || 0) + (history.carn[i] || 0)
        if (total > maxTotal) maxTotal = total
      }
      const maxScaledTotal = useLogScale ? Math.log1p(maxTotal) : maxTotal

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
        const frac = gi / 4
        const val = useLogScale ? Math.expm1(maxScaledTotal * frac) : maxTotal * frac
        const gy = pad.t + gh * (1 - gi / 4)
        ctx.fillText(val.toFixed(0), pad.l - 3, gy + 3)
      }

      // X-axis
      ctx.textAlign = 'center'
      if (history.t.length > 1) {
        ctx.fillText(`${history.t[0]}`, pad.l, ch - 2)
        ctx.fillText(`${history.t[n - 1]}`, pad.l + gw, ch - 2)
      }

      // Title
      ctx.fillStyle = 'rgba(200,210,230,0.7)'
      ctx.font = '9px ui-sans-serif,system-ui,sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('Ecology (Herb / Omni / Carn)', pad.l, pad.t - 5)

      // Stacked areas: draw bottom to top (herb, then omni on top, then carn on top)
      const layers = [
        { data: history.herb, fill: 'rgba(74,222,128,0.25)', line: '#4ade80' },
        { data: history.omni, fill: 'rgba(251,191,36,0.25)', line: '#fbbf24' },
        { data: history.carn, fill: 'rgba(248,113,113,0.3)', line: '#f87171' }
      ]

      // Compute cumulative stacks
      const stacks = []
      for (let i = 0; i < n; i++) {
        let cum = 0
        const row = [0]
        for (const layer of layers) {
          cum += layer.data[i] || 0
          row.push(cum)
        }
        stacks.push(row)
      }

      // Draw each layer as filled area between its bottom and top
      for (let li = layers.length - 1; li >= 0; li--) {
        const layer = layers[li]
        ctx.beginPath()
        // Top edge (left to right)
        for (let i = 0; i < n; i++) {
          const x = pad.l + (i / (n - 1)) * gw
          const topVal = useLogScale ? Math.log1p(stacks[i][li + 1]) : stacks[i][li + 1]
          const y = pad.t + gh * (1 - topVal / maxScaledTotal)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        // Bottom edge (right to left)
        for (let i = n - 1; i >= 0; i--) {
          const x = pad.l + (i / (n - 1)) * gw
          const botVal = useLogScale ? Math.log1p(stacks[i][li]) : stacks[i][li]
          const y = pad.t + gh * (1 - botVal / maxScaledTotal)
          ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.fillStyle = layer.fill
        ctx.fill()

        // Top edge line
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const x = pad.l + (i / (n - 1)) * gw
          const topVal = useLogScale ? Math.log1p(stacks[i][li + 1]) : stacks[i][li + 1]
          const y = pad.t + gh * (1 - topVal / maxScaledTotal)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = layer.line
        ctx.lineWidth = 1.0
        ctx.lineJoin = 'round'
        ctx.stroke()
      }

      // Legend
      ctx.font = '7px ui-sans-serif,system-ui,sans-serif'
      const legendX = pad.l + gw - 80
      const legendItems = [
        { color: '#4ade80', label: `Herb ${history.herb[n - 1]}` },
        { color: '#fbbf24', label: `Omni ${history.omni[n - 1]}` },
        { color: '#f87171', label: `Carn ${history.carn[n - 1]}` }
      ]
      for (let li2 = 0; li2 < legendItems.length; li2++) {
        const item = legendItems[li2]
        const ly = pad.t + 2 + li2 * 10
        ctx.fillStyle = item.color
        ctx.fillRect(legendX, ly, 6, 6)
        ctx.globalAlpha = 0.7
        ctx.fillStyle = item.color
        ctx.textAlign = 'left'
        ctx.fillText(item.label, legendX + 9, ly + 5.5)
        ctx.globalAlpha = 1
      }
      return
    }

    // ── Standard single-line graph ──
    const data = history[graphMetric]
    if (!data || data.length < 2) {
      ctx.fillStyle = 'rgba(140,155,183,0.4)'
      ctx.font = '10px ui-sans-serif,system-ui,sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Collecting data...', cw / 2, ch / 2)
      return
    }

    const n = data.length
    let maxVal = 0
    for (let i = 0; i < n; i++) if (data[i] > maxVal) maxVal = data[i]
    if (maxVal === 0) maxVal = 1
    const useLogScale = graphScale === 'log'
    const maxScaledVal = useLogScale ? Math.log1p(maxVal) : maxVal

    const colors = {
      multicell: { line: '#4fc3f7', fill: 'rgba(79,195,247,0.12)', label: 'Multicellularity' },
      pop: { line: '#81c784', fill: 'rgba(129,199,132,0.12)', label: 'Population' },
      diversity: { line: '#ffb74d', fill: 'rgba(255,183,77,0.12)', label: 'Species Diversity' },
      adhesion: { line: '#ce93d8', fill: 'rgba(206,147,216,0.12)', label: 'Mean Adhesion' },
      speed: { line: '#4dd0e1', fill: 'rgba(77,208,225,0.12)', label: 'Mean Speed' },
      diet: { line: '#ef5350', fill: 'rgba(239,83,80,0.12)', label: 'Mean Diet' },
      kills: { line: '#ff5252', fill: 'rgba(255,82,82,0.12)', label: 'Total Kills' }
    }
    const c = colors[graphMetric] || colors.multicell

    // Background grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + gh * (1 - i / 4)
      ctx.beginPath()
      ctx.moveTo(pad.l, y)
      ctx.lineTo(pad.l + gw, y)
      ctx.stroke()
    }

    // Y-axis labels
    ctx.fillStyle = 'rgba(140,155,183,0.5)'
    ctx.font = '8px ui-sans-serif,system-ui,sans-serif'
    ctx.textAlign = 'right'
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4
      const val = useLogScale ? Math.expm1(maxScaledVal * frac) : maxVal * frac
      const y = pad.t + gh * (1 - i / 4)
      ctx.fillText(val >= 10 ? val.toFixed(0) : val.toFixed(2), pad.l - 3, y + 3)
    }

    // X-axis tick range
    ctx.textAlign = 'center'
    if (history.t.length > 1) {
      ctx.fillText(`${history.t[0]}`, pad.l, ch - 2)
      ctx.fillText(`${history.t[n - 1]}`, pad.l + gw, ch - 2)
    }

    // Title
    ctx.fillStyle = 'rgba(200,210,230,0.7)'
    ctx.font = '9px ui-sans-serif,system-ui,sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(useLogScale ? `${c.label} (log)` : c.label, pad.l, pad.t - 5)

    // Fill area
    ctx.beginPath()
    ctx.moveTo(pad.l, pad.t + gh)
    for (let i = 0; i < n; i++) {
      const x = pad.l + (i / (n - 1)) * gw
      const yVal = useLogScale ? Math.log1p(data[i]) : data[i]
      const y = pad.t + gh * (1 - yVal / maxScaledVal)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(pad.l + gw, pad.t + gh)
    ctx.closePath()
    ctx.fillStyle = c.fill
    ctx.fill()

    // Line
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = pad.l + (i / (n - 1)) * gw
      const yVal = useLogScale ? Math.log1p(data[i]) : data[i]
      const y = pad.t + gh * (1 - yVal / maxScaledVal)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = c.line
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Current value dot
    const lastX = pad.l + gw
    const lastYVal = useLogScale ? Math.log1p(data[n - 1]) : data[n - 1]
    const lastY = pad.t + gh * (1 - lastYVal / maxScaledVal)
    ctx.fillStyle = c.line
    ctx.beginPath()
    ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // ══════════════════════════════════════
  //  FAST-FORWARD
  // ══════════════════════════════════════
  const btnFF = document.getElementById('btn-ff')
  const ffTicksInput = document.getElementById('ff-ticks')
  if (btnFF) {
    btnFF.addEventListener('click', () => {
      const ticks = parseInt(ffTicksInput?.value || '1000', 10)
      if (ticks < 1 || ticks > 50000) return
      const wasRunning = running
      setRunning(false)
      btnFF.textContent = 'Running...'
      btnFF.disabled = true

      // Run in chunks to avoid blocking UI completely
      let done = 0
      const chunkSize = 50
      function runChunk() {
        const start = performance.now()
        const end = Math.min(done + chunkSize, ticks)
        for (let i = done; i < end; i++) {
          sim.step()
        }
        done = end

        // Record history periodically during FF
        if (done % 100 === 0 || done >= ticks) {
          const s = sim.stats()
          recordHistory(s)
        }

        if (done < ticks) {
          btnFF.textContent = `${done}/${ticks}`
          setTimeout(runChunk, 0)
        } else {
          btnFF.textContent = 'FF'
          btnFF.disabled = false
          if (wasRunning) setRunning(true)
          updateHud()
          drawGraph()
        }
      }
      runChunk()
    })
  }

  let lastStatsAt = 0
  let lastRenderAt = 0
  let lastSimAt = 0
  let lastCamAt = 0
  let camTarget = { x: sim.w / 2, y: sim.h / 2 }

  let lastFrameAt = performance.now()
  let fpsEma = 60
  let simMsEma = 0
  let renderMsEma = 0
  let avgStepMsEma = 0.08
  let stepsSince = 0
  let stepsWindowAt = performance.now()

  function updateHud() {
    let s
    try {
      s = sim.stats()
    } catch (e) {
      console.error('stats() failed:', e)
      return
    }
    try {
      if (el.hudT) el.hudT.textContent = `${s.t}`

      // Day/Night cycle
      // Actual sun curve: phase 0.0 = midnight, 0.125 = dawn, 0.25 = noon, 0.375 = dusk, 0.5 = midnight
      // The cycle repeats symmetrically: 0.5–1.0 mirrors 0.0–0.5
      if (el.hudDaynight) {
        const phase = s.dayPhase || 0
        // Normalize to a 0..1 "time of day" where 0=midnight, 0.5=noon
        const tod = phase < 0.5 ? phase * 2 : (1 - phase) * 2 // 0..1..0 triangle
        let timeLabel
        if (tod < 0.15) timeLabel = 'Night'
        else if (tod < 0.35) timeLabel = 'Dawn'
        else if (tod < 0.65) timeLabel = 'Day'
        else if (tod < 0.85) timeLabel = 'Dusk'
        else timeLabel = 'Night'
        el.hudDaynight.textContent = `${timeLabel} (d${s.dayCount || 0})`
      }
      if (el.hudSunIcon) {
        const phase = s.dayPhase || 0
        const intensity = s.sunIntensity || 0
        el.hudSunIcon.textContent = intensity > 0.4 ? '\u2600' : '\u263E'
        el.hudSunIcon.style.color = intensity > 0.4 ? '#fbbf24' : '#94a3b8'
      }

      if (el.hudOrgs) el.hudOrgs.textContent = `${s.organismCount}`
      if (el.hudPop) el.hudPop.textContent = `${s.pop}`

      // Species count (unique clades)
      if (el.hudSpecies) {
        const cladeSet = new Set()
        for (let i = 0; i < sim.cells.length; i++) cladeSet.add(sim.cells[i].clade)
        el.hudSpecies.textContent = `${cladeSet.size}`
      }

      // Multicell %
      if (el.hudMulticell) {
        el.hudMulticell.textContent = `${(s.multicellFraction * 100).toFixed(0)}%`
      }

      // Diet breakdown
      if (el.hudHerb) el.hudHerb.textContent = `${s.herbivores}`
      if (el.hudOmni) el.hudOmni.textContent = `${s.omnivores}`
      if (el.hudCarn) el.hudCarn.textContent = `${s.carnivores}`

      // Kills
      if (el.hudKills) el.hudKills.textContent = `${s.kills}`

      // Mean energy
      if (el.hudEnergy) {
        let eSum = 0
        for (let i = 0; i < sim.cells.length; i++) eSum += sim.cells[i].energy
        el.hudEnergy.textContent = sim.cells.length > 0 ? fmt(eSum / sim.cells.length, 2) : '0'
      }

      // Current biome (based on camera center)
      if (el.hudBiome && sim.cfg.biomes && sim.cfg.biomes.length > 0) {
        const bi = sim.getBiomeAt(renderer.view.cx, renderer.view.cy)
        const biome = sim.cfg.biomes[bi]
        el.hudBiome.textContent = biome ? biome.name : '—'
      }

      // Update status panel
      if (el.statusGen) el.statusGen.textContent = `${generation}`
      if (el.statusBirths) el.statusBirths.textContent = `${totalBirths}`

      // Calculate food level
      let totalFood = 0
      if (sim.food && sim.food.length) {
        for (let i = 0; i < sim.food.length; i++) totalFood += sim.food[i]
      }
      const maxFood = sim.w * sim.h * 8.0
      const foodPercent = maxFood > 0 ? ((totalFood / maxFood) * 100).toFixed(1) : '0.0'
      if (el.statusFood) el.statusFood.textContent = `${foodPercent}%`

      // Season
      if (el.statusSeason) el.statusSeason.textContent = `${s.season}`

      // Day/Night on status panel too
      if (el.statusDaynight) {
        const phase = s.dayPhase || 0
        let timeLabel
        if (phase < 0.15) timeLabel = 'Dawn'
        else if (phase < 0.4) timeLabel = 'Day'
        else if (phase < 0.55) timeLabel = 'Dusk'
        else timeLabel = 'Night'
        el.statusDaynight.textContent = `${timeLabel} (d${s.dayCount || 0})`
      }
      if (el.sunIcon) {
        const phase = s.dayPhase || 0
        el.sunIcon.textContent = phase < 0.55 ? '\u2600' : '\u263E'
        el.sunIcon.style.color = phase < 0.55 ? '#fbbf24' : '#94a3b8'
      }

      // Organelle bars
      const orgPct = (v) => `${(v * 100).toFixed(0)}%`
      const setBar = (barEl, valEl, v) => {
        if (barEl) barEl.style.width = `${Math.min(100, v * 100).toFixed(1)}%`
        if (valEl) valEl.textContent = orgPct(v)
      }
      setBar(el.orgNucleus, el.orgNucleusV, s.meanNucleus)
      setBar(el.orgMito, el.orgMitoV, s.meanMito)
      setBar(el.orgFlagella, el.orgFlagellaV, s.meanFlagella)
      setBar(el.orgReceptor, el.orgReceptorV, s.meanReceptor)
      setBar(el.orgVacuole, el.orgVacuoleV, s.meanVacuole)

      // Mechanism bars
      setBar(el.mechFlagella, el.mechFlagellaV, s.meanFlagellaG)
      setBar(el.mechCilia, el.mechCiliaV, s.meanCiliaG)
      setBar(el.mechJet, el.mechJetV, s.meanJet)
      setBar(el.mechAmoeboid, el.mechAmoeboidV, s.meanAmoeboid)
      setBar(el.mechToxin, el.mechToxinV, s.meanToxin)
      setBar(el.mechSpike, el.mechSpikeV, s.meanSpike)
      setBar(el.mechConstrict, el.mechConstrictV, s.meanConstrict)
      setBar(el.mechMembrane, el.mechMembraneV, s.meanMembrane)
      setBar(el.mechSpines, el.mechSpinesV, s.meanSpines)
      setBar(el.mechCamo, el.mechCamoV, s.meanCamo)
      setBar(el.mechToxResist, el.mechToxResistV, s.meanToxResist)
      setBar(el.mechElong, el.mechElongV, s.meanElongation)
      setBar(el.mechBiolum, el.mechBiolumV, s.meanBiolum)
      setBar(el.mechVesicles, el.mechVesiclesV, s.meanVesicles)
      setBar(el.mechPaddle, el.mechPaddleV, s.meanPaddleFin)
      setBar(el.mechProboscis, el.mechProboscisV, s.meanProboscis)
      setBar(el.mechBright, el.mechBrightV, s.meanBrightness)
      setBar(el.mechSexuality, el.mechSexualityV, s.meanSexuality)
      setBar(el.mechShell, el.mechShellV, s.meanShell)
      setBar(el.mechSymbiosis, el.mechSymbiosisV, s.meanSymbiosis)
      setBar(el.mechEyespot, el.mechEyespotV, s.meanEyespot)
      setBar(el.mechStalk, el.mechStalkV, s.meanStalk)

      // Ecology
      if (el.ecoHerb) el.ecoHerb.textContent = `${s.herbivores}`
      if (el.ecoOmni) el.ecoOmni.textContent = `${s.omnivores}`
      if (el.ecoCarn) el.ecoCarn.textContent = `${s.carnivores}`
      if (el.ecoKills) el.ecoKills.textContent = `${s.kills}`

      // Morphology bars
      setBar(el.morphFlipper, el.morphFlipperV, s.meanFlipper)
      setBar(el.morphMembrane, el.morphMembraneV, s.meanMembrane)
      setBar(el.morphCilia, el.morphCiliaV, s.meanCilia)
      setBar(el.morphSpines, el.morphSpinesV, s.meanSpines)

      // Organism list
      updateOrganismList()

      // Food chain
      updateFoodChain(s)

      // Populate species filter dropdown
      updateSpeciesDropdown()

      // Time-series graph
      recordHistory(s)
      drawGraph()

      // ── Science tools updates ──
      const now = performance.now()
      // Pop-gen metrics (expensive — compute every 3s)
      if (now - lastPopGenAt > 3000 && sim.cells.length > 1) {
        lastPopGenAt = now
        lastPopGenMetrics = computePopGenMetrics(sim)
        if (lastPopGenMetrics) {
          if (pgNe) pgNe.textContent = `${lastPopGenMetrics.effectivePopSize}`
          if (pgHe) pgHe.textContent = lastPopGenMetrics.meanHeterozygosity.toFixed(3)
          if (pgFst) pgFst.textContent = lastPopGenMetrics.Fst.toFixed(3)
          if (pgPi) pgPi.textContent = lastPopGenMetrics.nucleotideDiversity.toFixed(4)
          if (pgShannon) pgShannon.textContent = lastPopGenMetrics.shannonDiversity.toFixed(3)
          if (pgFitSD) pgFitSD.textContent = lastPopGenMetrics.fitnessSD.toFixed(3)
          if (pgGenTime) pgGenTime.textContent = lastPopGenMetrics.meanGenerationTime.toFixed(0)
        }
      }

      // Allele frequency tracking (every update)
      alleleTracker.record(sim, lastPopGenMetrics)

      // Muller plot tracking (every update)
      mullerTracker.record(sim)

      // Draw Muller plot
      drawMullerPlot(mullerCanvas, mullerTracker, cladeColor)

      // Draw pop-gen chart
      drawPopGenPanel(popgenCanvas, alleleTracker)

      // Selection coefficient tracking (every update)
      selectionTracker.record(sim)
      drawSelectionPanel(selectionPanel, selectionTracker)

      // A/B split world divergence (every pop-gen cycle)
      if (splitWorld.active) {
        splitWorld.computeDivergence(sim)
        drawSplitWorldPanel(splitCanvas, splitWorld)
        if (splitStats) {
          const d = splitWorld.divergence
          splitStats.textContent =
            `A:${d.popA} B:${d.popB} | Div:${d.traitDistance.toFixed(4)} Fst:${d.fst.toFixed(4)} ` +
            `| Fit A:${d.meanFitnessA.toFixed(2)} B:${d.meanFitnessB.toFixed(2)}`
        }
      }

      // Refresh genome browser if a cell is selected
      if (selectedCell) updateGenomeBrowser()
    } catch (e) {
      console.error('updateHud error:', e)
    }
  }

  let lastSpeciesUpdate = 0
  function updateSpeciesDropdown() {
    if (!el.filterSpecies) return
    const now = performance.now()
    if (now - lastSpeciesUpdate < 2000) return // update every 2s
    lastSpeciesUpdate = now

    const currentVal = el.filterSpecies.value
    const cladePop = new Map()
    for (let i = 0; i < sim.cells.length; i++) {
      const cl = sim.cells[i].clade
      cladePop.set(cl, (cladePop.get(cl) || 0) + 1)
    }
    // Sort by population descending
    const sorted = [...cladePop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)

    let html = '<option value="all">All species</option>'
    for (const [clade, pop] of sorted) {
      ensureCladeName(clade, sim)
      const entry = organismNames.get(clade)
      const name = entry ? entry.displayName : `Clade ${clade}`
      const sci = entry ? entry.scientificName : ''
      const sel = `${clade}` === currentVal ? ' selected' : ''
      html += `<option value="${clade}"${sel}>${name} — ${sci} (${pop})</option>`
    }
    el.filterSpecies.innerHTML = html
  }

  function updateOrganismList() {
    if (!el.organismList) return
    const organisms = buildOrganisms(sim.cells, sim.links, sim.w, sim.h, sim.cfg.linkDist)

    // Collect organism data, scored by composite fitness
    const orgData = []
    for (const [, indices] of organisms) {
      if (indices.length < 2) continue
      const cells = indices.map((i) => sim.cells[i])
      const clade = cells[0].clade
      let totalEnergy = 0
      let dietSum = 0
      let maxAge = 0
      let complexitySum = 0
      for (const c of cells) {
        totalEnergy += c.energy
        dietSum += c.g.diet
        if (c.age > maxAge) maxAge = c.age
        complexitySum += c.complexity || 0
      }
      const avgDiet = dietSum / cells.length
      let dietLabel = 'herb'
      if (avgDiet > 0.6) dietLabel = 'carn'
      else if (avgDiet > 0.3) dietLabel = 'omni'

      // Composite score: size matters most, then energy, age, complexity
      const score =
        indices.length * 10 +
        totalEnergy * 2 +
        Math.min(maxAge / 200, 10) * 3 +
        (complexitySum / cells.length) * 5

      // Get or create name
      ensureCladeName(clade, sim)

      // Pick a representative cell (largest energy)
      let repCell = cells[0]
      for (const c of cells) {
        if (c.energy > repCell.energy) repCell = c
      }

      orgData.push({
        clade,
        name: (organismNames.get(clade) || {}).displayName || `Clade ${clade}`,
        sciName: (organismNames.get(clade) || {}).scientificName || '',
        size: indices.length,
        energy: totalEnergy,
        score,
        diet: dietLabel,
        color: cladeColor(clade),
        rep: repCell,
        cells
      })
    }

    orgData.sort((a, b) => b.score - a.score)

    // Cap display at maxOrgDisplay
    const display = orgData.slice(0, maxOrgDisplay)

    if (display.length === 0) {
      el.organismList.innerHTML = '<div class="organism-empty">No multicellular organisms yet</div>'
      return
    }

    let html = ''
    for (let oi = 0; oi < display.length; oi++) {
      const org = display[oi]
      html += `<div class="organism-entry">
        <canvas id="org-cvs-${oi}" width="96" height="96" style="width:96px;height:96px;border-radius:50%;flex-shrink:0"></canvas>
        <div class="organism-info">
          <div class="organism-name">${org.name}</div>
          <div class="organism-sci" style="font-size:8px;font-style:italic;color:#8f9bb7;margin-top:-1px">${org.sciName}</div>
          <div class="organism-meta">
            <span>${org.diet}</span>
            <span>${org.energy.toFixed(1)}e</span>
          </div>
          <div class="organism-meta" style="opacity:0.6">
            <span>score ${org.score.toFixed(0)}</span>
          </div>
        </div>
        <div class="organism-cells">${org.size}</div>
      </div>`
    }
    if (orgData.length > maxOrgDisplay) {
      html += `<div class="organism-empty">+${orgData.length - maxOrgDisplay} more</div>`
    }
    el.organismList.innerHTML = html

    // Draw mini cell illustrations on each canvas
    for (let oi = 0; oi < display.length; oi++) {
      const cvs = document.getElementById(`org-cvs-${oi}`)
      if (!cvs) continue
      _drawMiniCell(cvs, display[oi])
    }
  }

  // ── Full multi-cell organism illustration for organism list ──
  // Matches the main canvas rendering pipeline from cells.js as closely as possible.
  function _drawMiniCell(canvas, org) {
    const ctx = canvas.getContext('2d')
    const w = canvas.width,
      h = canvas.height
    const TAU = Math.PI * 2
    const allCells = org.cells || [org.rep]
    ctx.clearRect(0, 0, w, h)

    // ── Helpers matching color.js ──
    function _clamp(x, a, b) {
      return x < a ? a : x > b ? b : x
    }
    function _hsl(h, s, l) {
      return `hsl(${h | 0} ${s | 0}% ${l | 0}%)`
    }
    function _hsla(h, s, l, a) {
      return `hsla(${h | 0} ${s | 0}% ${l | 0}% / ${a.toFixed(2)})`
    }

    // Compute centroid
    let sumX = 0,
      sumY = 0
    for (const c of allCells) {
      sumX += c.x
      sumY += c.y
    }
    const centX = sumX / allCells.length,
      centY = sumY / allCells.length

    // Find max distance from centroid, accounting for full rendered size
    let maxDist = 4
    for (const c of allCells) {
      const dx = c.x - centX,
        dy = c.y - centY
      const g = c.g
      const baseCell = 4.0 * (g.bodyScale || 1)
      // Match the drawR inflation from energy/vacuole/membrane
      const eScale = Math.min(1.25, 0.9 + c.energy * 0.05)
      const vScale = 1 + (c.organelles ? c.organelles[4] : 0) * 0.15
      const mScale = 1 + (g.membrane || 0) * 0.15
      const cellR = baseCell * eScale * vScale * mScale
      // Glow extends ~2.5x beyond drawR
      const glowMult = 1.9 + Math.min(c.energy / 3.5, 1) * 1.0
      // Account for appendages that extend beyond the cell body
      let visualR = cellR * glowMult
      if ((g.flagella || 0) > 0.08) visualR = Math.max(visualR, cellR * (2.0 + (g.flagella || 0) * 4.5))
      if ((g.spines || 0) > 0.08) visualR = Math.max(visualR, cellR * (1.0 + (g.spines || 0) * 0.8))
      if ((g.spike || 0) > 0.1) visualR = Math.max(visualR, cellR * (1.0 + (g.spike || 0) * 1.8))
      if ((g.cilia || 0) > 0.15) visualR = Math.max(visualR, cellR * (1.0 + (g.cilia || 0) * 0.6))
      if ((g.toxin || 0) > 0.2) visualR = Math.max(visualR, cellR * (1.6 + (g.toxin || 0) * 2.0))
      const d = Math.sqrt(dx * dx + dy * dy) + visualR
      if (d > maxDist) maxDist = d
    }
    // Scale so organism fits within the clip circle with padding
    const scale = (w * 0.36) / maxDist
    const midX = w / 2,
      midY = h / 2
    // Base cell radius matching sim config (default 4.0)
    const baseR = 4.0 * scale

    // Clip to circle
    ctx.save()
    ctx.beginPath()
    ctx.arc(midX, midY, w * 0.48, 0, TAU)
    ctx.clip()

    // ═══════════════════════════════════════════════════════════════
    // LAYER 0: Dark background (matches main canvas water feel)
    // ═══════════════════════════════════════════════════════════════
    const rep = allCells[0]
    const repHue = cladeHue(rep.clade)
    const bgGrad = ctx.createRadialGradient(midX, midY, 0, midX, midY, w * 0.5)
    bgGrad.addColorStop(0, `hsla(${repHue | 0},25%,10%,1)`)
    bgGrad.addColorStop(0.6, `hsla(${repHue | 0},15%,5%,1)`)
    bgGrad.addColorStop(1, `hsla(${repHue | 0},10%,2%,1)`)
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, w, h)

    // ═══════════════════════════════════════════════════════════════
    // LAYER 1: Cell rendering — matches main canvas cells.js pipeline
    // ═══════════════════════════════════════════════════════════════
    function toLocal(wx, wy) {
      return [midX + (wx - centX) * scale, midY + (wy - centY) * scale]
    }

    // Reusable blob point buffers (matching cells.js)
    const _bpX = new Float64Array(32)
    const _bpY = new Float64Array(32)

    function _miniBlobPath(ctx, x, y, r, phase, id, nLobes, amoeboid, shape) {
      const lobes = nLobes || 7
      const am = amoeboid || 0
      const depth = shape ? shape.depth : 0.12
      const chaos = shape ? shape.chaos : 0
      const facet = shape ? shape.facet : 0
      const stream = shape ? shape.streamline : 0
      const sFdx = shape ? shape.faceDx || 0 : 0
      const sFdy = shape ? shape.faceDy || 0 : 0
      const lobeAngle = TAU / lobes
      for (let i = 0; i < lobes; i++) {
        const a = i * lobeAngle
        const cosA = Math.cos(a)
        const sinA = Math.sin(a)
        let deform =
          1.0 +
          depth * Math.sin(phase + a * 2.0 + id * 1.7) +
          depth * 0.58 * Math.sin(phase * 0.7 + a * 3.0 + id * 0.9) +
          depth * 0.42 * Math.cos(a * 5.0 + id * 2.3)
        if (chaos > 0.01) {
          const hash = Math.sin(id * 12.9898 + i * 78.233) * 43758.5453
          deform += chaos * 0.18 * ((hash - (hash | 0)) * 2 - 1)
        }
        if (facet > 0.01) {
          const nearestLobe = Math.round(a / lobeAngle) * lobeAngle
          const angleDist = Math.abs(a - nearestLobe) / (lobeAngle * 0.5)
          deform += facet * 0.06 * (angleDist * 2 - 1)
        }
        if (stream > 0.01) {
          const dot = cosA * sFdx + sinA * sFdy
          const cross = cosA * -sFdy + sinA * sFdx
          deform += dot * stream * 0.25 - Math.abs(cross) * stream * 0.12
        }
        if (am > 0.1) {
          deform += am * 0.3 * Math.sin(a * 1.5 + id * 2.1)
          deform += am * 0.2 * Math.sin(a * 2.7 + id * 0.6)
          deform += am * 0.15 * Math.cos(a * 0.8 + id * 3.4)
        }
        _bpX[i] = x + cosA * r * deform
        _bpY[i] = y + sinA * r * deform
      }
      ctx.beginPath()
      ctx.moveTo((_bpX[lobes - 1] + _bpX[0]) * 0.5, (_bpY[lobes - 1] + _bpY[0]) * 0.5)
      for (let i = 0; i < lobes; i++) {
        const ni = i + 1 < lobes ? i + 1 : 0
        ctx.quadraticCurveTo(_bpX[i], _bpY[i], (_bpX[i] + _bpX[ni]) * 0.5, (_bpY[i] + _bpY[ni]) * 0.5)
      }
      ctx.closePath()
    }

    function _miniElongPath(ctx, x, y, r, phase, id, elongation, faceDx, faceDy) {
      const elong = 0.3 + elongation * 1.4
      const lobes = 12
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * TAU
        const cosA = Math.cos(a)
        const sinA = Math.sin(a)
        const dot = cosA * faceDx + sinA * faceDy
        const stretch = 1.0 + Math.abs(dot) * elong
        const squeeze = 1.0 - Math.abs(cosA * -faceDy + sinA * faceDx) * elong * 0.3
        const deform =
          stretch *
          squeeze *
          (1.0 +
            0.06 * Math.sin(phase + a * 2.0 + id * 1.7) +
            0.04 * Math.sin(phase * 0.7 + a * 3.0 + id * 0.9))
        _bpX[i] = x + cosA * r * deform
        _bpY[i] = y + sinA * r * deform
      }
      ctx.beginPath()
      ctx.moveTo((_bpX[lobes - 1] + _bpX[0]) * 0.5, (_bpY[lobes - 1] + _bpY[0]) * 0.5)
      for (let i = 0; i < lobes; i++) {
        const ni = (i + 1) % lobes
        ctx.quadraticCurveTo(_bpX[i], _bpY[i], (_bpX[i] + _bpX[ni]) * 0.5, (_bpY[i] + _bpY[ni]) * 0.5)
      }
      ctx.closePath()
    }

    // Render each cell using the same pipeline as cells.js
    for (const c of allCells) {
      const [x, y] = toLocal(c.x, c.y)
      const g = c.g

      // ── Color calculation (identical to cells.js lines 408-457) ──
      const baseHue = cladeHue(c.clade)
      const dietShift = g.diet * 55 - 15
      const hueShiftVal = (g.hueShift || 0) * 180
      const morphHueShift =
        (g.toxin || 0) * -40 +
        (g.spines || 0) * 25 +
        (g.flagella || 0) * -18 +
        (g.biolum || 0) * 35 +
        (g.amoeboid || 0) * -15 +
        (g.membrane || 0) * 12 +
        (g.chloroplast || 0) * -30 +
        (g.elongation || 0) * 10
      const hue = (baseHue + dietShift + hueShiftVal + morphHueShift + 720) % 360
      const brightnessGene = g.brightness || 0
      const cSatOff = cladeSatOffset(c.clade)
      const cLumOff = cladeLumOffset(c.clade)
      const sat = _clamp(
        60 +
          g.diet * 25 -
          brightnessGene * 15 +
          cSatOff * 1.5 -
          (g.membrane || 0) * 18 +
          (g.chloroplast || 0) * 12 +
          (g.toxin || 0) * 10,
        15,
        100
      )
      const lum = _clamp(
        44 +
          14 * g.adhesion +
          brightnessGene * 28 +
          cLumOff * 1.5 -
          (g.toxin || 0) * 12 -
          (g.membrane || 0) * 6 +
          (g.biolum || 0) * 10,
        18,
        88
      )

      // ── Cell radius (matching cells.js lines 459-478) ──
      const energyScale = _clamp(0.9 + c.energy * 0.05, 0.85, 1.25)
      const vacScale = 1 + (c.organelles ? c.organelles[4] : 0) * 0.15
      const memScale = 1 + g.membrane * 0.15
      const bodyScaleGene = g.bodyScale || 1.0
      const drawR = Math.max(3, baseR * energyScale * vacScale * memScale * bodyScaleGene)

      // ── Facing direction ──
      const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
      const faceDx = c.vx / vLen
      const faceDy = c.vy / vLen
      const perpX = -faceDy
      const perpY = faceDx

      // ── Shape parameters (matching cells.js lines 811-844) ──
      const ageMorph = Math.min((c.age || 0) / 800, 1)
      const cxMorph = Math.min((c.complexity || 0) / 5, 1)
      const cellElong = g.elongation || 0
      const fullness = _clamp(c.energy / (g.division * 0.6), 0, 1)
      let lobes
      if (g.diet > 0.6) lobes = 3 + Math.floor(ageMorph * 1 + cxMorph * 1 + (g.membrane || 0) * 2)
      else if (g.diet < 0.25) lobes = 10 + Math.floor(ageMorph * 3 + cxMorph * 3 + (g.adhesion || 0) * 3)
      else lobes = 6 + Math.floor(ageMorph * 2 + cxMorph * 2 + (g.spines || 0) * 4)
      const shapeDepth = 0.05 + (1 - fullness) * 0.22 + g.diet * 0.1 + (g.spines || 0) * 0.08
      const shapeChaos = _clamp(((g.mutRate || 0.05) - 0.03) * 4, 0, 1)
      const shapeFacet = _clamp((g.membrane || 0) - 0.1, 0, 1) * 1.2
      const shapeStream = _clamp(g.speed - 0.6, 0, 1) * 0.8
      const morphPhase = (c.membranePhase || 0) + ageMorph * 0.5
      const shapeDesc = {
        depth: shapeDepth,
        chaos: shapeChaos,
        facet: shapeFacet,
        streamline: shapeStream,
        faceDx: faceDx,
        faceDy: faceDy
      }

      // ── Glow (matching cells.js LOD 2+ glow, lines 689-727) ──
      const orgSize = c.organismSize || 1
      const _orgGlowDamp = orgSize > 1 ? 1.0 / (1.0 + (orgSize - 1) * 0.35) : 1.0
      const eLev = _clamp(c.energy / 3.5, 0, 1)
      const biolum = g.biolum || 0
      const glowR = drawR * (1.9 + eLev * 1.0 + cxMorph * 0.5 + biolum * 0.7)
      const glowAlpha = (0.04 + eLev * 0.05 + cxMorph * 0.015 + biolum * 0.07) * _orgGlowDamp
      if (glowAlpha > 0.005 && glowR > 1) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = glowAlpha
        const gGrad = ctx.createRadialGradient(x, y, 0, x, y, glowR)
        gGrad.addColorStop(0, _hsla(hue, sat, lum + 20, 0.6))
        gGrad.addColorStop(0.5, _hsla(hue, sat, lum, 0.2))
        gGrad.addColorStop(1, _hsla(hue, sat, lum, 0))
        ctx.fillStyle = gGrad
        ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2)
        ctx.restore()
      }

      // ── Toxin cloud (matching cells.js lines 731-740) ──
      if ((g.toxin || 0) > 0.2) {
        const tx = g.toxin
        const toxR = drawR * (1.6 + tx * 2.0)
        ctx.globalAlpha = 0.05 + tx * 0.12
        ctx.fillStyle = 'rgba(60,200,30,0.2)'
        ctx.beginPath()
        ctx.arc(x, y, toxR, 0, TAU)
        ctx.fill()
      }

      // ── Flagella behind body (matching cells.js lines 1209-1277) ──
      if ((g.flagella || 0) > 0.08) {
        const fl = g.flagella
        const tailCount = fl > 0.5 ? 3 : 2
        const tailLen = drawR * (2.0 + fl * 4.5)
        const tailX = -faceDx,
          tailY = -faceDy
        ctx.lineCap = 'round'
        for (let fi = 0; fi < tailCount; fi++) {
          const spread = (fi - (tailCount - 1) / 2) * drawR * 0.22
          const phaseOff = fi * 1.7 + c.id
          const tSegs = 8
          const tPts = []
          tPts[0] = [x + tailY * spread, y - tailX * spread]
          for (let s = 1; s <= tSegs; s++) {
            const frac = s / tSegs
            const amp = frac * frac
            const wave = Math.sin(frac * Math.PI * 3.5 + phaseOff) * drawR * 0.6 * fl * amp
            tPts[s] = [
              x + tailY * spread + tailX * tailLen * frac + tailY * wave,
              y - tailX * spread + tailY * tailLen * frac - tailX * wave
            ]
          }
          ctx.strokeStyle = _hsla(hue, 75, 72, 0.25 + fl * 0.45)
          ctx.lineWidth = 0.6 + fl * 1.4
          ctx.beginPath()
          ctx.moveTo(tPts[0][0], tPts[0][1])
          for (let s = 0; s < tSegs; s++) {
            const mx = (tPts[s][0] + tPts[s + 1][0]) * 0.5
            const my = (tPts[s][1] + tPts[s + 1][1]) * 0.5
            ctx.quadraticCurveTo(tPts[s][0], tPts[s][1], mx, my)
          }
          ctx.lineTo(tPts[tSegs][0], tPts[tSegs][1])
          ctx.stroke()
        }
      }

      // ── Spines behind body (matching cells.js lines 1382-1413) ──
      if ((g.spines || 0) > 0.08) {
        const sn = g.spines
        ctx.lineCap = 'round'
        const barbCount = Math.min(10, 6 + Math.floor(sn * 6))
        ctx.globalAlpha = 0.4 + sn * 0.35
        ctx.strokeStyle = _hsla(40, 65, 72, 0.6)
        ctx.lineWidth = 0.5 + sn * 0.7
        for (let bi = 0; bi < barbCount; bi++) {
          const ba = (bi / barbCount) * TAU + c.id * 1.3
          const lenVar = 0.7 + 0.6 * ((c.id * 5 + bi * 3.7) % 1)
          const bLen = drawR * (0.3 + sn * 0.8) * lenVar
          const bx0 = x + Math.cos(ba) * drawR * 0.95
          const by0 = y + Math.sin(ba) * drawR * 0.95
          const tipX = x + Math.cos(ba) * (drawR + bLen)
          const tipY = y + Math.sin(ba) * (drawR + bLen)
          ctx.beginPath()
          ctx.moveTo(bx0, by0)
          ctx.lineTo(tipX, tipY)
          ctx.stroke()
        }
      }

      // ── Spike horn (matching cells.js lines 1354-1380) ──
      if ((g.spike || 0) > 0.1) {
        const sp = g.spike
        const spikeLen = drawR * (0.6 + sp * 1.8)
        const spikeCount = 3 + Math.floor(sp * 5)
        ctx.fillStyle = _hsla(0, 75, 55, 0.35 + sp * 0.2)
        for (let si = 0; si < spikeCount; si++) {
          const sa = (si / spikeCount) * TAU + c.id * 0.5
          const tipX = x + Math.cos(sa) * (drawR + spikeLen)
          const tipY = y + Math.sin(sa) * (drawR + spikeLen)
          const b1x = x + Math.cos(sa - 0.12) * drawR * 0.92
          const b1y = y + Math.sin(sa - 0.12) * drawR * 0.92
          const b2x = x + Math.cos(sa + 0.12) * drawR * 0.92
          const b2y = y + Math.sin(sa + 0.12) * drawR * 0.92
          ctx.beginPath()
          ctx.moveTo(b1x, b1y)
          ctx.lineTo(tipX, tipY)
          ctx.lineTo(b2x, b2y)
          ctx.closePath()
          ctx.fill()
        }
      }

      // ── Body shape (matching cells.js lines 846-853) ──
      if (drawR < 3.5) {
        ctx.beginPath()
        ctx.arc(x, y, drawR, 0, TAU)
      } else if (cellElong > 0.2) {
        _miniElongPath(ctx, x, y, drawR, morphPhase, c.clade, cellElong, faceDx, faceDy)
      } else {
        _miniBlobPath(ctx, x, y, drawR, morphPhase, c.clade, lobes, g.amoeboid || 0, shapeDesc)
      }

      // ── Body fill (matching cells.js lines 856-861) ──
      const fillAlpha = 0.4 + fullness * 0.35
      ctx.globalAlpha = fillAlpha
      const fillHueShift = ((g.pattern ?? 0.5) - 0.5) * 30
      const fillHue = (hue + fillHueShift + 360) % 360
      ctx.fillStyle = _hsl(fillHue, sat * 0.55, _clamp(lum + 6 + brightnessGene * 8, 32, 82))
      ctx.fill()

      // ── Membrane stroke (matching cells.js lines 872-890) ──
      ctx.globalAlpha = 1
      const neonLum = _clamp(lum + 22, 55, 88)
      const neonSat = _clamp(sat + 15, 60, 100)
      const memThick = 0.8 + g.membrane * 2.5 + cxMorph * 0.6
      ctx.strokeStyle = _hsla(hue, neonSat, neonLum, 0.65 + g.membrane * 0.25)
      ctx.lineWidth = memThick
      ctx.stroke()

      // ── Body patterns (matching cells.js lines 910-969) ──
      if (drawR > 4) {
        const pat = g.pattern ?? 0.5
        const pScale = g.patternScale ?? 0.5
        const patHue = (hue + 150 + pat * 60) % 360
        const patAlpha = 0.12 + pScale * 0.18
        if (pat < 0.33) {
          const spotCount = 3 + Math.floor(pScale * 5)
          const spotR = drawR * (0.08 + pScale * 0.1)
          ctx.fillStyle = _hsla(patHue, sat * 0.8, lum + 15, patAlpha * 2.5)
          for (let si = 0; si < spotCount; si++) {
            const sa = (si / spotCount) * TAU + c.clade * 2.3
            const sd = drawR * (0.25 + 0.35 * ((c.clade * 7 + si * 5.3) % 1))
            ctx.globalAlpha = patAlpha
            ctx.beginPath()
            ctx.arc(x + Math.cos(sa) * sd, y + Math.sin(sa) * sd, spotR, 0, TAU)
            ctx.fill()
          }
        } else if (pat < 0.66) {
          const stripeCount = 2 + Math.floor(pScale * 3)
          ctx.strokeStyle = _hsla(patHue, sat * 0.7, lum + 10, patAlpha * 2.0)
          ctx.lineWidth = 0.5 + pScale * 1.5
          ctx.lineCap = 'round'
          const stripeAngle = (c.clade * 1.618) % Math.PI
          const cosS = Math.cos(stripeAngle)
          const sinS = Math.sin(stripeAngle)
          for (let si = 0; si < stripeCount; si++) {
            const offset = ((si + 0.5) / stripeCount - 0.5) * drawR * 1.4
            const sx = x + cosS * offset
            const sy = y + sinS * offset
            const perpLen = drawR * 0.7
            ctx.globalAlpha = patAlpha * (1 - Math.abs(offset) / (drawR * 0.8))
            ctx.beginPath()
            ctx.moveTo(sx - sinS * perpLen, sy + cosS * perpLen)
            ctx.lineTo(sx + sinS * perpLen, sy - cosS * perpLen)
            ctx.stroke()
          }
        } else {
          const ringCount = 1 + Math.floor(pScale * 2)
          ctx.strokeStyle = _hsla(patHue, sat * 0.7, lum + 12, patAlpha * 2.2)
          ctx.lineWidth = 0.4 + pScale * 1.0
          for (let ri = 0; ri < ringCount; ri++) {
            const ringR = drawR * (0.35 + ri * 0.25)
            if (ringR > drawR * 0.9) continue
            ctx.globalAlpha = patAlpha * (1 - ri * 0.25)
            ctx.beginPath()
            ctx.arc(x, y, ringR, 0, TAU)
            ctx.stroke()
          }
        }
        ctx.globalAlpha = 1
      }

      // ── Nucleus (matching cells.js lines 1026-1060) ──
      if (c.organelles) {
        const nucLevel = c.organelles[0]
        if (nucLevel > 0.05) {
          const nucR = drawR * 0.28 + nucLevel * drawR * 0.22
          const nucHue = (hue + 180) % 360
          ctx.globalAlpha = 0.75 + nucLevel * 0.2
          ctx.fillStyle = _hsl(nucHue, 80, 68)
          ctx.beginPath()
          ctx.arc(x, y, nucR, 0, TAU)
          ctx.fill()
          if (nucLevel > 0.2) {
            ctx.globalAlpha = 0.65 + nucLevel * 0.3
            ctx.fillStyle = _hsla(nucHue, 65, 95, 0.95)
            ctx.beginPath()
            ctx.arc(x - nucR * 0.15, y - nucR * 0.1, nucR * 0.25, 0, TAU)
            ctx.fill()
          }
        }

        // Mitochondria (matching cells.js lines 1063-1090)
        const mitoLevel = c.organelles[1]
        if (mitoLevel > 0.06) {
          const mitoCount = Math.min(3, 1 + Math.floor(mitoLevel * 3))
          for (let mi = 0; mi < mitoCount; mi++) {
            const ma = (mi / mitoCount) * TAU + c.clade * 0.7
            const md = drawR * 0.4
            const mr = drawR * 0.07 * (1.0 + mitoLevel * 0.6)
            const mx2 = x + Math.cos(ma) * md
            const my2 = y + Math.sin(ma) * md
            ctx.globalAlpha = 0.7 + mitoLevel * 0.25
            ctx.fillStyle = _hsl(15, 92, 58)
            ctx.beginPath()
            ctx.arc(mx2, my2, mr, 0, TAU)
            ctx.fill()
          }
        }

        // Vacuole (matching cells.js lines 1093-1105)
        const vacLevel = c.organelles[4]
        if (vacLevel > 0.08) {
          const vr = drawR * 0.3 * vacLevel + drawR * 0.12
          ctx.globalAlpha = 0.35 + vacLevel * 0.3
          ctx.fillStyle = _hsla(200, 50, 72, 0.5)
          ctx.beginPath()
          ctx.arc(x + drawR * 0.2, y + drawR * 0.2, vr, 0, TAU)
          ctx.fill()
        }

        // Receptors (matching cells.js lines 1170-1191)
        const recLevel = c.organelles[3]
        if (recLevel > 0.08) {
          const recCount = 4 + Math.floor(recLevel * 6)
          for (let ri = 0; ri < recCount; ri++) {
            const ra = (ri / recCount) * TAU + c.id * 1.1
            const rDist = drawR * 0.9
            const rr = 0.6 + recLevel * 1.0
            ctx.globalAlpha = 0.6 + recLevel * 0.3
            ctx.fillStyle = _hsla(45, 95, 75, 0.9)
            ctx.beginPath()
            ctx.arc(x + Math.cos(ra) * rDist, y + Math.sin(ra) * rDist, rr, 0, TAU)
            ctx.fill()
          }
          ctx.globalAlpha = 1
        }
      }

      // ── Cilia (matching cells.js morphology.js lines 94-132) ──
      if ((g.cilia || 0) > 0.15) {
        const cl = g.cilia
        const count = Math.min(16, Math.floor(8 + cl * 16))
        const ciliaLen = drawR * (0.3 + cl * 0.6)
        ctx.save()
        ctx.lineCap = 'round'
        ctx.strokeStyle = _hsla(hue, sat - 10, lum + 22, 0.6)
        ctx.lineWidth = 0.3 + cl * 0.3
        for (let i = 0; i < count; i++) {
          const a = (i / count) * TAU
          const bx = x + Math.cos(a) * (drawR + 0.3)
          const by = y + Math.sin(a) * (drawR + 0.3)
          const tipAngle = a + Math.sin(a * 3.5 + c.id * 0.5) * 0.35
          const tipLen = ciliaLen * 0.85
          const ex = bx + Math.cos(tipAngle) * tipLen
          const ey = by + Math.sin(tipAngle) * tipLen
          ctx.globalAlpha = 0.25 + cl * 0.35
          ctx.beginPath()
          ctx.moveTo(bx, by)
          ctx.lineTo(ex, ey)
          ctx.stroke()
        }
        ctx.restore()
      }

      ctx.globalAlpha = 1
    }

    ctx.restore()
    ctx.globalAlpha = 1
  }

  function updateFoodChain(s) {
    if (!el.foodchainList || !s.foodChain) return

    // Aggregate food chain: group by predator clade → prey clade, sum kills
    const chains = []
    for (const [key, count] of s.foodChain) {
      const [predStr, preyStr] = key.split('>')
      const predClade = parseInt(predStr, 10)
      const preyClade = parseInt(preyStr, 10)
      ensureCladeName(predClade, sim)
      ensureCladeName(preyClade, sim)
      chains.push({
        predClade,
        preyClade,
        predName: (organismNames.get(predClade) || {}).displayName || `Clade ${predClade}`,
        preyName: (organismNames.get(preyClade) || {}).displayName || `Clade ${preyClade}`,
        predColor: cladeColor(predClade),
        preyColor: cladeColor(preyClade),
        kills: count
      })
    }
    chains.sort((a, b) => b.kills - a.kills)

    const display = chains.slice(0, 8)
    if (display.length === 0) {
      el.foodchainList.innerHTML = '<div class="organism-empty">No predation yet</div>'
      return
    }

    let html = ''
    for (const ch of display) {
      html += `<div class="foodchain-entry">
        <span class="foodchain-predator" style="color:${ch.predColor}">${ch.predName}</span>
        <span class="foodchain-arrow">&rarr;</span>
        <span class="foodchain-prey" style="color:${ch.preyColor}">${ch.preyName}</span>
        <span class="foodchain-kills">${ch.kills}</span>
      </div>`
    }
    el.foodchainList.innerHTML = html
  }

  function perfBarClass(pct) {
    return pct < 60
      ? 'perf-bar-fill perf-good'
      : pct < 85
        ? 'perf-bar-fill perf-warn'
        : 'perf-bar-fill perf-bad'
  }

  function updatePerfHud() {
    // FPS: 60=good, <30=bad
    const fpsPct = clamp((1 - fpsEma / 60) * 100, 0, 100)
    if (el.hudFps) el.hudFps.textContent = fmt(fpsEma, 1)
    if (el.perfFpsBar) {
      el.perfFpsBar.style.width = `${clamp((fpsEma / 60) * 100, 0, 100).toFixed(0)}%`
      el.perfFpsBar.className = perfBarClass(fpsPct)
    }

    // Sim ms: 0-16ms budget
    const simPct = clamp((simMsEma / 16) * 100, 0, 100)
    if (el.hudSimMs) el.hudSimMs.textContent = `${fmt(simMsEma, 1)}ms`
    if (el.perfSimBar) {
      el.perfSimBar.style.width = `${simPct.toFixed(0)}%`
      el.perfSimBar.className = perfBarClass(simPct)
    }

    // Render ms: 0-16ms budget
    const renderPct = clamp((renderMsEma / 16) * 100, 0, 100)
    if (el.hudRenderMs) el.hudRenderMs.textContent = `${fmt(renderMsEma, 1)}ms`
    if (el.perfRenderBar) {
      el.perfRenderBar.style.width = `${renderPct.toFixed(0)}%`
      el.perfRenderBar.className = perfBarClass(renderPct)
    }

    // Frame total: sim + render
    const totalMs = simMsEma + renderMsEma
    const framePct = clamp((totalMs / 16.67) * 100, 0, 100)
    if (el.perfFrameV) el.perfFrameV.textContent = `${fmt(totalMs, 1)}ms`
    if (el.perfFrameBar) {
      el.perfFrameBar.style.width = `${framePct.toFixed(0)}%`
      el.perfFrameBar.className = perfBarClass(framePct)
    }

    // Steps/s
    const dt = Math.max(0.001, (performance.now() - stepsWindowAt) / 1000)
    const sps = stepsSince / dt
    if (el.hudStepsS) el.hudStepsS.textContent = fmt(sps, 0)
    if (el.perfStepsBar) {
      const spsPct = clamp((sps / 200) * 100, 0, 100) // 200 steps/s = full bar
      el.perfStepsBar.style.width = `${spsPct.toFixed(0)}%`
      el.perfStepsBar.className = perfBarClass(100 - spsPct) // invert: more=better
    }

    // Budget %
    const budgetPct = framePct
    if (el.perfBudgetBar) {
      el.perfBudgetBar.style.width = `${budgetPct.toFixed(0)}%`
      el.perfBudgetBar.className = perfBarClass(budgetPct)
    }
    if (el.perfBudgetV) el.perfBudgetV.textContent = `${budgetPct.toFixed(0)}%`

    // Cells, links, species
    const nCells = sim.cells.length
    const nLinks = sim.links.length
    if (el.perfCells) el.perfCells.textContent = `${nCells}`
    if (el.perfLinks) el.perfLinks.textContent = `${nLinks}`
    if (el.perfSpecies) {
      const cladeSet = new Set()
      for (let i = 0; i < nCells; i++) cladeSet.add(sim.cells[i].clade)
      el.perfSpecies.textContent = `${cladeSet.size}`
    }

    // µs per cell (from sim step profile)
    const sp = sim.stepProfile
    if (el.perfUsCell && sp && sp._total && nCells > 0) {
      const usPerCell = (sp._total * 1000) / nCells
      el.perfUsCell.textContent = fmt(usPerCell, 1)
    }

    // Sim subsystem breakdown
    if (el.perfSubsystems && sp) {
      const subs = [
        { key: 'environment', label: 'Environ', color: '#4fc3f7' },
        { key: 'spatial', label: 'Spatial', color: '#81c784' },
        { key: 'foodSense', label: 'FoodSense', color: '#aed581' },
        { key: 'cellLoop', label: 'CellLoop', color: '#ffb74d' },
        { key: 'links', label: 'Links', color: '#ce93d8' },
        { key: 'predation', label: 'Predation', color: '#ef5350' },
        { key: 'deathCleanup', label: 'Death', color: '#90a4ae' }
      ]
      const total = sp._total || 1
      let html = ''
      for (const s of subs) {
        const v = sp[s.key] || 0
        const pct = Math.min(100, (v / total) * 100)
        html +=
          `<div style="display:flex;align-items:center;gap:3px;margin:1px 0">` +
          `<span style="width:48px;color:${s.color}">${s.label}</span>` +
          `<div style="flex:1;height:3px;background:rgba(255,255,255,0.04);border-radius:2px">` +
          `<div style="width:${pct.toFixed(0)}%;height:100%;background:${s.color};border-radius:2px"></div></div>` +
          `<span style="width:36px;text-align:right">${v.toFixed(2)}ms</span></div>`
      }
      // Cell loop sub-breakdown
      if (sp.cl_movement !== undefined) {
        const clSubs = [
          { key: 'cl_movement', label: '  move', color: '#fff176' },
          { key: 'cl_feeding', label: '  feed', color: '#a5d6a7' },
          { key: 'cl_metabolism', label: '  metab', color: '#ffcc80' },
          { key: 'cl_lifecycle', label: '  life', color: '#b39ddb' }
        ]
        for (const s of clSubs) {
          const v = sp[s.key] || 0
          const pct = Math.min(100, (v / total) * 100)
          html +=
            `<div style="display:flex;align-items:center;gap:3px;margin:1px 0">` +
            `<span style="width:48px;color:${s.color}">${s.label}</span>` +
            `<div style="flex:1;height:3px;background:rgba(255,255,255,0.04);border-radius:2px">` +
            `<div style="width:${pct.toFixed(0)}%;height:100%;background:${s.color};border-radius:2px"></div></div>` +
            `<span style="width:36px;text-align:right">${v.toFixed(2)}ms</span></div>`
        }
      }
      el.perfSubsystems.innerHTML = html
    }

    // Render subsystem breakdown
    const rp = renderer.profileData
    if (el.perfRenderSubs && rp) {
      const rSubs = [
        { key: 'water', label: 'Water', color: '#4fc3f7' },
        { key: 'food', label: 'Food', color: '#81c784' },
        { key: 'terrain', label: 'Terrain', color: '#a1887f' },
        { key: 'cells', label: 'Cells', color: '#ffb74d' },
        { key: 'trails', label: 'Trails', color: '#ce93d8' },
        { key: 'hulls', label: 'Hulls', color: '#90a4ae' },
        { key: 'particles', label: 'Particles', color: '#ef5350' },
        { key: 'worldBlob', label: 'Blob', color: '#80cbc4' }
      ]
      const total = rp._total || 1
      let html = ''
      for (const s of rSubs) {
        const v = rp[s.key] || 0
        if (v < 0.01) continue // skip negligible
        const pct = Math.min(100, (v / total) * 100)
        html +=
          `<div style="display:flex;align-items:center;gap:3px;margin:1px 0">` +
          `<span style="width:48px;color:${s.color}">${s.label}</span>` +
          `<div style="flex:1;height:3px;background:rgba(255,255,255,0.04);border-radius:2px">` +
          `<div style="width:${pct.toFixed(0)}%;height:100%;background:${s.color};border-radius:2px"></div></div>` +
          `<span style="width:36px;text-align:right">${v.toFixed(2)}ms</span></div>`
      }
      el.perfRenderSubs.innerHTML = html
    }
  }

  // ── Free camera state ──
  let freeCam = { x: sim.w / 2, y: sim.h / 2, zoom: 1.0 }
  let isDragging = false
  let didDrag = false // true if mouse moved >3px during drag (prevents click-to-select)
  let dragStart = { x: 0, y: 0 }
  let dragCamStart = { x: 0, y: 0 }

  el.canvas.addEventListener('mousedown', (e) => {
    if (el.cameraMode.value !== 'free') return
    isDragging = true
    didDrag = false
    dragStart = { x: e.clientX, y: e.clientY }
    dragCamStart = { x: freeCam.x, y: freeCam.y }
    el.canvas.style.cursor = 'grabbing'
  })

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    if (dx * dx + dy * dy > 9) didDrag = true
    const scale = renderer.view.scale || 1
    freeCam.x = dragCamStart.x - dx / scale
    freeCam.y = dragCamStart.y - dy / scale
  })

  window.addEventListener('mouseup', () => {
    isDragging = false
    el.canvas.style.cursor = ''
  })

  el.canvas.addEventListener(
    'wheel',
    (e) => {
      if (el.cameraMode.value !== 'free') return
      e.preventDefault()
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
      freeCam.zoom = clamp(freeCam.zoom * zoomFactor, 0.15, 20.0)
    },
    { passive: false }
  )

  // ── Genome browser: click on canvas to select nearest cell ──
  el.canvas.addEventListener('click', (e) => {
    if (didDrag) return
    const rect = el.canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const scale = renderer.view.scale || 1
    const wx = renderer.view.cx + (mx - el.canvas.clientWidth / 2) / scale
    const wy = renderer.view.cy + (my - el.canvas.clientHeight / 2) / scale

    let bestCell = null
    let bestD2 = Infinity
    for (let i = 0; i < sim.cells.length; i++) {
      const c = sim.cells[i]
      const dx = c.x - wx
      const dy = c.y - wy
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        bestCell = c
      }
    }
    if (bestCell && bestD2 < 400) {
      selectedCell = bestCell
      updateGenomeBrowser()
    }
  })

  // ── Camera tracking state ──
  let trackedCellId = null
  let trackedClade = null
  let camZoomTarget = 1.0
  let camZoomCurrent = 1.0
  // Random mode: list of clades we've visited, index, and timer
  let randomCladeList = []
  let randomCladeIdx = 0
  let randomSwitchAt = 0
  const RANDOM_DWELL_MS = 8000 // stay on each species for 8s
  const RANDOM_TRANSITION_MS = 1500 // smooth transition period

  function getBaseScale() {
    const pad = 1.08
    return Math.min(renderer.canvas.width / (sim.w * pad), renderer.canvas.height / (sim.h * pad))
  }

  function getCladePops() {
    const cladePop = new Map()
    for (let i = 0; i < sim.cells.length; i++) {
      const cl = sim.cells[i].clade
      cladePop.set(cl, (cladePop.get(cl) || 0) + 1)
    }
    return cladePop
  }

  function findBestClade() {
    const cladePop = getCladePops()
    let bestClade = null,
      bestPop = 0
    for (const [cl, pop] of cladePop) {
      if (pop > bestPop) {
        bestPop = pop
        bestClade = cl
      }
    }
    return bestClade
  }

  function findCladeCentroid(clade) {
    let sx = 0,
      sy = 0,
      n = 0
    for (let i = 0; i < sim.cells.length; i++) {
      const c = sim.cells[i]
      if (c.clade === clade) {
        sx += c.x
        sy += c.y
        n++
      }
    }
    if (n === 0) return null
    return { x: sx / n, y: sy / n, pop: n }
  }

  function findOldestOfClade(clade) {
    let oldest = null,
      maxAge = -1
    for (let i = 0; i < sim.cells.length; i++) {
      const c = sim.cells[i]
      if (c.clade === clade && c.age > maxAge) {
        maxAge = c.age
        oldest = c
      }
    }
    return oldest
  }

  function smoothCamTo(tx, ty, mix) {
    renderer.view.cx = renderer.view.cx === 0 ? tx : renderer.view.cx * (1 - mix) + tx * mix
    renderer.view.cy = renderer.view.cy === 0 ? ty : renderer.view.cy * (1 - mix) + ty * mix
  }

  function updateCamera(ts) {
    const mode = el.cameraMode.value

    // Smooth zoom interpolation (used by all non-free modes)
    camZoomCurrent += (camZoomTarget - camZoomCurrent) * 0.18

    if (mode === 'free') {
      renderer.view.cx = freeCam.x
      renderer.view.cy = freeCam.y
      renderer.view.scale = getBaseScale() * freeCam.zoom
      renderer._trackTarget = null
      return
    }

    if (mode === 'track') {
      // Track: follow the oldest cell of the most successful species, zoomed in tight
      if (ts - lastCamAt > 3000 || trackedClade === null) {
        const best = findBestClade()
        if (best !== null) trackedClade = best
        lastCamAt = ts
      }
      const rep = trackedClade !== null ? findOldestOfClade(trackedClade) : null
      if (rep) {
        // Zoom in tight on the organism — close enough to see detail
        const orgSize = rep.organismSize || 1
        const trackZoom = clamp(8.0 - orgSize * 0.3, 4.0, 12.0)
        camZoomTarget = trackZoom
        // Follow the actual cell position, not the centroid
        smoothCamTo(rep.x, rep.y, 0.1)
        renderer.view.scale = getBaseScale() * camZoomCurrent
        ensureCladeName(trackedClade, sim)
        renderer._trackTarget = {
          id: rep.id,
          clade: trackedClade,
          label: (organismNames.get(trackedClade) || {}).displayName || `Clade ${trackedClade}`
        }
      } else {
        renderer._trackTarget = null
        camZoomTarget = 1.0
      }
      return
    }

    if (mode === 'random') {
      // Random: cycle through species, dwelling on each for RANDOM_DWELL_MS
      const cladePop = getCladePops()
      const aliveClades = [...cladePop.entries()].filter(([, p]) => p >= 3).sort((a, b) => b[1] - a[1])

      if (aliveClades.length === 0) {
        renderer._trackTarget = null
        camZoomTarget = 1.0
        smoothCamTo(sim.w / 2, sim.h / 2, 0.03)
        renderer.view.scale = getBaseScale() * camZoomCurrent
        return
      }

      // Rebuild clade list periodically or if empty
      if (
        randomCladeList.length === 0 ||
        ts - randomSwitchAt > RANDOM_DWELL_MS * randomCladeList.length * 1.5
      ) {
        randomCladeList = aliveClades.map(([cl]) => cl)
        // Shuffle for variety
        for (let i = randomCladeList.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[randomCladeList[i], randomCladeList[j]] = [randomCladeList[j], randomCladeList[i]]
        }
        randomCladeIdx = 0
        randomSwitchAt = ts
      }

      // Time to switch?
      if (ts - randomSwitchAt > RANDOM_DWELL_MS) {
        randomCladeIdx = (randomCladeIdx + 1) % randomCladeList.length
        randomSwitchAt = ts
        // Check if current clade is still alive, skip if not
        let attempts = 0
        while (attempts < randomCladeList.length) {
          const cl = randomCladeList[randomCladeIdx]
          if (cladePop.has(cl) && cladePop.get(cl) >= 2) break
          randomCladeIdx = (randomCladeIdx + 1) % randomCladeList.length
          attempts++
        }
      }

      const currentClade = randomCladeList[randomCladeIdx]
      trackedClade = currentClade
      const centroid = findCladeCentroid(currentClade)

      if (centroid) {
        // Smooth transition: faster mix right after switch, slower once settled
        const elapsed = ts - randomSwitchAt
        const transitionFrac = clamp(elapsed / RANDOM_TRANSITION_MS, 0, 1)
        const mix = 0.02 + transitionFrac * 0.06
        const popZoom = clamp(4.0 - centroid.pop * 0.005, 1.8, 6.0)
        camZoomTarget = popZoom
        smoothCamTo(centroid.x, centroid.y, mix)
        renderer.view.scale = getBaseScale() * camZoomCurrent
        const rep = findOldestOfClade(currentClade)
        ensureCladeName(currentClade, sim)
        renderer._trackTarget = {
          id: rep ? rep.id : null,
          clade: currentClade,
          label: (organismNames.get(currentClade) || {}).displayName || `Clade ${currentClade}`
        }
      } else {
        renderer._trackTarget = null
      }
      return
    }

    // ── Predator Cam: track the top carnivore species ──
    if (mode === 'predator') {
      if (ts - lastCamAt > 3000 || trackedClade === null) {
        let bestCl = null,
          bestScore = -1
        const cladePop = getCladePops()
        for (const [cl, pop] of cladePop) {
          // Find a representative cell to check diet
          for (let i = 0; i < sim.cells.length; i++) {
            if (sim.cells[i].clade === cl) {
              const score = sim.cells[i].g.diet * pop
              if (score > bestScore && sim.cells[i].g.diet > 0.5) {
                bestScore = score
                bestCl = cl
              }
              break
            }
          }
        }
        if (bestCl !== null) trackedClade = bestCl
        lastCamAt = ts
      }
      const rep = trackedClade !== null ? findOldestOfClade(trackedClade) : null
      if (rep) {
        const orgSize = rep.organismSize || 1
        camZoomTarget = clamp(7.0 - orgSize * 0.3, 3.5, 10.0)
        smoothCamTo(rep.x, rep.y, 0.1)
        renderer.view.scale = getBaseScale() * camZoomCurrent
        ensureCladeName(trackedClade, sim)
        renderer._trackTarget = {
          id: rep.id,
          clade: trackedClade,
          label: '🔴 ' + ((organismNames.get(trackedClade) || {}).displayName || `Clade ${trackedClade}`)
        }
      } else {
        renderer._trackTarget = null
        camZoomTarget = 1.0
      }
      return
    }

    // ── Herbivore Cam: track the top herbivore species ──
    if (mode === 'herbivore') {
      if (ts - lastCamAt > 3000 || trackedClade === null) {
        let bestCl = null,
          bestScore = -1
        const cladePop = getCladePops()
        for (const [cl, pop] of cladePop) {
          for (let i = 0; i < sim.cells.length; i++) {
            if (sim.cells[i].clade === cl) {
              const score = (1 - sim.cells[i].g.diet) * pop
              if (score > bestScore && sim.cells[i].g.diet < 0.3) {
                bestScore = score
                bestCl = cl
              }
              break
            }
          }
        }
        if (bestCl !== null) trackedClade = bestCl
        lastCamAt = ts
      }
      const rep = trackedClade !== null ? findOldestOfClade(trackedClade) : null
      if (rep) {
        const orgSize = rep.organismSize || 1
        camZoomTarget = clamp(7.0 - orgSize * 0.3, 3.5, 10.0)
        smoothCamTo(rep.x, rep.y, 0.1)
        renderer.view.scale = getBaseScale() * camZoomCurrent
        ensureCladeName(trackedClade, sim)
        renderer._trackTarget = {
          id: rep.id,
          clade: trackedClade,
          label: '🟢 ' + ((organismNames.get(trackedClade) || {}).displayName || `Clade ${trackedClade}`)
        }
      } else {
        renderer._trackTarget = null
        camZoomTarget = 1.0
      }
      return
    }

    // ── Largest Organism Cam: track the biggest multi-cell organism ──
    if (mode === 'largest') {
      if (ts - lastCamAt > 2000) {
        let bestCell = null,
          bestSize = 0
        for (let i = 0; i < sim.cells.length; i++) {
          const c = sim.cells[i]
          if ((c.organismSize || 1) > bestSize) {
            bestSize = c.organismSize || 1
            bestCell = c
          }
        }
        if (bestCell) {
          trackedClade = bestCell.clade
          trackedCellId = bestCell.id
        }
        lastCamAt = ts
      }
      // Find the actual cell by id
      let target = null
      for (let i = 0; i < sim.cells.length; i++) {
        if (sim.cells[i].id === trackedCellId) {
          target = sim.cells[i]
          break
        }
      }
      if (!target && trackedClade !== null) target = findOldestOfClade(trackedClade)
      if (target) {
        const orgSize = target.organismSize || 1
        camZoomTarget = clamp(6.0 - orgSize * 0.2, 2.5, 10.0)
        smoothCamTo(target.x, target.y, 0.08)
        renderer.view.scale = getBaseScale() * camZoomCurrent
        ensureCladeName(target.clade, sim)
        renderer._trackTarget = {
          id: target.id,
          clade: target.clade,
          label:
            `⬡ ${orgSize} cells — ` +
            ((organismNames.get(target.clade) || {}).displayName || `Clade ${target.clade}`)
        }
      } else {
        renderer._trackTarget = null
        camZoomTarget = 1.0
      }
      return
    }

    // ── Battle Cam: follow recent kill events ──
    if (mode === 'battle') {
      // Use death events as battle locations
      const deaths = sim.deathEvents || []
      if (deaths.length > 0) {
        const ev = deaths[deaths.length - 1]
        smoothCamTo(ev.x, ev.y, 0.15)
        camZoomTarget = 6.0
      } else {
        // Fall back to densest region
        if (ts - lastCamAt > 500) {
          camTarget = sim.densestRegion()
          lastCamAt = ts
        }
        smoothCamTo(camTarget.x, camTarget.y, 0.04)
        camZoomTarget = 3.0
      }
      renderer.view.scale = getBaseScale() * camZoomCurrent
      renderer._trackTarget = null
      return
    }

    // ── Pioneer Cam: follow the fastest-moving frontier cells ──
    if (mode === 'pioneer') {
      if (ts - lastCamAt > 2000) {
        let bestCell = null,
          bestSpeed = 0
        for (let i = 0; i < sim.cells.length; i++) {
          const c = sim.cells[i]
          if (c.role === 3 /* ROLE_PIONEER */) {
            const spd = c.vx * c.vx + c.vy * c.vy
            if (spd > bestSpeed) {
              bestSpeed = spd
              bestCell = c
            }
          }
        }
        // Fallback: fastest cell overall
        if (!bestCell) {
          for (let i = 0; i < sim.cells.length; i++) {
            const c = sim.cells[i]
            const spd = c.vx * c.vx + c.vy * c.vy
            if (spd > bestSpeed) {
              bestSpeed = spd
              bestCell = c
            }
          }
        }
        if (bestCell) {
          trackedClade = bestCell.clade
          trackedCellId = bestCell.id
        }
        lastCamAt = ts
      }
      let target = null
      for (let i = 0; i < sim.cells.length; i++) {
        if (sim.cells[i].id === trackedCellId) {
          target = sim.cells[i]
          break
        }
      }
      if (target) {
        camZoomTarget = 8.0
        smoothCamTo(target.x, target.y, 0.12)
        renderer.view.scale = getBaseScale() * camZoomCurrent
        ensureCladeName(target.clade, sim)
        renderer._trackTarget = {
          id: target.id,
          clade: target.clade,
          label: '⚡ ' + ((organismNames.get(target.clade) || {}).displayName || `Clade ${target.clade}`)
        }
      } else {
        renderer._trackTarget = null
        camZoomTarget = 1.0
      }
      return
    }

    // ── Newborn Cam: follow the most recent birth ──
    if (mode === 'newborn') {
      const births = sim.birthEvents || []
      if (births.length > 0) {
        const ev = births[births.length - 1]
        smoothCamTo(ev.x, ev.y, 0.12)
        camZoomTarget = 8.0
        if (ev.clade) {
          ensureCladeName(ev.clade, sim)
          renderer._trackTarget = {
            id: null,
            clade: ev.clade,
            label: '✦ Born — ' + ((organismNames.get(ev.clade) || {}).displayName || `Clade ${ev.clade}`)
          }
        }
      } else {
        if (ts - lastCamAt > 500) {
          camTarget = sim.densestRegion()
          lastCamAt = ts
        }
        smoothCamTo(camTarget.x, camTarget.y, 0.04)
        camZoomTarget = 2.0
        renderer._trackTarget = null
      }
      renderer.view.scale = getBaseScale() * camZoomCurrent
      return
    }

    // Auto mode: follow densest region, gentle zoom, no species focus
    renderer._trackTarget = null
    if (ts - lastCamAt > 200) {
      camTarget = sim.densestRegion()
      lastCamAt = ts
    }
    camZoomTarget = 1.8
    smoothCamTo(camTarget.x, camTarget.y, 0.04)
    renderer.view.scale = getBaseScale() * camZoomCurrent
  }

  function draw(ts) {
    const pop = sim.cells.length
    const minInterval = (pop > 4000 ? 33 : pop > 2500 ? 22 : 16) * TIME_SCALE
    if (ts - lastRenderAt < minInterval) return
    lastRenderAt = ts

    renderer.updateQuality(sim, renderMsEma)
    renderer.resizeToFit()
    updateCamera(ts)
    const start = performance.now()
    renderer.draw(sim, {
      showFood: el.showFood.checked,
      showLinks: el.showLinks.checked,
      filterDiet: el.filterDiet ? el.filterDiet.value : 'all',
      filterRole: el.filterRole ? el.filterRole.value : 'all',
      filterSpecies: el.filterSpecies ? el.filterSpecies.value : 'all',
      paused: !running
    })
    const ms = performance.now() - start
    renderMsEma = renderMsEma * 0.9 + ms * 0.1
  }

  function frame(ts) {
    try {
      if (running) {
        const dt = ts - lastFrameAt
        lastFrameAt = ts
        if (dt > 0) fpsEma = fpsEma * 0.9 + (1000 / dt) * 0.1

        const requested = parseInt(el.speed ? el.speed.value : '4', 10)

        const pop = sim.cells.length
        const simInterval = (pop > 3200 ? 66 : pop > 2200 ? 50 : pop > 1400 ? 33 : 16) * TIME_SCALE
        if (ts - lastSimAt >= simInterval) {
          lastSimAt = ts

          const start = performance.now()
          const target = Math.max(1, requested)
          const cap = Math.min(target, SAFETY.maxStepsPerFrame)
          const dynamicCap = Math.max(
            1,
            Math.min(cap, Math.floor(SAFETY.frameTimeBudgetMs / Math.max(0.001, avgStepMsEma)))
          )

          let i = 0
          const prevPop = sim.cells.length
          for (; i < dynamicCap; i++) {
            // Environment script: fire scheduled events
            envScript.tick(sim.t, sim, {
              onSnapshot: () => experimentLog.logEvent(sim.t, 'snapshot', { pop: sim.cells.length })
            })
            sim.step()
            // A/B split world: enforce barrier after movement
            if (splitWorld.active) splitWorld.enforceBarrier(sim)
            const newPop = sim.cells.length
            if (newPop > prevPop) {
              totalBirths += newPop - prevPop
            }
            if (performance.now() - start > SAFETY.frameTimeBudgetMs) break
          }

          // Update generation every 100 simulation steps
          if (sim.t % 100 === 0) {
            generation = Math.floor(sim.t / 100)
          }

          const simMs = performance.now() - start
          simMsEma = simMsEma * 0.9 + simMs * 0.1
          if (i > 0) {
            const per = simMs / i
            avgStepMsEma = avgStepMsEma * 0.92 + per * 0.08
          }

          stepsSince += i

          // Feed stress test with live perf metrics (once per sim batch)
          if (stressTest.running) {
            stressTest.tick({ fps: fpsEma, simMs: simMsEma, renderMs: renderMsEma })
          }

          if (el.speedV) {
            if (target > cap) {
              el.speedV.textContent = `${cap} (capped)`
            } else if (i < target) {
              el.speedV.textContent = `${i} (budget)`
            } else {
              el.speedV.textContent = `${el.speed ? el.speed.value : requested}`
            }
          }
        }

        if (ts - lastStatsAt > 260) {
          updateHud()
          updatePerfHud()
          lastStatsAt = ts
        }

        if (ts - stepsWindowAt > 1200) {
          stepsSince = 0
          stepsWindowAt = performance.now()
        }

        draw(ts)
      }
      requestAnimationFrame(frame)
    } catch (err) {
      setRunning(false)
      console.error('Simulation paused due to error:', err)
    }
  }

  requestAnimationFrame(frame)

  window.addEventListener('resize', () => draw(performance.now()))

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) {
      setRunning(false)
    }
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault()
      setRunning(!running)
    }
    if (e.key.toLowerCase() === 'r') doReset()
  })
}
main()
