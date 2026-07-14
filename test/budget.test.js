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
