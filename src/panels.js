// ── Panel Management System ──
// Handles collapsible panels with drag-and-drop between slot zones.
// Each panel has a unique id, a collapse toggle, and can be dragged to any slot.

const SLOT_IDS = ['slot-tl', 'slot-ml', 'slot-bl', 'slot-tr', 'slot-mr', 'slot-br', 'slot-sidebar']
const STORAGE_KEY = 'evoio-panel-layout'

let draggedPanel = null
let dragGhost = null
let dragOffsetX = 0
let dragOffsetY = 0

function saveLayout() {
  const layout = {}
  for (const slotId of SLOT_IDS) {
    const slot = document.getElementById(slotId)
    if (!slot) continue
    const panels = slot.querySelectorAll('.dp')
    layout[slotId] = []
    for (const p of panels) {
      layout[slotId].push({
        id: p.dataset.panelId,
        collapsed: p.classList.contains('dp--collapsed')
      })
    }
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)) } catch {}
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function initPanels() {
  // Wrap each .dp-content in its parent .dp container (already done in HTML)
  const panels = document.querySelectorAll('.dp')

  for (const panel of panels) {
    const header = panel.querySelector('.dp-header')
    if (!header) continue

    // Collapse toggle
    const collapseBtn = header.querySelector('.dp-collapse')
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        panel.classList.toggle('dp--collapsed')
        const arrow = collapseBtn.querySelector('.dp-arrow')
        if (arrow) {
          arrow.textContent = panel.classList.contains('dp--collapsed') ? '\u25B6' : '\u25BC'
        }
        saveLayout()
      })
    }

    // Drag start on header (but not on collapse button)
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.dp-collapse')) return
      e.preventDefault()
      startDrag(panel, e)
    })
  }

  // Restore saved layout
  const saved = loadLayout()
  if (saved) {
    restoreLayout(saved)
  }

  // Set up slot drop zones
  for (const slotId of SLOT_IDS) {
    const slot = document.getElementById(slotId)
    if (!slot) continue
    slot.addEventListener('mouseenter', () => {
      if (draggedPanel) slot.classList.add('slot--hover')
    })
    slot.addEventListener('mouseleave', () => {
      slot.classList.remove('slot--hover')
    })
  }
}

function restoreLayout(saved) {
  // Move panels to their saved slots and restore collapsed state
  for (const [slotId, panelEntries] of Object.entries(saved)) {
    const slot = document.getElementById(slotId)
    if (!slot) continue
    for (const entry of panelEntries) {
      const panel = document.querySelector(`.dp[data-panel-id="${entry.id}"]`)
      if (!panel) continue
      slot.appendChild(panel)
      if (entry.collapsed) {
        panel.classList.add('dp--collapsed')
        const arrow = panel.querySelector('.dp-arrow')
        if (arrow) arrow.textContent = '\u25B6'
      } else {
        panel.classList.remove('dp--collapsed')
        const arrow = panel.querySelector('.dp-arrow')
        if (arrow) arrow.textContent = '\u25BC'
      }
    }
  }
}

function startDrag(panel, e) {
  draggedPanel = panel
  const rect = panel.getBoundingClientRect()
  dragOffsetX = e.clientX - rect.left
  dragOffsetY = e.clientY - rect.top

  // Create ghost
  dragGhost = panel.cloneNode(true)
  dragGhost.classList.add('dp--ghost')
  dragGhost.style.width = rect.width + 'px'
  dragGhost.style.left = (e.clientX - dragOffsetX) + 'px'
  dragGhost.style.top = (e.clientY - dragOffsetY) + 'px'
  document.body.appendChild(dragGhost)

  panel.classList.add('dp--dragging')

  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e) {
  if (!dragGhost) return
  dragGhost.style.left = (e.clientX - dragOffsetX) + 'px'
  dragGhost.style.top = (e.clientY - dragOffsetY) + 'px'

  // Highlight nearest slot
  for (const slotId of SLOT_IDS) {
    const slot = document.getElementById(slotId)
    if (!slot) continue
    const rect = slot.getBoundingClientRect()
    const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top && e.clientY <= rect.bottom
    slot.classList.toggle('slot--hover', inside)
  }
}

function onDragEnd(e) {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)

  if (dragGhost) {
    dragGhost.remove()
    dragGhost = null
  }

  if (!draggedPanel) return
  draggedPanel.classList.remove('dp--dragging')

  // Find which slot we dropped into
  let targetSlot = null
  for (const slotId of SLOT_IDS) {
    const slot = document.getElementById(slotId)
    if (!slot) continue
    slot.classList.remove('slot--hover')
    const rect = slot.getBoundingClientRect()
    if (e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom) {
      targetSlot = slot
    }
  }

  if (targetSlot && targetSlot !== draggedPanel.parentElement) {
    // Find insertion point within the slot
    const children = [...targetSlot.querySelectorAll('.dp')]
    let insertBefore = null
    for (const child of children) {
      const childRect = child.getBoundingClientRect()
      const childMid = childRect.top + childRect.height / 2
      if (e.clientY < childMid) {
        insertBefore = child
        break
      }
    }
    if (insertBefore) {
      targetSlot.insertBefore(draggedPanel, insertBefore)
    } else {
      targetSlot.appendChild(draggedPanel)
    }
    saveLayout()
  }

  draggedPanel = null
}

export { initPanels, saveLayout }
