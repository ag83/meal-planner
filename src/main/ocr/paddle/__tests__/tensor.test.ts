import { describe, it, expect } from 'vitest'
import { rgbaToChwFloat32 } from '../tensor'

describe('rgbaToChwFloat32', () => {
  it('normalizes and transposes a 1x2 RGB image to planar CHW', () => {
    // pixel 0: R=255,G=0,B=0 ; pixel 1: R=0,G=255,B=0  (1 row, 2 cols, 3 channels)
    const pixels = Buffer.from([255, 0, 0, 0, 255, 0])
    const result = rgbaToChwFloat32(pixels, 2, 1, 3, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], false)
    // (255/255 - 0.5)/0.5 = 1 ; (0/255 - 0.5)/0.5 = -1
    expect(Array.from(result)).toEqual([
      1, -1, // R channel, both pixels
      -1, 1, // G channel, both pixels
      -1, -1 // B channel, both pixels
    ])
  })

  it('swaps R and B channel positions when swapRB is true', () => {
    const pixels = Buffer.from([255, 0, 0, 0, 255, 0])
    const result = rgbaToChwFloat32(pixels, 2, 1, 3, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], true)
    expect(Array.from(result)).toEqual([
      -1, -1, // channel 0 is now B (was R)
      -1, 1, // channel 1 is G, unchanged
      1, -1 // channel 2 is now R (was B)
    ])
  })

  it('ignores a 4th alpha channel when channels=4', () => {
    const pixels = Buffer.from([255, 0, 0, 200, 0, 255, 0, 200])
    const result = rgbaToChwFloat32(pixels, 2, 1, 4, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], false)
    expect(result.length).toBe(6)
    expect(Array.from(result)).toEqual([1, -1, -1, 1, -1, -1])
  })
})
