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
const MIN_PLATEAU_SHARE = 0.02 // gutter must be at least 2% of page width wide

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

  const zeros: number[] = []
  for (let x = lo; x <= hi; x++) {
    if (countCrossings(words, x) === 0) zeros.push(x)
  }
  if (zeros.length === 0) return null

  // Take the widest contiguous run of zero-crossing positions.
  let bestStart = 0
  let bestLen = 0
  let runStart = 0
  for (let i = 1; i <= zeros.length; i++) {
    const broken = i === zeros.length || zeros[i] !== zeros[i - 1] + 1
    if (broken) {
      const len = i - runStart
      if (len > bestLen) {
        bestLen = len
        bestStart = runStart
      }
      runStart = i
    }
  }

  if (bestLen < width * MIN_PLATEAU_SHARE) return null

  const cut = zeros[bestStart + Math.floor(bestLen / 2)]
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

const groupIntoLines = (words: OcrWord[]): string[] => {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0)
  const lines: OcrWord[][] = []

  for (const word of sorted) {
    const line = lines.find((l) => l.some((w) => overlapsVertically(w, word)))
    if (line) line.push(word)
    else lines.push([word])
  }

  return lines
    .map((l) => [...l].sort((a, b) => a.bbox.x0 - b.bbox.x0))
    .sort((a, b) => a[0].bbox.y0 - b[0].bbox.y0)
    .map((l) => l.map((w) => w.text).join(' '))
}

export const reconstructLines = (words: OcrWord[]): string[] => {
  if (words.length === 0) return []

  const cuts = detectColumnCuts(words)
  if (cuts.length === 0) return groupIntoLines(words)

  const bounds = [-Infinity, ...cuts, Infinity]
  const out: string[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const column = words.filter((w) => midpoint(w) >= bounds[i] && midpoint(w) < bounds[i + 1])
    if (column.length > 0) out.push(...groupIntoLines(column))
  }
  return out
}
