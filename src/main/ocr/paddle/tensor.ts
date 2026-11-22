export const rgbaToChwFloat32 = (
  pixels: Buffer,
  width: number,
  height: number,
  channels: 3 | 4,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
  swapRB: boolean
): Float32Array => {
  const pixelCount = width * height
  const out = new Float32Array(pixelCount * 3)
  const order = swapRB ? [2, 1, 0] : [0, 1, 2]

  for (let i = 0; i < pixelCount; i++) {
    const base = i * channels
    for (let c = 0; c < 3; c++) {
      const srcChannel = order[c]
      const value = pixels[base + srcChannel] / 255
      out[c * pixelCount + i] = (value - mean[c]) / std[c]
    }
  }

  return out
}
