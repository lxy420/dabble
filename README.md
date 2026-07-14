# dabble

Serverless peer-to-peer video chat. No backend, no accounts — pick a name,
share a room code, talk. Video, screen sharing, text chat and file transfer
all flow directly between browsers over WebRTC (via
[trystero](https://github.com/dmotz/trystero) for signaling); nothing you
share ever touches a server you don't control.

## Quickstart

```bash
npm i
npm run dev
```

Open the printed local URL in two browser tabs (or send the link + room
code to a friend) to try it with more than one participant.

```bash
npm test      # unit tests (vitest)
npm run build # production build into dist/
```

## TURN / NAT traversal

STUN alone (already configured) is enough for most connections, but some
networks (symmetric NAT, restrictive corporate firewalls) need a TURN relay
to connect at all. [Metered](https://www.metered.ca/stun-turn) offers a free
TURN tier:

1. Create a free Metered account and grab your TURN username/credential
   from the dashboard (Settings → your app → "Static Auth Secret" or the
   generated username/credential pair).
2. Paste them into `src/config.js`:

   ```js
   const METERED = {
     username: 'your-metered-username',
     credential: 'your-metered-credential'
   }
   ```

3. Rebuild/redeploy. When credentials are present the TURN servers are
   added to the ICE config automatically; when empty, only STUN is used.

## Deploying (GitHub Pages)

The included workflow (`.github/workflows/deploy.yml`) builds the app with
Vite and publishes `dist/` to GitHub Pages on every push to `main`.

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages** and set **Source** to
   **GitHub Actions** (the workflow also passes `enablement: true` to
   `actions/configure-pages`, so Pages gets enabled automatically on the
   first run if you skip this step).
3. Push to `main` — the workflow builds and deploys automatically. The
   site URL appears in the workflow run summary and under
   **Settings → Pages**.

## What's in here

- No framework, no TypeScript — plain ES modules bundled by Vite.
- `src/net/` — the WebRTC/trystero networking facade (rooms, chat, typing,
  file transfer, quality budgeting). Never touches the DOM.
- `src/ui/` — pure DOM factories (join screen, video grid, chat panel,
  control bar, join/leave sounds). Never imports `src/net/`.
- `src/main.js` — the only module that wires `net/` and `ui/` together:
  join flow, camera/mic/screen toggles, reconnect grace period, stats
  overlay, cleanup on leave.

All user-facing text is in Serbian (Latin script).
