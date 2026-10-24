type Box = readonly [number, number, number, number] // [x0, y0, x1, y1]

const projectionByBoxes = (boxes: Box[], axis: 0 | 1): Int32Array => {
  let maxLength = 0
  for (const box of boxes) {
    maxLength = Math.max(maxLength, box[axis], box[axis + 2])
  }
  const projection = new Int32Array(maxLength)
  for (const box of boxes) {
    const start = Math.max(0, Math.round(box[axis]))
    const end = Math.max(start, Math.round(box[axis + 2]))
    for (let i = start; i < end && i < maxLength; i++) projection[i]++
  }
  return projection
}

const splitProjectionProfile = (values: Int32Array, minGap: number): Array<[number, number]> => {
  const significant: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (values[i] > 0) significant.push(i)
  }
  if (significant.length === 0) return []

  const segments: Array<[number, number]> = []
  let segStart = significant[0]
  let prev = significant[0]
  for (let i = 1; i < significant.length; i++) {
    const idx = significant[i]
    if (idx - prev > minGap) {
      segments.push([segStart, prev + 1])
      segStart = idx
    }
    prev = idx
  }
  segments.push([segStart, prev + 1])
  return segments
}

interface IndexedBox {
  box: Box
  index: number
}

// Columns are found from how much of the page's height covers each x, not from whether any
// box covers it, so a lone title centred over two columns does not hide their gutter.
const GUTTER_COVERAGE_RATIO = 0.1
const MIN_GUTTER_WIDTH = 6

const findGutters = (boxes: IndexedBox[]): Array<[number, number]> => {
  const minX = Math.min(...boxes.map((b) => b.box[0]))
  const maxX = Math.max(...boxes.map((b) => b.box[2]))
  const coverage = new Float64Array(maxX - minX)
  for (const { box } of boxes) {
    for (let x = box[0]; x < box[2]; x++) coverage[x - minX] += box[3] - box[1]
  }
  const limit = Math.max(...coverage) * GUTTER_COVERAGE_RATIO
  const gutters: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i <= coverage.length; i++) {
    const low = i < coverage.length && coverage[i] <= limit
    if (low && start === -1) start = i
    if (!low && start !== -1) {
      if (start > 0 && i < coverage.length && i - start >= MIN_GUTTER_WIDTH) gutters.push([start + minX, i + minX])
      start = -1
    }
  }
  return gutters
}

const largestGap = (intervals: Array<[number, number]>): number =>
  intervals.reduce((gap, [, end], i) => (i + 1 < intervals.length ? Math.max(gap, intervals[i + 1][0] - end) : gap), 0)

const centerY = (b: IndexedBox): number => (b.box[1] + b.box[3]) / 2

// Reads the page column by column when its gutters are wider than the gaps between rows.
// Boxes that cross a gutter (a centred title) are emitted in y order between the column groups.
// Returns false, having emitted nothing, when the page is not laid out that way.
const cutColumnsFirst = (boxes: IndexedBox[], res: number[], minGap: number): boolean => {
  const gutters = findGutters(boxes)
  if (gutters.length === 0) return false
  const yIntervals = splitProjectionProfile(projectionByBoxes(boxes.map((b) => b.box), 1), 1)
  const widestGutter = Math.max(...gutters.map(([start, end]) => end - start))
  if (widestGutter <= largestGap(yIntervals)) return false

  const bridging = boxes
    .filter((b) => gutters.some(([start, end]) => b.box[0] < start && b.box[2] > end))
    .sort((a, b) => centerY(a) - centerY(b))
  const rest = boxes.filter((b) => !bridging.includes(b))
  const columnsOf = (group: IndexedBox[]): Array<[number, number]> =>
    splitProjectionProfile(projectionByBoxes(group.map((b) => b.box), 0), minGap)
  if (rest.length < 2 || columnsOf(rest).length < 2) return false

  let remaining = rest
  for (const title of bridging) {
    const above = remaining.filter((b) => centerY(b) < centerY(title))
    remaining = remaining.filter((b) => centerY(b) >= centerY(title))
    recursiveYxCut(above, res, minGap)
    res.push(title.index)
  }
  const columns = columnsOf(remaining)
  if (columns.length < 2) {
    recursiveYxCut(remaining, res, minGap)
    return true
  }
  for (const [xStart, xEnd] of columns) {
    recursiveYxCut(
      remaining.filter((b) => b.box[0] >= xStart && b.box[0] < xEnd),
      res,
      minGap
    )
  }
  return true
}

