// File transfer over trystero actions: offer -> accept/decline -> transfer
// with progress -> blob on completion. Split out of room.js to keep that
// module under ~250 lines; wired in via createFileTransfer(room, callbacks).
export function createFileTransfer(room, {onFileOffer, onFileProgress, onFileDone}) {
  const fOfferAction = room.makeAction('fOffer')
  const fAnswerAction = room.makeAction('fAnswer')
  const fileAction = room.makeAction('file')

  const pendingReceivedOffers = new Map() // `${peerId}:${offerId}` -> offer payload
  const pendingSentFiles = new Map() // offerId -> File

  fOfferAction.onMessage = (payload, {peerId}) => {
    pendingReceivedOffers.set(`${peerId}:${payload.offerId}`, payload)
    onFileOffer?.({peerId, offerId: payload.offerId, name: payload.name, size: payload.size})
  }

  fAnswerAction.onMessage = async (payload, {peerId}) => {
    const file = pendingSentFiles.get(payload.offerId)
    if (!file) return
    if (!payload.ok) {
      pendingSentFiles.delete(payload.offerId)
      return
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await fileAction.send(bytes, {
        target: peerId,
        metadata: {offerId: payload.offerId, name: file.name, type: file.type},
        onProgress: (pct, ctx) => {
          onFileProgress?.({peerId: ctx.peerId, offerId: payload.offerId, direction: 'up', pct})
        }
      })
      // Sender-side completion: no blob (blob is only for received files) —
      // lets the sending UI mark the transfer as done.
      onFileDone?.({peerId, offerId: payload.offerId, name: file.name})
    } catch {
      // Peer disconnected mid-transfer (or the file could not be read).
      // Swallow: don't crash, don't leak the pending entry.
    } finally {
      pendingSentFiles.delete(payload.offerId)
    }
  }

  fileAction.onReceiveProgress = (pct, {peerId, metadata}) => {
    onFileProgress?.({peerId, offerId: metadata?.offerId, direction: 'down', pct})
  }

  fileAction.onMessage = (bytes, {peerId, metadata}) => {
    const blob = new Blob([bytes], {type: metadata?.type})
    onFileDone?.({peerId, offerId: metadata?.offerId, blob, name: metadata?.name})
    pendingReceivedOffers.delete(`${peerId}:${metadata?.offerId}`)
  }

  function sendFile(file) {
    const offerId = crypto.randomUUID()
    pendingSentFiles.set(offerId, file)
    fOfferAction.send({offerId, name: file.name, size: file.size, type: file.type})
  }

  function acceptFile(peerId, offerId) {
    fAnswerAction.send({offerId, ok: true}, {target: peerId})
  }

  function declineFile(peerId, offerId) {
    fAnswerAction.send({offerId, ok: false}, {target: peerId})
    pendingReceivedOffers.delete(`${peerId}:${offerId}`)
  }

  function clearPeer(peerId) {
    // Purge transfer state tied to a departed peer. Incoming offers are
    // keyed by peer; sent files are broadcast offers (not peer-scoped), so
    // they are cleaned up when answered, on send failure, or on room leave.
    const prefix = `${peerId}:`
    for (const key of pendingReceivedOffers.keys()) {
      if (key.startsWith(prefix)) pendingReceivedOffers.delete(key)
    }
  }

  function clear() {
    pendingReceivedOffers.clear()
    pendingSentFiles.clear()
  }

  return {sendFile, acceptFile, declineFile, clearPeer, clear}
}
