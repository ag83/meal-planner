import { parentPort } from 'worker_threads'
import { loadSessions, processImage } from './pipeline'
import type { Sessions } from './pipeline'

interface WorkerRequest {
  id: number
  payload: { imagePath: string; modelsDir: string }
}

let sessionsPromise: Promise<Sessions> | null = null

const getSessions = (modelsDir: string): Promise<Sessions> => {
  sessionsPromise ??= loadSessions(modelsDir).catch((error: Error) => {
    sessionsPromise = null
    throw error
  })
  return sessionsPromise
}

parentPort?.on('message', (msg: WorkerRequest) => {
  getSessions(msg.payload.modelsDir)
    .then((sessions) => processImage(sessions, msg.payload.imagePath))
    .then((result) => parentPort?.postMessage({ id: msg.id, result }))
    .catch((error: Error) => parentPort?.postMessage({ id: msg.id, error: error.message }))
})
