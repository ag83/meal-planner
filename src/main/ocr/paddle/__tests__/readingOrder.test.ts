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

  it('keeps every box when coordinates are fractional, as the layout model emits them', () => {
    // Real runLayout output for beef-three-column, in emitted order. Rounding
    // the projection intervals but comparing raw y0 against them used to drop
    // every box whose y0 rounded up (e.g. 17.81 -> 18).
    const boxes: Array<[number, number, number, number]> = [
      [445.19, 26.18, 1279.76, 654.32], // image
      [48.71, 472.41, 423.31, 951.36], // step1
      [831.9, 682.51, 1203.62, 950.59], // step2b
      [440.03, 678.67, 816.19, 950.36], // step2a
      [66.45, 165.63, 392.61, 434.19], // ingredients
      [78.5, 17.81, 391.26, 130.27] // title
    ]
    const order = sortReadingOrder(boxes)
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5])
    const textOnly = order.filter((i) => i !== 0)
    expect(textOnly).toEqual([5, 4, 1, 3, 2])
  })


  it('reads whole columns when a short title bridges the gutter and the row gap is thinner than the gutters', () => {
    // Layout regions measured on a real three-column magazine page: a title centred over the
    // left and middle columns, a photo top right, and a 5px row gap between the middle column's
    // two blocks that is thinner than either 15-20px gutter. The text runs down each column.
    const regions: Record<string, [number, number, number, number]> = {
      photo: [822, 0, 1268, 452],
      midBottom1: [426, 493, 799, 626],
      leftBottom1: [35, 492, 408, 661],
      ingredients: [51, 187, 370, 457],
      midBottom2: [427, 631, 799, 729],
      leftBottom2: [35, 666, 407, 727],
      rightBottom: [817, 492, 1193, 731],
      midTop2: [426, 287, 801, 487],
      title: [212, 109, 621, 146],
      midTop1: [426, 181, 800, 282]
    }
    const labels = Object.keys(regions)
    const order = sortReadingOrder(labels.map((l) => regions[l])).map((i) => labels[i])
    expect(order.filter((l) => l !== 'photo')).toEqual([
      'title',
      'ingredients',
      'leftBottom1',
      'leftBottom2',
      'midTop1',
      'midTop2',
      'midBottom1',
      'midBottom2',
      'rightBottom'
    ])
  })

  it('keeps row-major order when the gap between rows is wider than the gap between columns', () => {
    const boxes: Array<[number, number, number, number]> = [
      [0, 0, 100, 50],
      [110, 0, 210, 50],
      [0, 100, 100, 150],
      [110, 100, 210, 150]
    ]
    expect(sortReadingOrder(boxes)).toEqual([0, 1, 2, 3])
  })


  it('reads a three-column recipe page column by column, with a promo box on the right', () => {
    // Regions measured on a real page: centred title and byline over the columns, ingredient box
    // and steps in the left column, the middle column split into four blocks, a promo photo
    // bottom right.
    const regions: Record<string, [number, number, number, number]> = {
      mid3: [474, 1033, 848, 1125],
      mid4: [475, 1134, 848, 1230],
      mid5: [476, 1236, 845, 1299],
      mid6a: [476, 1307, 850, 1472],
      mid6b: [476, 1479, 851, 1645],
      mid6c: [476, 1652, 852, 1725],
      leftBottom1: [86, 1548, 457, 1645],
      leftBottom2: [86, 1444, 457, 1541],
      leftBottom3: [85, 1650, 457, 1724],
      ingredients: [99, 1030, 441, 1407],
      title: [228, 754, 1086, 861],
      subtitle: [290, 956, 1028, 997],
      byline: [339, 872, 998, 938],
      right: [867, 1029, 1241, 1333],
      promo: [864, 1339, 1301, 1725]
    }
    const labels = Object.keys(regions)
    const order = sortReadingOrder(labels.map((l) => regions[l])).map((i) => labels[i])
    expect(order.filter((l) => l !== 'promo')).toEqual([
      'title',
      'byline',
      'subtitle',
      'ingredients',
      'leftBottom2',
      'leftBottom1',
      'leftBottom3',
      'mid3',
      'mid4',
      'mid5',
      'mid6a',
      'mid6b',
      'mid6c',
      'right'
    ])
  })

  it('orders regions that overlap each other by their top edge, not their left edge', () => {
    // A bold ingredients region and the two-column text under it overlap by 18px in y and share
    // columns, so neither cut applies; the wider lower region starts further left.
    const boxes: Array<[number, number, number, number]> = [
      [22, 238, 745, 397],
      [56, 159, 743, 256]
    ]
    expect(sortReadingOrder(boxes)).toEqual([1, 0])
  })

  it('returns a single index unchanged for one box', () => {
    expect(sortReadingOrder([[0, 0, 10, 10]])).toEqual([0])
  })

  it('returns an empty array for no boxes', () => {
    expect(sortReadingOrder([])).toEqual([])
  })
})
