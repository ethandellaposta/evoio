export function defaultConfig() {
  return {
    seed: 'evoio',
    w: 1920,
    h: 960,
    maxOrganisms: 5000,
    sampleScale: 0.1,
    cellRadius: 4.5,
    dt: 1,
    mutationRate: 0.09,
    foodGrowth: 1.6,
    patchiness: 0.75,
    diffusion: 0.14,
    uptake: 0.3,
    baseMove: 0.04,
    moveWander: 0.14,
    gradientWeight: 0.85,
    metabolismBase: 0.01,
    linkDist: 5.5,
    linkSpring: 0.09,
    linkDamp: 0.06,
    linkMax: 5,
    shareRate: 0.04,
    cladeShiftMut: 0.002,
    deathAge: 9000,
    seasonLength: 600,
    gradientSlope: 0.002,
    gradientNoise: 0.12,
    gradientPeaks: 3,
    persistenceInterval: 40,
    persistenceStrength: 0.6,
    contactInhibition: 0.15,
    organelleGrowthRate: 0.002,
    organelleMutRate: 0.12,
    surfaceTensionBase: 0.3,
    mineralGrowth: 0.15,
    mineralEnergy: 2.5,
    meatDecay: 0.003,
    meatDropEnergy: 0.5,
    predationRange: 7.0,
    predationCooldown: 18,
    predationMinSize: 0.6,
    morphMutRate: 0.11,
    dayLength: 800,
    nightMetabolismMult: 1.3,
    spawn: {
      n: 120,
      energy: 1.5
    },
    // biomes: generated at runtime by generateBiomes() — see below
    biomes: null
  }
}

// ── Pool of 10 water biome presets ──
// Each has a depth tier: 'shallow' (sunlit), 'mid' (twilight), 'deep' (aphotic)
// Placement logic ensures smooth depth transitions across the world.
export const BIOME_POOL = [
  {
    name: 'Kelp Forest',
    tier: 'shallow',
    flora: 'kelp',
    foodGrowthMult: 1.8,
    mineralGrowthMult: 0.2,
    metabolismMult: 1.1,
    meatDecayMult: 1.5,
    predationRangeMult: 0.6,
    shelterRate: 0.8,
    shelterCap: 3.0,
    symbiosis: 0.4,
    currentMult: 0.4,
    palette: { rBase: 4, gBase: 18, bBase: 22, causticG: 90, causticB: 55, purpStr: 0.2 }
  },
  {
    name: 'Coral Reef',
    tier: 'shallow',
    flora: 'coral',
    foodGrowthMult: 1.2,
    mineralGrowthMult: 1.8,
    metabolismMult: 1.2,
    meatDecayMult: 2.0,
    predationRangeMult: 0.9,
    shelterRate: 1.5,
    shelterCap: 5.0,
    symbiosis: 0.8,
    currentMult: 0.7,
    palette: { rBase: 8, gBase: 16, bBase: 28, causticG: 80, causticB: 65, purpStr: 0.5 }
  },
  {
    name: 'Seagrass Meadow',
    tier: 'shallow',
    flora: 'kelp',
    foodGrowthMult: 1.5,
    mineralGrowthMult: 0.4,
    metabolismMult: 1.0,
    meatDecayMult: 1.2,
    predationRangeMult: 0.7,
    shelterRate: 0.6,
    shelterCap: 2.5,
    symbiosis: 0.5,
    currentMult: 0.5,
    palette: { rBase: 5, gBase: 20, bBase: 18, causticG: 95, causticB: 45, purpStr: 0.15 }
  },
  {
    name: 'Mangrove Shallows',
    tier: 'shallow',
    flora: 'kelp',
    foodGrowthMult: 1.4,
    mineralGrowthMult: 0.6,
    metabolismMult: 1.05,
    meatDecayMult: 1.8,
    predationRangeMult: 0.5,
    shelterRate: 1.2,
    shelterCap: 4.0,
    symbiosis: 0.6,
    currentMult: 0.3,
    palette: { rBase: 6, gBase: 15, bBase: 14, causticG: 85, causticB: 40, purpStr: 0.1 }
  },
  {
    name: 'Open Ocean',
    tier: 'mid',
    flora: 'plankton',
    foodGrowthMult: 0.6,
    mineralGrowthMult: 0.5,
    metabolismMult: 0.9,
    meatDecayMult: 0.8,
    predationRangeMult: 1.4,
    shelterRate: 0.1,
    shelterCap: 0.5,
    symbiosis: 0.1,
    currentMult: 1.5,
    palette: { rBase: 4, gBase: 8, bBase: 42, causticG: 50, causticB: 85, purpStr: 1.8 }
  },
  {
    name: 'Twilight Zone',
    tier: 'mid',
    flora: 'plankton',
    foodGrowthMult: 0.4,
    mineralGrowthMult: 0.7,
    metabolismMult: 0.85,
    meatDecayMult: 0.6,
    predationRangeMult: 0.8,
    shelterRate: 0.2,
    shelterCap: 1.0,
    symbiosis: 0.2,
    currentMult: 0.6,
    palette: { rBase: 3, gBase: 5, bBase: 32, causticG: 35, causticB: 60, purpStr: 2.0 }
  },
  {
    name: 'Sargasso Drift',
    tier: 'mid',
    flora: 'kelp',
    foodGrowthMult: 1.0,
    mineralGrowthMult: 0.3,
    metabolismMult: 0.95,
    meatDecayMult: 1.0,
    predationRangeMult: 1.0,
    shelterRate: 0.5,
    shelterCap: 2.0,
    symbiosis: 0.3,
    currentMult: 1.0,
    palette: { rBase: 5, gBase: 12, bBase: 30, causticG: 65, causticB: 70, purpStr: 0.8 }
  },
  {
    name: 'Abyssal Plain',
    tier: 'deep',
    flora: 'detritus',
    foodGrowthMult: 0.3,
    mineralGrowthMult: 0.8,
    metabolismMult: 0.7,
    meatDecayMult: 0.3,
    predationRangeMult: 0.5,
    shelterRate: 0.3,
    shelterCap: 2.0,
    symbiosis: 0.3,
    currentMult: 0.3,
    palette: { rBase: 2, gBase: 3, bBase: 18, causticG: 20, causticB: 35, purpStr: 2.5 }
  },
  {
    name: 'Hydrothermal Vents',
    tier: 'deep',
    flora: 'tubeworm',
    foodGrowthMult: 0.2,
    mineralGrowthMult: 4.0,
    metabolismMult: 0.8,
    meatDecayMult: 0.4,
    predationRangeMult: 1.1,
    shelterRate: 1.0,
    shelterCap: 4.0,
    symbiosis: 0.6,
    currentMult: 0.8,
    palette: { rBase: 6, gBase: 8, bBase: 24, causticG: 40, causticB: 50, purpStr: 1.2 }
  },
  {
    name: 'Cold Seep',
    tier: 'deep',
    flora: 'tubeworm',
    foodGrowthMult: 0.15,
    mineralGrowthMult: 3.0,
    metabolismMult: 0.65,
    meatDecayMult: 0.2,
    predationRangeMult: 0.6,
    shelterRate: 0.8,
    shelterCap: 3.5,
    symbiosis: 0.7,
    currentMult: 0.2,
    palette: { rBase: 3, gBase: 5, bBase: 20, causticG: 25, causticB: 40, purpStr: 2.2 }
  }
]

