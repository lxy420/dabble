# Dabble MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working MVP of dabble — serverless P2P rooms (up to 5 peers) with high-quality video/audio/screen streaming, text chat, and file sharing, joinable via a room code in seconds.

**Architecture:** Static Vite site. Trystero (nostr strategy) provides signaling over public relays and forms a WebRTC mesh; the room code is both the room id and the signaling encryption password. `src/net/` owns all networking, `src/ui/` owns all DOM; `main.js` wires them. Deployed to GitHub Pages.

**Tech Stack:** Vite 6, trystero (latest, ^0.21), vanilla JS (ES modules, no framework, no TypeScript), Vitest for pure-logic tests, GitHub Actions for deploy.

**Spec:** `docs/superpowers/specs/2026-07-14-dabble-remake-design.md` — read it before starting any task.

## Global Constraints

- No framework, no TypeScript. Plain ES modules.
- No servers: only public STUN + user-supplied Metered TURN credentials in `src/config.js`.
- UI language: Serbian (latin script) for all user-facing copy. Code/comments in English.
- Dark theme only. App name is "dabble" (lowercase).
- `net/` modules must never touch the DOM. `ui/` modules must never import trystero.
- Trystero action names are limited to 12 bytes.
- MVP file transfer may buffer in memory (streaming-to-disk is post-MVP).
- Node 20+. Package manager: npm.

## Trystero API cheatsheet (for implementers)

```js
import {joinRoom, selfId} from 'trystero' // default = nostr strategy

const room = joinRoom(
  {appId: 'dabble-v1', password: roomCode, rtcConfig: {iceServers: [...]}},
  roomCode
)
room.onPeerJoin(peerId => {})
room.onPeerLeave(peerId => {})
room.addStream(mediaStream, null, {kind: 'camera'})   // null = all peers; metadata arrives with onPeerStream
room.removeStream(mediaStream)
room.onPeerStream((stream, peerId, meta) => {})       // meta = {kind: 'camera'|'screen'}
const [sendX, onX, onXProgress] = room.makeAction('x') // name ≤ 12 bytes
sendX(payload)                                         // payload: JSON-serializable, or Blob/ArrayBuffer/Uint8Array (auto-chunked)
sendX(bytes, null, {name, size, type})                 // binary + metadata; onXProgress((pct, peerId, meta) => {})
room.getPeers()                                        // {peerId: RTCPeerConnection}
room.leave()
```

---

### Task 1: Project scaffold, config, styles, deploy workflow

**Files:**
- Create: `package.json`, `vite.config.js`, `.gitignore`
- Create: `index.html` (replaces current single-file app — delete all inline script/style)
- Create: `src/config.js`
- Create: `src/style.css`
- Create: `.github/workflows/deploy.yml`
- Create: `src/main.js` (placeholder that imports style.css and logs boot — Task 4 replaces it)

**Interfaces:**
- Produces: `src/config.js` exporting `export const rtcConfig` and `export const APP_ID = 'dabble-v1'`.
- Produces: CSS custom properties + classes that Task 3 UI relies on (see below).

**Steps:**

- [ ] **Step 1: Init npm project and deps**

```bash
npm init -y
npm i trystero
npm i -D vite vitest
```

Set in `package.json`: `"type": "module"`, scripts `{"dev": "vite", "build": "vite build", "preview": "vite preview", "test": "vitest run"}`.

- [ ] **Step 2: vite.config.js**

```js
import {defineConfig} from 'vite'

export default defineConfig({
  base: './', // relative paths so GitHub Pages subpath works
  build: {target: 'es2022'}
})
```

- [ ] **Step 3: .gitignore** with `node_modules`, `dist`.

- [ ] **Step 4: src/config.js**

