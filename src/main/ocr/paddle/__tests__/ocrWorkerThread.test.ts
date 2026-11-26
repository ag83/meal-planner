import { beforeAll, describe, expect, it, vi } from 'vitest'

import { loadSessions, processImage } from '../pipeline'

const port = vi.hoisted(() => ({ on: vi.fn(), postMessage: vi.fn() }))
vi.mock('worker_threads', () => ({ parentPort: port, default: { parentPort: port } }))
vi.mock('../pipeline', () => ({ loadSessions: vi.fn(), processImage: vi.fn() }))

let send: (id: number) => void

beforeAll(async () => {
  await import('../ocrWorkerThread')
  const onMessage = port.on.mock.calls[0][1] as (msg: unknown) => void
  send = (id) => onMessage({ id, payload: { imagePath: 'a.jpg', modelsDir: 'm' } })
})

const reply = async (id: number): Promise<unknown> => {
  port.postMessage.mockClear()
  send(id)
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled())
  return port.postMessage.mock.calls[0][0]
}

describe('ocr worker thread', () => {
  it('reports a session load failure, retries, then caches the sessions', async () => {
    vi.mocked(loadSessions)
      .mockRejectedValueOnce(new Error('no models'))
      .mockResolvedValue({} as never)
    vi.mocked(processImage).mockResolvedValue({ text: 't', confidence: 50 })

    await expect(reply(1)).resolves.toEqual({ id: 1, error: 'no models' })
    await expect(reply(2)).resolves.toEqual({ id: 2, result: { text: 't', confidence: 50 } })
    await reply(3)

    expect(loadSessions).toHaveBeenCalledTimes(2)
  })
})
