// App wiring: the only module allowed to touch both net/ and ui/. Boots the
// join screen, and on join wires every net/ callback to a ui/ factory.
import './style.css'
import {createRoom} from './net/room.js'
import {getCameraStream, getScreenStream, stopStream} from './net/media.js'
import {generateRoomCode, normalizeRoomCode} from './net/room-code.js'
import {renderJoinScreen} from './ui/join-screen.js'
import {createVideoGrid} from './ui/video-grid.js'
import {createChatPanel} from './ui/chat-panel.js'
import {createControlBar} from './ui/control-bar.js'
import {playJoin, playLeave, playMessage} from './ui/sounds.js'

const RECONNECT_GRACE_MS = 15000
const OVERLAY_DELAY_MS = 3000
const CONNECT_CHECK_MS = 20000
const NO_MEDIA_NOTICE = 'Kamera/mikrofon nedostupni — možeš da pratiš i pišeš.'
const CONNECT_FAIL_NOTICE =
  'Ne mogu da se povežem na signaling mrežu — proveri internet konekciju pa pokušaj ponovo.'

const joinScreenEl = document.getElementById('join-screen')
const roomScreenEl = document.getElementById('room-screen')
const videoGridEl = document.getElementById('video-grid')
const chatPanelEl = document.getElementById('chat-panel')
const controlBarEl = document.getElementById('control-bar')

// Per-room state — (re)initialized in startRoom(), torn down in leaveRoom().
let roomApi = null
let videoGrid = null
let chatPanel = null
let controlBar = null
let displayName = ''
let camStream = null
let screenStream = null
let statsVisible = false
let connectCheckTimer = null
let joinErrorShown = false

const peerNames = new Map() // peerId -> last known display name
const knownPeerIds = new Set() // peers we've already shown a join notice for
const reconnectTimers = new Map() // peerId -> setTimeout id (grace period)
const overlayTimers = new Map() // peerId -> setTimeout id (delay before showing the overlay)
const typingPeers = new Map() // peerId -> name, currently typing
const incomingFileCards = new Map() // `${peerId}:${offerId}` -> file card api
const outgoingFileCards = new Map() // offerId -> file card api
const pendingOfferNames = new Map() // `${peerId}:${offerId}` -> file name, for the save-picker
const blobUrls = new Set() // object URLs created for downloaded files

boot()

function boot() {
  renderJoinScreen({
    generateCode: generateRoomCode,
    onJoin: ({name, code}) => startRoom(name, code)
  })
}

async function startRoom(name, rawCode) {
  const code = normalizeRoomCode(rawCode)
  displayName = name
  location.hash = code

  videoGrid = createVideoGrid(videoGridEl)
  chatPanel = createChatPanel(chatPanelEl, {
    onSend: sendChatMessage,
    onSendFile: sendFile,
    onAcceptFile: acceptFileFlow,
    onDeclineFile: (peerId, offerId) => roomApi.declineFile(peerId, offerId),
    // Null-guarded: the panel's typing-idle timer could in theory outlive
    // the room (destroy() also clears it — belt and suspenders).
    onTyping: isTyping => roomApi?.sendTyping(isTyping)
  })
  controlBar = createControlBar(controlBarEl, {
    onToggleMic: toggleMic,
    onToggleCam: toggleCam,
    onToggleScreen: toggleScreen,
    onToggleChat: () => roomScreenEl.classList.toggle('chat-hidden'),
    onToggleStats: toggleStats,
    onLeave: leaveRoom
  })

  roomApi = createRoom(code, displayName)
  wireRoomCallbacks()
  roomApi.join()

  joinScreenEl.hidden = true
  roomScreenEl.hidden = false

  // Belt-and-suspenders connectivity check: trystero's onJoinError only
  // fires on failed peer handshakes, so "every relay unreachable" would
  // otherwise stay silent forever. If after a while we have neither a peer
  // nor a single open relay socket, tell the user instead of spinning.
  // Deliberately NOT kicking them out — peers might simply be absent.
  const checkedRoom = roomApi
  connectCheckTimer = setTimeout(() => {
    connectCheckTimer = null
    if (roomApi !== checkedRoom) return
    if (roomApi.peerCount() === 0 && !roomApi.hasRelayConnection()) {
      chatPanel.addNotice(CONNECT_FAIL_NOTICE)
    }
  }, CONNECT_CHECK_MS)

  // Session guard: getCameraStream can settle after this room was already
  // left (or another one joined) — without the check, a stale resolution
  // would leak the camera and touch the wrong (or torn-down) UI.
  const session = roomApi
  try {
    const stream = await getCameraStream()
    if (roomApi !== session) {
      stopStream(stream)
      return
    }
    camStream = stream
    videoGrid.addTile({peerId: roomApi.selfId, stream: camStream, kind: 'camera', name: displayName, local: true})
    roomApi.shareStream(camStream, 'camera')
  } catch {
    // Permission denied, no device, or an insecure context — MVP falls
    // back to chat-only rather than blocking the room.
    if (roomApi === session) chatPanel.addNotice(NO_MEDIA_NOTICE)
  }
}

