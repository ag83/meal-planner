import { describe, it, expect } from 'vitest'
import { decodeLayout, LAYOUT_LABELS } from '../layout'

const makeRow = (labelId: number, score: number, x0: number, y0: number, x1: number, y1: number): number[] => [
  labelId,
  score,
  x0,
  y0,
  x1,
  y1
]

describe('decodeLayout', () => {
  it('keeps a row labeled "text" above threshold', () => {
    const textId = LAYOUT_LABELS.indexOf('text')
    const rows = new Float32Array(makeRow(textId, 0.9, 10, 20, 100, 200))
    const regions = decodeLayout(rows, 1, 0.5)
    expect(regions).toEqual([{ x0: 10, y0: 20, x1: 100, y1: 200, label: 'text' }])
  })

  it('maps paragraph_title and doc_title both to label "title"', () => {
    const paragraphTitleId = LAYOUT_LABELS.indexOf('paragraph_title')
    const rows = new Float32Array(makeRow(paragraphTitleId, 0.9, 10, 20, 100, 200))
    expect(decodeLayout(rows, 1, 0.5)[0].label).toBe('title')
  })

  it('drops a row whose label is a Non-goal (e.g. table)', () => {
    const tableId = LAYOUT_LABELS.indexOf('table')
    const rows = new Float32Array(makeRow(tableId, 0.9, 10, 20, 100, 200))
    expect(decodeLayout(rows, 1, 0.5)).toEqual([])
  })

  it('drops a row below the score threshold', () => {
    const textId = LAYOUT_LABELS.indexOf('text')
    const rows = new Float32Array(makeRow(textId, 0.3, 10, 20, 100, 200))
    expect(decodeLayout(rows, 1, 0.5)).toEqual([])
  })

  it('resolves overlapping multi-class candidates for the same region via the threshold alone', () => {
    // mirrors the real beef-fixture title region: three labels for one box,
    // only the top one clears 0.5
    const textId = LAYOUT_LABELS.indexOf('text')
    const titleId = LAYOUT_LABELS.indexOf('paragraph_title')
    const docTitleId = LAYOUT_LABELS.indexOf('doc_title')
    const rows = new Float32Array([
      ...makeRow(textId, 0.7, 78, 18, 391, 130),
      ...makeRow(titleId, 0.46, 78, 18, 391, 130),
      ...makeRow(docTitleId, 0.32, 78, 18, 391, 130)
    ])
    const regions = decodeLayout(rows, 3, 0.5)
    expect(regions).toEqual([{ x0: 78, y0: 18, x1: 391, y1: 130, label: 'text' }])
  })

  it('passes coordinates through unchanged — the graph already rescaled them', () => {
    const imageId = LAYOUT_LABELS.indexOf('image')
    const rows = new Float32Array(makeRow(imageId, 0.9, 445.4, 26.2, 1279.8, 654.5))
    const region = decodeLayout(rows, 1, 0.5)[0]
    expect(region.x0).toBeCloseTo(445.4, 1)
    expect(region.x1).toBeCloseTo(1279.8, 1)
  })
})
