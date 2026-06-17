import path from 'path'
import os from 'os'
import { app } from 'electron'
import { createWorker } from 'tesseract.js'
import type { Worker } from 'tesseract.js'

const POOL_SIZE = Math.max(1, Math.min(os.cpus().length - 1, 4))
const LANG = 'rus+eng'

interface PoolEntry {
  worker: Worker
  busy: boolean
}

let pool: PoolEntry[] = []
let initPromise: Promise<void> | null = null

async function buildPool(): Promise<void> {
  const langPath = path.join(app.getPath('userData'), 'tessdata')
  pool = await Promise.all(
    Array.from({ length: POOL_SIZE }, async () => {
      const worker = await createWorker({ langPath, cacheMethod: 'readWrite' })
      await worker.loadLanguage(LANG)
      await worker.initialize(LANG)
      return { worker, busy: false }
    })
  )
}

function ensurePool(): Promise<void> {
  initPromise ??= buildPool()
  return initPromise
}

export async function terminateOcrPool(): Promise<void> {
  if (pool.length === 0) return
  await Promise.all(pool.map((e) => e.worker.terminate()))
  pool = []
  initPromise = null
}

function acquireWorker(): Promise<PoolEntry> {
  return new Promise((resolve) => {
    const tryFind = (): void => {
      const entry = pool.find((e) => !e.busy)
      if (entry) {
        entry.busy = true
        resolve(entry)
      } else {
        setTimeout(tryFind, 50)
      }
    }
    tryFind()
  })
}

export interface OcrResult {
  text: string
  confidence: number
  lang: string
}

export async function runOcr(imagePath: string): Promise<OcrResult> {
  await ensurePool()
  const entry = await acquireWorker()
  try {
    const {
      data: { text, confidence }
    } = await entry.worker.recognize(imagePath)
    return { text: text.trim(), confidence, lang: LANG }
  } finally {
    entry.busy = false
  }
}
