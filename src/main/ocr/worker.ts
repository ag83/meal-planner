import os from 'os'
import path from 'path'
import { app } from 'electron'
import { createWorkerPool } from './workerPool'
import type { WorkerPool } from './workerPool'
import type { PipelineResult } from './paddle/pipeline'

// Each worker holds three ONNX sessions, and ingest runs one image at a time, so a
// large pool buys memory cost without throughput.
const POOL_SIZE = Math.max(1, Math.min(os.cpus().length - 1, 2))

// electron-vite emits the worker entry next to the main bundle (see electron.vite.config.ts).
const WORKER_SCRIPT = path.join(__dirname, 'ocrWorkerThread.js')

const modelsDir = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'models')
    : path.join(app.getAppPath(), 'resources', 'models')

export type OcrResult = PipelineResult

export const OCR_LANG = 'ru'

interface OcrRequest {
  imagePath: string
  modelsDir: string
}

let pool: WorkerPool<OcrRequest, OcrResult> | null = null

export const terminateOcrPool = async (): Promise<void> => {
  const current = pool
  pool = null
  await current?.terminate()
}

export const runOcr = (imagePath: string): Promise<OcrResult> => {
  pool ??= createWorkerPool<OcrRequest, OcrResult>(WORKER_SCRIPT, POOL_SIZE)
  return pool.run({ imagePath, modelsDir: modelsDir() })
}
