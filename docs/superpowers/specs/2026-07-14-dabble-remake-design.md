# Dabble Remake — Design Spec

**Date:** 2026-07-14
**Status:** Approved by user

## Goal

Total remake of dabble: an in-browser, serverless P2P communication app for a small group of friends. Ultra-high-quality video/audio/screen streaming, text chat, and unlimited-size file sharing. Join a room via a short code in seconds. Zero self-hosted infrastructure.

## Requirements

- **Room size:** up to 4–5 people, full P2P mesh (every peer connects to every peer).
- **Zero infra:** no servers owned or hosted by the users. Static site hosting only.
- **Connectivity:** must work through strict NATs/CGNAT via a free TURN relay (Metered free tier; user creates one free account and pastes credentials into `src/config.js`).
- **Join flow:** enter a room code (or open a shared `#room-code` URL) → connected within seconds.
- **Chat history:** session-only. Messages vanish when the tab closes. No persistence.
- **Priorities:** connection reliability, stream quality, and speed above all else.

## Architecture

**Approach chosen:** Trystero mesh (over PeerJS cloud and custom WebRTC + Firebase).

- [Trystero](https://github.com/dmotz/trystero) handles signaling over existing public infrastructure (Nostr relays as default strategy, BitTorrent trackers as fallback). No signaling server to host, no PeerJS broker dependency.
- Room code doubles as the encryption password for signaling payloads (Trystero's built-in E2E room encryption): outsiders who don't know the code can't discover or join the room.
- Mesh forms automatically as peers join; Trystero exposes raw `RTCPeerConnection` objects for quality tuning.
- Plain HTML/CSS/JS (no framework, no TypeScript), built with **Vite**.
- Deployed to **GitHub Pages** via GitHub Action on push to `main`.

### Project structure

```
dabble/
├── index.html
├── src/
│   ├── main.js          # bootstrap, screen routing (join → room)
│   ├── config.js        # ICE servers (public STUN + Metered TURN credentials)
│   ├── net/
│   │   ├── room.js      # Trystero room: join/leave, peer lifecycle, reconnect
│   │   ├── media.js     # camera/mic/screen capture, quality tuning, track mgmt
│   │   ├── files.js     # file transfer: chunking, progress, accept/decline
│   │   └── chat.js      # text messages, typing indicator
│   └── ui/              # video grid, chat panel, control bar, settings modal
├── vite.config.js
└── .github/workflows/deploy.yml
```

Each module has one responsibility and a small surface; UI talks to `net/` through explicit functions/events, never the reverse.

## Connection flow

1. Landing screen: name input (persisted in localStorage) + room code input + "Join" / "Create room" (generates a readable code like `plavi-tigar-42`).
2. `joinRoom(config, code)` — Trystero finds peers via public relays; the code is also the signaling encryption password.
3. WebRTC connects via public STUN; falls back to Metered TURN when direct connection is impossible.
4. URL sharing: `site/#room-code` joins directly on open.
5. Reconnect: a dropped peer shows as "reconnecting…" for 15 s; the connection re-establishes automatically if they return, otherwise the tile is removed and a chat notice is posted.

## Stream quality (core of the remake)

Defaults are deliberately unlocked from WebRTC's conservative baselines:

| Stream | Target |
|---|---|
| Camera video | Highest native resolution/framerate the device offers; `maxBitrate` 8–10 Mbps/connection; VP9 preferred, H.264 fallback (`setCodecPreferences`); `degradationPreference: 'maintain-resolution'` |
| Screen share | Up to 4K@60; `contentHint: 'detail'` for sharp text; `maxBitrate` ~15 Mbps; optional "smooth motion" mode (framerate-priority) for gaming |
| Microphone | Opus with echo cancellation + noise suppression |
| System audio (screen share) | Opus stereo 256–510 kbps via SDP munging; echo cancellation/noise suppression OFF so music isn't degraded |

- Screen share is an **additional track** alongside the camera — it does not replace it.
- **Mesh-aware bitrate budgeting:** total upload cap is divided across connected peers (e.g. ~10 Mbps total across 3 peers), recomputed when peers join/leave.
- **Stats overlay:** live per-peer bitrate, resolution, RTT, packet loss, and whether the path is direct or TURN-relayed.

## Features

- Voice/video: mic mute, camera on/off, deafen, input/output device selection.
- Screen share with system audio (tab/window/full screen).
- Text chat: name + timestamp, typing indicator, clickable links, session-only.
- File sharing: drag & drop anywhere or via chat button; recipient sees an offer (name, size) and accepts; chunked transfer over data channels with a progress bar; unlimited size (streamed to disk via browser download, not buffered fully in memory).
- Sound notifications: peer join/leave, incoming message when tab unfocused.
- Settings modal: device pickers, quality preset (Auto / High / Ultra), smooth-motion toggle.

## UI

Dark, Discord-inspired but with its own identity.

- **Join screen:** centered — logo, name input, room code input, Join / Create room.
- **Room:** video grid center (1 = full, 2 = split, 3–4 = 2×2 grid; click tile = fullscreen; active screen share gets the large tile, cameras shrink to a strip), collapsible chat panel right, control bar bottom (mute / camera / screen share / settings / stats / leave; clear states, red = muted/off).
- Responsive for laptop → wide monitor. Mobile is not a priority but must not break.

## Error handling

- No camera/mic permission → room still works (chat + viewing only) with clear guidance to enable.
- Peer drop → 15 s "reconnecting…" → removal + chat notice.
- All relays unreachable (rare) → explicit error message, no infinite spinner.
- Interrupted file transfer → notice + easy re-send.
- Bad/expired TURN credentials → STUN still attempted; warning surfaced in stats overlay.

## Testing

- **Vitest** unit tests for pure logic: file chunking, room-code generation, bitrate budgeting.
- Connection paths verified via a manual smoke-test protocol: two browser profiles locally, then a real-world test between the two users on the deployed site.
- Network code kept thin and isolated so untestable WebRTC surface stays minimal.

## Out of scope (for now)

- Persistent chat history / IndexedDB storage.
- More than ~5 participants (would require an SFU).
- Mobile-first UI.
- Accounts, auth, or any hosted backend beyond free TURN relay.
