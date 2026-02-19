// ══════════════════════════════════════════════════════════════
//  PERFORMANCE PROFILER — Continuous metrics recorder
//  Records a snapshot every ~1 second with key perf metrics.
//  No phases, no parameter ramping — just observes the sim.
//  Click Start, let it run, click Stop, CSV auto-downloads.
// ══════════════════════════════════════════════════════════════

function _triggerDownload(content, filename, mime) {
  const dataUri = 'data:' + (mime || 'text/plain') + ';charset=utf-8,' + encodeURIComponent(content)
  const a = document.createElement('a')
  a.setAttribute('href', dataUri)
  a.setAttribute('download', filename)
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

const SAMPLE_INTERVAL = 10 // ticks between snapshots

// Render resource keys tracked by the renderer profiler
const RENDER_RESOURCES = [
  'water',
  'food',
  'foodBuds',
  'terrain',
  'barriers',
  'trails',
  'hulls',
  'particles',
  'cells',
  'mateParticles',
  'worldBlob'
]

// Sim subsystem keys tracked by step.js stepProfile
const SIM_RESOURCES = [
  'environment',
  'spatial',
  'foodSense',
  'cellLoop',
  'cl_movement',
  'cl_feeding',
  'cl_metabolism',
  'cl_lifecycle',
  'links',
  'predation',
  'deathCleanup'
]

export class StressTest {
  constructor(sim, renderer) {
    this.sim = sim
    this.renderer = renderer
    this.running = false
    this.phase = 'IDLE' // 'IDLE' | 'RECORDING' | 'DONE'
    this.results = []
    this.summary = null
    this.opts = { fpsFloor: 20 }

    // Accumulators for averaging over the sample interval
    this._tickCount = 0
    this._fpsSum = 0
    this._simMsSum = 0
    this._renderMsSum = 0
    this._renderResources = {} // accumulated per-resource ms
    this._simResources = {} // accumulated per-subsystem sim ms
    this._startTime = 0

    // Callbacks
    this.onUpdate = null
    this.onDone = null
  }

  start() {
    this.running = true
    this.phase = 'RECORDING'
    this.results = []
    this.summary = null
    this._tickCount = 0
    this._fpsSum = 0
    this._simMsSum = 0
    this._renderMsSum = 0
    this._renderResources = {}
    this._simResources = {}
    this._startTime = Date.now()
  }

  stop() {
    this.running = false
    this.phase = this.results.length > 0 ? 'DONE' : 'IDLE'
    this.summary = this.results.length > 0 ? this._buildSummary() : null
    if (this.results.length > 0) {
      this.exportCSV()
    }
    if (this.onDone) this.onDone(this)
  }

  // Call once per frame from the main loop
  tick(perf) {
    if (!this.running) return

    this._tickCount++
    this._fpsSum += perf.fps || 0
    this._simMsSum += perf.simMs || 0
    this._renderMsSum += perf.renderMs || 0

    // Accumulate per-render-resource timings from renderer.profileData
    const pd = this.renderer.profileData
    if (pd) {
      for (const key of RENDER_RESOURCES) {
        this._renderResources[key] = (this._renderResources[key] || 0) + (pd[key] || 0)
      }
    }

    // Accumulate per-sim-subsystem timings from sim.stepProfile
    const sp = this.sim.stepProfile
    if (sp) {
      for (const key of SIM_RESOURCES) {
        this._simResources[key] = (this._simResources[key] || 0) + (sp[key] || 0)
      }
    }

    if (this._tickCount >= SAMPLE_INTERVAL) {
      this._recordSnapshot()
      this._tickCount = 0
      this._fpsSum = 0
      this._simMsSum = 0
      this._renderMsSum = 0
      this._renderResources = {}
      this._simResources = {}
    }
  }

  _recordSnapshot() {
    const n = Math.max(1, this._tickCount)
    const sim = this.sim

    // Count species
    const clades = new Set()
    for (let i = 0; i < sim.cells.length; i++) clades.add(sim.cells[i].clade)

    const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1)

    // Build render resource receipt (averaged over interval)
    const rReceipt = {}
    for (const key of RENDER_RESOURCES) {
      rReceipt['r_' + key] = (this._renderResources[key] || 0) / n
    }

    // Build sim subsystem receipt (averaged over interval)
    const sReceipt = {}
    for (const key of SIM_RESOURCES) {
      sReceipt['s_' + key] = (this._simResources[key] || 0) / n
    }

    this.results.push({
      elapsed_s: parseFloat(elapsed),
      tick: sim.t,
      fps: this._fpsSum / n,
      simMs: this._simMsSum / n,
      renderMs: this._renderMsSum / n,
      frameMs: (this._simMsSum + this._renderMsSum) / n,
      cells: sim.cells.length,
      links: sim.links.length,
      species: clades.size,
      // Sim subsystem receipt (ms per subsystem per step)
      ...sReceipt,
      // Render resource receipt (ms per resource per frame)
      ...rReceipt
    })

    if (this.onUpdate) this.onUpdate(this)
  }

  _buildSummary() {
    const r = this.results
    if (r.length === 0) return null
    let minFps = Infinity,
      maxFps = 0,
      sumFps = 0
    let maxSimMs = 0,
      maxRenderMs = 0
    let maxCells = 0,
      maxLinks = 0,
      maxSpecies = 0
    for (const s of r) {
      if (s.fps < minFps) minFps = s.fps
      if (s.fps > maxFps) maxFps = s.fps
      sumFps += s.fps
      if (s.simMs > maxSimMs) maxSimMs = s.simMs
      if (s.renderMs > maxRenderMs) maxRenderMs = s.renderMs
      if (s.cells > maxCells) maxCells = s.cells
      if (s.links > maxLinks) maxLinks = s.links
      if (s.species > maxSpecies) maxSpecies = s.species
    }
    return {
      samples: r.length,
      duration_s: r[r.length - 1].elapsed_s,
      avgFps: sumFps / r.length,
      minFps,
      maxFps,
      peakSimMs: maxSimMs,
      peakRenderMs: maxRenderMs,
      peakCells: maxCells,
      peakLinks: maxLinks,
      peakSpecies: maxSpecies
    }
  }

  exportCSV() {
    if (this.results.length === 0) return
    const keys = Object.keys(this.results[0])
    let csv = keys.join(',') + '\n'
    for (const r of this.results) {
      csv +=
        keys
          .map((k) => {
            const v = r[k]
            return typeof v === 'number' ? v.toFixed(4) : v
          })
          .join(',') + '\n'
    }
    _triggerDownload(
      csv,
      `evoio-perf-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.csv`,
      'text/csv'
    )
  }

  get progress() {
    if (this.phase === 'DONE') return 1
    if (this.phase === 'IDLE') return 0
    return Math.min(0.99, this.results.length / 60) // fills up over ~60 samples
  }

  get statusText() {
    if (this.phase === 'IDLE') return 'Ready'
    if (this.phase === 'DONE') return `Complete — ${this.results.length} samples`
    return `Recording... ${this.results.length} samples`
  }
}

