import { rawSharp } from './image'
import type { PreparedImage } from './image'
import type { InferenceSession } from 'onnxruntime-node'
import { Tensor } from 'onnxruntime-node'
import { rgbaToChwFloat32 } from './tensor'
import { findConnectedComponents } from './connectedComponents'

// Measured, not taken from config.json's resize_long=960: on a 1279px three-column page the
// ~16px gutters bridged into single boxes at 960 and 1280 and separated cleanly at 1600+.
export const DET_MIN_LONG_SIDE = 1600
export const DET_MAX_LONG_SIDE = 2560
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
  const boxThresh = opts.boxThresh ?? 0.5
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

export const detectionInputSize = (width: number, height: number): { width: number; height: number } => {
  const longSide = Math.max(width, height)
  const scale = Math.min(Math.max(DET_MIN_LONG_SIDE / longSide, 1), DET_MAX_LONG_SIDE / longSide)
  return { width: roundToMultipleOf32(width * scale), height: roundToMultipleOf32(height * scale) }
}

export const preprocessForDetection = async (
  image: PreparedImage
): Promise<{ tensorData: Float32Array; width: number; height: number; ratioW: number; ratioH: number }> => {
  const originalWidth = image.width
  const originalHeight = image.height
  const { width: resizedWidth, height: resizedHeight } = detectionInputSize(originalWidth, originalHeight)

  const { data } = await rawSharp(image)
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

export const runDetection = async (session: InferenceSession, image: PreparedImage): Promise<DetectedBox[]> => {
  const { tensorData, width, height, ratioW, ratioH } = await preprocessForDetection(image)
  const inputName = session.inputNames[0]
  const feeds = { [inputName]: new Tensor('float32', tensorData, [1, 3, height, width]) }
  const output = await session.run(feeds)
  const outputName = session.outputNames[0]
  const probMap = output[outputName].data as Float32Array
  return decodeDetection(probMap, width, height, ratioW, ratioH)
}
