// Short WebAudio oscillator blips — no audio files, no imports from net/.
// AudioContext is created lazily on first call so we respect autoplay
// policies (browsers block audio context creation before a user gesture).
let audioCtx = null

function getContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    audioCtx = new Ctx()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

function blip(ctx, freq, startTime, duration, gainPeak) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, startTime)
  gain.gain.setValueAtTime(0, startTime)
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.02)
}

/** Two-tone rising blip: someone joined. */
export function playJoin() {
  const ctx = getContext()
  const now = ctx.currentTime
  blip(ctx, 523.25, now, 0.12, 0.15) // C5
  blip(ctx, 783.99, now + 0.09, 0.16, 0.15) // G5
}

/** Two-tone falling blip: someone left. */
export function playLeave() {
  const ctx = getContext()
  const now = ctx.currentTime
  blip(ctx, 659.25, now, 0.12, 0.15) // E5
  blip(ctx, 392.0, now + 0.09, 0.16, 0.15) // G4
}

/** Single soft blip for a new chat message — only while the tab is hidden. */
export function playMessage() {
  if (!document.hidden) return
  const ctx = getContext()
  blip(ctx, 660, ctx.currentTime, 0.09, 0.1)
}