function sendChatMessage(text) {
  roomApi.sendChat(text)
  chatPanel.addMessage({name: displayName, text, ts: Date.now(), self: true})
}

function sendFile(file) {
  const offerId = roomApi.sendFile(file)
  if (!offerId) return
  const card = chatPanel.addFileCard({
    offerId,
    peerId: null,
    name: file.name,
    size: file.size,
    direction: 'up',
    incoming: false
  })
  outgoingFileCards.set(offerId, card)
}

/**
 * Accept-file flow: on browsers with the File System Access API, opens the
 * save picker FIRST (synchronously in the click gesture, before any other
 * await) and hands the resulting WritableStream down to roomApi so files.js
 * can stream slices straight to disk instead of buffering the whole file in
 * memory. Falls back to the old in-memory (Blob) path otherwise. A cancelled
 * picker is treated the same as a decline.
 */
async function acceptFileFlow(peerId, offerId) {
  if (window.showSaveFilePicker) {
    const name = pendingOfferNames.get(`${peerId}:${offerId}`)
    let writable
    try {
      const handle = await window.showSaveFilePicker({suggestedName: name})
      writable = await handle.createWritable()
    } catch {
      // User cancelled the picker (or it's unsupported at call time).
      const card = incomingFileCards.get(`${peerId}:${offerId}`)
      roomApi.declineFile(peerId, offerId)
      card?.setDeclined()
      return
    }
    roomApi.acceptFile(peerId, offerId, writable)
  } else {
    roomApi.acceptFile(peerId, offerId)
  }
}