```js
// ICE configuration. STUN works out of the box; TURN requires free Metered
// credentials (https://www.metered.ca/stun-turn) pasted below.
const METERED = {
  username: '', // <-- paste Metered username
  credential: '' // <-- paste Metered credential
}

export const APP_ID = 'dabble-v1'

export const rtcConfig = {
  iceServers: [
    {urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']},
    ...(METERED.username
      ? [{
          urls: [
            'turn:standard.relay.metered.ca:80',
            'turn:standard.relay.metered.ca:443',
            'turns:standard.relay.metered.ca:443?transport=tcp'
          ],
          username: METERED.username,
          credential: METERED.credential
        }]
      : [])
  ]
}
```

- [ ] **Step 5: index.html** — semantic shell only, no inline JS/CSS:

```html
<!doctype html>
<html lang="sr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>dabble</title>
</head>
<body>
  <div id="app">
    <section id="join-screen"></section>
    <section id="room-screen" hidden>
      <main id="video-grid"></main>
      <aside id="chat-panel"></aside>
      <footer id="control-bar"></footer>
    </section>
  </div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 6: src/style.css** — full dark theme. Define custom properties on `:root`:

```css
:root {
  --bg: #0f1117;
  --bg-raised: #171a23;
  --bg-input: #0b0d12;
  --border: #262b38;
  --text: #e6e8ee;
  --text-dim: #8b90a0;
  --accent: #7c5cff;
  --accent-hover: #9277ff;
  --danger: #f0475c;
  --ok: #3ddc97;
  --radius: 12px;
  --font: system-ui, 'Segoe UI', sans-serif;
}
```

Layout contract for Task 3 (write these now):
- `#room-screen` is a CSS grid: `grid-template-columns: 1fr 320px; grid-template-rows: 1fr 72px;` — video grid spans left column, chat panel spans right column full height, control bar bottom-left. When `#room-screen.chat-hidden`, columns become `1fr 0`.
- `#video-grid` is a responsive grid of `.tile` elements: 1 tile = full, 2 = two columns, 3-4 = 2×2 (use `data-count` attribute on `#video-grid` set by UI code).
- `.tile` contains `video` (object-fit: cover, camera mirrored via `.tile.local.camera video {transform: scaleX(-1)}`) and `.tile-name` label overlay bottom-left. `.tile.screen video {object-fit: contain}`.
- Buttons: `.btn` base, `.btn-danger` red, `.btn.active` accent background, `.btn.off` (muted/camera-off state) danger-tinted.
- Basic styles for inputs, chat messages `.msg` (`.msg-author`, `.msg-time`, `.msg-body`), file transfer card `.file-card` with `progress` element.

- [ ] **Step 7: placeholder src/main.js**

```js
import './style.css'
console.log('dabble boot')
```

- [ ] **Step 8: .github/workflows/deploy.yml**

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: {node-version: 20}
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: {path: dist}
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 9: Verify** — `npm run dev` starts and serves the page with dark background; `npm run build` succeeds.

- [ ] **Step 10: Commit** — `git add -A && git commit -m "feat: scaffold Vite project, config, theme, deploy workflow"`.

---

### Task 2: Networking layer (`src/net/`)

**Files:**
- Create: `src/net/room.js`, `src/net/media.js`, `src/net/chat.js`, `src/net/files.js`, `src/net/room-code.js`
- Test: `test/room-code.test.js`, `test/budget.test.js`

**Interfaces (Produces — Task 3/4 depend on these exact signatures):**

