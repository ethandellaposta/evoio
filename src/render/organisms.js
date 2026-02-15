import { ROLE_NONE, ROLE_EDGE, ROLE_INTERIOR, ROLE_PIONEER } from '../sim/index.js'

export function buildOrganisms(cells, links, worldW, worldH, linkDist) {
  // Build adjacency list from strong links only
  const MIN_BOND = 0.25 // minimum adhesion * surface tension to count as organism bond
  const adj = new Map()
  for (let k = 0; k < links.length; k++) {
    const L = links[k]
    if (L.a >= cells.length || L.b >= cells.length) continue
    const a = cells[L.a],
      b = cells[L.b]
    if (!a || !b || a.clade !== b.clade) continue
    // Only count strong bonds as organism connections
    const bondStrength = (L.s || 0) * (L.gamma || 0.5)
    if (bondStrength < MIN_BOND) continue
    if (!adj.has(L.a)) adj.set(L.a, [])
    if (!adj.has(L.b)) adj.set(L.b, [])
    adj.get(L.a).push(L.b)
    adj.get(L.b).push(L.a)
  }

  // Flood-fill connected components via actual links
  const visited = new Uint8Array(cells.length)
  const result = new Map()
  let groupId = 0

  for (const [startIdx] of adj) {
    if (visited[startIdx]) continue
    visited[startIdx] = 1
    const cluster = [startIdx]
    const queue = [startIdx]

    while (queue.length > 0) {
      const cur = queue.pop()
      const neighbors = adj.get(cur)
      if (!neighbors) continue
      for (let j = 0; j < neighbors.length; j++) {
        const ni = neighbors[j]
        if (visited[ni]) continue
        visited[ni] = 1
        cluster.push(ni)
        queue.push(ni)
      }
    }

    if (cluster.length >= 2) {
      result.set(groupId++, cluster)
    }
  }

  return result
}

// Color palettes for roles
export const ROLE_COLORS = {
  [ROLE_NONE]: { hShift: 0, satBoost: 0, lumBoost: 0 },
  [ROLE_EDGE]: { hShift: 10, satBoost: 10, lumBoost: 5 },
  [ROLE_INTERIOR]: { hShift: -20, satBoost: -5, lumBoost: -8 },
  [ROLE_PIONEER]: { hShift: 30, satBoost: 15, lumBoost: 12 }
}

// Organelle colors
export const ORGANELLE_STYLES = [
  { h: 270, s: 80, l: 65, name: 'nucleus' },
  { h: 15, s: 90, l: 55, name: 'mitochondria' },
  { h: 160, s: 75, l: 50, name: 'flagellum' },
  { h: 45, s: 85, l: 60, name: 'receptor' },
  { h: 200, s: 60, l: 55, name: 'vacuole' }
]
