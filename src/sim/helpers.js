export function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x
}

export function wrap(x, n) {
  x %= n
  return x < 0 ? x + n : x
}

export function torusDelta(d, size) {
  if (d > size / 2) return d - size
  if (d < -size / 2) return d + size
  return d
}
