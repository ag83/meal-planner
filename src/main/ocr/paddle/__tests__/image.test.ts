import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prepareImage, estimateSkewDegrees } from '../image'

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-image-'))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const textLikeBars = async (width: number, height: number, rotateDegrees: number): Promise<Buffer> => {
  const bars = Array.from({ length: 10 }, (_, i) => ({
    input: { create: { width: width - 80, height: 10, channels: 3 as const, background: '#000' } },
    left: 40,
    top: 20 + i * 26
  }))
  const flat = await sharp({ create: { width, height, channels: 3, background: '#fff' } })
    .composite(bars)
    .png()
    .toBuffer()
  if (rotateDegrees === 0) return flat
  return sharp(flat).rotate(rotateDegrees, { background: '#fff' }).png().toBuffer()
}

describe('prepareImage', () => {
  it('flattens an RGBA image onto white and always yields 3 channels', async () => {
    const file = path.join(dir, 'rgba.png')
    await sharp({ create: { width: 4, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toFile(file)
    const image = await prepareImage(file)
    expect(image.data.length).toBe(4 * 2 * 3)
    expect(Array.from(image.data.subarray(0, 3))).toEqual([255, 255, 255])
  })

  it('expands a greyscale image to 3 channels', async () => {
    const file = path.join(dir, 'grey.png')
    await sharp({ create: { width: 5, height: 3, channels: 3, background: '#808080' } })
      .greyscale()
      .png()
      .toFile(file)
    const image = await prepareImage(file)
    expect(image.data.length).toBe(5 * 3 * 3)
  })

  it('applies EXIF orientation so a portrait phone photo is upright', async () => {
    const file = path.join(dir, 'exif6.jpg')
    await sharp({ create: { width: 100, height: 50, channels: 3, background: '#fff' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toFile(file)
    const image = await prepareImage(file)
    expect({ width: image.width, height: image.height }).toEqual({ width: 50, height: 100 })
  })

  it('levels a page photographed 3 degrees clockwise', async () => {
    const file = path.join(dir, 'tilted.png')
    fs.writeFileSync(file, await textLikeBars(400, 300, 3))
    const levelled = await prepareImage(file)
    const grey = await sharp(levelled.data, { raw: { width: levelled.width, height: levelled.height, channels: 3 } })
      .greyscale()
      .raw()
      .toBuffer()
    expect(Math.abs(estimateSkewDegrees(grey, levelled.width, levelled.height))).toBeLessThan(0.6)
  })
})

describe('estimateSkewDegrees', () => {
  it('returns about the opposite angle for a tilted page', async () => {
    const { data, info } = await sharp(await textLikeBars(400, 300, 3))
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const angle = estimateSkewDegrees(data, info.width, info.height)
    expect(angle).toBeGreaterThan(-3.6)
    expect(angle).toBeLessThan(-2.4)
  })

  it('returns 0 for an already level page', async () => {
    const { data, info } = await sharp(await textLikeBars(400, 300, 0))
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(estimateSkewDegrees(data, info.width, info.height)).toBe(0)
  })
})
