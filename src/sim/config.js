export function defaultConfig() {
  return {
    seed: 'evoio',
    w: 1920,
    h: 960,
    maxOrganisms: 5000,
    sampleScale: 0.1,
    cellRadius: 3.0,
    dt: 1,
    mutationRate: 0.06,
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
    organelleMutRate: 0.08,
    surfaceTensionBase: 0.3,
    mineralGrowth: 0.15,
    mineralEnergy: 2.5,
    meatDecay: 0.003,
    meatDropEnergy: 0.5,
    predationRange: 7.0,
    predationCooldown: 18,
    predationMinSize: 0.6,
    morphMutRate: 0.07,
    dayLength: 800,
    nightMetabolismMult: 1.3,
    spawn: {
      n: 180,
      energy: 2.2
    },
    // ── Biome definitions ──
    // Each biome is an x-region of the single body of water (~1/3 width each).
    // Biome-local multipliers modify the base config values.
    biomes: [
      {
        name: 'Shallows',
        // Warm, sunlit, plant-rich — favors herbivores, small fast organisms
        foodGrowthMult: 1.6,
        mineralGrowthMult: 0.3,
        metabolismMult: 1.15,
        meatDecayMult: 1.8,
        predationRangeMult: 0.8,
        // Visual palette: warm sunlit green
        palette: { rBase: 12, gBase: 28, bBase: 14, causticG: 110, causticB: 35, purpStr: 0.1 }
      },
      {
        name: 'Deep Ocean',
        // Balanced — the original biome
        foodGrowthMult: 1.0,
        mineralGrowthMult: 1.0,
        metabolismMult: 1.0,
        meatDecayMult: 1.0,
        predationRangeMult: 1.0,
        // Visual palette: deep blue-indigo
        palette: { rBase: 4, gBase: 8, bBase: 38, causticG: 55, causticB: 80, purpStr: 1.6 }
      },
      {
        name: 'Thermal Vents',
        // Hot, mineral-rich, low plant food — favors chemotrophs, predators, tough organisms
        foodGrowthMult: 0.4,
        mineralGrowthMult: 3.0,
        metabolismMult: 0.85,
        meatDecayMult: 0.5,
        predationRangeMult: 1.3,
        // Visual palette: hot amber-red volcanic
        palette: { rBase: 32, gBase: 10, bBase: 6, causticG: 35, causticB: 18, purpStr: 0.2 }
      }
    ]
  }
}
