import { describe, it, expect } from 'vitest'
import { flattenWords, DEFAULT_MIN_CONFIDENCE } from '../layout'
import type { TessBlock } from '../layout'

const bbox = (
  x0: number,
  y0: number,
  x1: number,
  y1: number
): { x0: number; y0: number; x1: number; y1: number } => ({ x0, y0, x1, y1 })

const block = (
  words: { text: string; confidence: number; bbox: ReturnType<typeof bbox> }[]
): TessBlock => ({
  paragraphs: [{ lines: [{ words }] }]
})

describe('flattenWords', () => {
  it('flattens the block/paragraph/line/word hierarchy', () => {
    const blocks: TessBlock[] = [
      block([
        { text: 'привет', confidence: 90, bbox: bbox(0, 0, 50, 20) },
        { text: 'мир', confidence: 88, bbox: bbox(60, 0, 90, 20) }
      ])
    ]
    expect(flattenWords(blocks).map((w) => w.text)).toEqual(['привет', 'мир'])
  })

  it('drops words below the confidence floor', () => {
    const blocks: TessBlock[] = [
      block([
        { text: 'хорошо', confidence: 63, bbox: bbox(0, 0, 50, 20) },
        { text: 'мусор', confidence: 11, bbox: bbox(60, 0, 90, 20) }
      ])
    ]
    expect(flattenWords(blocks).map((w) => w.text)).toEqual(['хорошо'])
  })

  it('drops whitespace-only words', () => {
    const blocks: TessBlock[] = [
      block([
        { text: '  ', confidence: 95, bbox: bbox(0, 0, 5, 20) },
        { text: 'текст', confidence: 95, bbox: bbox(10, 0, 60, 20) }
      ])
    ]
    expect(flattenWords(blocks).map((w) => w.text)).toEqual(['текст'])
  })

  it('exposes a confidence floor of 50', () => {
    expect(DEFAULT_MIN_CONFIDENCE).toBe(50)
  })

  it('returns an empty array for no blocks', () => {
    expect(flattenWords([])).toEqual([])
  })
})
