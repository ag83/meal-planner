import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { createWorker, PSM } from 'tesseract.js'
import type { Worker } from 'tesseract.js'
import { blocksToLines } from './blocks'
import { joinLines } from './postprocess'
import { preprocessImage } from './preprocess'
import type { TessBlock } from './blocks'

const POOL_SIZE = Math.max(1, Math.min(os.cpus().length - 1, 4))
const LANG = 'rus+eng'

interface PoolEntry {
  worker: Worker
  busy: boolean
}

let pool: PoolEntry[] = []
let initPromise: Promise<void> | null = null

const buildPool = async (): Promise<void> => {
  // cachePath = local storage for .traineddata files; langPath defaults to HTTPS for downloading
  const cachePath = path.join(app.getPath('userData'), 'tessdata')
  fs.mkdirSync(cachePath, { recursive: true })
  pool = await Promise.all(
    Array.from({ length: POOL_SIZE }, async () => {
      const worker = await createWorker({ cachePath, cacheMethod: 'readWrite' })
      await worker.loadLanguage(LANG)
      await worker.initialize(LANG)
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
      return { worker, busy: false }
    })
  )
}

const ensurePool = (): Promise<void> => {
  initPromise ??= buildPool()
  return initPromise
}

export const terminateOcrPool = async (): Promise<void> => {
  if (pool.length === 0) return
  await Promise.all(pool.map((e) => e.worker.terminate()))
  pool = []
  initPromise = null
}

const acquireWorker = (): Promise<PoolEntry> => {
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

export const runOcr = async (imagePath: string): Promise<OcrResult> => {
  await ensurePool()
  const entry = await acquireWorker()
  try {
    const buffer = await preprocessImage(imagePath)
    const {
      data: { blocks, confidence }
    } = await entry.worker.recognize(buffer)
    const text = joinLines(blocksToLines((blocks ?? []) as TessBlock[]))
    return { text, confidence, lang: LANG }
  } finally {
    entry.busy = false
  }
}
