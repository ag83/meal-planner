export interface Bbox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  confidence: number
  bbox: Bbox
}

// Structural subset of tesseract.js output — declared locally so the pure layout
// logic stays testable without importing tesseract types into unit tests.
export interface TessBlock {
  paragraphs: { lines: { words: OcrWord[] }[] }[]
}

export const DEFAULT_MIN_CONFIDENCE = 50

export const flattenWords = (
  blocks: TessBlock[],
  minConfidence = DEFAULT_MIN_CONFIDENCE
): OcrWord[] => {
  const out: OcrWord[] = []
  for (const b of blocks) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        for (const w of l.words) {
          if (w.confidence >= minConfidence && w.text.trim().length > 0) {
            out.push({ text: w.text, confidence: w.confidence, bbox: w.bbox })
          }
        }
      }
    }
  }
  return out
}

const MIN_WORDS_FOR_SPLIT = 12
const SEARCH_MARGIN = 0.2 // ignore the outer 20% of page width on each side
const MIN_SIDE_SHARE = 0.08 // each column must hold at least 8% of words
const MIN_PLATEAU_SHARE = 0.01 // gutter must be at least 1% of page width wide
const MIN_PLATEAU_PX = 4
// A headline or stray mark can bridge an otherwise clean gutter, so a real column
// break is the *minimum* of the crossing profile rather than strictly zero.
const CROSSING_TOLERANCE_SHARE = 0.02

const midpoint = (w: OcrWord): number => (w.bbox.x0 + w.bbox.x1) / 2

// A "crossing" is a word whose box strictly spans x. A real gutter has zero.
const countCrossings = (words: OcrWord[], x: number): number =>
  words.filter((w) => w.bbox.x0 < x && w.bbox.x1 > x).length

const findSingleCut = (words: OcrWord[]): number | null => {
  if (words.length < MIN_WORDS_FOR_SPLIT) return null

  const minX = Math.min(...words.map((w) => w.bbox.x0))
  const maxX = Math.max(...words.map((w) => w.bbox.x1))
  const width = maxX - minX
  if (width <= 0) return null

  const lo = Math.round(minX + width * SEARCH_MARGIN)
  const hi = Math.round(maxX - width * SEARCH_MARGIN)

  const profile: { x: number; crossings: number }[] = []
  for (let x = lo; x <= hi; x++) {
    profile.push({ x, crossings: countCrossings(words, x) })
  }
  if (profile.length === 0) return null

  const minCrossings = Math.min(...profile.map((p) => p.crossings))
  const tolerance = Math.max(1, Math.ceil(words.length * CROSSING_TOLERANCE_SHARE))
  if (minCrossings > tolerance) return null

  const candidates = profile.filter((p) => p.crossings === minCrossings).map((p) => p.x)

  // Take the widest contiguous run of best-scoring positions.
  let bestStart = 0
  let bestLen = 0
  let runStart = 0
  for (let i = 1; i <= candidates.length; i++) {
    const broken = i === candidates.length || candidates[i] !== candidates[i - 1] + 1
    if (broken) {
      const len = i - runStart
      if (len > bestLen) {
        bestLen = len
        bestStart = runStart
      }
      runStart = i
    }
  }

  if (bestLen < Math.max(MIN_PLATEAU_PX, width * MIN_PLATEAU_SHARE)) return null

  const cut = candidates[bestStart + Math.floor(bestLen / 2)]
  const left = words.filter((w) => midpoint(w) < cut).length
  const right = words.length - left
  const minSide = words.length * MIN_SIDE_SHARE
  if (left < minSide || right < minSide) return null

  return cut
}

export const detectColumnCuts = (words: OcrWord[]): number[] => {
  const cut = findSingleCut(words)
  return cut === null ? [] : [cut]
}

const VERTICAL_OVERLAP_RATIO = 0.5

const overlapsVertically = (a: OcrWord, b: OcrWord): boolean => {
  const overlap = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0)
  if (overlap <= 0) return false
  const shorter = Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0)
  return shorter > 0 && overlap / shorter >= VERTICAL_OVERLAP_RATIO
}