// Render the profiler results into a canvas
export function drawStressTestChart(canvas, stressTest) {
  if (!canvas || !stressTest || stressTest.results.length === 0) return

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

  const results = stressTest.results
  const n = results.length
  if (n < 1) return

  const pad = { l: 32, r: 8, t: 16, b: 20 }
  const gw = cw - pad.l - pad.r
  const gh = ch - pad.t - pad.b

  // Find ranges
  let maxFps = 0,
    maxPop = 0,
    maxMs = 0
  for (const r of results) {
    if (r.fps > maxFps) maxFps = r.fps
    if (r.cells > maxPop) maxPop = r.cells
    if (r.totalFrameMs > maxMs) maxMs = r.totalFrameMs
  }
  maxFps = Math.max(maxFps, 60)
  maxPop = Math.max(maxPop, 100)
  maxMs = Math.max(maxMs, 16)

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

  // FPS line
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = pad.l + (i / Math.max(1, n - 1)) * gw
    const y = pad.t + gh * (1 - results[i].fps / maxFps)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = '#4fc3f7'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Cell count line
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = pad.l + (i / Math.max(1, n - 1)) * gw
    const y = pad.t + gh * (1 - results[i].cells / maxPop)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = '#81c784'
  ctx.lineWidth = 1.2
  ctx.stroke()

  // Frame time bars — stacked sim subsystems + render
  const barW = Math.max(1, (gw / n) * 0.6)
  const simSubs = [
    { key: 's_cellLoop', color: 'rgba(255,183,77,0.45)' },
    { key: 's_environment', color: 'rgba(102,187,106,0.40)' },
    { key: 's_links', color: 'rgba(239,83,80,0.40)' },
    { key: 's_predation', color: 'rgba(255,112,67,0.40)' },
    { key: 's_spatial', color: 'rgba(66,165,245,0.35)' },
    { key: 's_foodSense', color: 'rgba(171,71,188,0.35)' },
    { key: 's_deathCleanup', color: 'rgba(120,144,156,0.35)' }
  ]
  // Find max stacked bar total so bars auto-scale to fit chart
  let maxBarTotal = 0
  for (let i = 0; i < n; i++) {
    let total = results[i].renderMs || 0
    for (const sub of simSubs) total += results[i][sub.key] || 0
    if (total > maxBarTotal) maxBarTotal = total
  }
  maxBarTotal = Math.max(maxBarTotal, 1)
  const barScale = (gh * 0.85) / maxBarTotal // 85% of chart height max
  for (let i = 0; i < n; i++) {
    const x = pad.l + (i / Math.max(1, n - 1)) * gw - barW / 2
    const renH = (results[i].renderMs || 0) * barScale
    let yOff = pad.t + gh - renH
    // Render bar at bottom
    ctx.fillStyle = 'rgba(206,147,216,0.35)'
    ctx.fillRect(x, yOff, barW, renH)
    // Stack sim subsystems above render
    for (const sub of simSubs) {
      const v = results[i][sub.key] || 0
      const h = v * barScale
      if (h < 0.3) continue
      yOff -= h
      ctx.fillStyle = sub.color
      ctx.fillRect(x, yOff, barW, h)
    }
  }

  // Y-axis labels
  ctx.fillStyle = 'rgba(79,195,247,0.7)'
  ctx.font = '7px ui-sans-serif,system-ui,sans-serif'
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const val = ((maxFps * i) / 4).toFixed(0)
    const y = pad.t + gh * (1 - i / 4)
    ctx.fillText(val, pad.l - 3, y + 3)
  }

  // Legend
  ctx.font = '6px ui-sans-serif,system-ui,sans-serif'
  ctx.textAlign = 'left'
  const legendX = pad.l + 2
  const legendY = pad.t + gh - 4
  const items = [
    { color: '#4fc3f7', label: 'FPS' },
    { color: '#81c784', label: 'Cells' },
    { color: '#ffb74d', label: 'cellLoop' },
    { color: '#66bb6a', label: 'env' },
    { color: '#ef5350', label: 'links' },
    { color: '#ce93d8', label: 'render' }
  ]
  for (let i = 0; i < items.length; i++) {
    const lx = legendX + i * 36
    ctx.fillStyle = items[i].color
    ctx.fillRect(lx, legendY - 4, 4, 4)
    ctx.fillText(items[i].label, lx + 6, legendY)
  }

  // Title
  ctx.fillStyle = 'rgba(200,210,230,0.7)'
  ctx.font = '9px ui-sans-serif,system-ui,sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('Performance Profile', pad.l, pad.t - 4)
}

