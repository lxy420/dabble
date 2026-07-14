// Video tile grid — pure DOM factory, no net/ imports. Consumes plain
// {peerId, stream, kind, name, local} payload objects handed in by main.js.

const DEFAULT_REMOTE_NAME = 'gost'
const DEFAULT_LOCAL_NAME = 'ti'

function tileKey(peerId, kind) {
  return `${peerId}::${kind}`
}

function toggleFullscreen(tile) {
  if (document.fullscreenElement === tile) {
    document.exitFullscreen?.()
  } else {
    tile.requestFullscreen?.().catch(() => {
      // Fullscreen can be denied (no user gesture, unsupported) — ignore.
    })
  }
}

export function createVideoGrid(rootEl) {
  const tiles = new Map() // `${peerId}::${kind}` -> {tile, video, nameEl}

  function updateCount() {
    const count = Math.min(4, Math.max(1, tiles.size))
    rootEl.dataset.count = String(count)
  }

  function buildTile(peerId, kind, local) {
    const tile = document.createElement('div')
    tile.className = 'tile'
    tile.dataset.peerId = peerId
    tile.dataset.kind = kind
    if (local) tile.classList.add('local')
    if (kind === 'screen') tile.classList.add('screen')
    tile.classList.add(kind === 'screen' ? 'screen' : 'camera')

    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    if (local) video.muted = true
    tile.appendChild(video)

    const nameEl = document.createElement('div')
    nameEl.className = 'tile-name'
    tile.appendChild(nameEl)

    tile.addEventListener('click', () => toggleFullscreen(tile))

    rootEl.appendChild(tile)
    return {tile, video, nameEl}
  }

  function addTile({peerId, stream, kind, name, local}) {
    const key = tileKey(peerId, kind)
    let entry = tiles.get(key)
    if (!entry) {
      entry = buildTile(peerId, kind, local)
      tiles.set(key, entry)
    }
    entry.video.srcObject = stream
    entry.nameEl.textContent = name || (local ? DEFAULT_LOCAL_NAME : DEFAULT_REMOTE_NAME)
    updateCount()
  }

  function removeTile(peerId, kind) {
    const key = tileKey(peerId, kind)
    const entry = tiles.get(key)
    if (!entry) return
    entry.video.srcObject = null
    entry.tile.remove()
    tiles.delete(key)
    updateCount()
  }

  function setName(peerId, name) {
    tiles.forEach((entry, key) => {
      if (key.startsWith(`${peerId}::`)) {
        entry.nameEl.textContent = name
      }
    })
  }

  function setCount() {
    updateCount()
  }

  return {addTile, removeTile, setName, setCount}
}
