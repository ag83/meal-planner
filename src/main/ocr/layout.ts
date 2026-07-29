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