// Render summary text into a div
export function renderStressTestSummary(container, stressTest) {
  if (!container || !stressTest) return

  if (stressTest.phase === 'IDLE') {
    container.innerHTML =
      '<div style="color:#667;font-size:8px">Press Start to record performance metrics</div>'
    return
  }

  const r = stressTest.results
  const last = r.length > 0 ? r[r.length - 1] : null

  let html = ''

  // Status
  html += `<div style="display:flex;justify-content:space-between;font-size:7px;color:#8f9bb7;margin-bottom:4px">
    <span>${stressTest.statusText}</span>
    <span>${last ? last.elapsed_s + 's' : ''}</span>
  </div>`

  // Live metrics
  if (last) {
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:8px;color:#c8d2e6;margin-bottom:4px">`
    html += `<div><span style="color:#4fc3f7">FPS:</span> ${last.fps.toFixed(1)}</div>`
    html += `<div><span style="color:#81c784">Cells:</span> ${last.cells}</div>`
    html += `<div><span style="color:#ffb74d">Sim:</span> ${last.simMs.toFixed(1)}ms</div>`
    html += `<div><span style="color:#ce93d8">Render:</span> ${last.renderMs.toFixed(1)}ms</div>`
    html += `<div><span style="color:#8f9bb7">Links:</span> ${last.links}</div>`
    html += `<div><span style="color:#8f9bb7">Species:</span> ${last.species}</div>`
    html += `<div><span style="color:#8f9bb7">Frame:</span> ${last.frameMs.toFixed(1)}ms</div>`
    html += `<div><span style="color:#8f9bb7">Tick:</span> ${last.tick}</div>`
    html += `</div>`

    // Sim subsystem receipt
    const sKeys = [
      's_cellLoop',
      's_cl_movement',
      's_cl_feeding',
      's_cl_metabolism',
      's_cl_lifecycle',
      's_environment',
      's_spatial',
      's_foodSense',
      's_links',
      's_predation',
      's_deathCleanup'
    ]
    const maxSimRes = Math.max(0.01, ...sKeys.map((k) => last[k] || 0))
    html += `<div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:3px;margin-top:2px">`
    html += `<div style="font-size:7px;color:#ffb74d;margin-bottom:2px;font-weight:600">Sim Receipt (${last.simMs.toFixed(1)}ms)</div>`
    const simColors = {
      cellLoop: '#ffb74d',
      cl_movement: '#ffa726',
      cl_feeding: '#66bb6a',
      cl_metabolism: '#29b6f6',
      cl_lifecycle: '#ce93d8',
      environment: '#66bb6a',
      spatial: '#42a5f5',
      foodSense: '#ab47bc',
      links: '#ef5350',
      predation: '#ff7043',
      deathCleanup: '#78909c'
    }
    for (const k of sKeys) {
      const v = last[k] || 0
      if (v < 0.01) continue
      const label = k.slice(2)
      const isSub = label.startsWith('cl_')
      const displayLabel = isSub ? '· ' + label.slice(3) : label
      const pct = (v / maxSimRes) * 100
      const color = simColors[label] || '#8f9bb7'
      html += `<div style="display:flex;align-items:center;gap:4px;font-size:7px;margin-bottom:1px${isSub ? ';padding-left:8px;opacity:0.85' : ''}">`
      html += `<span style="width:${isSub ? '52' : '60'}px;color:${color};text-align:right">${displayLabel}</span>`
      html += `<div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden"><div style="width:${pct.toFixed(0)}%;height:100%;background:${color};border-radius:2px"></div></div>`
      html += `<span style="width:36px;color:#667;text-align:right">${v.toFixed(1)}ms</span>`
      html += `</div>`
    }
    html += `</div>`

    // Render resource receipt
    const rKeys = [
      'r_cells',
      'r_food',
      'r_water',
      'r_terrain',
      'r_particles',
      'r_hulls',
      'r_trails',
      'r_mateParticles',
      'r_foodBuds',
      'r_barriers',
      'r_worldBlob'
    ]
    const maxResMs = Math.max(0.01, ...rKeys.map((k) => last[k] || 0))
    html += `<div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:3px;margin-top:2px">`
    html += `<div style="font-size:7px;color:#ce93d8;margin-bottom:2px;font-weight:600">Render Receipt (${last.renderMs.toFixed(1)}ms)</div>`
    for (const k of rKeys) {
      const v = last[k] || 0
      if (v < 0.005) continue
      const label = k.slice(2)
      const pct = (v / maxResMs) * 100
      const color =
        label === 'cells'
          ? '#ce93d8'
          : label === 'food'
            ? '#81c784'
            : label === 'water'
              ? '#4fc3f7'
              : '#8f9bb7'
      html += `<div style="display:flex;align-items:center;gap:4px;font-size:7px;margin-bottom:1px">`
      html += `<span style="width:60px;color:${color};text-align:right">${label}</span>`
      html += `<div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden"><div style="width:${pct.toFixed(0)}%;height:100%;background:${color};border-radius:2px"></div></div>`
      html += `<span style="width:36px;color:#667;text-align:right">${v.toFixed(1)}ms</span>`
      html += `</div>`
    }
    html += `</div>`
  }

  // Summary (when done)
  if (stressTest.summary) {
    const s = stressTest.summary
    html += `<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:4px;margin-top:2px;font-size:8px;color:#c8d2e6">`
    html += `<div style="font-weight:600;color:#8f9bb7;margin-bottom:2px">Summary (${s.samples} samples, ${s.duration_s}s)</div>`
    html += `<div>FPS: ${s.minFps.toFixed(0)}–${s.maxFps.toFixed(0)} (avg ${s.avgFps.toFixed(1)})</div>`
    html += `<div>Peak sim: ${s.peakSimMs.toFixed(1)}ms · Peak render: ${s.peakRenderMs.toFixed(1)}ms</div>`
    html += `<div>Peak cells: ${s.peakCells} · Peak links: ${s.peakLinks} · Peak species: ${s.peakSpecies}</div>`
    html += `</div>`
  }

  container.innerHTML = html
}
