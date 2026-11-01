import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { loadSessions, processImage } from '../pipeline'
import type { Sessions } from '../pipeline'

const MODELS_DIR = path.join(process.cwd(), 'resources/models')
const FIXTURE = path.join(process.cwd(), 'src/main/ocr/__tests__/fixtures/images/pork-two-column.png')

describe('processImage', () => {
  let sessions: Sessions

  beforeAll(async () => {
    sessions = await loadSessions(MODELS_DIR)
  }, 60000)

  it('reads a real two-column recipe page into text with a 0-100 confidence like the rest of the app stores', async () => {
    const result = await processImage(sessions, FIXTURE)
    expect(result.text).toContain('Свинина')
    expect(result.confidence).toBeGreaterThan(50)
    expect(result.confidence).toBeLessThanOrEqual(100)
  }, 60000)

  describe('input classes beyond a flat RGB scan', () => {
    let dir: string

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-inputs-'))
    })

    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    const textFrom = async (file: string): Promise<string> => (await processImage(sessions, file)).text

    it('reads an RGBA screenshot', async () => {
      const file = path.join(dir, 'rgba.png')
      await sharp(FIXTURE).ensureAlpha().png().toFile(file)
      expect(await textFrom(file)).toContain('Свинина')
    }, 60000)

    it('reads a page photographed 2 degrees off level', async () => {
      const file = path.join(dir, 'tilted.png')
      await sharp(FIXTURE).rotate(2, { background: '#ffffff' }).png().toFile(file)
      const text = await textFrom(file)
      expect(text).toContain('Свинина')
      expect(text).toContain('чеснока')
    }, 60000)

    it('reads an EXIF-rotated portrait photo', async () => {
      const file = path.join(dir, 'exif.jpg')
      await sharp(FIXTURE).rotate(270).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toFile(file)
      expect(await textFrom(file)).toContain('Свинина')
    }, 60000)
  })
})
