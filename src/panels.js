// ── Panel Management System ──
// Free-floating panels with 25px grid snap. All hidden by default.
// Sidebar shows checkbox list to toggle each widget on/off.
// Close button (×) on each panel also hides it.
// Positions + visibility persisted in localStorage.

const GRID = 25
const STORAGE_KEY = 'evoio-panels-v4'

const WIDGETS = [
  { id: 'hud', name: 'Stats' },
  { id: 'organelles', name: 'Organelles' },
  { id: 'status', name: 'Status' },
  { id: 'ecology', name: 'Ecology' },
  { id: 'performance', name: 'Performance' },
  { id: 'organisms', name: 'Organisms' },
  { id: 'graphs', name: 'Evolution Graphs' },
  { id: 'science', name: 'Science Tools' },
  { id: 'muller', name: 'Muller Plot' },
  { id: 'genomebrowser', name: 'Genome Browser' },
  { id: 'experiment', name: 'Experiment Controls' },
  { id: 'stresstest', name: 'Stress Test' },
  { id: 'settings', name: 'Settings' }
]

// State: { [panelId]: { x, y, visible, collapsed } }
let _state = {}
let _dragPanel = null
let _dragOffX = 0
let _dragOffY = 0
let _overlay = null
// Map of panelId → checkbox element for syncing
const _checkboxes = {}

function snap(v) {
  return Math.round(v / GRID) * GRID
}

// ── Persistence ──

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state))
  } catch {}
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// ── Show / Hide ──

function showPanel(id) {
  const p = document.querySelector(`.dp[data-panel-id="${id}"]`)
  if (!p) return
  if (!_state[id]) _state[id] = {}
  _state[id].visible = true
  if (_state[id].x == null) {
    const idx = WIDGETS.findIndex((w) => w.id === id)
    _state[id].x = snap(25 + (idx % 4) * 75)
    _state[id].y = snap(25 + Math.floor(idx / 4) * 75)
  }
  p.style.display = ''
  p.style.left = _state[id].x + 'px'
  p.style.top = _state[id].y + 'px'
  if (_checkboxes[id]) _checkboxes[id].checked = true
  save()
}

function hidePanel(id) {
  const p = document.querySelector(`.dp[data-panel-id="${id}"]`)
  if (!p) return
  if (!_state[id]) _state[id] = {}
  _state[id].visible = false
  p.style.display = 'none'
  if (_checkboxes[id]) _checkboxes[id].checked = false
  save()
}

// ── Build sidebar toggle list ──

function buildToggles() {
  const container = document.getElementById('widget-toggles')
  if (!container) return
  container.innerHTML = ''
  for (const w of WIDGETS) {
    const label = document.createElement('label')
    label.className = 'widget-toggle'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = !!(_state[w.id] && _state[w.id].visible)
    cb.addEventListener('change', () => {
      if (cb.checked) showPanel(w.id)
      else hidePanel(w.id)
    })
    _checkboxes[w.id] = cb
    const span = document.createElement('span')
    span.textContent = w.name
    label.appendChild(cb)
    label.appendChild(span)
    container.appendChild(label)
  }
}

// ── Drag with grid snap ──

function startDrag(panel, e) {
  _dragPanel = panel
  _dragOffX = e.clientX - panel.getBoundingClientRect().left
  _dragOffY = e.clientY - panel.getBoundingClientRect().top
  panel.classList.add('dp--dragging')
  panel.style.zIndex = 1000
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e) {
  if (!_dragPanel || !_overlay) return
  const r = _overlay.getBoundingClientRect()
  let x = e.clientX - r.left - _dragOffX
  let y = e.clientY - r.top - _dragOffY
  x = Math.max(0, Math.min(x, r.width - 50))
  y = Math.max(0, Math.min(y, r.height - 30))
  x = snap(x)
  y = snap(y)
  _dragPanel.style.left = x + 'px'
  _dragPanel.style.top = y + 'px'
}

