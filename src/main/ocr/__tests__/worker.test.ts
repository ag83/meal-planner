import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { electronModule } from '../../__tests__/electronMock'
import { runOcr, terminateOcrPool } from '../worker'
import { createWorkerPool } from '../workerPool'

vi.mock('electron', async () => (await import('../../__tests__/electronMock')).electronModule)

const pool = vi.hoisted(() => ({
  run: vi.fn(async () => ({ text: 't', confidence: 1 })),
  terminate: vi.fn(async () => undefined)
}))
vi.mock('../workerPool', () => ({ createWorkerPool: vi.fn(() => pool) }))

beforeEach(async () => {
  await terminateOcrPool()
  vi.clearAllMocks()
  electronModule.app.isPackaged = false
})

describe('runOcr', () => {
  it('creates one pool lazily and points it at the dev models', async () => {
    await runOcr('a.jpg')
    await runOcr('b.jpg')

    expect(createWorkerPool).toHaveBeenCalledTimes(1)
    expect(pool.run).toHaveBeenLastCalledWith({
      imagePath: 'b.jpg',
      modelsDir: path.join(process.cwd(), 'resources', 'models')
    })
  })

  it('uses the packaged resources path in a packaged app', async () => {
    electronModule.app.isPackaged = true
    Object.defineProperty(process, 'resourcesPath', { value: '/res', configurable: true })

    await runOcr('a.jpg')

    expect(pool.run).toHaveBeenCalledWith({
      imagePath: 'a.jpg',
      modelsDir: path.join('/res', 'models')
    })
  })

  it('terminates the pool and builds a new one next time', async () => {
    await runOcr('a.jpg')
    await terminateOcrPool()
    await runOcr('a.jpg')

    expect(pool.terminate).toHaveBeenCalledTimes(1)
    expect(createWorkerPool).toHaveBeenCalledTimes(2)
  })
})
