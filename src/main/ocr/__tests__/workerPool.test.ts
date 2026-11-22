import { describe, it, expect, afterEach } from 'vitest'
import { createWorkerPool } from '../workerPool'
import type { WorkerPool } from '../workerPool'

const WORKER_SOURCE = `
import { parentPort } from 'worker_threads'
parentPort.on('message', (msg) => {
  if (msg.payload === 'crash') throw new Error('boom')
  if (msg.payload === 'exit') process.exit(1)
  if (msg.payload === 'fail') return parentPort.postMessage({ id: msg.id, error: 'bad input' })
  parentPort.postMessage({ id: msg.id, result: 'echo:' + msg.payload })
})
`
const SCRIPT = new URL(`data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`)

describe('createWorkerPool', () => {
  let pool: WorkerPool<string, string> | null = null

  afterEach(async () => {
    await pool?.terminate()
    pool = null
  })

  it('resolves a task with the worker result', async () => {
    pool = createWorkerPool<string, string>(SCRIPT, 2)
    await expect(pool.run('hi')).resolves.toBe('echo:hi')
  })

  it('rejects with the worker error message', async () => {
    pool = createWorkerPool<string, string>(SCRIPT, 1)
    await expect(pool.run('fail')).rejects.toThrow('bad input')
  })

  it('rejects the in-flight task when its worker throws, then serves the next task', async () => {
    pool = createWorkerPool<string, string>(SCRIPT, 1)
    await expect(pool.run('crash')).rejects.toThrow('boom')
    await expect(pool.run('after')).resolves.toBe('echo:after')
  })

  it('rejects the in-flight task when its worker exits, then serves the next task', async () => {
    pool = createWorkerPool<string, string>(SCRIPT, 1)
    await expect(pool.run('exit')).rejects.toThrow(/exited/)
    await expect(pool.run('after')).resolves.toBe('echo:after')
  })

  it('rejects pending tasks on terminate instead of leaving them hanging', async () => {
    pool = createWorkerPool<string, string>(SCRIPT, 1)
    const inFlight = pool.run('slow-ok')
    const settled = expect(inFlight).rejects.toThrow(/terminated/)
    await pool.terminate()
    await settled
  })
})
