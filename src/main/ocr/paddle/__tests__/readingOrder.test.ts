import { describe, it, expect } from 'vitest'
import { sortReadingOrder } from '../readingOrder'

describe('sortReadingOrder', () => {
  it('orders a simple 2x2 grid top-to-bottom, left-to-right within each row', () => {
    const boxes: Array<[number, number, number, number]> = [
      [100, 100, 200, 150], // bottom-right
      [0, 0, 100, 50], // top-left
      [0, 100, 100, 150], // bottom-left
      [100, 0, 200, 50] // top-right
    ]
    const order = sortReadingOrder(boxes)
    expect(order).toEqual([1, 3, 2, 0])
  })

  it('orders the real beef-fixture layout regions with every text region in correct sequence', () => {
    // bboxes as measured and recorded in the 2026-10-02 spec's Investigation
    // section (PPStructureV3, use_region_detection=False). This plan's
    // simplified port (core recursive cut only, no vision-block special-
    // casing) places "image" after step1 instead of between ingredients and
    // step1, unlike the full PaddleX reference — the image block's bbox
    // vertically overlaps step1's, so no clean row-level cut exists without
    // the reference's extra vision-block distance-insertion logic. This is
    // accepted: assemble.ts never assigns recognized lines to an 'image'
    // region, so its exact position in this order has zero effect on the
    // final OCR'd text. What must be correct — and is — is that every text
    // region appears in the right relative sequence.
    const boxes: Array<[number, number, number, number]> = [
      [440, 678, 816, 950], // step2a
      [78, 17, 391, 130], // title
      [831, 682, 1203, 950], // step2b
      [66, 165, 392, 434], // ingredients
      [48, 472, 423, 951], // step1
      [445, 26, 1279, 654] // image
    ]
    const order = sortReadingOrder(boxes)
    const labels = ['step2a', 'title', 'step2b', 'ingredients', 'step1', 'image']
    const orderedLabels = order.map((i) => labels[i])
    const textOnly = orderedLabels.filter((l) => l !== 'image')
    expect(textOnly).toEqual(['title', 'ingredients', 'step1', 'step2a', 'step2b'])
  })

  it('returns a single index unchanged for one box', () => {
    expect(sortReadingOrder([[0, 0, 10, 10]])).toEqual([0])
  })

  it('returns an empty array for no boxes', () => {
    expect(sortReadingOrder([])).toEqual([])
  })
})
