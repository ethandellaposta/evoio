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

// ── Characteristic-based organism name generator ──
// Names are built from actual genome traits, mimicking biological taxonomy.
// Genus (prefix) = ecological strategy, Species (suffix) = dominant morphology,
// Epithet = notable secondary trait. e.g. "Velocilia the Armored"

// Genus roots — based on diet + locomotion strategy
const GENUS_HERB_SLOW = ['Chloro', 'Phyto', 'Herba', 'Viridi', 'Frondo', 'Limna', 'Bryo']
const GENUS_HERB_FAST = ['Veloci', 'Cursa', 'Rheo', 'Dromo', 'Pelagi', 'Necto', 'Plano']
const GENUS_OMNI_SLOW = ['Vario', 'Amphi', 'Meso', 'Medio', 'Mixo', 'Poly', 'Demi']
const GENUS_OMNI_FAST = ['Versi', 'Agili', 'Flexi', 'Rapido', 'Celeri', 'Vivi', 'Acro']
const GENUS_CARN_SLOW = ['Tardi', 'Gravi', 'Torpi', 'Lento', 'Pondo', 'Vasto', 'Moli']
const GENUS_CARN_FAST = ['Preda', 'Feroci', 'Raptori', 'Voraci', 'Saevi', 'Atroci', 'Diri']

// Species suffixes — based on dominant morphological trait
const SPECIES_SUFFIXES = {
  flagella: ['cilia', 'flagra', 'cauda', 'penna', 'filum'],
  cilia: ['cilia', 'vibra', 'tricha', 'setae', 'pilia'],
  spike: ['spina', 'acantha', 'echina', 'hasta', 'cuspis'],
  spines: ['echinus', 'aculea', 'chaeta', 'senta', 'hirta'],
  toxin: ['toxica', 'venena', 'noxia', 'virosa', 'letha'],
  membrane: ['derma', 'theca', 'tunica', 'crusta', 'lamina'],
  shell: ['testa', 'concha', 'lorica', 'clypea', 'scuta'],
  elongation: ['verma', 'forma', 'longa', 'taenia', 'nema'],
  amoeboid: ['protea', 'morpha', 'plasma', 'amoeba', 'flexa'],
  biolum: ['luxa', 'phota', 'lumina', 'fulgora', 'nitida'],
  vesicles: ['vesica', 'bulla', 'gemma', 'pustula', 'cysta'],
  proboscis: ['rostra', 'probos', 'siphona', 'haustra', 'stylia'],
  eyespot: ['ocula', 'stigma', 'optica', 'visia', 'pupila'],
  stalk: ['stipa', 'pedica', 'caulis', 'trunca', 'stipita'],
  symbiosis: ['socia', 'mutuala', 'symbio', 'unita', 'nexia'],
  chloroplast: ['chlora', 'viridis', 'thalla', 'phylla', 'herba'],
  adhesion: ['nexus', 'vincta', 'juncta', 'copula', 'liga'],
  camouflage: ['crypta', 'latena', 'obscura', 'umbra', 'phantasma'],
  default: ['morpha', 'soma', 'plasma', 'forma', 'vita']
}

// Epithets — based on secondary notable traits
const EPITHETS = {
  big: ['the Vast', 'the Grand', 'the Colossal'],
  tiny: ['the Minute', 'the Dwarf', 'the Micro'],
  fast: ['the Swift', 'the Fleet', 'the Darting'],
  slow: ['the Sessile', 'the Rooted', 'the Still'],
  tough: ['the Armored', 'the Hardy', 'the Ironclad'],
  social: ['the Colonial', 'the Gregarious', 'the Communal'],
  toxic: ['the Venomous', 'the Noxious', 'the Caustic'],
  bright: ['the Luminous', 'the Radiant', 'the Glowing'],
  ancient: ['the Elder', 'the Primordial', 'the Archaic'],
  mutant: ['the Unstable', 'the Shifting', 'the Volatile'],
  predator: ['the Ravenous', 'the Voracious', 'the Devouring'],
  peaceful: ['the Gentle', 'the Placid', 'the Serene'],
  shelled: ['the Plated', 'the Encased', 'the Fortified'],
  eyed: ['the Watchful', 'the Vigilant', 'the Keen-eyed'],
  symbiotic: ['the Bonded', 'the Mutualist', 'the Cooperative']
}

function generateOrganismName(clade, genome) {
  if (!genome) {
    // Fallback for legacy calls without genome — deterministic from clade id
    const fallbackParts = ['Proto', 'Neo', 'Xeno', 'Archa', 'Primi', 'Crypto', 'Para']
    const fallbackSuffix = ['morpha', 'plasma', 'soma', 'forma', 'vita', 'nema', 'cysta']
    return fallbackParts[clade % fallbackParts.length] + fallbackSuffix[(clade * 7) % fallbackSuffix.length]
  }

  const g = genome

  // ── Determine genus from diet + speed ──
  const isHerb = g.diet < 0.3
  const isCarn = g.diet > 0.6
  const isFast = g.speed > 1.2 || (g.flagella || 0) > 0.3 || (g.jet || 0) > 0.2
  let genusPool
  if (isHerb) genusPool = isFast ? GENUS_HERB_FAST : GENUS_HERB_SLOW
  else if (isCarn) genusPool = isFast ? GENUS_CARN_FAST : GENUS_CARN_SLOW
  else genusPool = isFast ? GENUS_OMNI_FAST : GENUS_OMNI_SLOW
  const genus = genusPool[clade % genusPool.length]

  // ── Determine species suffix from dominant morphological trait ──
  const traits = [
    { key: 'flagella', val: g.flagella || 0 },
    { key: 'cilia', val: g.cilia || 0 },
    { key: 'spike', val: g.spike || 0 },
    { key: 'spines', val: g.spines || 0 },
    { key: 'toxin', val: g.toxin || 0 },
    { key: 'membrane', val: g.membrane || 0 },
    { key: 'shell', val: g.shell || 0 },
    { key: 'elongation', val: g.elongation || 0 },
    { key: 'amoeboid', val: g.amoeboid || 0 },
    { key: 'biolum', val: g.biolum || 0 },
    { key: 'vesicles', val: g.vesicles || 0 },
    { key: 'proboscis', val: g.proboscis || 0 },
    { key: 'eyespot', val: g.eyespot || 0 },
    { key: 'stalk', val: g.stalk || 0 },
    { key: 'symbiosis', val: g.symbiosis || 0 },
    { key: 'chloroplast', val: g.chloroplast || 0 },
    { key: 'adhesion', val: g.adhesion || 0 },
    { key: 'camouflage', val: g.camouflage || 0 }
  ]
  traits.sort((a, b) => b.val - a.val)
  const topTrait = traits[0].val > 0.08 ? traits[0].key : 'default'
  const suffixPool = SPECIES_SUFFIXES[topTrait] || SPECIES_SUFFIXES.default
  const species = suffixPool[(clade * 3) % suffixPool.length]

  // ── Determine epithet from secondary notable characteristics ──
  let epithet = ''
  const secondTrait = traits[1]
  const bodyScale = g.bodyScale || 1.0
  const toughness = g.toughness || 0
  const sociality = g.sociality || 0
  const mutRate = g.mutRate || 0.05
  const biolum = g.biolum || 0
  const shell = g.shell || 0
  const eyespot = g.eyespot || 0
  const symbiosis = g.symbiosis || 0

  // Pick epithet based on most notable secondary characteristic
  const pick = (pool) => pool[(clade * 11) % pool.length]
  if (shell > 0.25) epithet = pick(EPITHETS.shelled)
  else if (eyespot > 0.2) epithet = pick(EPITHETS.eyed)
  else if (symbiosis > 0.25) epithet = pick(EPITHETS.symbiotic)
  else if (toughness > 0.3) epithet = pick(EPITHETS.tough)
  else if (isCarn && g.diet > 0.7) epithet = pick(EPITHETS.predator)
  else if (biolum > 0.2) epithet = pick(EPITHETS.bright)
  else if (sociality > 0.5) epithet = pick(EPITHETS.social)
  else if (bodyScale > 1.4) epithet = pick(EPITHETS.big)
  else if (bodyScale < 0.7) epithet = pick(EPITHETS.tiny)
  else if (g.speed > 1.6) epithet = pick(EPITHETS.fast)
  else if (g.speed < 0.6 || (g.stalk || 0) > 0.2) epithet = pick(EPITHETS.slow)
  else if ((g.toxin || 0) > 0.2) epithet = pick(EPITHETS.toxic)
  else if (mutRate > 0.15) epithet = pick(EPITHETS.mutant)
  else if (isHerb && g.diet < 0.15) epithet = pick(EPITHETS.peaceful)

  const suffix = epithet ? ` ${epithet}` : ''
  return `${genus}${species}${suffix}`
}

