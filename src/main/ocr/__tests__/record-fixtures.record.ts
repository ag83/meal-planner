import fs from 'fs/promises'
import path from 'path'
import { describe, it, vi } from 'vitest'
import { createWorker, PSM } from 'tesseract.js'
import { preprocessImage } from '../preprocess'
import type { OcrWord, TessBlock } from '../blocks'

// worker.ts imports `electron` for its tessdata cache path. This recorder only
// wants DEFAULT_LANG from it, so stub the module rather than duplicate the
// language string and let it drift from production.
vi.mock('electron', () => ({ app: { getPath: (): string => '/tmp/meal-planner-record' } }))

const { DEFAULT_LANG } = await import('../worker')

const FIXTURES = path.join(process.cwd(), 'src/main/ocr/__tests__/fixtures')

const PAGES = ['beef-three-column', 'pork-two-column']

// Keep only what blocksToLines consumes; coordinates are no longer read by
// anything, and dropping them keeps the fixtures small and readable.
const strip = (blocks: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[]): TessBlock[] =>
  blocks.map((block) => ({
    paragraphs: block.paragraphs.map((paragraph) => ({
      lines: paragraph.lines.map((line) => ({
        words: line.words.map((word) => ({ text: word.text, confidence: word.confidence }))
      }))
    }))
  }))

describe('record OCR fixtures', () => {
  it('regenerates block fixtures from the committed source images', async () => {
    const worker = await createWorker()
    await worker.loadLanguage(DEFAULT_LANG)
    await worker.initialize(DEFAULT_LANG)
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })

    try {
      for (const page of PAGES) {
        const buffer = await preprocessImage(path.join(FIXTURES, 'images', `${page}.png`))
        const { data } = await worker.recognize(buffer)
        const blocks = strip((data.blocks ?? []) as never)
        await fs.writeFile(
          path.join(FIXTURES, `${page}.blocks.json`),
          `${JSON.stringify(blocks, null, 1)}\n`,
          'utf-8'
        )
        console.log(`recorded ${page}: ${blocks.length} blocks`)
      }
    } finally {
      await worker.terminate()
    }
  })
})
