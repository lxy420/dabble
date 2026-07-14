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
    const bytes = new Uint8Array(await file.arrayBuffer())
    await fileAction.send(bytes, {
      target: peerId,
      metadata: {offerId: payload.offerId, name: file.name, type: file.type},
      onProgress: (pct, ctx) => {
        onFileProgress?.({peerId: ctx.peerId, offerId: payload.offerId, direction: 'up', pct})
      }
    })
    pendingSentFiles.delete(payload.offerId)
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

  function clear() {
    pendingReceivedOffers.clear()
    pendingSentFiles.clear()
  }

  return {sendFile, acceptFile, declineFile, clear}
}
