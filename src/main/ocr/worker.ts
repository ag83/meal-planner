import os from 'os'
import path from 'path'
import { Worker } from 'worker_threads'
import { app } from 'electron'
import type { PipelineResult } from './paddle/pipeline'

const POOL_SIZE = Math.max(1, Math.min(os.cpus().length - 1, 4))

// electron-vite emits the worker entry next to the main bundle (see electron.vite.config.ts).
const WORKER_SCRIPT = path.join(__dirname, 'ocrWorkerThread.js')

const modelsDir = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'models')
    : path.join(app.getAppPath(), 'resources', 'models')

export type OcrResult = PipelineResult

export const OCR_LANG = 'ru'

interface PoolEntry {
  worker: Worker
  busy: boolean
}

interface WorkerReply {
  id: number
  result?: OcrResult
  error?: string
}

interface PendingTask {
  resolve: (result: OcrResult) => void
  reject: (error: Error) => void
}

let pool: PoolEntry[] = []
let nextMessageId = 0
const pending = new Map<number, PendingTask>()

const buildPool = (): PoolEntry[] =>
  Array.from({ length: POOL_SIZE }, () => {
    const worker = new Worker(WORKER_SCRIPT)
    worker.on('message', (msg: WorkerReply) => {
      const task = pending.get(msg.id)
      if (!task) return
      pending.delete(msg.id)
      if (msg.error !== undefined) task.reject(new Error(msg.error))
      else if (msg.result) task.resolve(msg.result)
    })
    return { worker, busy: false }
  })

const ensurePool = (): PoolEntry[] => {
  if (pool.length === 0) pool = buildPool()
  return pool
}

export const terminateOcrPool = async (): Promise<void> => {
  if (pool.length === 0) return
  await Promise.all(pool.map((e) => e.worker.terminate()))
  pool = []
}

const acquireWorker = (): Promise<PoolEntry> =>
  new Promise((resolve) => {
    const tryFind = (): void => {
      const entry = ensurePool().find((e) => !e.busy)
      if (entry) {
        entry.busy = true
        resolve(entry)
      } else {
        setTimeout(tryFind, 50)
      }
    }
    tryFind()
  })

export const runOcr = async (imagePath: string): Promise<OcrResult> => {
  const entry = await acquireWorker()
  const id = nextMessageId++
  try {
    return await new Promise<OcrResult>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      entry.worker.postMessage({ id, imagePath, modelsDir: modelsDir() })
    })
  } finally {
    entry.busy = false
  }
}
