import { describe, it, expect } from 'vitest'
import path from 'path'
import sharp from 'sharp'
import { preprocessImage, UPSCALE } from '../preprocess'

// process.cwd()-relative, matching the established fixture-loading pattern in
// src/main/tags/__tests__/seed-rules.test.ts:19. Avoids __dirname, which is not
// reliably available in Vitest's ESM transform.
const IMAGE = path.join(
  process.cwd(),
  'src/main/ocr/__tests__/fixtures/images/pork-two-column.png'
)

describe('preprocessImage', () => {
  it('upscales by UPSCALE', async () => {
    const original = await sharp(IMAGE).metadata()
    const out = await sharp(await preprocessImage(IMAGE)).metadata()

    expect(out.width).toBe(original.width! * UPSCALE)
  })

  it('desaturates to greyscale', async () => {
    // sharp's .greyscale() equalises R/G/B rather than re-encoding to a
    // single-channel PNG, so the real invariant is equal channel means, not
    // metadata().channels === 1.
    const stats = await sharp(await preprocessImage(IMAGE)).stats()
    const [r, g, b] = stats.channels.map((c) => c.mean)
    expect(r).toBeCloseTo(g, 1)
    expect(g).toBeCloseTo(b, 1)
  })
})