function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  if (!_dragPanel) return
  _dragPanel.classList.remove('dp--dragging')
  _dragPanel.style.zIndex = ''
  const pid = _dragPanel.dataset.panelId
  if (pid) {
    if (!_state[pid]) _state[pid] = {}
    _state[pid].x = parseInt(_dragPanel.style.left) || 0
    _state[pid].y = parseInt(_dragPanel.style.top) || 0
    save()
  }
  _dragPanel = null
}

// ── Layout save (compat export for main.js) ──
function saveLayout() {
  save()
}

// ── Init ──

// ── Pop-out windows ──
const _popouts = {} // panelId → { win, interval }

function popOutPanel(pid) {
  const panel = document.querySelector(`.dp[data-panel-id="${pid}"]`)
  if (!panel) return
  const body = panel.querySelector('.dp-body')
  if (!body) return
  const title = panel.querySelector('.dp-title')
  const name = title ? title.textContent : pid

  // Close existing popout for this panel
  if (_popouts[pid] && _popouts[pid].win && !_popouts[pid].win.closed) {
    _popouts[pid].win.focus()
    return
  }

  const w = Math.max(360, panel.offsetWidth + 40)
  const h = Math.max(300, panel.offsetHeight + 40)
  const win = window.open('', `evoio_${pid}`, `width=${w},height=${h},resizable=yes,scrollbars=yes`)
  if (!win) return

  // Write initial document with styles
  win.document.write(`<!doctype html><html><head><title>EvoIO — ${name}</title>
<link rel="stylesheet" href="${location.origin}/style.css">
<style>
  body { background: #070913; color: #e8ecff; font-family: ui-sans-serif,system-ui,-apple-system,sans-serif; margin: 0; padding: 10px; overflow: auto; }
  .dp-body { padding: 0; max-height: none !important; opacity: 1 !important; overflow: visible !important; }
  canvas { max-width: 100%; height: auto !important; }
</style></head><body><div id="content"></div></body></html>`)
  win.document.close()

  // Sync content periodically
  const contentDiv = win.document.getElementById('content')
  const syncContent = () => {
    if (win.closed) {
      clearInterval(interval)
      delete _popouts[pid]
      return
    }
    contentDiv.innerHTML = body.innerHTML
  }
  syncContent()
  const interval = setInterval(syncContent, 500)

  _popouts[pid] = { win, interval }

  win.addEventListener('beforeunload', () => {
    clearInterval(interval)
    delete _popouts[pid]
  })
}

// ── Zoom / Scale ──

function setScale(panel, scale) {
  const body = panel.querySelector('.dp-body')
  if (!body) return
  body.style.transformOrigin = 'top left'
  body.style.transform = scale === 1 ? '' : `scale(${scale})`
  // Adjust container width to compensate for scale
  if (scale !== 1) {
    body.style.width = 100 / scale + '%'
  } else {
    body.style.width = ''
  }
  const label = panel.querySelector('.dp-scale-label')
  if (label) label.textContent = Math.round(scale * 100) + '%'
  const pid = panel.dataset.panelId
  if (pid) {
    if (!_state[pid]) _state[pid] = {}
    _state[pid].scale = scale
    save()
  }
}