```js
// room-code.js
generateRoomCode() // → 'plavi-tigar-42' style string: adjective-noun-2digits, from built-in Serbian word lists
normalizeRoomCode(raw) // trim, lowercase, collapse spaces to '-'

// room.js — the single networking facade the UI uses
createRoom(roomCode, displayName) // → roomApi
roomApi = {
  selfId,                       // string
  join(),                       // starts trystero join; returns void
  leave(),
  // callbacks (assign before join): each is (payload) => void
  onPeerJoined,   // ({peerId, name})
  onPeerLeft,     // ({peerId})
  onPeerStream,   // ({peerId, stream, kind}) kind: 'camera'|'screen'
  onPeerStreamEnded, // ({peerId, kind})
  onChat,         // ({peerId, name, text, ts})
  onTyping,       // ({peerId, isTyping})
  onFileOffer,    // ({peerId, offerId, name, size}) — UI must call acceptFile/declineFile
  onFileProgress, // ({peerId, offerId, direction: 'up'|'down', pct})
  onFileDone,     // ({peerId, offerId, blob, name}) blob only for received files
  onStats,        // ({peerId, stats: {kbps, rtt, res, relay}}) emitted ~1/s per peer
  // senders
  sendChat(text),
  sendTyping(isTyping),
  sendFile(file),               // File object; offers to all peers
  acceptFile(peerId, offerId),
  declineFile(peerId, offerId),
  shareStream(stream, kind),    // adds stream to all peers (and future joiners)
  unshareStream(stream),
  peerCount()                   // number of connected peers
}

// media.js
getCameraStream({video = true, audio = true}) // high-quality constraints; throws on denial
getScreenStream()             // getDisplayMedia w/ system audio, 4K@60, contentHint 'detail'
stopStream(stream)            // stops all tracks
applyQualityToPeers(getPeersFn, peerCount) // sets per-sender maxBitrate + degradationPreference on every RTCPeerConnection
computeBudget(peerCount)      // pure: → {cameraKbps, screenKbps} per-peer caps from totals (camera total 10_000, screen total 15_000, min 1_500/2_500)
```

**Implementation notes:**

- `room.js` wraps trystero. Actions: `makeAction('chat')`, `('typing')`, `('name')`, `('fOffer')`, `('fAnswer')`, `('file')`. On peer join: send own name via `name` action, re-share any currently shared streams to the new peer specifically (`room.addStream(stream, peerId, {kind})`), and call `applyQualityToPeers`.
- Names: keep `Map<peerId, name>`; emit `onPeerJoined` only once the name arrives (or after 2 s fallback with name `'gost'`).
- File flow: `sendFile` → generate `offerId` (crypto.randomUUID), send `fOffer {offerId, name, size, type}`. Receiver UI calls `acceptFile` → sends `fAnswer {offerId, ok: true}` → sender transmits with `sendFileAction(new Uint8Array(await file.arrayBuffer()), peerId, {offerId, name, type})`; both sides get progress via the action's progress callback → forward to `onFileProgress`. On receive completion build `new Blob([bytes], {type})` → `onFileDone`.
- Stats: `setInterval` 1 s, for each pc from `room.getPeers()` call `pc.getStats()`, extract outbound-rtp video bitrate (delta bytesSent), `candidate-pair` currentRoundTripTime, frame dimensions, and whether selected candidate is `relay` → emit `onStats`.
- `media.js` camera constraints: `{video: {width: {ideal: 3840}, height: {ideal: 2160}, frameRate: {ideal: 60}}, audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}}` — browser negotiates down to device max. Screen: `getDisplayMedia({video: {width: {ideal: 3840}, height: {ideal: 2160}, frameRate: {ideal: 60}}, audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}})`, then set `track.contentHint = 'detail'` on the video track.
- `applyQualityToPeers`: for each pc, for each `pc.getSenders()` with a video track: `const p = sender.getParameters(); p.degradationPreference = 'maintain-resolution'; (p.encodings ||= [{}])[0].maxBitrate = capKbps * 1000; sender.setParameters(p)`. Screen-share senders identified by `sender.track.contentHint === 'detail'` get the screen cap, others the camera cap. Wrap per-sender in try/catch (setParameters can reject transiently).
- `chat.js` may be folded into `room.js` if under ~50 lines total; do not create ceremony.

**Steps:**

- [ ] **Step 1: Write failing tests** for the two pure functions:

```js
// test/room-code.test.js
import {describe, it, expect} from 'vitest'
import {generateRoomCode, normalizeRoomCode} from '../src/net/room-code.js'

describe('generateRoomCode', () => {
  it('matches adjective-noun-NN shape', () => {
    expect(generateRoomCode()).toMatch(/^[a-z]+-[a-z]+-\d{2}$/)
  })
  it('produces varied codes', () => {
    const codes = new Set(Array.from({length: 20}, generateRoomCode))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('normalizeRoomCode', () => {
  it('lowercases, trims, collapses spaces', () => {
    expect(normalizeRoomCode('  Plavi Tigar 42 ')).toBe('plavi-tigar-42')
  })
})
```

