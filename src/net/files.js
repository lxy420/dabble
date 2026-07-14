// File transfer over trystero actions: offer -> accept/decline -> chunked
// slice protocol -> blob (or disk write) on completion. Split out of room.js
// to keep that module small; wired in via createFileTransfer(room, callbacks).
//
// Why chunked, not a single blast: trystero's action send() loop waits for
// the data channel's `bufferedamountlow` event with a 10s timeout and, on
// timeout or channel close, does a silent `break` — the returned promise
// still RESOLVES as if the whole payload made it. A single whole-file send()
// can therefore "succeed" after only a partial transfer. Slicing the file
// into SLICE_SIZE pieces and requiring the receiver to ACK total bytes
// received lets us detect that lie ourselves (via ACK_TIMEOUT_MS) instead of
// trusting trystero's resolution. Reading each slice lazily via
// `file.slice(...).arrayBuffer()` (never `file.arrayBuffer()` on the whole
// file) also keeps memory bounded to ~1 MiB regardless of file size.
export const SLICE_SIZE = 1024 * 1024 // 1 MiB
export const ACK_EVERY = 16 // receiver ACKs every 16th slice, and always the last
export const ACK_TIMEOUT_MS = 30000 // no ack progress / no new slice within this -> fail

/**
 * How many slices a file of `size` bytes is split into, and how big the
 * final (possibly partial) slice is. A 0-byte file still gets exactly one
 * (empty) slice so the offer/ack handshake has something to complete on.
 */
export function planSlices(size) {
  const sliceCount = Math.max(1, Math.ceil(size / SLICE_SIZE))
  const lastSliceSize = size === 0 ? 0 : size - SLICE_SIZE * (sliceCount - 1)
  return {sliceCount, lastSliceSize}
}

/** Integer 0..100 progress, clamped; an unknown/zero total reads as done. */
export function pct(bytes, total) {
  if (total <= 0) return 100
  return Math.min(100, Math.max(0, Math.round((bytes / total) * 100)))
}

/** True on every ACK_EVERY-th slice (1-based `seq`) and always on the last. */
export function shouldAck(seq, sliceCount) {
  return seq % ACK_EVERY === 0 || seq === sliceCount
}

