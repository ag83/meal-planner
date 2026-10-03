import { describe, it, expect } from 'vitest'
import { decodeDetection, detectionInputSize } from '../detect'

const buildProbMap = (
  width: number,
  height: number,
  highBoxes: Array<[number, number, number, number]>,
  highValue: number
): Float32Array => {
  const map = new Float32Array(width * height)
  for (const [x0, y0, x1, y1] of highBoxes) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        map[y * width + x] = highValue
      }
    }
  }
  return map
}

describe('decodeDetection', () => {
  it('finds one box above thresh/box_thresh and expands it by unclip_ratio', () => {
    const map = buildProbMap(10, 10, [[2, 2, 5, 5]], 0.9)
    const boxes = decodeDetection(map, 10, 10, 1, 1, { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 })
    expect(boxes).toHaveLength(1)
    // component spans inclusive pixel indices [2,5] on both axes, so in
    // continuous coordinates the box is (2,2)-(6,6): width=4 height=4
    // area=16 perimeter=16, distance = 16 * 1.5 / 16 = 1.5
    const box = boxes[0]
    expect(box.x0).toBeCloseTo(0.5, 5)
    expect(box.y0).toBeCloseTo(0.5, 5)
    expect(box.x1).toBeCloseTo(7.5, 5)
    expect(box.y1).toBeCloseTo(7.5, 5)
  })

  it('rejects a blob whose mean probability is below box_thresh', () => {
    const map = buildProbMap(10, 10, [[2, 2, 5, 5]], 0.4)
    const boxes = decodeDetection(map, 10, 10, 1, 1, { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 })
    expect(boxes).toHaveLength(0)
  })

  it('rescales coordinates back to original image space using ratioW/ratioH', () => {
    const map = buildProbMap(10, 10, [[2, 2, 5, 5]], 0.9)
    // model saw the image resized 2x horizontally, 1x vertically, so ratioW=2 means
    // original = model_coordinate / ratioW
    const boxes = decodeDetection(map, 10, 10, 2, 1, { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 })
    expect(boxes[0].x0).toBeCloseTo(0.25, 5)
    expect(boxes[0].x1).toBeCloseTo(3.75, 5)
    expect(boxes[0].y0).toBeCloseTo(0.5, 5)
    expect(boxes[0].y1).toBeCloseTo(7.5, 5)
  })

  it('returns an empty array when nothing is above thresh', () => {
    const map = new Float32Array(100)
    expect(decodeDetection(map, 10, 10, 1, 1, { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 })).toEqual([])
  })
})

describe('detectionInputSize', () => {
  it('upscales a typical page so its long side reaches 1600, rounded to multiples of 32', () => {
    // At native 1280 (and at 960) the ~16px gutter between columns bridged into
    // one wide box per text row; 1600 separated every column.
    expect(detectionInputSize(1279, 973)).toEqual({ width: 1600, height: 1216 })
  })

  it('upscales a thin strip by the same long-side rule', () => {
    expect(detectionInputSize(400, 32)).toEqual({ width: 1600, height: 128 })
  })

  it('leaves an image already between 1600 and 2560 alone', () => {
    expect(detectionInputSize(2400, 1600)).toEqual({ width: 2400, height: 1600 })
  })

  it('scales down an image whose long side exceeds 2560', () => {
    // a 12MP phone photo at 4000px pinned ~10GB of onnxruntime arena per worker
    expect(detectionInputSize(8000, 4000)).toEqual({ width: 2560, height: 1280 })
  })
})
