// Networking facade: wraps trystero so the UI never touches the DOM-free
// P2P plumbing directly. See README/brief for the exact roomApi contract.
//
// Note on the trystero API actually installed (v0.25.x, @trystero-p2p/core):
// `room.onPeerJoin` / `onPeerLeave` / `onPeerStream` are settable properties
// (not functions you call), `makeAction` returns `{send, onMessage,
// onReceiveProgress}` objects (not `[send, on, onProgress]` arrays), and
// `send`/`addStream` take an options object (`{target, metadata, onProgress}`)
// rather than positional peerId/metadata arguments. The code below targets
// that real, installed API.
import {getRelaySockets, joinRoom, selfId} from 'trystero'
import {APP_ID, rtcConfig} from '../config.js'
import {applyQualityToPeers} from './media.js'
import {createFileTransfer} from './files.js'

const NAME_FALLBACK = 'gost'
const NAME_FALLBACK_MS = 2000
const STATS_INTERVAL_MS = 1000

export function createRoom(roomCode, displayName) {
  let room = null
  let statsTimer = null

  // Actions, created once trystero room exists (inside join()).
  let nameAction = null
  let chatAction = null
  let typingAction = null
  let fileTransfer = null

  const names = new Map() // peerId -> display name
  const joinTimers = new Map() // peerId -> fallback timeout id
  const sharedStreams = new Map() // stream -> kind ('camera'|'screen')
  const lastStatsSample = new Map() // peerId -> {bytes, time}

  const api = {
    selfId,
    onPeerJoined: null,
    onPeerLeft: null,
    onPeerStream: null,
    onPeerStreamEnded: null,
    onChat: null,
    onTyping: null,
    onFileOffer: null,
    onFileProgress: null,
    onFileDone: null,
    onFileFailed: null,
    onStats: null,
    onJoinError: null,
    join,
    leave,
    sendChat,
    sendTyping,
    sendFile,
    acceptFile,
    declineFile,
    shareStream,
    unshareStream,
    peerCount,
    hasRelayConnection
  }

  function peerCount() {
    return room ? Object.keys(room.getPeers()).length : 0
  }

  /** True if at least one signaling relay WebSocket is currently open. */
  function hasRelayConnection() {
    try {
      return Object.values(getRelaySockets() || {}).some(
        socket => socket?.readyState === WebSocket.OPEN
      )
    } catch {
      return false
    }
  }

  function markPeerJoined(peerId, name) {
    names.set(peerId, name)
    const timer = joinTimers.get(peerId)
    if (timer) {
      clearTimeout(timer)
      joinTimers.delete(peerId)
    }
    api.onPeerJoined?.({peerId, name})
  }

  function join() {
    if (room) return
    // Third joinRoom argument is trystero 0.25's JoinRoomCallbacks —
    // onJoinError fires when a peer handshake/join fails outright.
    room = joinRoom({appId: APP_ID, password: roomCode, rtcConfig}, roomCode, {
      onJoinError: details => api.onJoinError?.({error: details?.error || 'join failed'})
    })

    nameAction = room.makeAction('name')
    chatAction = room.makeAction('chat')
    typingAction = room.makeAction('typing')
    fileTransfer = createFileTransfer(room, {
      onFileOffer: payload => api.onFileOffer?.(payload),
      onFileProgress: payload => api.onFileProgress?.(payload),
      onFileDone: payload => api.onFileDone?.(payload),
      onFileFailed: payload => api.onFileFailed?.(payload)
    })

    nameAction.onMessage = (name, {peerId}) => {
      if (!names.has(peerId)) {
        markPeerJoined(peerId, name)
      } else if (names.get(peerId) !== name) {
        // Real name arrived after the 'gost' fallback (or peer renamed):
        // re-emit onPeerJoined so the UI updates the display name.
        names.set(peerId, name)
        api.onPeerJoined?.({peerId, name})
      }
    }

    chatAction.onMessage = (payload, {peerId}) => {
      api.onChat?.({peerId, name: names.get(peerId) || NAME_FALLBACK, text: payload.text, ts: payload.ts})
    }

    typingAction.onMessage = (payload, {peerId}) => {
      api.onTyping?.({peerId, isTyping: payload.isTyping})
    }

    room.onPeerJoin = peerId => {
      nameAction.send(displayName, {target: peerId})
      // Re-share any streams we're already broadcasting to this new peer.
      sharedStreams.forEach((kind, stream) => {
        room.addStream(stream, {target: peerId, metadata: {kind}})
      })
      applyQualityToPeers(room.getPeers, peerCount())
      joinTimers.set(
        peerId,
        setTimeout(() => {
          if (!names.has(peerId)) markPeerJoined(peerId, NAME_FALLBACK)
        }, NAME_FALLBACK_MS)
      )
    }

    room.onPeerLeave = peerId => {
      names.delete(peerId)
      lastStatsSample.delete(peerId)
      const timer = joinTimers.get(peerId)
      if (timer) {
        clearTimeout(timer)
        joinTimers.delete(peerId)
      }
      fileTransfer?.clearPeer(peerId)
      api.onPeerLeft?.({peerId})
      applyQualityToPeers(room.getPeers, peerCount())
    }

    room.onPeerStream = (stream, peerId, metadata) => {
      const kind = metadata?.kind || 'camera'
      api.onPeerStream?.({peerId, stream, kind})
      // trystero has no built-in "stream ended" signal; infer it from the
      // remote track(s) ending (peer stopped/removed the stream). Emit once
      // per (peerId, stream), not once per track.
      let endedEmitted = false
      stream.getTracks().forEach(track => {
        track.addEventListener(
          'ended',
          () => {
            if (endedEmitted) return
            endedEmitted = true
            api.onPeerStreamEnded?.({peerId, kind})
          },
          {once: true}
        )
      })
    }

    statsTimer = setInterval(() => collectStats(room), STATS_INTERVAL_MS)
  }

  async function collectStats(activeRoom) {
    const peers = activeRoom.getPeers()
    for (const [peerId, pc] of Object.entries(peers)) {
      try {
        const report = await pc.getStats()
        let bytesSent = 0
        let width = null
        let height = null
        let rtt = null
        let relay = false

        report.forEach(stat => {
          if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
            bytesSent += stat.bytesSent || 0
            if (stat.frameWidth) width = stat.frameWidth
            if (stat.frameHeight) height = stat.frameHeight
          }
          if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') {
            if (typeof stat.currentRoundTripTime === 'number') rtt = stat.currentRoundTripTime
            const localCandidate = report.get(stat.localCandidateId)
            relay = localCandidate?.candidateType === 'relay'
          }
        })

        const now = Date.now()
        const prev = lastStatsSample.get(peerId)
        let kbps = 0
        if (prev && now > prev.time) {
          kbps = Math.max(0, Math.round(((bytesSent - prev.bytes) * 8) / (now - prev.time)))
        }
        lastStatsSample.set(peerId, {bytes: bytesSent, time: now})

        api.onStats?.({
          peerId,
          stats: {kbps, rtt, res: width && height ? `${width}x${height}` : null, relay}
        })
      } catch {
        // pc may be mid-teardown between ticks — skip this peer this tick.
      }
    }
  }

  function leave() {
    if (statsTimer) {
      clearInterval(statsTimer)
      statsTimer = null
    }
    joinTimers.forEach(timer => clearTimeout(timer))
    joinTimers.clear()
    names.clear()
    lastStatsSample.clear()
    sharedStreams.clear()
    fileTransfer?.clear()
    fileTransfer = null
    room?.leave()
    room = null
  }

  function sendChat(text) {
    if (!room) return
    chatAction.send({text, ts: Date.now()})
  }

  function sendTyping(isTyping) {
    if (!room) return
    typingAction.send({isTyping})
  }

  function sendFile(file) {
    if (!room) return
    return fileTransfer.sendFile(file)
  }

  /** Returns false if the offer was gone (see files.js acceptFile). */
  function acceptFile(peerId, offerId, sink) {
    if (!room) {
      sink?.abort().catch(() => {})
      return false
    }
    return fileTransfer.acceptFile(peerId, offerId, sink)
  }

  function declineFile(peerId, offerId) {
    if (!room) return
    fileTransfer.declineFile(peerId, offerId)
  }

  function shareStream(stream, kind) {
    if (!room) return
    sharedStreams.set(stream, kind)
    room.addStream(stream, {metadata: {kind}})
    applyQualityToPeers(room.getPeers, peerCount())
  }

  function unshareStream(stream) {
    if (!room) return
    sharedStreams.delete(stream)
    room.removeStream(stream)
  }

  return api
}
