import { parentPort } from 'worker_threads'
import { loadSessions, processImage } from './pipeline'
import type { Sessions } from './pipeline'

interface WorkerRequest {
  id: number
  imagePath: string
  modelsDir: string
}

let sessionsPromise: Promise<Sessions> | null = null

parentPort?.on('message', (msg: WorkerRequest) => {
  sessionsPromise ??= loadSessions(msg.modelsDir)
  sessionsPromise
    .then((sessions) => processImage(sessions, msg.imagePath))
    .then((result) => parentPort?.postMessage({ id: msg.id, result }))
    .catch((error: Error) => parentPort?.postMessage({ id: msg.id, error: error.message }))
})