function initPanels() {
  _overlay = document.getElementById('panels-overlay')

  // Clean up old storage keys
  try {
    localStorage.removeItem('evoio-panel-layout')
    localStorage.removeItem('evoio-panel-layout-v2')
    localStorage.removeItem('evoio-panel-layout-v3')
    localStorage.removeItem('evoio-panel-layout-v4')
    localStorage.removeItem('evoio-panel-layout-v5')
    localStorage.removeItem('evoio-visible-widgets-v1')
    localStorage.removeItem('evoio-visible-widgets-v2')
    localStorage.removeItem('evoio-panels-v3')
  } catch {}

  // Load saved state
  const saved = load()
  _state = saved || {}

  const panels = document.querySelectorAll('#panels-overlay .dp[data-panel-id]')

  for (const panel of panels) {
    const pid = panel.dataset.panelId
    const header = panel.querySelector('.dp-header')

    // ── Inject zoom + popout buttons before collapse/close ──
    if (header) {
      const collapseBtn = header.querySelector('.dp-collapse')
      const insertBefore = collapseBtn || header.querySelector('.dp-close')

      // Zoom out
      const zoomOut = document.createElement('button')
      zoomOut.className = 'dp-zoom-out'
      zoomOut.title = 'Zoom out'
      zoomOut.textContent = '\u2212' // minus
      zoomOut.addEventListener('click', (e) => {
        e.stopPropagation()
        const s = (_state[pid] && _state[pid].scale) || 1
        setScale(panel, Math.max(0.5, +(s - 0.1).toFixed(1)))
      })

      // Scale label
      const scaleLabel = document.createElement('span')
      scaleLabel.className = 'dp-scale-label'
      scaleLabel.textContent = '100%'

      // Zoom in
      const zoomIn = document.createElement('button')
      zoomIn.className = 'dp-zoom-in'
      zoomIn.title = 'Zoom in'
      zoomIn.textContent = '+'
      zoomIn.addEventListener('click', (e) => {
        e.stopPropagation()
        const s = (_state[pid] && _state[pid].scale) || 1
        setScale(panel, Math.min(2.0, +(s + 0.1).toFixed(1)))
      })

      // Pop-out
      const popout = document.createElement('button')
      popout.className = 'dp-popout'
      popout.title = 'Pop out to new window'
      popout.innerHTML = '&#8599;' // arrow upper right
      popout.addEventListener('click', (e) => {
        e.stopPropagation()
        popOutPanel(pid)
      })

      if (insertBefore) {
        header.insertBefore(zoomOut, insertBefore)
        header.insertBefore(scaleLabel, insertBefore)
        header.insertBefore(zoomIn, insertBefore)
        header.insertBefore(popout, insertBefore)
      } else {
        header.appendChild(zoomOut)
        header.appendChild(scaleLabel)
        header.appendChild(zoomIn)
        header.appendChild(popout)
      }
    }

    // Collapse toggle
    const collapseBtn = panel.querySelector('.dp-collapse')
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        panel.classList.toggle('dp--collapsed')
        const arrow = collapseBtn.querySelector('.dp-arrow')
        if (arrow) {
          arrow.textContent = panel.classList.contains('dp--collapsed') ? '\u25B6' : '\u25BC'
        }
        if (!_state[pid]) _state[pid] = {}
        _state[pid].collapsed = panel.classList.contains('dp--collapsed')
        save()
      })
    }

    // Close button
    const closeBtn = panel.querySelector('.dp-close')
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        hidePanel(pid)
      })
    }

    // Drag on header
    if (header) {
      header.addEventListener('mousedown', (e) => {
        if (
          e.target.closest('.dp-collapse') ||
          e.target.closest('.dp-close') ||
          e.target.closest('.dp-popout') ||
          e.target.closest('.dp-zoom-in') ||
          e.target.closest('.dp-zoom-out')
        )
          return
        e.preventDefault()
        startDrag(panel, e)
      })
    }

    // Apply saved state
    const s = _state[pid]
    if (s && s.visible) {
      panel.style.display = ''
      if (s.x != null) panel.style.left = s.x + 'px'
      if (s.y != null) panel.style.top = s.y + 'px'
      if (s.collapsed) {
        panel.classList.add('dp--collapsed')
        const arrow = panel.querySelector('.dp-arrow')
        if (arrow) arrow.textContent = '\u25B6'
      }
      if (s.scale && s.scale !== 1) {
        setScale(panel, s.scale)
      }
    }
    // else: stays display:none from HTML
  }

  // Build the always-visible widget toggle list in sidebar
  buildToggles()
}

export { initPanels, saveLayout }
