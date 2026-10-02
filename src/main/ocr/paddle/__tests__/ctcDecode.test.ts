import { describe, it, expect } from 'vitest'
import { ctcGreedyDecode } from '../ctcDecode'

const dict = ['a', 'b', 'c'] // class 1='a', class 2='b', class 3='c'; class 0 is blank

const logitsFromClasses = (classes: number[], numClasses: number): Float32Array => {
  const logits = new Float32Array(classes.length * numClasses)
  classes.forEach((cls, t) => {
    logits[t * numClasses + cls] = 10 // dominant logit for the chosen class
  })
  return logits
}

describe('ctcGreedyDecode', () => {
  it('decodes a simple sequence with no repeats or blanks', () => {
    const logits = logitsFromClasses([1, 2, 3], 4)
    const result = ctcGreedyDecode(logits, 3, 4, dict)
    expect(result.text).toBe('abc')
  })

  it('collapses consecutive repeated classes into one character', () => {
    const logits = logitsFromClasses([1, 1, 1, 2], 4)
    const result = ctcGreedyDecode(logits, 4, 4, dict)
    expect(result.text).toBe('ab')
  })

  it('drops blank (class 0) entirely, including between repeats to produce a doubled letter', () => {
    const logits = logitsFromClasses([1, 0, 1], 4)
    const result = ctcGreedyDecode(logits, 3, 4, dict)
    expect(result.text).toBe('aa')
  })

  it('returns an empty string and zero confidence for an all-blank sequence', () => {
    const logits = logitsFromClasses([0, 0, 0], 4)
    const result = ctcGreedyDecode(logits, 3, 4, dict)
    expect(result.text).toBe('')
    expect(result.confidence).toBe(0)
  })

  it('averages confidence over the kept (non-blank, non-repeat) characters only', () => {
    // class 1 at t=0 with logit 10 among [10,0,0,0] -> softmax prob close to 1
    // class 1 repeated at t=1 is dropped from the average (it's a collapsed repeat)
    const numClasses = 4
    const logits = new Float32Array(2 * numClasses)
    logits.set([0, 10, 0, 0], 0)
    logits.set([0, 10, 0, 0], numClasses)
    const result = ctcGreedyDecode(logits, 2, numClasses, dict)
    expect(result.text).toBe('a')
    expect(result.confidence).toBeGreaterThan(0.9)
  })
})
