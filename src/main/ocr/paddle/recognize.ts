import { rawSharp } from './image'
import type { PreparedImage } from './image'
import type { InferenceSession } from 'onnxruntime-node'
import { Tensor } from 'onnxruntime-node'
import { rgbaToChwFloat32 } from './tensor'
import { ctcGreedyDecode } from './ctcDecode'
import type { DetectedBox } from './detect'

export const RECOGNIZER_HEIGHT = 48
const REC_MEAN: readonly [number, number, number] = [0.5, 0.5, 0.5]
const REC_STD: readonly [number, number, number] = [0.5, 0.5, 0.5]

export const loadDictionary = (fileContents: string): string[] => {
  const lines = fileContents.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export const runRecognition = async (
  session: InferenceSession,
  image: PreparedImage,
  box: DetectedBox,
  dict: readonly string[]
): Promise<{ text: string; confidence: number }> => {
  const imageWidth = image.width
  const imageHeight = image.height

  // DB's unclip expansion (detect.ts) can push a box slightly outside the
  // image bounds (e.g. a negative top near the top edge). sharp.extract()
  // throws on out-of-range regions, so clamp to the real image first.
  const left = Math.max(0, Math.round(box.x0))
  const top = Math.max(0, Math.round(box.y0))
  const right = Math.min(imageWidth, Math.round(box.x1))
  const bottom = Math.min(imageHeight, Math.round(box.y1))
  const cropWidth = Math.max(1, right - left)
  const cropHeight = Math.max(1, bottom - top)
  const targetWidth = Math.max(1, Math.round((cropWidth / cropHeight) * RECOGNIZER_HEIGHT))

  const { data } = await rawSharp(image)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(targetWidth, RECOGNIZER_HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const tensorData = rgbaToChwFloat32(data, targetWidth, RECOGNIZER_HEIGHT, 3, REC_MEAN, REC_STD, true)
  const inputName = session.inputNames[0]
  const feeds = { [inputName]: new Tensor('float32', tensorData, [1, 3, RECOGNIZER_HEIGHT, targetWidth]) }
  const output = await session.run(feeds)
  const outputName = session.outputNames[0]
  const logitsResult = output[outputName]
  const dims = logitsResult.dims
  const timeSteps = dims[1]
  const numClasses = dims[2]

  return ctcGreedyDecode(logitsResult.data as Float32Array, timeSteps, numClasses, dict)
}