export function createFileTransfer(room, {onFileOffer, onFileProgress, onFileDone, onFileFailed}) {
  const fOfferAction = room.makeAction('fOffer')
  const fAnswerAction = room.makeAction('fAnswer')
  const fSliceAction = room.makeAction('fSlice')
  const fAckAction = room.makeAction('fAck')

  const pendingReceivedOffers = new Map() // `${peerId}:${offerId}` -> {name, size, type}
  const offeredFiles = new Map() // offerId -> File (broadcast; not peer-scoped)
  const senderSessions = new Map() // `${peerId}:${offerId}` -> session (upload)
  const receiverSessions = new Map() // `${peerId}:${offerId}` -> session (download)

  // ---- offer / answer ------------------------------------------------

  fOfferAction.onMessage = (payload, {peerId}) => {
    pendingReceivedOffers.set(`${peerId}:${payload.offerId}`, payload)
    onFileOffer?.({peerId, offerId: payload.offerId, name: payload.name, size: payload.size})
  }

  fAnswerAction.onMessage = (payload, {peerId}) => {
    if (!payload.ok) return
    const file = offeredFiles.get(payload.offerId)
    if (!file) return
    startSenderSession(peerId, payload.offerId, file)
  }

  // ---- sender session (per peerId+offerId) ---------------------------

  function resetSenderAckTimer(key) {
    const session = senderSessions.get(key)
    if (!session) return
    clearTimeout(session.ackTimer)
    session.ackTimer = setTimeout(() => failSender(key), ACK_TIMEOUT_MS)
  }

  function failSender(key) {
    const session = senderSessions.get(key)
    if (!session) return
    clearTimeout(session.ackTimer)
    senderSessions.delete(key)
    session.reject(new Error('file transfer failed'))
    onFileFailed?.({peerId: session.peerId, offerId: session.offerId, direction: 'up'})
  }

  async function startSenderSession(peerId, offerId, file) {
    const key = `${peerId}:${offerId}`
    const {sliceCount, lastSliceSize} = planSlices(file.size)
    let resolveDone
    let rejectDone
    const done = new Promise((res, rej) => {
      resolveDone = res
      rejectDone = rej
    })
    const session = {
      peerId,
      offerId,
      size: file.size,
      lastAckBytes: 0,
      ackTimer: null,
      resolve: resolveDone,
      reject: rejectDone
    }
    senderSessions.set(key, session)
    resetSenderAckTimer(key)

    try {
      for (let seq = 1; seq <= sliceCount; seq++) {
        if (!senderSessions.has(key)) return // failed/cleared mid-flight
        const start = (seq - 1) * SLICE_SIZE
        const len = seq === sliceCount ? lastSliceSize : SLICE_SIZE
        const bytes = new Uint8Array(await file.slice(start, start + len).arrayBuffer())
        await fSliceAction.send(bytes, {target: peerId, metadata: {offerId, seq}})
        if (!senderSessions.has(key)) return
        const bytesSent = seq === sliceCount ? file.size : seq * SLICE_SIZE
        onFileProgress?.({peerId, offerId, direction: 'up', pct: pct(bytesSent, file.size)})
      }
      // Don't declare success until the receiver confirms every byte —
      // this is what actually fixes the "resolved but partial" lie.
      await done
      if (!senderSessions.has(key)) return
      clearTimeout(session.ackTimer)
      senderSessions.delete(key)
      onFileDone?.({peerId, offerId, name: file.name})
    } catch {
      failSender(key)
    }
  }

  fAckAction.onMessage = (payload, {peerId}) => {
    const key = `${peerId}:${payload.offerId}`
    const session = senderSessions.get(key)
    if (!session) return
    if (payload.received > session.lastAckBytes) {
      session.lastAckBytes = payload.received
      resetSenderAckTimer(key)
    }
    if (payload.received >= session.size) {
      session.resolve()
    }
  }

  // ---- receiver session (per peerId+offerId) -------------------------

  function resetReceiverAckTimer(key) {
    const session = receiverSessions.get(key)
    if (!session) return
    clearTimeout(session.ackTimer)
    session.ackTimer = setTimeout(() => failReceiver(key), ACK_TIMEOUT_MS)
  }

  function failReceiver(key) {
    const session = receiverSessions.get(key)
    if (!session) return
    clearTimeout(session.ackTimer)
    receiverSessions.delete(key)
    // A prior slice write may already be rejected (e.g. sink error) — this
    // session is being abandoned either way, so swallow it rather than
    // leaving an unhandled rejection behind.
    session.writing?.catch(() => {})
    if (session.sink) session.sink.abort().catch(() => {})
    onFileFailed?.({peerId: session.peerId, offerId: session.offerId, direction: 'down'})
  }

  async function finishReceiver(key) {
    const session = receiverSessions.get(key)
    if (!session) return
    clearTimeout(session.ackTimer)
    receiverSessions.delete(key)
    try {
      await session.writing
      if (session.sink) {
        await session.sink.close()
        onFileDone?.({peerId: session.peerId, offerId: session.offerId, name: session.name, saved: true})
      } else {
        const blob = new Blob(session.parts, {type: session.type})
        onFileDone?.({peerId: session.peerId, offerId: session.offerId, name: session.name, blob})
      }
    } catch {
      onFileFailed?.({peerId: session.peerId, offerId: session.offerId, direction: 'down'})
    }
  }

  fSliceAction.onMessage = (bytes, {peerId, metadata}) => {
    const {offerId, seq} = metadata || {}
    const key = `${peerId}:${offerId}`
    const session = receiverSessions.get(key)
    if (!session) return

    session.bytesReceived += bytes.byteLength
    resetReceiverAckTimer(key)
    session.writing = session.sink
      ? session.writing.then(() => session.sink.write(bytes))
      : session.writing.then(() => {
          session.parts.push(bytes)
        })

    onFileProgress?.({peerId, offerId, direction: 'down', pct: pct(session.bytesReceived, session.size)})

    if (shouldAck(seq, session.sliceCount)) {
      fAckAction.send({offerId, received: session.bytesReceived}, {target: peerId})
    }

    if (session.bytesReceived >= session.size) {
      finishReceiver(key)
    }
  }

  // ---- public API ------------------------------------------------------

  function sendFile(file) {
    const offerId = crypto.randomUUID()
    offeredFiles.set(offerId, file)
    fOfferAction.send({offerId, name: file.name, size: file.size, type: file.type})
    // Returned so the caller (main.js) can track its own "outgoing" file
    // card and match later onFileProgress/onFileDone/onFileFailed events.
    return offerId
  }

  function acceptFile(peerId, offerId, sink) {
    const key = `${peerId}:${offerId}`
    const offer = pendingReceivedOffers.get(key)
    fAnswerAction.send({offerId, ok: true}, {target: peerId})
    if (!offer) return
    pendingReceivedOffers.delete(key)
    const {sliceCount} = planSlices(offer.size)
    receiverSessions.set(key, {
      peerId,
      offerId,
      name: offer.name,
      type: offer.type,
      size: offer.size,
      sliceCount,
      bytesReceived: 0,
      sink: sink || null,
      parts: sink ? null : [],
      writing: Promise.resolve(),
      ackTimer: null
    })
    resetReceiverAckTimer(key)
  }

  function declineFile(peerId, offerId) {
    fAnswerAction.send({offerId, ok: false}, {target: peerId})
    pendingReceivedOffers.delete(`${peerId}:${offerId}`)
  }

  function clearPeer(peerId) {
    // Purge every bit of transfer state tied to a departed peer, and tell
    // the UI about anything that can now never complete:
    //  - offers we received from them but hadn't accepted/declined yet
    //  - our own in-flight receiver sessions from them
    //  - our own in-flight sender sessions to them
    const prefix = `${peerId}:`
    for (const key of Array.from(pendingReceivedOffers.keys())) {
      if (!key.startsWith(prefix)) continue
      pendingReceivedOffers.delete(key)
      onFileFailed?.({peerId, offerId: key.slice(prefix.length), direction: 'down'})
    }
    for (const key of Array.from(receiverSessions.keys())) {
      if (key.startsWith(prefix)) failReceiver(key)
    }
    for (const key of Array.from(senderSessions.keys())) {
      if (key.startsWith(prefix)) failSender(key)
    }
  }

  function clear() {
    pendingReceivedOffers.clear()
    offeredFiles.clear()
    senderSessions.forEach(session => clearTimeout(session.ackTimer))
    senderSessions.clear()
    receiverSessions.forEach(session => {
      clearTimeout(session.ackTimer)
      session.writing?.catch(() => {})
      if (session.sink) session.sink.abort().catch(() => {})
    })
    receiverSessions.clear()
  }

  return {sendFile, acceptFile, declineFile, clearPeer, clear}
}
