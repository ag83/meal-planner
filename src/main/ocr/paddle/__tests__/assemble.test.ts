import { describe, it, expect } from 'vitest'
import { assembleBlocks, splitBoxesAtRegions } from '../assemble'
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

  it('joins boxes sharing a visual row left-to-right instead of ordering them by y0', () => {
    const regions: LayoutRegion[] = [{ x0: 0, y0: 0, x1: 400, y1: 200, label: 'text' }]
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 52, x1: 150, y1: 80 }, text: 'next row', confidence: 0.9 },
      { box: { x0: 200, y0: 10, x1: 300, y1: 38 }, text: 'right', confidence: 0.9 },
      { box: { x0: 10, y0: 16, x1: 100, y1: 44 }, text: 'left', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, regions)
    expect(blocks[0].paragraphs[0].lines.map((l) => l.words.map((w) => w.text))).toEqual([
      ['left', 'right'],
      ['next row']
    ])
  })

  it('produces no block for an image region or a region with no assigned line', () => {
    const regions: LayoutRegion[] = [
      { x0: 0, y0: 0, x1: 100, y1: 100, label: 'image' },
      { x0: 0, y0: 200, x1: 100, y1: 300, label: 'text' } // no lines fall here
    ]
    const lines: RecognizedLine[] = []
    expect(assembleBlocks(lines, regions)).toEqual([])
  })

  it('keeps a line outside every region in a trailing block instead of dropping it', () => {
    const regions: LayoutRegion[] = [{ x0: 0, y0: 0, x1: 100, y1: 100, label: 'text' }]
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 10, x1: 90, y1: 30 }, text: 'inside', confidence: 0.9 },
      { box: { x0: 500, y0: 500, x1: 600, y1: 520 }, text: 'orphan', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, regions)
    expect(blocks.map((b) => b.paragraphs[0].lines.map((l) => l.words[0].text))).toEqual([['inside'], ['orphan']])
  })

  it('keeps a line that overhangs the bottom of a region in that region', () => {
    const regions: LayoutRegion[] = [
      { x0: 0, y0: 0, x1: 100, y1: 200, label: 'text' },
      { x0: 200, y0: 0, x1: 300, y1: 400, label: 'text' }
    ]
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 10, x1: 90, y1: 40 }, text: 'left top', confidence: 0.9 },
      { box: { x0: 10, y0: 210, x1: 90, y1: 240 }, text: 'left overhang', confidence: 0.9 },
      { box: { x0: 210, y0: 10, x1: 290, y1: 40 }, text: 'right', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, regions)
    expect(blocks.map((b) => b.paragraphs[0].lines.map((l) => l.words[0].text))).toEqual([
      ['left top', 'left overhang'],
      ['right']
    ])
  })

  it('leaves a line beside a region, not under it, as an orphan', () => {
    const regions: LayoutRegion[] = [{ x0: 200, y0: 0, x1: 300, y1: 200, label: 'text' }]
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 210, x1: 90, y1: 240 }, text: 'footer strip', confidence: 0.9 }
    ]
    expect(assembleBlocks(lines, regions)).toHaveLength(1)
    expect(assembleBlocks(lines, regions)[0].paragraphs[0].lines[0].words[0].text).toBe('footer strip')
  })

  it('treats a region nested inside another text region as part of it', () => {
    const regions: LayoutRegion[] = [
      { x0: 0, y0: 0, x1: 100, y1: 300, label: 'text' },
      { x0: 0, y0: 150, x1: 100, y1: 290, label: 'text' }
    ]
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 10, x1: 90, y1: 40 }, text: 'one', confidence: 0.9 },
      { box: { x0: 10, y0: 160, x1: 90, y1: 190 }, text: 'two', confidence: 0.9 },
      { box: { x0: 10, y0: 295, x1: 90, y1: 325 }, text: 'three', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, regions)
    expect(blocks.map((b) => b.paragraphs[0].lines.map((l) => l.words[0].text))).toEqual([['one', 'two', 'three']])
  })

  it('still returns every line, top to bottom, when the layout model finds no regions', () => {
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 40, x1: 90, y1: 60 }, text: 'second row', confidence: 0.9 },
      { box: { x0: 300, y0: 10, x1: 380, y1: 30 }, text: 'first row right', confidence: 0.9 },
      { box: { x0: 10, y0: 10, x1: 90, y1: 30 }, text: 'first row left', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, [])
    expect(blocks[0].paragraphs[0].lines.map((l) => l.words.map((w) => w.text))).toEqual([
      ['first row left', 'first row right'],
      ['second row']
    ])
  })

  it('keeps a title printed over a photograph when a title region claims it', () => {
    const regions: LayoutRegion[] = [
      { x0: 0, y0: 0, x1: 400, y1: 400, label: 'image' },
      { x0: 20, y0: 300, x1: 300, y1: 380, label: 'title' }
    ]
    const lines: RecognizedLine[] = [
      { box: { x0: 30, y0: 310, x1: 290, y1: 350 }, text: 'Свинина', confidence: 0.9 },
      { box: { x0: 30, y0: 50, x1: 90, y1: 70 }, text: 'label on a jar', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, regions)
    expect(blocks.map((b) => b.paragraphs[0].lines.map((l) => l.words[0].text))).toEqual([['Свинина']])
  })

  it('drops a line lying over a photograph', () => {
    const regions: LayoutRegion[] = [{ x0: 0, y0: 0, x1: 100, y1: 100, label: 'image' }]
    const lines: RecognizedLine[] = [{ box: { x0: 10, y0: 10, x1: 90, y1: 30 }, text: 'label on a jar', confidence: 0.9 }]
    expect(assembleBlocks(lines, regions)).toEqual([])
  })
})

describe('splitBoxesAtRegions', () => {
  const columns: LayoutRegion[] = [
    { x0: 0, y0: 0, x1: 100, y1: 200, label: 'text' },
    { x0: 120, y0: 0, x1: 220, y1: 200, label: 'text' }
  ]

  it('cuts a box that bridges the gutter into one piece per column', () => {
    const pieces = splitBoxesAtRegions([{ x0: 5, y0: 150, x1: 215, y1: 180 }], columns)
    expect(pieces).toEqual([
      { x0: 5, y0: 150, x1: 100, y1: 180 },
      { x0: 120, y0: 150, x1: 215, y1: 180 }
    ])
  })

  it('leaves a box inside one column alone, even if it grazes the neighbour', () => {
    const box = { x0: 5, y0: 150, x1: 105, y1: 180 }
    expect(splitBoxesAtRegions([box], columns)).toEqual([box])
  })

  it('leaves a box alone when the layout has no regions', () => {
    const box = { x0: 5, y0: 150, x1: 215, y1: 180 }
    expect(splitBoxesAtRegions([box], [])).toEqual([box])
  })

  it('leaves a box alone when the regions under it overlap each other', () => {
    const overlapping: LayoutRegion[] = [
      { x0: 0, y0: 0, x1: 150, y1: 200, label: 'text' },
      { x0: 100, y0: 0, x1: 220, y1: 200, label: 'text' }
    ]
    const box = { x0: 5, y0: 150, x1: 215, y1: 180 }
    expect(splitBoxesAtRegions([box], overlapping)).toEqual([box])
  })
})
