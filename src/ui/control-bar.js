// Control bar — pure DOM factory, no net/ imports. Inline SVG icons (built
// via createElementNS, never innerHTML) with title/aria-label tooltips.

const SVG_NS = 'http://www.w3.org/2000/svg'

function buildIcon(children) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '20')
  svg.setAttribute('height', '20')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  children.forEach(([tag, attrs]) => {
    const el = document.createElementNS(SVG_NS, tag)
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value))
    svg.appendChild(el)
  })
  return svg
}

const ICONS = {
  mic: [
    ['path', {d: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z'}],
    ['path', {d: 'M19 10v2a7 7 0 0 1-14 0v-2'}],
    ['line', {x1: 12, y1: 19, x2: 12, y2: 23}],
    ['line', {x1: 8, y1: 23, x2: 16, y2: 23}]
  ],
  cam: [
    ['path', {d: 'M23 7l-7 5 7 5V7z'}],
    ['rect', {x: 1, y: 5, width: 15, height: 14, rx: 2, ry: 2}]
  ],
  screen: [
    ['rect', {x: 2, y: 3, width: 20, height: 14, rx: 2, ry: 2}],
    ['line', {x1: 8, y1: 21, x2: 16, y2: 21}],
    ['line', {x1: 12, y1: 17, x2: 12, y2: 21}]
  ],
  chat: [['path', {d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'}]],
  stats: [
    ['line', {x1: 6, y1: 20, x2: 6, y2: 12}],
    ['line', {x1: 12, y1: 20, x2: 12, y2: 4}],
    ['line', {x1: 18, y1: 20, x2: 18, y2: 14}]
  ],
  leave: [
    ['path', {d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'}],
    ['line', {x1: 16, y1: 17, x2: 21, y2: 12}],
    ['line', {x1: 21, y1: 12, x2: 16, y2: 7}],
    ['line', {x1: 21, y1: 12, x2: 9, y2: 12}]
  ]
}

function makeToggleButton(iconKey, label) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'btn active'
  btn.title = label
  btn.setAttribute('aria-label', label)
  btn.appendChild(buildIcon(ICONS[iconKey]))
  return btn
}

function applyState(btn, on) {
  btn.classList.toggle('active', on)
  btn.classList.toggle('off', !on)
}

export function createControlBar(
  rootEl,
  {onToggleMic, onToggleCam, onToggleScreen, onToggleChat, onToggleStats, onLeave} = {}
) {
  rootEl.textContent = ''

  const micBtn = makeToggleButton('mic', 'Mikrofon')
  const camBtn = makeToggleButton('cam', 'Kamera')
  const screenBtn = makeToggleButton('screen', 'Deli ekran')
  applyState(screenBtn, false) // screen sharing starts off
  const chatBtn = makeToggleButton('chat', 'Chat')
  const statsBtn = makeToggleButton('stats', 'Statistika')
  applyState(statsBtn, false) // stats line starts hidden

  const leaveBtn = document.createElement('button')
  leaveBtn.type = 'button'
  leaveBtn.className = 'btn btn-danger'
  leaveBtn.title = 'Izađi'
  leaveBtn.setAttribute('aria-label', 'Izađi')
  leaveBtn.appendChild(buildIcon(ICONS.leave))

  micBtn.addEventListener('click', () => onToggleMic?.())
  camBtn.addEventListener('click', () => onToggleCam?.())
  screenBtn.addEventListener('click', () => onToggleScreen?.())

  let chatOpen = true
  chatBtn.addEventListener('click', () => {
    chatOpen = !chatOpen
    applyState(chatBtn, chatOpen)
    onToggleChat?.()
  })

  statsBtn.addEventListener('click', () => onToggleStats?.())

  leaveBtn.addEventListener('click', () => onLeave?.())

  rootEl.appendChild(micBtn)
  rootEl.appendChild(camBtn)
  rootEl.appendChild(screenBtn)
  rootEl.appendChild(chatBtn)
  rootEl.appendChild(statsBtn)
  rootEl.appendChild(leaveBtn)

  return {
    setMic: on => applyState(micBtn, on),
    setCam: on => applyState(camBtn, on),
    setScreen: on => applyState(screenBtn, on),
    setStats: on => applyState(statsBtn, on)
  }
}
