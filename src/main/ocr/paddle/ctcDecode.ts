const BLANK_CLASS = 0

// rec.onnx's exported graph already applies softmax internally (verified
// empirically: applying softmax again here crushed a correct, ~0.99-confidence
// decode down to ~0.005 while leaving the chosen class — and so the decoded
// text — unaffected, since argmax is invariant to a monotonic rescaling).
// So this takes the per-step probability directly, matching PaddleOCR's own
// CTCLabelDecode.decode(), which does the same: argmax + max() on its input
// with no extra normalization.
const argmax = (probsForStep: Float32Array): { classIdx: number; prob: number } => {
  let maxVal = -Infinity
  let classIdx = 0
  for (let c = 0; c < probsForStep.length; c++) {
    if (probsForStep[c] > maxVal) {
      maxVal = probsForStep[c]
      classIdx = c
    }
  }
  return { classIdx, prob: maxVal }
}

export const ctcGreedyDecode = (
  probs: Float32Array,
  timeSteps: number,
  numClasses: number,
  dict: readonly string[]
): { text: string; confidence: number } => {
  let text = ''
  let lastClass = -1
  const confidences: number[] = []

  for (let t = 0; t < timeSteps; t++) {
    const stepProbs = probs.subarray(t * numClasses, (t + 1) * numClasses)
    const { classIdx, prob } = argmax(stepProbs)

    if (classIdx === BLANK_CLASS) {
      lastClass = BLANK_CLASS
      continue
    }
    if (classIdx === lastClass) {
      continue
    }
    text += dict[classIdx - 1]
    confidences.push(prob)
    lastClass = classIdx
  }

  const confidence = confidences.length === 0 ? 0 : confidences.reduce((a, b) => a + b, 0) / confidences.length
  return { text, confidence }
}