const recursiveYxCut = (boxes: IndexedBox[], res: number[], minGap: number): void => {
  if (boxes.length === 0) return
  if (boxes.length > 1 && cutColumnsFirst(boxes, res, minGap)) return

  const ySorted = [...boxes].sort((a, b) => a.box[1] - b.box[1])
  const yProjection = projectionByBoxes(ySorted.map((b) => b.box), 1)
  const yIntervals = splitProjectionProfile(yProjection, 1)
  if (yIntervals.length === 0) return

  for (const [yStart, yEnd] of yIntervals) {
    const rowBoxes = ySorted.filter((b) => b.box[1] >= yStart && b.box[1] < yEnd)
    const xSorted = [...rowBoxes].sort((a, b) => a.box[0] - b.box[0])
    const xProjection = projectionByBoxes(xSorted.map((b) => b.box), 0)
    const xIntervals = splitProjectionProfile(xProjection, minGap)
    if (xIntervals.length === 0) continue

    if (xIntervals.length === 1) {
      res.push(...xSorted.map((b) => b.index))
      continue
    }

    for (const [xStart, xEnd] of xIntervals) {
      const columnBoxes = xSorted.filter((b) => b.box[0] >= xStart && b.box[0] < xEnd)
      recursiveYxCut(columnBoxes, res, minGap)
    }
  }
}

// Layout regions stacked in one column often overlap by a few pixels. No cut separates such a
// pair, and the fallback then reads the wider or further-left one first. Moving the shared edge
// to the middle of the sliver, with a pixel to spare each side for the cut to see, makes them stacked, so the ordinary row cut orders them.
const STACKED_OVERLAP_SHARE = 0.25
const STACKED_MIN_WIDTH_SHARE = 0.5

const separateStackedOverlaps = (boxes: Array<[number, number, number, number]>): void => {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [upper, lower] = boxes[i][1] <= boxes[j][1] ? [boxes[i], boxes[j]] : [boxes[j], boxes[i]]
      const sharedWidth = Math.min(upper[2], lower[2]) - Math.max(upper[0], lower[0])
      const sliver = upper[3] - lower[1]
      const narrower = Math.min(upper[2] - upper[0], lower[2] - lower[0])
      const shorter = Math.min(upper[3] - upper[1], lower[3] - lower[1])
      if (sharedWidth < narrower * STACKED_MIN_WIDTH_SHARE) continue
      if (sliver <= 0 || sliver >= shorter * STACKED_OVERLAP_SHARE || upper[3] >= lower[3]) continue
      const middle = Math.round((upper[3] + lower[1]) / 2)
      upper[3] = middle - 1
      lower[1] = middle + 1
    }
  }
}

export const sortReadingOrder = (boxes: ReadonlyArray<Box>): number[] => {
  // Projection intervals are integer pixel ranges; membership tests compare a
  // box's raw origin against them, so fractional coordinates must be rounded
  // up front or boxes whose origin rounds up fall outside their own interval.
  const rounded = boxes.map(
    (box): [number, number, number, number] => [
      Math.max(0, Math.round(box[0])),
      Math.max(0, Math.round(box[1])),
      Math.round(box[2]),
      Math.round(box[3])
    ]
  )
  separateStackedOverlaps(rounded)
  const indexed = rounded.map((box, index) => ({ box, index }))
  const res: number[] = []
  recursiveYxCut(indexed, res, 1)
  return res
}
