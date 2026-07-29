import { describe, it, expect } from 'vitest'
import { flattenWords, DEFAULT_MIN_CONFIDENCE, detectColumnCuts } from '../layout'
import type { TessBlock, OcrWord } from '../layout'
import spaghettiWords from './fixtures/spaghetti-words.json'
import liverWords from './fixtures/liver-words.json'

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

// Synthetic two-column page: 20 rows, left column x 0..180, right column x 220..400.
const twoColumnPage = (): OcrWord[] => {
  const words: OcrWord[] = []
  for (let row = 0; row < 20; row++) {
    const y = row * 25
    words.push({ text: `л${row}`, confidence: 90, bbox: { x0: 0, y0: y, x1: 180, y1: y + 18 } })
    words.push({ text: `п${row}`, confidence: 90, bbox: { x0: 220, y0: y, x1: 400, y1: y + 18 } })
  }
  return words
}

const singleColumnPage = (): OcrWord[] => {
  const words: OcrWord[] = []
  for (let row = 0; row < 20; row++) {
    const y = row * 25
    words.push({ text: `с${row}`, confidence: 90, bbox: { x0: 0, y0: y, x1: 400, y1: y + 18 } })
  }
  return words
}

describe('detectColumnCuts', () => {
  it('finds the gutter in a synthetic two-column page', () => {
    const cuts = detectColumnCuts(twoColumnPage())
    expect(cuts).toHaveLength(1)
    expect(cuts[0]).toBeGreaterThan(180)
    expect(cuts[0]).toBeLessThan(220)
  })

  it('returns no cuts for a single-column page', () => {
    expect(detectColumnCuts(singleColumnPage())).toEqual([])
  })

  it('returns no cuts when there are too few words to be confident', () => {
    expect(detectColumnCuts(twoColumnPage().slice(0, 3))).toEqual([])
  })

  it('finds the real gutter in the spaghetti fixture', () => {
    const cuts = detectColumnCuts(spaghettiWords as OcrWord[])
    expect(cuts).toHaveLength(1)
    expect(cuts[0]).toBeGreaterThanOrEqual(208)
    expect(cuts[0]).toBeLessThanOrEqual(226)
  })

  it('finds the real gutter in the liver fixture', () => {
    const cuts = detectColumnCuts(liverWords as OcrWord[])
    expect(cuts).toHaveLength(1)
    expect(cuts[0]).toBeGreaterThanOrEqual(358)
    expect(cuts[0]).toBeLessThanOrEqual(382)
  })
})
