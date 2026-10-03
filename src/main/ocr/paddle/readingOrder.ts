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

const recursiveYxCut = (boxes: IndexedBox[], res: number[], minGap: number): void => {
  if (boxes.length === 0) return

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

export const sortReadingOrder = (boxes: ReadonlyArray<Box>): number[] => {
  // Projection intervals are integer pixel ranges; membership tests compare a
  // box's raw origin against them, so fractional coordinates must be rounded
  // up front or boxes whose origin rounds up fall outside their own interval.
  const indexed = boxes.map((box, index) => ({
    box: [Math.max(0, Math.round(box[0])), Math.max(0, Math.round(box[1])), Math.round(box[2]), Math.round(box[3])] as const,
    index
  }))
  const res: number[] = []
  recursiveYxCut(indexed, res, 1)
  return res
}