function wireRoomCallbacks() {
  roomApi.onPeerJoined = ({peerId, name}) => {
    peerNames.set(peerId, name)
    clearReconnectTimer(peerId)
    videoGrid.setName(peerId, name)
    if (!knownPeerIds.has(peerId)) {
      knownPeerIds.add(peerId)
      chatPanel.addNotice(`${name} je upao`)
      playJoin()
    }
  }

  roomApi.onPeerLeft = ({peerId}) => {
    // A peer that disconnects mid-typing never sends isTyping: false —
    // drop it from the typing set so the indicator doesn't stick forever.
    if (typingPeers.delete(peerId)) {
      chatPanel.setTyping(Array.from(typingPeers.values()))
    }
    // File-transfer cards tied to this peer are failed via roomApi's own
    // onFileFailed (fired from files.js's clearPeer, called before this
    // handler runs) — no separate bookkeeping needed here.

    // MVP reconnect grace: trystero churns connections in normal operation
    // (a re-announce can replace a live peer connection, or a secondary
    // handshake can fail and recover within a second or two) — onPeerLeave
    // fires every time even though the call recovers on its own almost
    // immediately. Arm the 15s removal timer right away (a real departure
    // still needs to notice + remove the tile eventually), but DON'T show
    // the "reconnecting" overlay instantly — that's what made brief micro
    // churn look like a scary outage on a working video. Instead, delay the
    // overlay by OVERLAY_DELAY_MS and only show it if the peer is still
    // gone by then. A rejoin within that window (clearReconnectTimer) stays
    // completely silent; a real outage shows the overlay from t+3s until
    // rejoin or removal at t+15s.
    clearTimeout(reconnectTimers.get(peerId)) // dedupe if onPeerLeft re-fires
    clearTimeout(overlayTimers.get(peerId))
    const timer = setTimeout(() => {
      reconnectTimers.delete(peerId)
      chatPanel.addNotice(`${peerNames.get(peerId) || 'gost'} je izašao`)
      playLeave()
      videoGrid.removeTile(peerId, 'camera')
      videoGrid.removeTile(peerId, 'screen')
      knownPeerIds.delete(peerId)
      peerNames.delete(peerId)
    }, RECONNECT_GRACE_MS)
    reconnectTimers.set(peerId, timer)
    const overlayTimer = setTimeout(() => {
      overlayTimers.delete(peerId)
      if (reconnectTimers.has(peerId)) videoGrid.setReconnecting(peerId, true)
    }, OVERLAY_DELAY_MS)
    overlayTimers.set(peerId, overlayTimer)
  }

  roomApi.onPeerStream = ({peerId, stream, kind}) => {
    videoGrid.addTile({peerId, stream, kind, name: peerNames.get(peerId), local: false})
  }

  roomApi.onPeerStreamEnded = ({peerId, kind}) => {
    videoGrid.removeTile(peerId, kind)
  }

  roomApi.onChat = ({name, text, ts}) => {
    chatPanel.addMessage({name, text, ts, self: false})
    playMessage()
  }

  roomApi.onTyping = ({peerId, isTyping}) => {
    if (isTyping) {
      typingPeers.set(peerId, peerNames.get(peerId) || 'gost')
    } else {
      typingPeers.delete(peerId)
    }
    chatPanel.setTyping(Array.from(typingPeers.values()))
  }

  roomApi.onFileOffer = ({peerId, offerId, name, size}) => {
    const card = chatPanel.addFileCard({offerId, peerId, name, size, direction: 'down', incoming: true})
    incomingFileCards.set(`${peerId}:${offerId}`, card)
    pendingOfferNames.set(`${peerId}:${offerId}`, name)
  }

  roomApi.onFileProgress = ({peerId, offerId, direction, pct}) => {
    if (direction === 'down') {
      incomingFileCards.get(`${peerId}:${offerId}`)?.setProgress(pct)
    } else {
      outgoingFileCards.get(offerId)?.setProgress(pct)
    }
  }

  roomApi.onFileDone = ({peerId, offerId, blob, name, saved}) => {
    if (blob) {
      const url = URL.createObjectURL(blob)
      blobUrls.add(url)
      incomingFileCards.get(`${peerId}:${offerId}`)?.setDone(url)
      incomingFileCards.delete(`${peerId}:${offerId}`)
      pendingOfferNames.delete(`${peerId}:${offerId}`)
    } else if (saved) {
      incomingFileCards.get(`${peerId}:${offerId}`)?.setSaved()
      incomingFileCards.delete(`${peerId}:${offerId}`)
      pendingOfferNames.delete(`${peerId}:${offerId}`)
    } else {
      outgoingFileCards.get(offerId)?.setDone()
      outgoingFileCards.delete(offerId)
    }
  }

  roomApi.onFileFailed = ({peerId, offerId, direction}) => {
    if (direction === 'down') {
      incomingFileCards.get(`${peerId}:${offerId}`)?.setFailed()
      incomingFileCards.delete(`${peerId}:${offerId}`)
      pendingOfferNames.delete(`${peerId}:${offerId}`)
    } else {
      outgoingFileCards.get(offerId)?.setFailed()
      outgoingFileCards.delete(offerId)
    }
  }

  roomApi.onStats = ({peerId, stats}) => {
    videoGrid.setStats(peerId, formatStats(stats))
  }

  roomApi.onJoinError = ({error}) => {
    // Can fire once per failed peer handshake — one notice is enough.
    if (joinErrorShown) return
    joinErrorShown = true
    chatPanel.addNotice(`Povezivanje nije uspelo: ${error}`)
  }
}