// Depth tier ordering for logical placement
const TIER_ORDER = { shallow: 0, mid: 1, deep: 2 }

// Generate a random biome layout for a given world size and RNG
// - Picks 3-6 biomes depending on world width
// - Ensures at least one shallow and one deep/mid biome for diversity
// - Sorts by depth tier so shallow→mid→deep flows naturally left-to-right
//   then shuffles within tiers for variety
export function generateBiomes(rng, worldW) {
  // Number of biomes scales with world width
  const minBiomes = 3
  const maxBiomes = Math.min(6, Math.max(3, Math.floor(worldW / 350)))
  const count = minBiomes + Math.floor(rng() * (maxBiomes - minBiomes + 1))

  // Separate pool by tier
  const shallow = BIOME_POOL.filter((b) => b.tier === 'shallow')
  const mid = BIOME_POOL.filter((b) => b.tier === 'mid')
  const deep = BIOME_POOL.filter((b) => b.tier === 'deep')

  // Shuffle helper (Fisher-Yates)
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  shuffle(shallow)
  shuffle(mid)
  shuffle(deep)

  // Guarantee at least 1 shallow and 1 deep/mid for ecological diversity
  const selected = []
  selected.push(shallow.shift()) // at least 1 shallow
  if (deep.length > 0) selected.push(deep.shift()) // at least 1 deep

  // Fill remaining slots from all tiers, weighted toward mid
  const remaining = [...shallow, ...mid, ...mid, ...deep] // mid appears twice for higher weight
  shuffle(remaining)

  // Remove duplicates (by name) with selected
  const usedNames = new Set(selected.map((b) => b.name))
  for (let i = 0; i < remaining.length && selected.length < count; i++) {
    if (!usedNames.has(remaining[i].name)) {
      selected.push(remaining[i])
      usedNames.add(remaining[i].name)
    }
  }

  // Sort by depth tier for logical spatial arrangement (shallow on left, deep on right)
  selected.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])

  // Within same tier, randomize order
  let i = 0
  while (i < selected.length) {
    let j = i
    while (j < selected.length && selected[j].tier === selected[i].tier) j++
    // Shuffle the sub-array [i..j)
    for (let k = j - 1; k > i; k--) {
      const m = i + Math.floor(rng() * (k - i + 1))
      ;[selected[k], selected[m]] = [selected[m], selected[k]]
    }
    i = j
  }

  // 50% chance to reverse the whole arrangement (deep-left, shallow-right)
  if (rng() < 0.5) selected.reverse()

  // Return deep copies so mutations don't affect the pool
  return selected.map((b) => ({ ...b, palette: { ...b.palette } }))
}
