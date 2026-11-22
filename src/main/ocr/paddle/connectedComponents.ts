export interface Component {
  minX: number
  minY: number
  maxX: number
  maxY: number
  pixelCount: number
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1]
]

export const findConnectedComponents = (mask: Uint8Array, width: number, height: number): Component[] => {
  const visited = new Uint8Array(width * height)
  const components: Component[] = []
  const queue: number[] = []

  for (let startIdx = 0; startIdx < mask.length; startIdx++) {
    if (mask[startIdx] === 0 || visited[startIdx] === 1) continue

    visited[startIdx] = 1
    queue.length = 0
    queue.push(startIdx)

    let minX = startIdx % width
    let maxX = minX
    let minY = Math.floor(startIdx / width)
    let maxY = minY
    let pixelCount = 0

    while (queue.length > 0) {
      const idx = queue.pop() as number
      const x = idx % width
      const y = Math.floor(idx / width)
      pixelCount++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nIdx = ny * width + nx
        if (mask[nIdx] === 1 && visited[nIdx] === 0) {
          visited[nIdx] = 1
          queue.push(nIdx)
        }
      }
    }

    components.push({ minX, minY, maxX, maxY, pixelCount })
  }

  return components
}
