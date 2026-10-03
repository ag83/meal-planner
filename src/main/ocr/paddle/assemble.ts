import { sortReadingOrder } from './readingOrder'
import type { DetectedBox } from './detect'
import type { LayoutRegion } from './layout'
import type { TessBlock } from '../blocks'

export interface RecognizedLine {
  box: DetectedBox
  text: string
  confidence: number
}

const boxCenter = (box: DetectedBox): { cx: number; cy: number } => ({
  cx: (box.x0 + box.x1) / 2,
  cy: (box.y0 + box.y1) / 2
})

const regionContains = (region: LayoutRegion, cx: number, cy: number): boolean =>
  cx >= region.x0 && cx <= region.x1 && cy >= region.y0 && cy <= region.y1

export const assembleBlocks = (lines: RecognizedLine[], regions: LayoutRegion[]): TessBlock[] => {
  const linesByRegion: RecognizedLine[][] = regions.map(() => [])

  for (const line of lines) {
    const { cx, cy } = boxCenter(line.box)
    const regionIdx = regions.findIndex((region) => region.label !== 'image' && regionContains(region, cx, cy))
    if (regionIdx !== -1) linesByRegion[regionIdx].push(line)
  }

  const order = sortReadingOrder(regions.map((r) => [r.x0, r.y0, r.x1, r.y1] as const))

  const blocks: TessBlock[] = []
  for (const regionIdx of order) {
    const regionLines = linesByRegion[regionIdx]
    if (regionLines.length === 0) continue

    const sortedLines = [...regionLines].sort((a, b) => a.box.y0 - b.box.y0)
    blocks.push({
      paragraphs: [
        {
          // blocksToLines' DEFAULT_MIN_CONFIDENCE (blocks.ts) assumes
          // Tesseract's 0-100 confidence scale; this recognizer reports a
          // 0-1 probability, so it must be rescaled here to keep that
          // shared filter meaningful without modifying blocks.ts itself.
          lines: sortedLines.map((line) => ({
            words: [{ text: line.text, confidence: line.confidence * 100 }]
          }))
        }
      ]
    })
  }

  return blocks
}