function clearReconnectTimer(peerId) {
  const timer = reconnectTimers.get(peerId)
  if (timer) {
    clearTimeout(timer)
    reconnectTimers.delete(peerId)
  }
  const overlayTimer = overlayTimers.get(peerId)
  if (overlayTimer) {
    clearTimeout(overlayTimer)
    overlayTimers.delete(peerId)
  }
  videoGrid.setReconnecting(peerId, false)
}

function resLabel(res) {
  if (!res) return '—'
  const height = Number(res.split('x')[1])
  return Number.isFinite(height) ? `${height}p` : '—'
}

function formatStats({kbps, rtt, res, relay}) {
  const mbps = (kbps / 1000).toFixed(1)
  const rttPart = rtt != null ? `${Math.round(rtt * 1000)} ms` : '— ms'
  return `${resLabel(res)} · ${mbps} Mbps · ${rttPart} · ${relay ? 'relay' : 'direct'}`
}

function toggleMic() {
  const track = camStream?.getAudioTracks()[0]
  if (!track) return
  track.enabled = !track.enabled
  controlBar.setMic(track.enabled)
}

function toggleCam() {
  const track = camStream?.getVideoTracks()[0]
  if (!track) return
  track.enabled = !track.enabled
  controlBar.setCam(track.enabled)
}

async function toggleScreen() {
  if (screenStream) {
    stopScreenShare()
    return
  }
  try {
    screenStream = await getScreenStream()
  } catch {
    // User cancelled the picker (or it's unsupported) — stay as-is.
    return
  }
  roomApi.shareStream(screenStream, 'screen')
  videoGrid.addTile({peerId: roomApi.selfId, stream: screenStream, kind: 'screen', name: displayName, local: true})
  controlBar.setScreen(true)
  const [track] = screenStream.getVideoTracks()
  track?.addEventListener('ended', stopScreenShare, {once: true})
}

function stopScreenShare() {
  if (!screenStream) return
  roomApi.unshareStream(screenStream)
  videoGrid.removeTile(roomApi.selfId, 'screen')
  stopStream(screenStream)
  screenStream = null
  controlBar.setScreen(false)
}

function toggleStats() {
  statsVisible = !statsVisible
  videoGrid.setStatsVisible(statsVisible)
  controlBar.setStats(statsVisible)
}

function leaveRoom() {
  roomApi?.leave()
  chatPanel?.destroy() // unhooks drop-zone listeners + pending typing timer
  stopStream(camStream)
  stopStream(screenStream)
  camStream = null
  screenStream = null

  clearTimeout(connectCheckTimer)
  connectCheckTimer = null
  joinErrorShown = false
  reconnectTimers.forEach(timer => clearTimeout(timer))
  reconnectTimers.clear()
  overlayTimers.forEach(timer => clearTimeout(timer))
  overlayTimers.clear()
  peerNames.clear()
  knownPeerIds.clear()
  typingPeers.clear()
  incomingFileCards.clear()
  outgoingFileCards.clear()
  pendingOfferNames.clear()
  blobUrls.forEach(url => URL.revokeObjectURL(url))
  blobUrls.clear()
  statsVisible = false

  roomApi = null
  videoGrid = null
  chatPanel = null
  controlBar = null

  location.hash = ''
  roomScreenEl.hidden = true
  roomScreenEl.classList.remove('chat-hidden')
  videoGridEl.textContent = ''
  chatPanelEl.textContent = ''
  controlBarEl.textContent = ''
  joinScreenEl.hidden = false

  boot()
}

window.addEventListener('beforeunload', () => {
  roomApi?.leave()
})