```js
// test/budget.test.js
import {describe, it, expect} from 'vitest'
import {computeBudget} from '../src/net/media.js'

describe('computeBudget', () => {
  it('gives full budget to a single peer', () => {
    expect(computeBudget(1)).toEqual({cameraKbps: 10000, screenKbps: 15000})
  })
  it('splits across peers', () => {
    expect(computeBudget(4)).toEqual({cameraKbps: 2500, screenKbps: 3750})
  })
  it('never goes below the floor', () => {
    expect(computeBudget(10).cameraKbps).toBe(1500)
    expect(computeBudget(10).screenKbps).toBe(2500)
  })
  it('treats 0 peers as 1', () => {
    expect(computeBudget(0)).toEqual({cameraKbps: 10000, screenKbps: 15000})
  })
})
```

- [ ] **Step 2: Run `npm test`** — expect FAIL (modules missing).
- [ ] **Step 3: Implement** `room-code.js` (word lists ~24 adjectives, ~24 nouns, Serbian latin, lowercase ASCII only), `media.js`, `room.js` per notes above.
- [ ] **Step 4: Run `npm test`** — expect PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: networking layer — trystero room, media quality, files, chat"`.

---

### Task 3: UI layer (`src/ui/`)

**Files:**
- Create: `src/ui/join-screen.js`, `src/ui/video-grid.js`, `src/ui/chat-panel.js`, `src/ui/control-bar.js`, `src/ui/sounds.js`
- Modify: `src/style.css` (extend as needed, keep the Task 1 contract)

**Interfaces:**
- Consumes: only DOM + the callback payload shapes from Task 2 (payloads passed in by main.js — UI never imports `net/`).
- Produces (exact exports main.js wires in Task 4):

```js
// join-screen.js
renderJoinScreen({onJoin})  // onJoin({name, code}); handles: name input (localStorage 'dabble-name'), code input, 'Upadni' btn, 'Napravi sobu' btn (fills input w/ generated code passed via opts.generateCode), reads location.hash for prefilled code
// video-grid.js
createVideoGrid(rootEl) // → {addTile({peerId, stream, kind, name, local}), removeTile(peerId, kind), setName(peerId, name), setCount()} — click tile toggles fullscreen; screen tiles get .screen class and grid priority
// chat-panel.js
createChatPanel(rootEl, {onSend, onSendFile, onAcceptFile, onDeclineFile})
  // → {addMessage({name, text, ts, self}), addNotice(text), setTyping(names[]),
  //    addFileCard({offerId, peerId, name, size, direction, incoming}) → cardApi {setProgress(pct), setDone(blobUrl?), setDeclined()}}
// control-bar.js
createControlBar(rootEl, {onToggleMic, onToggleCam, onToggleScreen, onToggleChat, onLeave})
  // → {setMic(on), setCam(on), setScreen(on)}
// sounds.js
playJoin(), playLeave(), playMessage() // WebAudio oscillator blips, no audio files
```

**Details:**
- Join screen copy (Serbian): title "dabble", inputs "tvoje ime", "kod sobe", buttons "Upadni", "Napravi sobu". Show generated/entered code prominently after join via URL hash (`location.hash = code`).
- Chat: Enter sends; drag & drop file anywhere on room screen opens send flow (dispatch to onSendFile); file card shows name, human size (KB/MB/GB), progress bar; incoming offers show "Prihvati" / "Odbij" buttons; completed downloads render an `<a download>` "Sačuvaj" link from the blob URL.
- Control bar buttons with SVG inline icons + tooltips: mikrofon, kamera, deli ekran, chat, izađi. Off states use `.off` class (red-tinted).
- Timestamps rendered as `HH:MM`.
- `playMessage()` only when `document.hidden`.

**Steps:**

