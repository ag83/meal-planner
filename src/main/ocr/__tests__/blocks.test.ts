import { describe, it, expect } from 'vitest'
import { blocksToLines } from '../blocks'
import type { OcrWord, TessBlock } from '../blocks'

const w = (text: string, confidence = 90): OcrWord => ({ text, confidence })

// paragraphs -> lines -> words
const mkBlock = (paragraphs: OcrWord[][][]): TessBlock => ({
  paragraphs: paragraphs.map((lines) => ({ lines: lines.map((words) => ({ words })) }))
})

describe('blocksToLines', () => {
  it('returns an empty array for no blocks', () => {
    expect(blocksToLines([])).toEqual([])
  })

  it('joins the words of a line with single spaces', () => {
    const blocks = [mkBlock([[[w('соль'), w('и'), w('сахар')]]])]
    expect(blocksToLines(blocks)).toEqual(['соль и сахар'])
  })

  it('keeps each line of a paragraph as its own entry', () => {
    const blocks = [mkBlock([[[w('первая')], [w('вторая')]]])]
    expect(blocksToLines(blocks)).toEqual(['первая', 'вторая'])
  })

  it('separates paragraphs with a blank entry but never leads with one', () => {
    const blocks = [mkBlock([[[w('один')]], [[w('два')]]])]
    expect(blocksToLines(blocks)).toEqual(['один', '', 'два'])
  })

  it('separates paragraphs across different blocks too', () => {
    const blocks = [mkBlock([[[w('блок')]]]), mkBlock([[[w('другой')]]])]
    expect(blocksToLines(blocks)).toEqual(['блок', '', 'другой'])
  })

  it('drops words below the confidence threshold', () => {
    const blocks = [mkBlock([[[w('хорошо', 90), w('мусор', 20)]]])]
    expect(blocksToLines(blocks)).toEqual(['хорошо'])
  })

  it('honours an explicit confidence threshold', () => {
    const blocks = [mkBlock([[[w('a', 60), w('b', 40)]]])]
    expect(blocksToLines(blocks, 50)).toEqual(['a'])
    expect(blocksToLines(blocks, 30)).toEqual(['a b'])
  })

  // Tesseract reports the photo region as a single whitespace word at confidence 95,
  // so emptiness — not confidence — is what must exclude it.
  it('drops a whitespace-only word even at high confidence', () => {
    const blocks = [mkBlock([[[w(' ', 95)]]])]
    expect(blocksToLines(blocks)).toEqual([])
  })

  it('contributes nothing, not even a separator, for a fully filtered block', () => {
    const blocks = [
      mkBlock([[[w('текст')]]]),
      mkBlock([[[w(' ', 95)]]]),
      mkBlock([[[w('дальше')]]])
    ]
    expect(blocksToLines(blocks)).toEqual(['текст', '', 'дальше'])
  })

  it('drops an empty line but keeps the surrounding ones in the same paragraph', () => {
    const blocks = [mkBlock([[[w('до')], [w(' ', 95)], [w('после')]]])]
    expect(blocksToLines(blocks)).toEqual(['до', 'после'])
  })
})
