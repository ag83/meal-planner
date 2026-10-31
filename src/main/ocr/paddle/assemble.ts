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

// Layout boxes are often a little short of the text they describe (the last line of a
// column hangs below its region), and an orphan is appended after every region, i.e. out of
// reading order. A line whose centre sits under or over a region's horizontal span and within
// two line heights of its edge belongs to that region.
const OVERHANG_LINE_HEIGHTS = 2

const overhangRegionIndex = (regions: LayoutRegion[], line: RecognizedLine): number => {
  const { cx, cy } = boxCenter(line.box)
  const reach = (line.box.y1 - line.box.y0) * OVERHANG_LINE_HEIGHTS
  let best = -1
  let bestGap = Infinity
  regions.forEach((region, idx) => {
    if (region.label === 'image' || cx < region.x0 || cx > region.x1) return
    const gap = cy < region.y0 ? region.y0 - cy : cy - region.y1
    if (gap <= reach && gap < bestGap) {
      best = idx
      bestGap = gap
    }
  })
  return best
}

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

// The layout model sometimes returns two narrow text columns as one region. Row grouping would
// then read straight across them, so a gutter running through every row splits the region. A
// gutter must be wider than a word space, and each side must be a real column rather than a
// narrow margin of list numbers or a single short row.
const COLUMN_GAP_LINE_HEIGHTS = 0.6
const MIN_COLUMN_SHARE = 0.25
const MIN_COLUMN_ROWS = 2

const splitColumns = (lines: RecognizedLine[]): RecognizedLine[][] => {
  const heights = lines.map((line) => line.box.y1 - line.box.y0).sort((a, b) => a - b)
  const minGap = heights[Math.floor(heights.length / 2)] * COLUMN_GAP_LINE_HEIGHTS
  const byLeft = [...lines].sort((a, b) => a.box.x0 - b.box.x0)
  const columns: RecognizedLine[][] = []
  let right = -Infinity
  for (const line of byLeft) {
    if (columns.length === 0 || line.box.x0 - right >= minGap) columns.push([line])
    else columns[columns.length - 1].push(line)
    right = Math.max(right, line.box.x1)
  }
  const span = right - byLeft[0].box.x0
  const widthOf = (column: RecognizedLine[]): number =>
    Math.max(...column.map((l) => l.box.x1)) - Math.min(...column.map((l) => l.box.x0))
  const real =
    columns.length > 1 &&
    columns.every((column) => widthOf(column) >= span * MIN_COLUMN_SHARE && groupRows(column).length >= MIN_COLUMN_ROWS)
  return real ? columns : [lines]
}

const toBlock = (lines: TessLine[]): TessBlock => ({ paragraphs: [{ lines }] })

// blocksToLines' DEFAULT_MIN_CONFIDENCE (blocks.ts) assumes Tesseract's 0-100 confidence
// scale; this recognizer reports a 0-1 probability, so it is rescaled here to keep that
// shared filter meaningful without modifying blocks.ts itself.
const toWord = (line: RecognizedLine): OcrWord => ({ text: line.text, confidence: line.confidence * 100 })

const isInside = (inner: LayoutRegion, outer: LayoutRegion): boolean =>
  inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1

// The layout model sometimes reports a column and a sub-span of it as two regions. Left in,
// they split the column's lines between two blocks and the second can be read out of order.
const dropNestedRegions = (regions: LayoutRegion[]): LayoutRegion[] =>
  regions.filter(
    (region, idx) =>
      region.label === 'image' ||
      !regions.some(
        (other, otherIdx) =>
          otherIdx !== idx &&
          other.label !== 'image' &&
          isInside(region, other) &&
          (!isInside(other, region) || otherIdx < idx)
      )
  )

// On a narrow gutter the detector can bridge two columns in one box whose centre lands
// between their regions, where nothing claims it. Cutting it at the region edges before
// recognition gives each column its own piece. Only done when the regions under the box are
// side by side; overlapping ones give no clean place to cut.
export const splitBoxesAtRegions = (boxes: DetectedBox[], allRegions: LayoutRegion[]): DetectedBox[] => {
  const regions = dropNestedRegions(allRegions).filter((region) => region.label !== 'image')
  return boxes.flatMap((box) => {
    const { cy } = boxCenter(box)
    const height = box.y1 - box.y0
    const under = regions
      .filter((region) => cy >= region.y0 && cy <= region.y1)
      .filter((region) => Math.min(box.x1, region.x1) - Math.max(box.x0, region.x0) > height)
      .sort((a, b) => a.x0 - b.x0)
    const sideBySide = under.every((region, i) => i === 0 || region.x0 >= under[i - 1].x1)
    if (under.length < 2 || !sideBySide) return [box]
    return under.map((region) => ({
      x0: Math.max(box.x0, region.x0),
      y0: box.y0,
      x1: Math.min(box.x1, region.x1),
      y1: box.y1
    }))
  })
}

export const assembleBlocks = (lines: RecognizedLine[], allRegions: LayoutRegion[]): TessBlock[] => {
  const regions = dropNestedRegions(allRegions)
  const linesByRegion: RecognizedLine[][] = regions.map(() => [])
  const orphans: RecognizedLine[] = []

  for (const line of lines) {
    const { cx, cy } = boxCenter(line.box)
    const regionIdx = regions.findIndex((region) => region.label !== 'image' && regionContains(region, cx, cy))
    if (regionIdx !== -1) {
      linesByRegion[regionIdx].push(line)
      continue
    }
    // A title set over a photo sits in both an image region and its own title region, and the
    // latter wins above; only a line that no text region claims is photo content.
    const overPhoto = regions.some((region) => region.label === 'image' && regionContains(region, cx, cy))
    if (overPhoto) continue
    const nearIdx = overhangRegionIndex(regions, line)
    if (nearIdx === -1) orphans.push(line)
    else linesByRegion[nearIdx].push(line)
  }

  // A photo spanning both columns covers their gutter, so it would hide the columns from the
  // ordering; it never holds a line, so nothing is lost by leaving it out.
  const textIdx = regions.flatMap((region, idx) => (region.label === 'image' ? [] : [idx]))
  const order = sortReadingOrder(textIdx.map((idx) => [regions[idx].x0, regions[idx].y0, regions[idx].x1, regions[idx].y1] as const)).map(
    (i) => textIdx[i]
  )

  const blocks: TessBlock[] = []
  for (const regionIdx of order) {
    const regionLines = linesByRegion[regionIdx]
    if (regionLines.length === 0) continue
    for (const column of splitColumns(regionLines)) {
      blocks.push(toBlock(groupRows(column).map((row) => ({ words: row.map(toWord) }))))
    }
  }

  // A line no region claims is still recipe text (a table the layout model missed, or a page
  // it found nothing on). Row order is all that is known about it.
  if (orphans.length > 0) {
    blocks.push(toBlock(groupRows(orphans).map((row) => ({ words: row.map(toWord) }))))
  }

  return blocks
}