- [ ] **Step 1: Implement all five modules** per contract.
- [ ] **Step 2: Visual check** — temporary harness in main.js or manual: render join screen, then room screen with 2 fake tiles (use `canvas.captureStream()` for a fake video), fake chat messages, verify layout at 1280×800 and 1920×1080. Remove harness after.
- [ ] **Step 3: Commit** — `git commit -m "feat: UI — join screen, video grid, chat panel, control bar"`.

---

### Task 4: Wiring (`src/main.js`), reconnect handling, smoke test

**Files:**
- Modify: `src/main.js` (replace placeholder)
- Modify: any small gaps discovered in net/ui during wiring

**Interfaces:**
- Consumes: everything from Tasks 2 & 3, exactly as specified.

**Behavior to implement:**

1. Boot: render join screen (pass `generateCode: generateRoomCode`). If `location.hash` has a code, prefill.
2. On join: `normalizeRoomCode`, store name, `createRoom(code, name)`, wire ALL callbacks to UI, `room.join()`, swap screens, set `location.hash`.
3. Acquire camera+mic via `getCameraStream()`; on failure (denied/absent) continue chat-only with a notice "Kamera/mikrofon nedostupni — možeš da pratiš i pišeš." Local tile shows own stream (muted video element).
4. `shareStream(camStream, 'camera')` once acquired.
5. Control bar: mic toggle = enable/disable audio track; cam toggle = enable/disable video track; screen toggle = `getScreenStream()` → `shareStream(s, 'screen')` + local screen tile; on native "stop sharing" (`track.onended`) or button → `unshareStream`, remove tile.
6. Peer events → tiles, chat notices ("X je upao", "X je izašao"), join/leave sounds.
7. `onPeerStreamEnded` → remove that tile.
8. File flow wired end-to-end (offer → accept → progress → download link).
9. Stats: `onStats` → update small text line in each remote tile (`720p · 4.2 Mbps · 23 ms · direct|relay`) toggled by a stats button in control bar.
10. Leave button → `room.leave()`, stop all streams, `location.hash = ''`, back to join screen.
11. `beforeunload` → `room.leave()`.
12. Reconnect semantics (MVP): trystero re-announces peers automatically; on `onPeerLeft` keep the tile with a "ponovo se povezuje…" overlay for 15 s (timer), remove after. If same peer id rejoins within 15 s, clear overlay.

**Steps:**

- [ ] **Step 1: Implement wiring** per behaviors 1-12.
- [ ] **Step 2: Run `npm test` && `npm run build`** — both must pass.
- [ ] **Step 3: Two-tab smoke test** — `npm run dev`, open two browser tabs (second in incognito/other profile so devices differ), same room code: verify (a) both peers appear with video, (b) chat both directions, (c) typing indicator, (d) file send/accept/download works with a ~50 MB file, (e) screen share appears as extra tile and stops cleanly, (f) leave cleans up, (g) stats line shows plausible numbers.
- [ ] **Step 4: Update README.md** — what it is, `npm i && npm run dev`, how to get Metered TURN creds and paste into `src/config.js`, how deploy works (GitHub Pages: enable Pages → Source: GitHub Actions).
- [ ] **Step 5: Commit** — `git commit -m "feat: wire app — join flow, streams, chat, files, stats, reconnect"`.

---

## Post-MVP (explicitly NOT in this plan)

Device pickers/settings modal, quality presets UI, opus SDP tuning, VP9 codec preference forcing, streaming files to disk, deafen, IndexedDB history.

## Self-review notes

- Spec coverage: connection/rooms (T2/T4), quality caps+degradation (T2), screen share w/ system audio (T2/T4), chat+typing (T2/T3/T4), files w/ progress (T2/T3/T4), stats overlay (T4), reconnect grace (T4), deploy (T1), error handling for permission denial & transfer (T4/T3). Settings modal & device pickers deferred to post-MVP per user's ASAP directive — documented above.
- Type consistency: callback payload shapes defined once in Task 2 and consumed verbatim in Tasks 3-4.
