import path from 'path'
import { describe, it, expect, beforeAll } from 'vitest'
import { loadSessions, processImage } from '../pipeline'
import type { Sessions } from '../pipeline'

const MODELS_DIR = path.join(process.cwd(), 'resources/models')
const FIXTURE = path.join(process.cwd(), 'src/main/ocr/__tests__/fixtures/images/pork-two-column.png')

describe('processImage', () => {
  let sessions: Sessions

  beforeAll(async () => {
    sessions = await loadSessions(MODELS_DIR)
  }, 60000)

  it('reads a real two-column recipe page into text with a 0-1 confidence', async () => {
    const result = await processImage(sessions, FIXTURE)
    expect(result.text).toContain('Свинина')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  }, 60000)
})
