import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import { Tensor } from 'onnxruntime-node'
import { rgbaToChwFloat32 } from './tensor'
import { findConnectedComponents } from './connectedComponents'

export const DET_RESIZE_LONG = 960
export const DET_MEAN: readonly [number, number, number] = [0.485, 0.456, 0.406]
export const DET_STD: readonly [number, number, number] = [0.229, 0.224, 0.225]

export interface DetectedBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface DecodeOptions {
  thresh?: number
  boxThresh?: number
  unclipRatio?: number
}

const roundToMultipleOf32 = (value: number): number => Math.max(32, Math.round(value / 32) * 32)

export const decodeDetection = (
  probMap: Float32Array,
  mapWidth: number,
  mapHeight: number,
  ratioW: number,
  ratioH: number,
  opts: DecodeOptions = {}
): DetectedBox[] => {
  const thresh = opts.thresh ?? 0.3
  const boxThresh = opts.boxThresh ?? 0.6
  const unclipRatio = opts.unclipRatio ?? 1.5

  const mask = new Uint8Array(mapWidth * mapHeight)
  for (let i = 0; i < probMap.length; i++) {
    mask[i] = probMap[i] > thresh ? 1 : 0
  }

  const components = findConnectedComponents(mask, mapWidth, mapHeight)
  const boxes: DetectedBox[] = []

  for (const component of components) {
    let sum = 0
    for (let y = component.minY; y <= component.maxY; y++) {
      for (let x = component.minX; x <= component.maxX; x++) {
        sum += probMap[y * mapWidth + x]
      }
    }
    const area = (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1)
    const meanScore = sum / area
    if (meanScore < boxThresh) continue

    const width = component.maxX - component.minX + 1
    const height = component.maxY - component.minY + 1
    const perimeter = 2 * (width + height)
    const distance = (width * height * unclipRatio) / perimeter

    boxes.push({
      x0: (component.minX - distance) / ratioW,
      y0: (component.minY - distance) / ratioH,
      x1: (component.maxX + 1 + distance) / ratioW,
      y1: (component.maxY + 1 + distance) / ratioH
    })
  }

  return boxes
}

export const preprocessForDetection = async (
  imagePath: string
): Promise<{ tensorData: Float32Array; width: number; height: number; ratioW: number; ratioH: number }> => {
  const image = sharp(imagePath)
  const metadata = await image.metadata()
  const originalWidth = metadata.width ?? 0
  const originalHeight = metadata.height ?? 0
  const longSide = Math.max(originalWidth, originalHeight)
  const scale = DET_RESIZE_LONG / longSide
  const resizedWidth = roundToMultipleOf32(originalWidth * scale)
  const resizedHeight = roundToMultipleOf32(originalHeight * scale)

  const { data } = await image
    .resize(resizedWidth, resizedHeight, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const tensorData = rgbaToChwFloat32(data, resizedWidth, resizedHeight, 3, DET_MEAN, DET_STD, true)

  return {
    tensorData,
    width: resizedWidth,
    height: resizedHeight,
    ratioW: resizedWidth / originalWidth,
    ratioH: resizedHeight / originalHeight
  }
}

export const runDetection = async (session: InferenceSession, imagePath: string): Promise<DetectedBox[]> => {
  const { tensorData, width, height, ratioW, ratioH } = await preprocessForDetection(imagePath)
  const inputName = session.inputNames[0]
  const feeds = { [inputName]: new Tensor('float32', tensorData, [1, 3, height, width]) }
  const output = await session.run(feeds)
  const outputName = session.outputNames[0]
  const probMap = output[outputName].data as Float32Array
  return decodeDetection(probMap, width, height, ratioW, ratioH)
}
