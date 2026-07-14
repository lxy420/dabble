// Media capture and per-peer bandwidth budgeting. No DOM access — only
// MediaDevices/RTCPeerConnection APIs, which are available in any modern
// browser context.

const CAMERA_TOTAL_KBPS = 10_000
const SCREEN_TOTAL_KBPS = 15_000
const CAMERA_MIN_KBPS = 1_500
const SCREEN_MIN_KBPS = 2_500

/**
 * Pure budget calculation: splits total kbps across connected peers,
 * never going below the floor per peer.
 */
export function computeBudget(peerCount) {
  const n = peerCount > 0 ? peerCount : 1
  return {
    cameraKbps: Math.max(CAMERA_MIN_KBPS, Math.floor(CAMERA_TOTAL_KBPS / n)),
    screenKbps: Math.max(SCREEN_MIN_KBPS, Math.floor(SCREEN_TOTAL_KBPS / n))
  }
}

/**
 * High-quality camera + mic capture. Browser negotiates down to device max.
 * Throws (rejects) if the user denies permission.
 */
export async function getCameraStream({video = true, audio = true} = {}) {
  return navigator.mediaDevices.getUserMedia({
    video: video
      ? {width: {ideal: 3840}, height: {ideal: 2160}, frameRate: {ideal: 60}}
      : false,
    audio: audio
      ? {echoCancellation: true, noiseSuppression: true, autoGainControl: true}
      : false
  })
}

/**
 * Screen/window capture with system audio, tuned for detail (text, UI).
 */
export async function getScreenStream() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {width: {ideal: 3840}, height: {ideal: 2160}, frameRate: {ideal: 60}},
    audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}
  })
  const [videoTrack] = stream.getVideoTracks()
  if (videoTrack) videoTrack.contentHint = 'detail'
  return stream
}

/** Stops every track on a stream (camera/mic or screen-share). */
export function stopStream(stream) {
  if (!stream) return
  stream.getTracks().forEach(track => track.stop())
}

/**
 * Applies bitrate caps + degradation preference to every outgoing video
 * sender across all peer connections, based on the current peer count.
 * Screen-share senders (contentHint === 'detail') get the screen cap;
 * camera senders get the camera cap.
 */
export function applyQualityToPeers(getPeersFn, peerCount) {
  const {cameraKbps, screenKbps} = computeBudget(peerCount)
  const peers = getPeersFn() || {}

  Object.values(peers).forEach(pc => {
    pc.getSenders?.().forEach(sender => {
      if (!sender.track || sender.track.kind !== 'video') return
      const isScreen = sender.track.contentHint === 'detail'
      const capKbps = isScreen ? screenKbps : cameraKbps
      try {
        const params = sender.getParameters()
        params.degradationPreference = 'maintain-resolution'
        params.encodings ||= [{}]
        params.encodings[0].maxBitrate = capKbps * 1000
        sender.setParameters(params)
      } catch {
        // setParameters can reject transiently (e.g. mid-renegotiation) — ignore.
      }
    })
  })
}
