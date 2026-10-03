import { rawSharp } from './image'
import type { PreparedImage } from './image'
import type { InferenceSession } from 'onnxruntime-node'
import { Tensor } from 'onnxruntime-node'

export const LAYOUT_INPUT_SIZE = 800

export const LAYOUT_LABELS = [
  'paragraph_title',
  'image',
  'text',
  'number',
  'abstract',
  'content',
  'figure_title',
  'formula',
  'table',
  'reference',
  'doc_title',
  'footnote',
  'header',
  'algorithm',
  'footer',
  'seal',
  'chart',
  'formula_number',
  'aside_text',
  'reference_content'
] as const

const LABEL_MAP: Record<string, 'text' | 'title' | 'image'> = {
  text: 'text',
  paragraph_title: 'title',
  doc_title: 'title',
  image: 'image'
}

export interface LayoutRegion {
  x0: number
  y0: number
  x1: number
  y1: number
  label: 'text' | 'title' | 'image'
}

export const decodeLayout = (rows: Float32Array, numRows: number, threshold = 0.5): LayoutRegion[] => {
  const regions: LayoutRegion[] = []

  for (let i = 0; i < numRows; i++) {
    const base = i * 6
    const labelId = rows[base]
    const score = rows[base + 1]
    if (score < threshold) continue

    const rawLabel = LAYOUT_LABELS[labelId]
    const mappedLabel = LABEL_MAP[rawLabel]
    if (mappedLabel === undefined) continue

    regions.push({
      x0: rows[base + 2],
      y0: rows[base + 3],
      x1: rows[base + 4],
      y1: rows[base + 5],
      label: mappedLabel
    })
  }

  return regions
}

export const runLayout = async (session: InferenceSession, image: PreparedImage): Promise<LayoutRegion[]> => {
  const originalWidth = image.width
  const originalHeight = image.height

  const { data } = await rawSharp(image)
    .resize(LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixelCount = LAYOUT_INPUT_SIZE * LAYOUT_INPUT_SIZE
  const imageTensorData = new Float32Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    const base = i * 3
    imageTensorData[i] = data[base] / 255
    imageTensorData[pixelCount + i] = data[base + 1] / 255
    imageTensorData[pixelCount * 2 + i] = data[base + 2] / 255
  }

  const feeds = {
    image: new Tensor('float32', imageTensorData, [1, 3, LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE]),
    im_shape: new Tensor('float32', new Float32Array([LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE]), [1, 2]),
    scale_factor: new Tensor(
      'float32',
      new Float32Array([LAYOUT_INPUT_SIZE / originalHeight, LAYOUT_INPUT_SIZE / originalWidth]),
      [1, 2]
    )
  }

  const output = await session.run(feeds)
  const rowsOutput = output['fetch_name_0']
  const numRows = rowsOutput.dims[0]

  return decodeLayout(rowsOutput.data as Float32Array, numRows)
}
