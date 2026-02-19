export function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x
}

const _hslCache = new Map()
export function hsl(h, s, l) {
  const key = (h | 0) * 100000 + (s | 0) * 1000 + (l | 0)
  let v = _hslCache.get(key)
  if (!v) {
    v = `hsl(${h | 0} ${s | 0}% ${l | 0}%)`
    _hslCache.set(key, v)
  }
  return v
}

export function hsla(h, s, l, a) {
  return `hsla(${h | 0} ${s | 0}% ${l | 0}% / ${a.toFixed(2)})`
}

export function cladeHue(clade) {
  const golden = 137.508
  return (clade * golden) % 360
}

// Per-clade saturation offset: returns -22 to +22
export function cladeSatOffset(clade) {
  return ((clade * 73.137) % 44) - 22
}

// Per-clade luminance offset: returns -16 to +16
export function cladeLumOffset(clade) {
  return ((clade * 51.923) % 32) - 16
}

export function cladeColor(clade) {
  const h = cladeHue(clade)
  const s = Math.max(45, Math.min(92, 72 + cladeSatOffset(clade)))
  const l = Math.max(40, Math.min(70, 58 + cladeLumOffset(clade)))
  const a2 = s / 100
  const b2 = l / 100
  const f = (n) => {
    const k = (n + h / 30) % 12
    const c = a2 * Math.min(b2, 1 - b2)
    return b2 - c * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  const r = Math.round(f(0) * 255)
  const g = Math.round(f(8) * 255)
  const b = Math.round(f(4) * 255)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}
