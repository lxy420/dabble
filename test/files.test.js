import {describe, it, expect} from 'vitest'
import {planSlices, pct, shouldAck, SLICE_SIZE, ACK_EVERY} from '../src/net/files.js'

describe('planSlices', () => {
  it('size 0 -> one empty slice (so the protocol still completes)', () => {
    expect(planSlices(0)).toEqual({sliceCount: 1, lastSliceSize: 0})
  })

  it('size smaller than one slice', () => {
    expect(planSlices(500)).toEqual({sliceCount: 1, lastSliceSize: 500})
  })

  it('exact multiple of the slice size', () => {
    expect(planSlices(SLICE_SIZE * 3)).toEqual({sliceCount: 3, lastSliceSize: SLICE_SIZE})
  })

  it('huge file (~600MB), not an exact multiple', () => {
    const size = 600 * 1024 * 1024 + 12345
    const result = planSlices(size)
    expect(result.sliceCount).toBe(Math.ceil(size / SLICE_SIZE))
    expect(result.lastSliceSize).toBe(size - SLICE_SIZE * (result.sliceCount - 1))
    expect(result.lastSliceSize).toBeGreaterThan(0)
    expect(result.lastSliceSize).toBeLessThanOrEqual(SLICE_SIZE)
  })
})

describe('pct', () => {
  it('returns an integer percentage', () => {
    expect(pct(0, 1000)).toBe(0)
    expect(pct(250, 1000)).toBe(25)
    expect(pct(1000, 1000)).toBe(100)
  })

  it('rounds to the nearest integer', () => {
    expect(pct(1, 3)).toBe(33)
    expect(pct(2, 3)).toBe(67)
  })

  it('clamps overshoot to 100', () => {
    expect(pct(1200, 1000)).toBe(100)
  })

  it('clamps undershoot to 0', () => {
    expect(pct(-5, 1000)).toBe(0)
  })

  it('treats total 0 as already complete (100)', () => {
    expect(pct(0, 0)).toBe(100)
  })
})

describe('shouldAck', () => {
  it('is true on every 16th slice', () => {
    expect(shouldAck(ACK_EVERY, 1000)).toBe(true)
    expect(shouldAck(ACK_EVERY * 2, 1000)).toBe(true)
  })

  it('is false on other slices', () => {
    expect(shouldAck(ACK_EVERY - 1, 1000)).toBe(false)
    expect(shouldAck(1, 1000)).toBe(false)
  })

  it('is always true on the last slice, regardless of the schedule', () => {
    expect(shouldAck(17, 17)).toBe(true)
    expect(shouldAck(1, 1)).toBe(true)
  })
})
