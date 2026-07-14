// ICE configuration. Public STUN handles most home networks; the Metered TURN
// relay is the fallback that makes connections work through strict NAT/CGNAT
// (mobile data, some ISPs). To rotate: create a new credential at
// dashboard.metered.ca -> TURN Server, "Show ICE Servers Array", replace below.
// These are client-side credentials — public by design (visible in any user's
// devtools), scoped to the free 20 GB/mo relay quota.
const METERED = {
  username: '6bd2845d56aaff37b7d715d6',
  credential: 'PyjxTMFXFseMFhQr'
}

export const APP_ID = 'dabble-v1'

export const rtcConfig = {
  iceServers: [
    {urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']},
    ...(METERED.username
      ? [{
          urls: [
            'turn:global.relay.metered.ca:80',
            'turn:global.relay.metered.ca:80?transport=tcp',
            'turn:global.relay.metered.ca:443',
            'turns:global.relay.metered.ca:443?transport=tcp'
          ],
          username: METERED.username,
          credential: METERED.credential
        }]
      : [])
  ]
}
