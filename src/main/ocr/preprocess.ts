import sharp from 'sharp'

export const UPSCALE = 2

// Screenshots run 8-12px x-height; Tesseract wants >=20px. Upscaling also recovers
// stylised headings that are otherwise dropped entirely.
export const preprocessImage = async (imagePath: string): Promise<Buffer> => {
  const image = sharp(imagePath)
  const { width } = await image.metadata()
  if (!width) return image.greyscale().normalise().toBuffer()
  return image
    .resize({ width: width * UPSCALE, kernel: 'lanczos3' })
    .greyscale()
    .normalise()
    .toBuffer()
}
