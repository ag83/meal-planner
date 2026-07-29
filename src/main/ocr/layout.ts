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
