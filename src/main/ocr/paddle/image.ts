import sharp from 'sharp'

export interface PreparedImage {
  data: Buffer
  width: number
  height: number
}

const SKEW_ANALYSIS_WIDTH = 600
const SKEW_MAX_DEGREES = 5
const SKEW_STEP_DEGREES = 0.25
// Below this the page is level enough, and a photo's own content (pictures, borders)
// can otherwise fabricate a small angle.
const SKEW_MIN_DEGREES = 0.5
const SKEW_MIN_GAIN = 1.02

const rowProfileScore = (dark: Int32Array, darkCount: number, width: number, height: number, degrees: number): number => {
  const slope = Math.tan((degrees * Math.PI) / 180)
  const offset = Math.ceil(width * Math.abs(slope))
  const bins = new Float64Array(height + 2 * offset + 1)
  for (let i = 0; i < darkCount; i++) {
    const x = dark[i] % width
    const y = (dark[i] - x) / width
    bins[Math.round(y - x * slope) + offset]++
  }
  let score = 0
  for (let i = 0; i < bins.length; i++) score += bins[i] * bins[i]
  return score
}

// Rows of text make the horizontal ink profile spiky only when the page is level, so the
// tilt is the trial angle that maximises that spikiness. Returns the clockwise rotation
// (in sharp's convention) that levels the page, or 0 when no clear tilt is found.
export const estimateSkewDegrees = (grey: Buffer, width: number, height: number): number => {
  let sum = 0
  for (let i = 0; i < grey.length; i++) sum += grey[i]
  const threshold = (sum / grey.length) * 0.6

  const dark = new Int32Array(grey.length)
  let darkCount = 0
  for (let i = 0; i < grey.length; i++) {
    if (grey[i] < threshold) dark[darkCount++] = i
  }
  if (darkCount === 0) return 0

  const levelScore = rowProfileScore(dark, darkCount, width, height, 0)
  let bestDegrees = 0
  let bestScore = levelScore
  for (let d = -SKEW_MAX_DEGREES; d <= SKEW_MAX_DEGREES + 1e-9; d += SKEW_STEP_DEGREES) {
    const score = rowProfileScore(dark, darkCount, width, height, d)
    if (score > bestScore) {
      bestScore = score
      bestDegrees = d
    }
  }
  if (Math.abs(bestDegrees) < SKEW_MIN_DEGREES || bestScore < levelScore * SKEW_MIN_GAIN) return 0
  return -bestDegrees
}

const toRaw = async (pipeline: sharp.Sharp): Promise<PreparedImage> => {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

export const rawSharp = (image: PreparedImage): sharp.Sharp =>
  sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } })

// Decoded once and shared by detection, layout and every line crop: EXIF-upright, alpha
// flattened onto white, always 3 channels, and levelled when photographed at a slight angle.
export const prepareImage = async (imagePath: string): Promise<PreparedImage> => {
  const upright = await toRaw(
    sharp(imagePath).rotate().flatten({ background: '#ffffff' }).toColourspace('srgb').removeAlpha()
  )

  const analysis = await rawSharp(upright)
    .resize({ width: Math.min(SKEW_ANALYSIS_WIDTH, upright.width) })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const degrees = estimateSkewDegrees(analysis.data, analysis.info.width, analysis.info.height)
  if (degrees === 0) return upright

  return toRaw(rawSharp(upright).rotate(degrees, { background: '#ffffff' }))
}
