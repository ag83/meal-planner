import { describe, it, expect } from 'vitest'
import { flattenWords, DEFAULT_MIN_CONFIDENCE, detectColumnCuts, reconstructLines } from '../layout'
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

  it('still finds the gutter when one stray word bridges it', () => {
    const words = twoColumnPage()
    words.push({
      text: 'заголовок',
      confidence: 90,
      bbox: { x0: 120, y0: 520, x1: 300, y1: 538 }
    })
    const cuts = detectColumnCuts(words)
    expect(cuts).toHaveLength(1)
    expect(cuts[0]).toBeGreaterThan(180)
    expect(cuts[0]).toBeLessThan(220)
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

describe('reconstructLines', () => {
  it('emits left column fully before right column', () => {
    const padded: OcrWord[] = [
      { text: 'лево1', confidence: 90, bbox: { x0: 0, y0: 0, x1: 150, y1: 18 } },
      { text: 'право1', confidence: 90, bbox: { x0: 300, y0: 0, x1: 450, y1: 18 } },
      { text: 'лево2', confidence: 90, bbox: { x0: 0, y0: 30, x1: 150, y1: 48 } },
      { text: 'право2', confidence: 90, bbox: { x0: 300, y0: 30, x1: 450, y1: 48 } }
    ]
    for (let i = 0; i < 10; i++) {
      const y = 60 + i * 30
      padded.push({ text: `л${i}`, confidence: 90, bbox: { x0: 0, y0: y, x1: 150, y1: y + 18 } })
      padded.push({ text: `п${i}`, confidence: 90, bbox: { x0: 300, y0: y, x1: 450, y1: y + 18 } })
    }
    const lines = reconstructLines(padded)
    const leftIdx = lines.findIndex((l) => l.includes('лево2'))
    const rightIdx = lines.findIndex((l) => l.includes('право1'))
    expect(leftIdx).toBeGreaterThanOrEqual(0)
    expect(rightIdx).toBeGreaterThan(leftIdx)
  })

  it('splits a line merged across the gutter', () => {
    const words: OcrWord[] = []
    for (let i = 0; i < 10; i++) {
      const y = i * 30
      words.push({ text: `лево${i}`, confidence: 90, bbox: { x0: 0, y0: y, x1: 150, y1: y + 18 } })
      words.push({ text: `право${i}`, confidence: 90, bbox: { x0: 300, y0: y, x1: 450, y1: y + 18 } })
    }
    const lines = reconstructLines(words)
    for (const line of lines) {
      expect(line.includes('лево') && line.includes('право')).toBe(false)
    }
  })

  it('orders words within a line by x', () => {
    const words: OcrWord[] = [
      { text: 'второе', confidence: 90, bbox: { x0: 100, y0: 0, x1: 180, y1: 18 } },
      { text: 'первое', confidence: 90, bbox: { x0: 0, y0: 0, x1: 90, y1: 18 } }
    ]
    expect(reconstructLines(words)).toEqual(['первое второе'])
  })

  it('groups words into one line when their boxes overlap vertically', () => {
    const words: OcrWord[] = [
      { text: 'а', confidence: 90, bbox: { x0: 0, y0: 0, x1: 20, y1: 20 } },
      { text: 'б', confidence: 90, bbox: { x0: 30, y0: 3, x1: 50, y1: 23 } }
    ]
    expect(reconstructLines(words)).toEqual(['а б'])
  })

  it('separates words into different lines when boxes do not overlap vertically', () => {
    const words: OcrWord[] = [
      { text: 'верх', confidence: 90, bbox: { x0: 0, y0: 0, x1: 40, y1: 18 } },
      { text: 'низ', confidence: 90, bbox: { x0: 0, y0: 40, x1: 40, y1: 58 } }
    ]
    expect(reconstructLines(words)).toEqual(['верх', 'низ'])
  })

  it('returns an empty array for no words', () => {
    expect(reconstructLines([])).toEqual([])
  })

  it('does not merge the two columns of the liver fixture into one line', () => {
    const lines = reconstructLines(liverWords as OcrWord[])
    const merged = lines.find((l) => l.includes('печень куриная') && l.includes('Тульской'))
    expect(merged).toBeUndefined()
  })
})

// A line of evenly spaced words at a given y.
const rowAt = (label: string, y: number, x0 = 0, x1 = 150): OcrWord => ({
  text: label,
  confidence: 90,
  bbox: { x0, y0: y, x1, y1: y + 18 }
})

describe('reconstructLines paragraph breaks', () => {
  it('inserts no blank line between evenly spaced lines', () => {
    const words = [0, 30, 60, 90, 120].map((y, i) => rowAt(`строка${i}`, y))
    expect(reconstructLines(words)).toEqual([
      'строка0',
      'строка1',
      'строка2',
      'строка3',
      'строка4'
    ])
  })

  it('inserts a blank line where the vertical gap jumps', () => {
    const words = [0, 30, 60, 200, 230, 260].map((y, i) => rowAt(`строка${i}`, y))
    const lines = reconstructLines(words)
    expect(lines).toEqual([
      'строка0',
      'строка1',
      'строка2',
      '',
      'строка3',
      'строка4',
      'строка5'
    ])
  })

  it('inserts a blank line between columns', () => {
    const words: OcrWord[] = []
    for (let i = 0; i < 10; i++) {
      const y = i * 30
      words.push(rowAt(`лево${i}`, y, 0, 150))
      words.push(rowAt(`право${i}`, y, 300, 450))
    }
    const lines = reconstructLines(words)
    const blankIdx = lines.indexOf('')
    expect(blankIdx).toBeGreaterThan(0)
    expect(lines[blankIdx - 1]).toContain('лево')
    expect(lines[blankIdx + 1]).toContain('право')
  })

  it('keeps a headline that spans both columns intact and emits it first', () => {
    const words: OcrWord[] = []
    // Headline across the top: evenly spaced words spanning the gutter.
    'Спагетти с индейкой и грибами'.split(' ').forEach((t, i) => {
      words.push({
        text: t,
        confidence: 90,
        bbox: { x0: 20 + i * 90, y0: 0, x1: 20 + i * 90 + 80, y1: 22 }
      })
    })
    for (let i = 0; i < 10; i++) {
      const y = 60 + i * 30
      words.push(rowAt(`лево${i}`, y, 0, 150))
      words.push(rowAt(`право${i}`, y, 300, 450))
    }
    const lines = reconstructLines(words)
    expect(lines[0]).toBe('Спагетти с индейкой и грибами')
    const leftIdx = lines.findIndex((l) => l.includes('лево0'))
    const rightIdx = lines.findIndex((l) => l.includes('право0'))
    expect(leftIdx).toBeGreaterThan(0)
    expect(rightIdx).toBeGreaterThan(leftIdx)
  })

  it('still splits a line whose halves are separated by a wide gap at the cut', () => {
    const words: OcrWord[] = []
    for (let i = 0; i < 10; i++) {
      const y = i * 30
      words.push(rowAt(`лево${i}`, y, 0, 150))
      words.push(rowAt(`право${i}`, y, 300, 450))
    }
    const lines = reconstructLines(words)
    for (const line of lines) {
      expect(line.includes('лево') && line.includes('право')).toBe(false)
    }
  })

  it('does not emit a leading or trailing blank line', () => {
    const words = [0, 30, 60, 200].map((y, i) => rowAt(`строка${i}`, y))
    const lines = reconstructLines(words)
    expect(lines[0]).not.toBe('')
    expect(lines[lines.length - 1]).not.toBe('')
  })
})
