import { describe, it, expect } from 'vitest'
import { assembleBlocks } from '../assemble'
import type { LayoutRegion } from '../layout'
import type { RecognizedLine } from '../assemble'

describe('assembleBlocks', () => {
  it('groups lines into their containing region, one paragraph per region', () => {
    const regions: LayoutRegion[] = [
      { x0: 0, y0: 0, x1: 100, y1: 100, label: 'title' },
      { x0: 0, y0: 200, x1: 100, y1: 400, label: 'text' }
    ]
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 10, x1: 90, y1: 30 }, text: 'Title line', confidence: 0.9 },
      { box: { x0: 10, y0: 210, x1: 90, y1: 230 }, text: 'Body line one', confidence: 0.9 },
      { box: { x0: 10, y0: 240, x1: 90, y1: 260 }, text: 'Body line two', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, regions)
    // confidence is rescaled 0-1 -> 0-100 to match blocksToLines'
    // DEFAULT_MIN_CONFIDENCE (blocks.ts), which assumes Tesseract's scale
    expect(blocks).toEqual([
      { paragraphs: [{ lines: [{ words: [{ text: 'Title line', confidence: 90 }] }] }] },
      {
        paragraphs: [
          {
            lines: [
              { words: [{ text: 'Body line one', confidence: 90 }] },
              { words: [{ text: 'Body line two', confidence: 90 }] }
            ]
          }
        ]
      }
    ])
  })

  it('orders lines within a region top-to-bottom regardless of input order', () => {
    const regions: LayoutRegion[] = [{ x0: 0, y0: 0, x1: 100, y1: 400, label: 'text' }]
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 240, x1: 90, y1: 260 }, text: 'second', confidence: 0.9 },
      { box: { x0: 10, y0: 10, x1: 90, y1: 30 }, text: 'first', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, regions)
    expect(blocks[0].paragraphs[0].lines.map((l) => l.words[0].text)).toEqual(['first', 'second'])
  })

  it('produces no block for an image region or a region with no assigned line', () => {
    const regions: LayoutRegion[] = [
      { x0: 0, y0: 0, x1: 100, y1: 100, label: 'image' },
      { x0: 0, y0: 200, x1: 100, y1: 300, label: 'text' } // no lines fall here
    ]
    const lines: RecognizedLine[] = []
    expect(assembleBlocks(lines, regions)).toEqual([])
  })

  it('drops a line whose center falls outside every region', () => {
    const regions: LayoutRegion[] = [{ x0: 0, y0: 0, x1: 100, y1: 100, label: 'text' }]
    const lines: RecognizedLine[] = [{ box: { x0: 500, y0: 500, x1: 600, y1: 520 }, text: 'orphan', confidence: 0.9 }]
    expect(assembleBlocks(lines, regions)).toEqual([])
  })
})
