import { describe, it, expect } from 'vitest'
import { findConnectedComponents } from '../connectedComponents'

const maskFromRows = (rows: string[]): { mask: Uint8Array; width: number; height: number } => {
  const width = rows[0].length
  const height = rows.length
  const mask = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    row.split('').forEach((char, x) => {
      mask[y * width + x] = char === '1' ? 1 : 0
    })
  })
  return { mask, width, height }
}

describe('findConnectedComponents', () => {
  it('finds a single rectangular blob', () => {
    const { mask, width, height } = maskFromRows(['00000', '01110', '01110', '00000'])
    const result = findConnectedComponents(mask, width, height)
    expect(result).toEqual([{ minX: 1, minY: 1, maxX: 3, maxY: 2, pixelCount: 6 }])
  })

  it('finds two separate blobs', () => {
    const { mask, width, height } = maskFromRows(['11000', '00000', '00011'])
    const result = findConnectedComponents(mask, width, height)
    expect(result).toHaveLength(2)
    expect(result).toEqual(
      expect.arrayContaining([
        { minX: 0, minY: 0, maxX: 1, maxY: 0, pixelCount: 2 },
        { minX: 3, minY: 2, maxX: 4, maxY: 2, pixelCount: 2 }
      ])
    )
  })

  it('connects diagonally-touching pixels (8-connectivity)', () => {
    const { mask, width, height } = maskFromRows(['10', '01'])
    const result = findConnectedComponents(mask, width, height)
    expect(result).toEqual([{ minX: 0, minY: 0, maxX: 1, maxY: 1, pixelCount: 2 }])
  })

  it('returns an empty array for an all-zero mask', () => {
    const { mask, width, height } = maskFromRows(['000', '000'])
    expect(findConnectedComponents(mask, width, height)).toEqual([])
  })
})