const PARAGRAPH_GAP_RATIO = 1.8
const MIN_LINES_FOR_GAP_ANALYSIS = 4

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const groupWordsIntoLines = (words: OcrWord[]): OcrWord[][] => {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0)
  const grouped: OcrWord[][] = []

  for (const word of sorted) {
    const line = grouped.find((l) => l.some((w) => overlapsVertically(w, word)))
    if (line) line.push(word)
    else grouped.push([word])
  }

  return grouped
    .map((l) => [...l].sort((a, b) => a.bbox.x0 - b.bbox.x0))
    .sort((a, b) => a[0].bbox.y0 - b[0].bbox.y0)
}

// Blank entries mark paragraph boundaries for postprocess.joinLines. Without them
// every line of a column collapses into one run-on paragraph.
const groupIntoLines = (words: OcrWord[]): string[] => {
  const lines = groupWordsIntoLines(words)

  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const prevBottom = Math.max(...lines[i - 1].map((w) => w.bbox.y1))
    gaps.push(Math.min(...lines[i].map((w) => w.bbox.y0)) - prevBottom)
  }

  const threshold =
    gaps.length >= MIN_LINES_FOR_GAP_ANALYSIS - 1 ? median(gaps) * PARAGRAPH_GAP_RATIO : Infinity

  const out: string[] = []
  lines.forEach((line, i) => {
    if (i > 0 && gaps[i - 1] > threshold) out.push('')
    out.push(line.map((w) => w.text).join(' '))
  })
  return out
}

const SPAN_GAP_RATIO = 3

const lineTop = (l: OcrWord[]): number => Math.min(...l.map((w) => w.bbox.y0))
const lineBottom = (l: OcrWord[]): number => Math.max(...l.map((w) => w.bbox.y1))
const centreY = (w: OcrWord): number => (w.bbox.y0 + w.bbox.y1) / 2

// Baseline intra-column word spacing, measured from gaps that do not straddle the
// cut so that column separation cannot contaminate it.
const typicalWordGap = (lines: OcrWord[][], cut: number): number | null => {
  const gaps: number[] = []
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const prev = line[i - 1]
      const next = line[i]
      const straddles = prev.bbox.x1 <= cut && next.bbox.x0 >= cut
      const gap = next.bbox.x0 - prev.bbox.x1
      if (!straddles && gap > 0) gaps.push(gap)
    }
  }
  return gaps.length > 0 ? median(gaps) : null
}

// A headline runs evenly across the gutter; two columns wrongly merged into one line
// leave a conspicuous gap exactly at the cut. The gap is what tells them apart.
const isSpanningLine = (line: OcrWord[], cut: number, baseline: number | null): boolean => {
  if (baseline === null) return false

  const left = line.filter((w) => midpoint(w) < cut)
  const right = line.filter((w) => midpoint(w) >= cut)
  if (left.length === 0 || right.length === 0) return false

  const gapAtCut = Math.min(...right.map((w) => w.bbox.x0)) - Math.max(...left.map((w) => w.bbox.x1))
  return gapAtCut <= baseline * SPAN_GAP_RATIO
}

export const reconstructLines = (words: OcrWord[]): string[] => {
  if (words.length === 0) return []

  const cuts = detectColumnCuts(words)
  if (cuts.length === 0) return groupIntoLines(words)
  const cut = cuts[0]

  const pageLines = groupWordsIntoLines(words)
  const baseline = typicalWordGap(pageLines, cut)
  const spanning = pageLines.filter((l) => isSpanningLine(l, cut, baseline))
  const columnWords = pageLines.filter((l) => !isSpanningLine(l, cut, baseline)).flat()

  const out: string[] = []
  const pushColumns = (ws: OcrWord[]): void => {
    for (const side of [
      ws.filter((w) => midpoint(w) < cut),
      ws.filter((w) => midpoint(w) >= cut)
    ]) {
      if (side.length === 0) continue
      if (out.length > 0) out.push('')
      out.push(...groupIntoLines(side))
    }
  }

  let prevBottom = -Infinity
  for (const line of spanning) {
    const band = columnWords.filter((w) => centreY(w) >= prevBottom && centreY(w) < lineTop(line))
    pushColumns(band)
    if (out.length > 0) out.push('')
    out.push(line.map((w) => w.text).join(' '))
    prevBottom = lineBottom(line)
  }
  pushColumns(columnWords.filter((w) => centreY(w) >= prevBottom))

  return out
}
