import fs from 'fs/promises'
import path from 'path'
import { describe, it } from 'vitest'
import { loadSessions, recognizeBlocks } from '../paddle/pipeline'

const FIXTURES = path.join(process.cwd(), 'src/main/ocr/__tests__/fixtures')
const MODELS_DIR = path.join(process.cwd(), 'resources/models')

const PAGES = ['beef-three-column', 'pork-two-column', 'mexican-soup-boxed']

describe('record OCR fixtures', () => {
  it('regenerates block fixtures from the committed source images', async () => {
    const sessions = await loadSessions(MODELS_DIR)

    for (const page of PAGES) {
      const blocks = await recognizeBlocks(sessions, path.join(FIXTURES, 'images', `${page}.png`))
      await fs.writeFile(
        path.join(FIXTURES, `${page}.blocks.json`),
        `${JSON.stringify(blocks, null, 1)}\n`,
        'utf-8'
      )
      console.log(`recorded ${page}: ${blocks.length} blocks`)
    }
  })
})
