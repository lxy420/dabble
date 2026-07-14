// Room code generation and normalization.
// Codes look like "plavi-tigar-42" — adjective-noun-2digits, built from
// small Serbian (Latin script) word lists, kept lowercase ASCII only.

const ADJECTIVES = [
  'plavi', 'crveni', 'zeleni', 'zuti', 'beli', 'crni', 'sivi', 'ljubicasti',
  'brzi', 'spori', 'tihi', 'glasni', 'veseli', 'tuzni', 'hrabri', 'lukavi',
  'divlji', 'pitomi', 'mali', 'veliki', 'stari', 'mladi', 'jaki', 'slabi'
]

const NOUNS = [
  'tigar', 'vuk', 'lav', 'medved', 'orao', 'soko', 'zmaj', 'vitez',
  'kralj', 'ratnik', 'putnik', 'lovac', 'planinar', 'mornar', 'pesnik', 'sanjar',
  'oblak', 'potok', 'kamen', 'plamen', 'vetar', 'talas', 'zvezda', 'mesec'
]

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

export function generateRoomCode() {
  const adjective = pick(ADJECTIVES)
  const noun = pick(NOUNS)
  const digits = String(Math.floor(Math.random() * 100)).padStart(2, '0')
  return `${adjective}-${noun}-${digits}`
}

export function normalizeRoomCode(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}