// Cache organism names so they persist
const organismNames = new Map()

// Helper: ensure a clade has a name, using a representative genome if available
function ensureCladeName(clade, simRef) {
  if (organismNames.has(clade)) return
  // Find a living cell of this clade to use as representative
  let genome = null
  if (simRef) {
    for (let i = 0; i < simRef.cells.length; i++) {
      if (simRef.cells[i].clade === clade) {
        genome = simRef.cells[i].g
        break
      }
    }
  }
  organismNames.set(clade, generateOrganismName(clade, genome))
}

async function main() {
  await initWasm()

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
    hudT: document.getElementById('hud-t'),
    hudOrgs: document.getElementById('hud-orgs'),
    hudPop: document.getElementById('hud-pop'),
    hudLinks: document.getElementById('hud-links'),
    hudAdh: document.getElementById('hud-adh'),
    hudSpd: document.getElementById('hud-spd'),
    hudMet: document.getElementById('hud-met'),
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
    // Role counts
    roleNone: document.getElementById('role-none'),
    roleEdge: document.getElementById('role-edge'),
    roleInterior: document.getElementById('role-interior'),
    rolePioneer: document.getElementById('role-pioneer'),
    // Multicellularity
    multicellBar: document.getElementById('multicell-bar'),
    multicellPct: document.getElementById('multicell-pct'),
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
    // Species + food chain
    speciesPopList: document.getElementById('species-pop-list'),
    speciesList: document.getElementById('species-list'),
    foodchainList: document.getElementById('foodchain-list'),
    // Largest organisms
    largestList: document.getElementById('largest-list'),
    // Behavioral evolution
    behBold: document.getElementById('beh-bold'),
    behBoldV: document.getElementById('beh-bold-v'),
    behSocial: document.getElementById('beh-social'),
    behSocialV: document.getElementById('beh-social-v'),
    behMutrate: document.getElementById('beh-mutrate'),
    behMutrateV: document.getElementById('beh-mutrate-v'),
    behForage: document.getElementById('beh-forage'),
    behForageV: document.getElementById('beh-forage-v'),
    behExplore: document.getElementById('beh-explore'),
    behExploreV: document.getElementById('beh-explore-v'),
    behCoop: document.getElementById('beh-coop'),
    behCoopV: document.getElementById('beh-coop-v'),
    behDiversity: document.getElementById('beh-diversity'),
    behDiversityV: document.getElementById('beh-diversity-v'),
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
    sim.setConfigPatch({
      mutationRate: parseFloat(el.mutation.value),
      foodGrowth: parseFloat(el.food.value),
      patchiness: parseFloat(el.patch.value),
      maxOrganisms: parseInt(el.maxOrganisms.value, 10)
    })

    el.speedV.textContent = `${el.speed.value}`
  }

  initUiFromParams()

  el.play.addEventListener('click', () => {
    running = !running
    el.play.textContent = running ? 'Pause' : 'Play'
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
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.href = url
    a.download = `evoio-save-t${sim.t}-${ts}.json`
    a.click()
    URL.revokeObjectURL(url)
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
  const graphCanvas = document.getElementById('graph-canvas')
  const graphCtx = graphCanvas ? graphCanvas.getContext('2d') : null

  // Listen for metric radio changes
  document.querySelectorAll('input[name="graph-metric"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      graphMetric = e.target.value
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
        const val = (maxTotal * gi) / 4
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
          const y = pad.t + gh * (1 - stacks[i][li + 1] / maxTotal)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        // Bottom edge (right to left)
        for (let i = n - 1; i >= 0; i--) {
          const x = pad.l + (i / (n - 1)) * gw
          const y = pad.t + gh * (1 - stacks[i][li] / maxTotal)
          ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.fillStyle = layer.fill
        ctx.fill()

        // Top edge line
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const x = pad.l + (i / (n - 1)) * gw
          const y = pad.t + gh * (1 - stacks[i][li + 1] / maxTotal)
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
      const val = (maxVal * i) / 4
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
    ctx.fillText(c.label, pad.l, pad.t - 5)

    // Fill area
    ctx.beginPath()
    ctx.moveTo(pad.l, pad.t + gh)
    for (let i = 0; i < n; i++) {
      const x = pad.l + (i / (n - 1)) * gw
      const y = pad.t + gh * (1 - data[i] / maxVal)
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
      const y = pad.t + gh * (1 - data[i] / maxVal)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = c.line
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Current value dot
    const lastX = pad.l + gw
    const lastY = pad.t + gh * (1 - data[n - 1] / maxVal)
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
      running = false
      el.play.textContent = 'Play'
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
          if (wasRunning) {
            running = true
            el.play.textContent = 'Pause'
          }
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
    const s = sim.stats()
    el.hudT.textContent = `${s.t}`
    el.hudOrgs.textContent = `${s.organismCount}`
    el.hudPop.textContent = `${s.pop}`
    el.hudLinks.textContent = `${s.links}`
    el.hudAdh.textContent = fmt(s.meanAdhesion, 3)
    el.hudSpd.textContent = fmt(s.meanSpeed, 3)
    el.hudMet.textContent = fmt(s.meanMetabolism, 3)

    // Update new status panel
    el.statusGen.textContent = `${generation}`
    el.statusBirths.textContent = `${totalBirths}`

    // Calculate food level
    let totalFood = 0
    if (sim.food && sim.food.length) {
      for (let i = 0; i < sim.food.length; i++) totalFood += sim.food[i]
    }
    const maxFood = sim.w * sim.h * 8.0
    const foodPercent = maxFood > 0 ? ((totalFood / maxFood) * 100).toFixed(1) : '0.0'
    el.statusFood.textContent = `${foodPercent}%`

    // Season
    el.statusSeason.textContent = `${s.season}`

    // Day/Night
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
      // Sun icon during day, moon during night
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

    // Role counts
    if (el.roleNone) el.roleNone.textContent = `${s.rolesNone}`
    if (el.roleEdge) el.roleEdge.textContent = `${s.rolesEdge}`
    if (el.roleInterior) el.roleInterior.textContent = `${s.rolesInterior}`
    if (el.rolePioneer) el.rolePioneer.textContent = `${s.rolesPioneer}`

    // Multicellularity bar
    const mcPct = (s.multicellFraction * 100).toFixed(0)
    if (el.multicellBar) el.multicellBar.style.width = `${mcPct}%`
    if (el.multicellPct) el.multicellPct.textContent = `${mcPct}%`

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

    // Species population + longevity + food chain
    updateSpeciesPopList()
    updateSpeciesList(s)
    updateFoodChain(s)

    // Largest organisms by sub-cell count
    updateLargestOrganisms(s)

    // Populate species filter dropdown
    updateSpeciesDropdown()

    // Behavioral evolution metrics
    updateBehavioralMetrics()

    // Time-series graph
    recordHistory(s)
    drawGraph()
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
      const name = organismNames.get(clade)
      const sel = `${clade}` === currentVal ? ' selected' : ''
      html += `<option value="${clade}"${sel}>${name} (${pop})</option>`
    }
    el.filterSpecies.innerHTML = html
  }

  function updateBehavioralMetrics() {
    if (!el.behBold || sim.cells.length === 0) return
    const n = sim.cells.length
    let sumBold = 0,
      sumSocial = 0,
      sumMutRate = 0
    let sumForage = 0,
      sumExplore = 0,
      sumCoop = 0
    const clades = new Set()
    for (let i = 0; i < n; i++) {
      const c = sim.cells[i]
      sumBold += c.g.boldness ?? 0.5
      sumSocial += c.g.sociality ?? 0.3
      sumMutRate += c.g.mutRate ?? 0.05
      sumForage += c.foragingEff || 0
      sumExplore += c.explorationScore || 0
      sumCoop += c.cooperationScore || 0
      clades.add(c.clade)
    }
    const setBV = (bar, val, txt, max) => {
      if (bar) bar.style.width = `${Math.min(100, (val / max) * 100).toFixed(0)}%`
      if (txt) txt.textContent = val.toFixed(2)
    }
    setBV(el.behBold, sumBold / n, el.behBoldV, 1)
    setBV(el.behSocial, sumSocial / n, el.behSocialV, 1)
    setBV(el.behMutrate, sumMutRate / n, el.behMutrateV, 0.25)
    setBV(el.behForage, sumForage / n, el.behForageV, 0.1)
    setBV(el.behExplore, sumExplore / n, el.behExploreV, 0.5)
    setBV(el.behCoop, sumCoop / n, el.behCoopV, 0.05)
    // Diversity: number of unique clades
    if (el.behDiversity) el.behDiversity.style.width = `${Math.min(100, clades.size * 2).toFixed(0)}%`
    if (el.behDiversityV) el.behDiversityV.textContent = clades.size
  }

  function updateOrganismList() {
    if (!el.organismList) return
    const organisms = buildOrganisms(sim.cells, sim.links, sim.w, sim.h, sim.cfg.linkDist)

    // Collect organism data, sorted by size descending
    const orgData = []
    for (const [, indices] of organisms) {
      if (indices.length < 2) continue
      const cells = indices.map((i) => sim.cells[i])
      const clade = cells[0].clade
      let totalEnergy = 0
      let dietSum = 0
      for (const c of cells) {
        totalEnergy += c.energy
        dietSum += c.g.diet
      }
      const avgDiet = dietSum / cells.length
      let dietLabel = 'herb'
      if (avgDiet > 0.6) dietLabel = 'carn'
      else if (avgDiet > 0.3) dietLabel = 'omni'

      // Get or create name
      ensureCladeName(clade, sim)

      // Pick a representative cell (largest energy)
      let repCell = cells[0]
      for (const c of cells) {
        if (c.energy > repCell.energy) repCell = c
      }

      orgData.push({
        clade,
        name: organismNames.get(clade),
        size: indices.length,
        energy: totalEnergy,
        diet: dietLabel,
        color: cladeColor(clade),
        rep: repCell,
        cells
      })
    }

    orgData.sort((a, b) => b.size - a.size)

    // Cap display at 12
    const display = orgData.slice(0, 12)

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
          <div class="organism-meta">
            <span>${org.diet}</span>
            <span>${org.energy.toFixed(1)}e</span>
          </div>
        </div>
        <div class="organism-cells">${org.size}</div>
      </div>`
    }
    if (orgData.length > 12) {
      html += `<div class="organism-empty">+${orgData.length - 12} more</div>`
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
  function _drawMiniCell(canvas, org) {
    const ctx = canvas.getContext('2d')
    const w = canvas.width,
      h = canvas.height
    const TAU = Math.PI * 2
    const allCells = org.cells || [org.rep]
    ctx.clearRect(0, 0, w, h)

    // Compute centroid and bounding extent of all cells in world space
    let sumX = 0,
      sumY = 0
    for (const c of allCells) {
      sumX += c.x
      sumY += c.y
    }
    const centX = sumX / allCells.length
    const centY = sumY / allCells.length

    // Find max distance from centroid to determine scale
    let maxDist = 5
    for (const c of allCells) {
      const dx = c.x - centX,
        dy = c.y - centY
      const d = Math.sqrt(dx * dx + dy * dy) + 4
      if (d > maxDist) maxDist = d
    }
    const scale = (w * 0.42) / maxDist
    const midX = w / 2,
      midY = h / 2

    function toLocal(wx, wy) {
      return [midX + (wx - centX) * scale, midY + (wy - centY) * scale]
    }

    // ── Draw links between cells ──
    ctx.lineWidth = 1.2
    ctx.lineCap = 'round'
    for (let i = 0; i < allCells.length; i++) {
      const ci = allCells[i]
      for (let j = i + 1; j < allCells.length; j++) {
        const cj = allCells[j]
        const dx = ci.x - cj.x,
          dy = ci.y - cj.y
        if (dx * dx + dy * dy < 64) {
          const [x1, y1] = toLocal(ci.x, ci.y)
          const [x2, y2] = toLocal(cj.x, cj.y)
          const h1 = (cladeHue(ci.clade) + (ci.g.hueShift || 0) * 60 + 360) % 360
          ctx.globalAlpha = 0.25
          ctx.strokeStyle = `hsl(${h1 | 0} 50% 60%)`
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
        }
      }
    }

    // ── Draw each sub-cell ──
    for (const c of allCells) {
      const [x, y] = toLocal(c.x, c.y)
      const g = c.g
      const baseHue = cladeHue(c.clade)
      const morphHue =
        (g.toxin || 0) * -25 +
        (g.spines || 0) * 15 +
        (g.flagella || 0) * -10 +
        (g.biolum || 0) * 20 +
        (g.amoeboid || 0) * -8
      const hue = (baseHue + (g.hueShift || 0) * 120 + g.diet * 55 - 15 + morphHue + 720) % 360
      const cSatOff = cladeSatOffset(c.clade)
      const cLumOff = cladeLumOffset(c.clade)
      const sat = Math.max(
        30,
        Math.min(98, 65 + g.diet * 18 - (g.brightness || 0) * 10 + cSatOff - (g.membrane || 0) * 12)
      )
      const lum = Math.max(
        28,
        Math.min(82, 48 + 12 * g.adhesion + (g.brightness || 0) * 18 + cLumOff - (g.toxin || 0) * 8)
      )
      const r = Math.max(5, 4.0 * (g.bodyScale || 1) * scale)
      const elong = g.elongation || 0
      const vLen = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 0.001
      const fdx = c.vx / vLen,
        fdy = c.vy / vLen

      // Organism glow damping for mini renders
      const _miniGlowDamp = allCells.length > 1 ? 1.0 / (1.0 + (allCells.length - 1) * 0.35) : 1.0

      // Bioluminescent glow — drawn first, behind everything
      const biolum = g.biolum || 0
      const glowR = r * (2.2 + biolum * 1.5)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = (0.12 + biolum * 0.15) * _miniGlowDamp
      ctx.fillStyle = `hsl(${hue | 0} ${sat | 0}% ${(lum + 15) | 0}%)`
      ctx.beginPath()
      ctx.arc(x, y, glowR, 0, TAU)
      ctx.fill()
      // Core highlight
      ctx.globalAlpha = (0.08 + biolum * 0.1) * _miniGlowDamp
      ctx.fillStyle = `hsl(${hue | 0} ${(sat * 0.5) | 0}% ${(lum + 25) | 0}%)`
      ctx.beginPath()
      ctx.arc(x, y, r * 0.6, 0, TAU)
      ctx.fill()
      ctx.restore()

      // ── Appendages drawn BEHIND body (matches main renderer order) ──
      const perpX = -fdy,
        perpY = fdx

      // Flipper fins
      if ((g.flipper || 0) > 0.1) {
        const fl = g.flipper
        const fLen = r * (0.8 + fl * 1.5)
        const fWid = r * (0.2 + fl * 0.3)
        ctx.globalAlpha = 0.3 + fl * 0.2
        ctx.fillStyle = `hsl(${hue | 0} ${(sat - 10) | 0}% ${(lum + 5) | 0}%)`
        for (const side of [-1, 1]) {
          const bx2 = x + perpX * r * 0.5 * side
          const by2 = y + perpY * r * 0.5 * side
          const tx2 = bx2 + perpX * side * fLen * 0.5 + fdx * fLen * 0.3
          const ty2 = by2 + perpY * side * fLen * 0.5 + fdy * fLen * 0.3
          ctx.beginPath()
          ctx.moveTo(bx2, by2)
          ctx.quadraticCurveTo(bx2 + fdx * fWid, by2 + fdy * fWid, tx2, ty2)
          ctx.quadraticCurveTo(bx2 - fdx * fWid * 0.5, by2 - fdy * fWid * 0.5, bx2, by2)
          ctx.fill()
        }
      }

      // Paddle fins
      if ((g.paddleFin || 0) > 0.1) {
        const pf = g.paddleFin
        const padLen = r * (0.8 + pf * 1.8)
        const padWid = r * (0.3 + pf * 0.5)
        ctx.globalAlpha = 0.25 + pf * 0.2
        ctx.fillStyle = `hsl(${hue | 0} ${(sat - 15) | 0}% ${(lum + 5) | 0}%)`
        for (const side of [-1, 1]) {
          const bx2 = x + perpX * r * 0.4 * side - fdx * r * 0.15
          const by2 = y + perpY * r * 0.4 * side - fdy * r * 0.15
          const tx2 = bx2 + perpX * side * padLen * 0.5 - fdx * padLen * 0.3
          const ty2 = by2 + perpY * side * padLen * 0.5 - fdy * padLen * 0.3
          ctx.beginPath()
          ctx.moveTo(bx2, by2)
          ctx.quadraticCurveTo(
            (bx2 + tx2) / 2 + perpX * side * padWid * 0.4,
            (by2 + ty2) / 2 + perpY * side * padWid * 0.4,
            tx2,
            ty2
          )
          ctx.quadraticCurveTo(
            (bx2 + tx2) / 2 - perpX * side * padWid * 0.3,
            (by2 + ty2) / 2 - perpY * side * padWid * 0.3,
            bx2,
            by2
          )
          ctx.fill()
        }
      }

      // Proboscis tube
      if ((g.proboscis || 0) > 0.1) {
        const prob = g.proboscis
        const tubeLen = r * (0.8 + prob * 2.5)
        const tubeWid = r * (0.08 + prob * 0.1)
        const tbx = x + fdx * r * 0.8,
          tby = y + fdy * r * 0.8
        const ttx = tbx + fdx * tubeLen,
          tty = tby + fdy * tubeLen
        ctx.globalAlpha = 0.35 + prob * 0.25
        ctx.fillStyle = `hsl(${hue | 0} ${(sat - 8) | 0}% ${(lum + 3) | 0}%)`
        ctx.beginPath()
        ctx.moveTo(tbx + perpX * tubeWid, tby + perpY * tubeWid)
        ctx.lineTo(ttx + perpX * tubeWid * 0.5, tty + perpY * tubeWid * 0.5)
        ctx.arc(ttx, tty, tubeWid * 0.5, Math.atan2(perpY, perpX), Math.atan2(-perpY, -perpX))
        ctx.lineTo(tbx - perpX * tubeWid, tby - perpY * tubeWid)
        ctx.closePath()
        ctx.fill()
        // Suction tip
        ctx.globalAlpha = 0.3 + prob * 0.2
        ctx.strokeStyle = `hsl(${((hue + 20) % 360) | 0} ${sat | 0}% ${(lum - 10) | 0}%)`
        ctx.lineWidth = 0.4 + prob * 0.3
        ctx.beginPath()
        ctx.arc(ttx, tty, tubeWid * 0.8, 0, TAU)
        ctx.stroke()
      }

      // Spike horn
      if ((g.spike || 0) > 0.1) {
        const sk = g.spike
        const hornLen = r * (0.6 + sk * 2.0)
        const hornWid = r * (0.1 + sk * 0.15)
        const hbx = x + fdx * r * 0.7,
          hby = y + fdy * r * 0.7
        const htx = hbx + fdx * hornLen,
          hty = hby + fdy * hornLen
        ctx.globalAlpha = 0.5 + sk * 0.25
        ctx.fillStyle = `hsl(${((hue + 30) % 360) | 0} ${(sat * 0.5) | 0}% ${(lum - 15) | 0}%)`
        ctx.beginPath()
        ctx.moveTo(hbx + perpX * hornWid, hby + perpY * hornWid)
        ctx.lineTo(htx, hty)
        ctx.lineTo(hbx - perpX * hornWid, hby - perpY * hornWid)
        ctx.closePath()
        ctx.fill()
        // Ridges
        ctx.globalAlpha = 0.2 + sk * 0.1
        ctx.strokeStyle = `hsl(${((hue + 30) % 360) | 0} ${(sat * 0.3) | 0}% ${(lum + 10) | 0}%)`
        ctx.lineWidth = 0.3
        for (let ri = 1; ri <= 3; ri++) {
          const f = ri / 4
          const rx2 = hbx + (htx - hbx) * f,
            ry2 = hby + (hty - hby) * f
          const rw2 = hornWid * (1 - f * 0.7)
          ctx.beginPath()
          ctx.moveTo(rx2 + perpX * rw2, ry2 + perpY * rw2)
          ctx.lineTo(rx2 - perpX * rw2, ry2 - perpY * rw2)
          ctx.stroke()
        }
      }

      // Spines — sharp triangles (matches main renderer)
      if ((g.spines || 0) > 0.1) {
        const sp = g.spines
        const spCount = Math.floor(5 + sp * 10)
        const spLen = r * (0.3 + sp * 0.9)
        const spWid = r * (0.04 + sp * 0.06)
        ctx.globalAlpha = 0.4 + sp * 0.3
        ctx.fillStyle = `hsl(${hue | 0} ${(sat - 5) | 0}% ${(lum - 8) | 0}%)`
        for (let si = 0; si < spCount; si++) {
          const sa = (si / spCount) * TAU + c.id * 0.4
          const sbx = x + Math.cos(sa) * r * 0.9,
            sby = y + Math.sin(sa) * r * 0.9
          const stx = x + Math.cos(sa) * (r + spLen),
            sty = y + Math.sin(sa) * (r + spLen)
          const spx = -Math.sin(sa),
            spy = Math.cos(sa)
          ctx.beginPath()
          ctx.moveTo(sbx + spx * spWid, sby + spy * spWid)
          ctx.lineTo(stx, sty)
          ctx.lineTo(sbx - spx * spWid, sby - spy * spWid)
          ctx.closePath()
          ctx.fill()
        }
      }

      // Amoeboid pseudopods
      if ((g.amoeboid || 0) > 0.15) {
        const am = g.amoeboid
        const podCount = 2 + Math.floor(am * 3)
        const podLen = r * (0.4 + am * 0.7)
        const podWid = r * (0.15 + am * 0.15)
        ctx.globalAlpha = 0.25 + am * 0.15
        ctx.fillStyle = `hsl(${hue | 0} ${(sat * 0.7) | 0}% ${(lum + 5) | 0}%)`
        for (let pi = 0; pi < podCount; pi++) {
          const pa = (pi / podCount) * TAU + c.id * 0.6
          const pbx = x + Math.cos(pa) * r * 0.65,
            pby = y + Math.sin(pa) * r * 0.65
          const ptx = pbx + Math.cos(pa) * podLen,
            pty = pby + Math.sin(pa) * podLen
          const ppx = -Math.sin(pa),
            ppy = Math.cos(pa)
          ctx.beginPath()
          ctx.moveTo(pbx + ppx * podWid * 0.7, pby + ppy * podWid * 0.7)
          ctx.quadraticCurveTo((pbx + ptx) / 2 + ppx * podWid, (pby + pty) / 2 + ppy * podWid, ptx, pty)
          ctx.quadraticCurveTo(
            (pbx + ptx) / 2 - ppx * podWid,
            (pby + pty) / 2 - ppy * podWid,
            pbx - ppx * podWid * 0.7,
            pby - ppy * podWid * 0.7
          )
          ctx.closePath()
          ctx.fill()
        }
      }

      // ── Body shape (matches main renderer: amoeboid distortion) ──
      ctx.globalAlpha = 0.55
      ctx.fillStyle = `hsl(${hue | 0} ${(sat * 0.6) | 0}% ${(lum + 8) | 0}%)`
      ctx.beginPath()
      if (elong > 0.2) {
        ctx.ellipse(x, y, r * (1 + elong * 0.5), r * (1 - elong * 0.15), Math.atan2(fdy, fdx), 0, TAU)
      } else if ((g.amoeboid || 0) > 0.1) {
        // Amoeboid: irregular blob outline
        const am = g.amoeboid
        const lobes = 10
        const pts = []
        for (let li = 0; li < lobes; li++) {
          const a = (li / lobes) * TAU
          let deform =
            1.0 +
            0.12 * Math.sin(a * 2.0 + c.id * 1.7) +
            0.07 * Math.sin(a * 3.0 + c.id * 0.9) +
            am * 0.25 * Math.sin(a * 1.5 + c.id * 2.1) +
            am * 0.18 * Math.sin(a * 2.7 + c.id * 0.6)
          pts.push({ x: x + Math.cos(a) * r * deform, y: y + Math.sin(a) * r * deform })
        }
        ctx.moveTo((pts[pts.length - 1].x + pts[0].x) / 2, (pts[pts.length - 1].y + pts[0].y) / 2)
        for (let li = 0; li < pts.length; li++) {
          const next = pts[(li + 1) % pts.length]
          ctx.quadraticCurveTo(pts[li].x, pts[li].y, (pts[li].x + next.x) / 2, (pts[li].y + next.y) / 2)
        }
        ctx.closePath()
      } else {
        ctx.arc(x, y, r, 0, TAU)
      }
      ctx.fill()

      // Membrane
      ctx.globalAlpha = 0.6
      ctx.strokeStyle = `hsl(${hue | 0} ${(sat + 10) | 0}% ${(lum + 15) | 0}%)`
      ctx.lineWidth = 0.6 + (g.membrane || 0) * 1.0
      ctx.stroke()

      // ── On-body overlays (drawn after membrane, matches main renderer) ──

      // Constriction bands
      if ((g.constrict || 0) > 0.1) {
        const cn = g.constrict
        const bandCount = 3 + Math.floor(cn * 4)
        ctx.globalAlpha = 0.15 + cn * 0.15
        ctx.strokeStyle = `hsl(${hue | 0} ${(sat * 0.5) | 0}% ${(lum - 12) | 0}%)`
        for (let bi = 0; bi < bandCount; bi++) {
          const frac = (bi + 1) / (bandCount + 1)
          ctx.lineWidth = 0.3 + cn * 0.4
          ctx.beginPath()
          ctx.arc(x, y, r * frac, 0, TAU)
          ctx.stroke()
        }
      }

      // Armor plates
      if ((g.membrane || 0) > 0.25) {
        const mem = g.membrane
        const plateCount = 4 + Math.floor(mem * 4)
        const plateThick = r * (0.06 + mem * 0.08)
        ctx.globalAlpha = 0.2 + mem * 0.2
        ctx.fillStyle = `hsl(${hue | 0} ${(sat * 0.4) | 0}% ${(lum - 10) | 0}%)`
        for (let pi = 0; pi < plateCount; pi++) {
          const a1 = (pi / plateCount) * TAU + c.id * 0.3
          const a2 = ((pi + 0.85) / plateCount) * TAU + c.id * 0.3
          const outerR = r * (1.02 + mem * 0.06)
          ctx.beginPath()
          ctx.arc(x, y, outerR, a1, a2)
          ctx.arc(x, y, outerR - plateThick, a2, a1, true)
          ctx.closePath()
          ctx.fill()
        }
      }

      // Toxin droplets
      if ((g.toxin || 0) > 0.2) {
        const tx2 = g.toxin
        const dropCount = 3 + Math.floor(tx2 * 3)
        ctx.globalAlpha = 0.3 + tx2 * 0.2
        ctx.fillStyle = `hsl(90 75% 40%)`
        for (let di = 0; di < dropCount; di++) {
          const da = (di / dropCount) * TAU + c.id * 0.9
          const dd = r * 1.1
          ctx.beginPath()
          ctx.arc(x + Math.cos(da) * dd, y + Math.sin(da) * dd, 0.5 + tx2 * 0.7, 0, TAU)
          ctx.fill()
        }
      }

      // Flagella tail
      if ((g.flagella || 0) > 0.1) {
        ctx.lineCap = 'round'
        const fLen = r * (1.5 + g.flagella * 2.5)
        const flagPath = () => {
          ctx.beginPath()
          ctx.moveTo(x - fdx * r * 0.6, y - fdy * r * 0.6)
          for (let s = 1; s <= 6; s++) {
            const f = s / 6
            const wave = Math.sin(f * 7 + c.id) * r * 0.35 * g.flagella * f
            ctx.lineTo(
              x - fdx * (r * 0.6 + fLen * f) + -fdy * wave,
              y - fdy * (r * 0.6 + fLen * f) + fdx * wave
            )
          }
        }
        ctx.globalAlpha = 0.8
        ctx.strokeStyle = `hsl(${hue | 0} 65% 75%)`
        ctx.lineWidth = 1.2 + g.flagella * 0.6
        flagPath()
        ctx.stroke()
      }

      // Cilia fringe
      if ((g.cilia || 0) > 0.1) {
        const cilCount = 8 + Math.floor(g.cilia * 6)
        ctx.globalAlpha = 0.5 + g.cilia * 0.2
        ctx.strokeStyle = `hsl(${hue | 0} 50% 68%)`
        ctx.lineWidth = 0.5
        for (let ci = 0; ci < cilCount; ci++) {
          const ca = (ci / cilCount) * TAU + c.id * 0.3
          const cLen = r * (0.2 + g.cilia * 0.4)
          ctx.beginPath()
          ctx.moveTo(x + Math.cos(ca) * r, y + Math.sin(ca) * r)
          ctx.lineTo(x + Math.cos(ca) * (r + cLen), y + Math.sin(ca) * (r + cLen))
          ctx.stroke()
        }
      }

      // ── Organelles ──
      if (c.organelles) {
        // Nucleus
        const nuc = c.organelles[0]
        if (nuc > 0.03) {
          const nucR = r * (0.35 + nuc * 0.25)
          const nucHue = (hue + 180) % 360
          ctx.globalAlpha = 0.75
          ctx.fillStyle = `hsl(${nucHue | 0} 80% 68%)`
          ctx.beginPath()
          ctx.arc(x, y, nucR, 0, TAU)
          ctx.fill()
          if (nuc > 0.15) {
            ctx.globalAlpha = 0.7
            ctx.fillStyle = `hsl(${nucHue | 0} 65% 94%)`
            ctx.beginPath()
            ctx.arc(x - nucR * 0.2, y - nucR * 0.15, nucR * 0.35, 0, TAU)
            ctx.fill()
          }
        }

        // Mitochondria
        const mito = c.organelles[1]
        if (mito > 0.04) {
          const mc = 1 + Math.floor(mito * 4)
          ctx.globalAlpha = 0.7
          ctx.fillStyle = 'hsl(15 90% 55%)'
          for (let mi = 0; mi < mc; mi++) {
            const ma = (mi / mc) * TAU + c.id * 0.7
            const md = r * 0.5
            const mr = r * 0.12 + mito * r * 0.08
            ctx.beginPath()
            ctx.ellipse(x + Math.cos(ma) * md, y + Math.sin(ma) * md, mr, mr * 0.55, ma, 0, TAU)
            ctx.fill()
          }
        }

        // Vacuole
        const vac = c.organelles[4]
        if (vac > 0.05) {
          const vr = r * 0.25 + vac * r * 0.2
          ctx.globalAlpha = 0.35
          ctx.fillStyle = `hsl(200 50% 72%)`
          ctx.beginPath()
          ctx.arc(x + r * 0.2, y + r * 0.15, vr, 0, TAU)
          ctx.fill()
        }

        // Receptors
        const rec = c.organelles[3]
        if (rec > 0.05) {
          const rc = 3 + Math.floor(rec * 5)
          ctx.globalAlpha = 0.6
          ctx.fillStyle = 'hsl(50 90% 70%)'
          for (let ri = 0; ri < rc; ri++) {
            const ra = (ri / rc) * TAU + c.id * 1.1
            ctx.beginPath()
            ctx.arc(x + Math.cos(ra) * r * 0.92, y + Math.sin(ra) * r * 0.92, 1.0 + rec * 0.8, 0, TAU)
            ctx.fill()
          }
        }
      }

      // Vesicle bumps
      if ((g.vesicles || 0) > 0.1) {
        const vc = 4 + Math.floor(g.vesicles * 4)
        ctx.globalAlpha = 0.5
        ctx.fillStyle = `hsl(${((hue + 30) % 360) | 0} ${sat | 0}% ${(lum + 15) | 0}%)`
        for (let vi = 0; vi < vc; vi++) {
          const va = (vi / vc) * TAU + c.id
          ctx.beginPath()
          ctx.arc(x + Math.cos(va) * r * 0.85, y + Math.sin(va) * r * 0.85, 1.2 + g.vesicles * 0.8, 0, TAU)
          ctx.fill()
        }
      }
    }

    ctx.globalAlpha = 1
  }

  function updateSpeciesPopList() {
    if (!el.speciesPopList) return
    const cells = sim.cells
    const n = cells.length
    if (n === 0) {
      el.speciesPopList.innerHTML = '<div style="font-size:8px;color:#556;padding:2px">No species yet</div>'
      return
    }
    // Union-Find to group cells into organisms via links
    const parent = new Int32Array(n)
    for (let i = 0; i < n; i++) parent[i] = i
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]]
        x = parent[x]
      }
      return x
    }
    function union(a, b) {
      parent[find(a)] = find(b)
    }
    for (let li = 0; li < sim.links.length; li++) {
      const l = sim.links[li]
      if (l.a < n && l.b < n && cells[l.a].clade === cells[l.b].clade) {
        union(l.a, l.b)
      }
    }
    // Count organisms and cells per clade
    const cladeOrgs = new Map() // clade -> Set of root indices
    const cladeCells = new Map() // clade -> cell count
    for (let i = 0; i < n; i++) {
      const cl = cells[i].clade
      const root = find(i)
      if (!cladeOrgs.has(cl)) {
        cladeOrgs.set(cl, new Set())
        cladeCells.set(cl, 0)
      }
      cladeOrgs.get(cl).add(root)
      cladeCells.set(cl, cladeCells.get(cl) + 1)
    }
    // Build sorted list by organism count, then by cell count
    const entries = []
    for (const [clade, roots] of cladeOrgs) {
      entries.push({ clade, orgs: roots.size, cells: cladeCells.get(clade) })
    }
    entries.sort((a, b) => b.orgs - a.orgs || b.cells - a.cells)
    const display = entries.slice(0, 10)
    const maxOrgs = display[0] ? display[0].orgs : 1
    let html = ''
    for (const e of display) {
      ensureCladeName(e.clade, sim)
      const name = organismNames.get(e.clade)
      const color = cladeColor(e.clade)
      const pct = maxOrgs > 0 ? ((e.orgs / maxOrgs) * 100).toFixed(0) : 0
      html +=
        `<div class="species-row">` +
        `<span class="sp-dot" style="background:${color}"></span>` +
        `<span class="sp-name">${name}</span>` +
        `<span class="sp-bar"><span class="sp-bar-fill" style="width:${pct}%;background:${color}"></span></span>` +
        `<span class="sp-pop">${e.orgs}<span style="font-size:7px;color:#667;font-weight:400"> · ${e.cells}c</span></span>` +
        `</div>`
    }
    el.speciesPopList.innerHTML = html
  }

  function updateSpeciesList(s) {
    if (!el.speciesList || !s.cladeRegistry) return

    // Find clades that are still alive
    const aliveClades = new Set()
    for (let i = 0; i < sim.cells.length; i++) {
      aliveClades.add(sim.cells[i].clade)
    }

    // Build list of species sorted by age (longest first)
    const species = []
    for (const [clade, entry] of s.cladeRegistry) {
      const alive = aliveClades.has(clade)
      const age = (alive ? s.t : entry.lastTick) - entry.firstTick
      if (age < 10) continue // skip very short-lived
      ensureCladeName(clade, sim)
      species.push({
        clade,
        name: organismNames.get(clade),
        age,
        peakPop: entry.peakPop,
        alive,
        diet: entry.diet,
        color: cladeColor(clade)
      })
    }
    species.sort((a, b) => b.age - a.age)

    const display = species.slice(0, 8)
    if (display.length === 0) {
      el.speciesList.innerHTML = '<div class="organism-empty">Tracking species...</div>'
      return
    }

    let html = ''
    for (let i = 0; i < display.length; i++) {
      const sp = display[i]
      const dietLabel = sp.diet > 0.6 ? 'carn' : sp.diet > 0.3 ? 'omni' : 'herb'
      const status = sp.alive ? '' : ' style="opacity:0.45"'
      html += `<div class="species-entry"${status}>
        <div class="species-rank">${i + 1}</div>
        <div class="species-swatch" style="background:${sp.color}"></div>
        <div class="species-info">
          <div class="species-name">${sp.name}</div>
          <div class="species-meta">
            <span>${dietLabel}</span>
            <span>peak ${sp.peakPop}</span>
            <span>${sp.alive ? 'alive' : 'extinct'}</span>
          </div>
        </div>
        <div class="species-age">${sp.age}t</div>
      </div>`
    }
    el.speciesList.innerHTML = html
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
        predName: organismNames.get(predClade),
        preyName: organismNames.get(preyClade),
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

  function updateLargestOrganisms(s) {
    if (!el.largestList || !s.cladeRegistry) return

    // Find alive clades with organisms
    const aliveClades = new Set()
    for (let i = 0; i < sim.cells.length; i++) aliveClades.add(sim.cells[i].clade)

    const entries = []
    for (const [clade, entry] of s.cladeRegistry) {
      if (!aliveClades.has(clade)) continue
      const size = entry.currentMaxSize || 0
      if (size < 2) continue
      ensureCladeName(clade, sim)
      const dietLabel = entry.diet > 0.6 ? 'carn' : entry.diet > 0.3 ? 'omni' : 'herb'
      entries.push({
        clade,
        name: organismNames.get(clade),
        size,
        record: entry.maxOrganismSize,
        complexity: entry.totalComplexity,
        pop: 0,
        diet: dietLabel,
        color: cladeColor(clade)
      })
    }

    // Count pop per clade
    const popMap = new Map()
    for (let i = 0; i < sim.cells.length; i++) {
      const cl = sim.cells[i].clade
      popMap.set(cl, (popMap.get(cl) || 0) + 1)
    }
    for (const e of entries) e.pop = popMap.get(e.clade) || 0

    entries.sort((a, b) => b.size - a.size)
    const display = entries.slice(0, 8)

    if (display.length === 0) {
      el.largestList.innerHTML = '<div class="organism-empty">No organisms yet</div>'
      return
    }

    const maxSize = display[0].size
    let html = ''
    for (let i = 0; i < display.length; i++) {
      const e = display[i]
      const barPct = Math.min(100, (e.size / Math.max(maxSize, 1)) * 100).toFixed(0)
      const cmplx = e.complexity.toFixed(1)
      html += `<div class="largest-entry">
        <div class="largest-rank">${i + 1}</div>
        <div class="largest-swatch" style="background:${e.color}"></div>
        <div class="largest-info">
          <div class="largest-name">${e.name}</div>
          <div class="largest-meta">
            <span>${e.diet}</span>
            <span>${e.pop} cells</span>
            <span>cx:${cmplx}</span>
          </div>
        </div>
        <div class="largest-bar-track"><div class="largest-bar-fill" style="width:${barPct}%;background:${e.color}"></div></div>
        <div class="largest-count">${e.size}</div>
      </div>`
    }
    el.largestList.innerHTML = html
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
    el.hudFps.textContent = fmt(fpsEma, 1)
    if (el.perfFpsBar) {
      el.perfFpsBar.style.width = `${clamp((fpsEma / 60) * 100, 0, 100).toFixed(0)}%`
      el.perfFpsBar.className = perfBarClass(fpsPct)
    }

    // Sim ms: 0-16ms budget
    const simPct = clamp((simMsEma / 16) * 100, 0, 100)
    el.hudSimMs.textContent = `${fmt(simMsEma, 1)}ms`
    if (el.perfSimBar) {
      el.perfSimBar.style.width = `${simPct.toFixed(0)}%`
      el.perfSimBar.className = perfBarClass(simPct)
    }

    // Render ms: 0-16ms budget
    const renderPct = clamp((renderMsEma / 16) * 100, 0, 100)
    el.hudRenderMs.textContent = `${fmt(renderMsEma, 1)}ms`
    if (el.perfRenderBar) {
      el.perfRenderBar.style.width = `${renderPct.toFixed(0)}%`
      el.perfRenderBar.className = perfBarClass(renderPct)
    }

    // Steps/s
    const dt = Math.max(0.001, (performance.now() - stepsWindowAt) / 1000)
    const sps = stepsSince / dt
    el.hudStepsS.textContent = fmt(sps, 0)
    if (el.perfStepsBar) {
      const spsPct = clamp((sps / 200) * 100, 0, 100) // 200 steps/s = full bar
      el.perfStepsBar.style.width = `${spsPct.toFixed(0)}%`
      el.perfStepsBar.className = perfBarClass(100 - spsPct) // invert: more=better
    }

    // Total frame budget: sim + render vs 16ms
    const totalMs = simMsEma + renderMsEma
    const budgetPct = clamp((totalMs / 16.67) * 100, 0, 100)
    if (el.perfBudgetBar) {
      el.perfBudgetBar.style.width = `${budgetPct.toFixed(0)}%`
      el.perfBudgetBar.className = perfBarClass(budgetPct)
    }
    if (el.perfBudgetV) el.perfBudgetV.textContent = `${budgetPct.toFixed(0)}%`
  }

  // ── Free camera state ──
  let freeCam = { x: sim.w / 2, y: sim.h / 2, zoom: 1.0 }
  let isDragging = false
  let dragStart = { x: 0, y: 0 }
  let dragCamStart = { x: 0, y: 0 }

  el.canvas.addEventListener('mousedown', (e) => {
    if (el.cameraMode.value !== 'free') return
    isDragging = true
    dragStart = { x: e.clientX, y: e.clientY }
    dragCamStart = { x: freeCam.x, y: freeCam.y }
    el.canvas.style.cursor = 'grabbing'
  })

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
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
          label: organismNames.get(trackedClade)
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
          label: organismNames.get(currentClade)
        }
      } else {
        renderer._trackTarget = null
      }
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

    renderer.updateQuality(sim)
    renderer.resizeToFit()
    updateCamera(ts)
    const start = performance.now()
    renderer.draw(sim, {
      showFood: el.showFood.checked,
      showLinks: el.showLinks.checked,
      filterDiet: el.filterDiet ? el.filterDiet.value : 'all',
      filterRole: el.filterRole ? el.filterRole.value : 'all',
      filterSpecies: el.filterSpecies ? el.filterSpecies.value : 'all'
    })
    const ms = performance.now() - start
    renderMsEma = renderMsEma * 0.9 + ms * 0.1
  }

  function frame(ts) {
    try {
      const dt = ts - lastFrameAt
      lastFrameAt = ts
      if (dt > 0) fpsEma = fpsEma * 0.9 + (1000 / dt) * 0.1

      const requested = parseInt(el.speed.value, 10)

      if (running) {
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
            sim.step()
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

          if (target > cap) {
            el.speedV.textContent = `${cap} (capped)`
          } else if (i < target) {
            el.speedV.textContent = `${i} (budget)`
          } else {
            el.speedV.textContent = `${el.speed.value}`
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
      requestAnimationFrame(frame)
    } catch (err) {
      running = false
      el.play.textContent = 'Play'
      console.error('Simulation paused due to error:', err)
    }
  }

  requestAnimationFrame(frame)

  window.addEventListener('resize', () => draw(performance.now()))

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) {
      running = false
      el.play.textContent = 'Play'
    }
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault()
      running = !running
      el.play.textContent = running ? 'Pause' : 'Play'
    }
    if (e.key.toLowerCase() === 'r') doReset()
  })
}
main()
