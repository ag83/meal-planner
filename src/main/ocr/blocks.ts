export interface OcrWord {
  text: string
  confidence: number
}

export interface TessLine {
  words: OcrWord[]
}

export interface TessParagraph {
  lines: TessLine[]
}

// Structural subset of tesseract.js output — declared locally so this stays
// testable without importing tesseract types into unit tests.
export interface TessBlock {
  paragraphs: TessParagraph[]
}

export const DEFAULT_MIN_CONFIDENCE = 50

// Tesseract's PSM.AUTO layout analysis already orders blocks and groups them into
// paragraphs and lines; this reads that result rather than re-deriving it from
// word geometry. Blank entries mark paragraph boundaries for postprocess.joinLines.
export const blocksToLines = (
  blocks: TessBlock[],
  minConfidence = DEFAULT_MIN_CONFIDENCE
): string[] => {
  const out: string[] = []

  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      const lines: string[] = []

      for (const line of paragraph.lines) {
        const text = line.words
          .filter((word) => word.confidence >= minConfidence && word.text.trim().length > 0)
          .map((word) => word.text)
          .join(' ')
          .trim()
        if (text.length > 0) lines.push(text)
      }

      if (lines.length === 0) continue
      if (out.length > 0) out.push('')
      out.push(...lines)
    }
  }

  return out
}
