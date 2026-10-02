import { describe, it, expect } from 'vitest'
import { ctcGreedyDecode } from '../ctcDecode'

const dict = ['a', 'b', 'c'] // class 1='a', class 2='b', class 3='c'; class 0 is blank

// rec.onnx's output is already post-softmax per PaddleOCR's own export (verified
// empirically against the real model), so test fixtures use probability-like
// values (a dominant class near 1, others near 0), not raw unbounded logits.
const probsFromClasses = (classes: number[], numClasses: number): Float32Array => {
  const probs = new Float32Array(classes.length * numClasses)
  classes.forEach((cls, t) => {
    probs[t * numClasses + cls] = 1 // dominant probability for the chosen class
  })
  return probs
}

describe('ctcGreedyDecode', () => {
  it('decodes a simple sequence with no repeats or blanks', () => {
    const probs = probsFromClasses([1, 2, 3], 4)
    const result = ctcGreedyDecode(probs, 3, 4, dict)
    expect(result.text).toBe('abc')
  })

  it('collapses consecutive repeated classes into one character', () => {
    const probs = probsFromClasses([1, 1, 1, 2], 4)
    const result = ctcGreedyDecode(probs, 4, 4, dict)
    expect(result.text).toBe('ab')
  })

  it('drops blank (class 0) entirely, including between repeats to produce a doubled letter', () => {
    const probs = probsFromClasses([1, 0, 1], 4)
    const result = ctcGreedyDecode(probs, 3, 4, dict)
    expect(result.text).toBe('aa')
  })

  it('returns an empty string and zero confidence for an all-blank sequence', () => {
    const probs = probsFromClasses([0, 0, 0], 4)
    const result = ctcGreedyDecode(probs, 3, 4, dict)
    expect(result.text).toBe('')
    expect(result.confidence).toBe(0)
  })

  it('averages confidence over the kept (non-blank, non-repeat) characters only, using the max probability directly', () => {
    // class 1 dominant at both timesteps with probability 0.97; class 1
    // repeated at t=1 is dropped from the average (it's a collapsed repeat)
    const numClasses = 4
    const probs = new Float32Array(2 * numClasses)
    probs.set([0.01, 0.97, 0.01, 0.01], 0)
    probs.set([0.01, 0.97, 0.01, 0.01], numClasses)
    const result = ctcGreedyDecode(probs, 2, numClasses, dict)
    expect(result.text).toBe('a')
    expect(result.confidence).toBeCloseTo(0.97, 5)
  })
})
