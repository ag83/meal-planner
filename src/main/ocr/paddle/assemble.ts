import { sortReadingOrder } from './readingOrder'
import type { DetectedBox } from './detect'
import type { LayoutRegion } from './layout'
import type { OcrWord, TessBlock, TessLine } from '../blocks'

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

// A row is every box whose vertical centre falls inside the row's first box. DB
// splits stylised or wide-spaced lines into several boxes whose y0 differs by a few
// pixels, so ordering by y0 alone interleaves them with the neighbouring row.
const groupRows = (lines: RecognizedLine[]): RecognizedLine[][] => {
  const byCenter = [...lines].sort((a, b) => boxCenter(a.box).cy - boxCenter(b.box).cy)
  const rows: RecognizedLine[][] = []
  for (const line of byCenter) {
    const row = rows[rows.length - 1]
    const { cy } = boxCenter(line.box)
    if (row && cy >= row[0].box.y0 && cy <= row[0].box.y1) row.push(line)
    else rows.push([line])
  }
  return rows.map((row) => row.sort((a, b) => a.box.x0 - b.box.x0))
}

const toBlock = (lines: TessLine[]): TessBlock => ({ paragraphs: [{ lines }] })

// blocksToLines' DEFAULT_MIN_CONFIDENCE (blocks.ts) assumes Tesseract's 0-100 confidence
// scale; this recognizer reports a 0-1 probability, so it is rescaled here to keep that
// shared filter meaningful without modifying blocks.ts itself.
const toWord = (line: RecognizedLine): OcrWord => ({ text: line.text, confidence: line.confidence * 100 })

export const assembleBlocks = (lines: RecognizedLine[], regions: LayoutRegion[]): TessBlock[] => {
  const linesByRegion: RecognizedLine[][] = regions.map(() => [])
  const orphans: RecognizedLine[] = []

  for (const line of lines) {
    const { cx, cy } = boxCenter(line.box)
    const overPhoto = regions.some((region) => region.label === 'image' && regionContains(region, cx, cy))
    if (overPhoto) continue
    const regionIdx = regions.findIndex((region) => region.label !== 'image' && regionContains(region, cx, cy))
    if (regionIdx === -1) orphans.push(line)
    else linesByRegion[regionIdx].push(line)
  }

  const order = sortReadingOrder(regions.map((r) => [r.x0, r.y0, r.x1, r.y1] as const))

  const blocks: TessBlock[] = []
  for (const regionIdx of order) {
    const regionLines = linesByRegion[regionIdx]
    if (regionLines.length === 0) continue
    blocks.push(toBlock(groupRows(regionLines).map((row) => ({ words: row.map(toWord) }))))
  }

  // A line no region claims is still recipe text (a table the layout model missed, or a page
  // it found nothing on). Row order is all that is known about it.
  if (orphans.length > 0) {
    blocks.push(toBlock(groupRows(orphans).map((row) => ({ words: row.map(toWord) }))))
  }

  return blocks
}
