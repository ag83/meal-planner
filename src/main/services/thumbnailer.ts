import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

const THUMB_SIZE = 512

export interface ImageMeta {
  width: number
  height: number
  bytes: number
}

export const makeThumbnail = async (
  srcPath: string,
  thumbsDir: string,
  id: string
): Promise<ImageMeta> => {
  const { size: bytes } = await fs.stat(srcPath)

  const image = sharp(srcPath)
  const { width, height } = await image.metadata()

  await image
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(thumbsDir, `${id}.webp`))

  return { width: width ?? 0, height: height ?? 0, bytes }
}
