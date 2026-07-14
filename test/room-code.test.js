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
