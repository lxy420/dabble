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
