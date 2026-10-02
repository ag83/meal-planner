const BLANK_CLASS = 0

const softmaxMax = (logitsForStep: Float32Array): { classIdx: number; prob: number } => {
  let maxVal = -Infinity
  let classIdx = 0
  for (let c = 0; c < logitsForStep.length; c++) {
    if (logitsForStep[c] > maxVal) {
      maxVal = logitsForStep[c]
      classIdx = c
    }
  }
  let sumExp = 0
  for (let c = 0; c < logitsForStep.length; c++) {
    sumExp += Math.exp(logitsForStep[c] - maxVal)
  }
  const prob = 1 / sumExp // exp(maxVal - maxVal) / sumExp
  return { classIdx, prob }
}

export const ctcGreedyDecode = (
  logits: Float32Array,
  timeSteps: number,
  numClasses: number,
  dict: readonly string[]
): { text: string; confidence: number } => {
  let text = ''
  let lastClass = -1
  const confidences: number[] = []

  for (let t = 0; t < timeSteps; t++) {
    const stepLogits = logits.subarray(t * numClasses, (t + 1) * numClasses)
    const { classIdx, prob } = softmaxMax(stepLogits)

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
