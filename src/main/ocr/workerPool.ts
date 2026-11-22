import { Worker } from 'worker_threads'

export interface WorkerPool<TRequest, TResult> {
  run: (payload: TRequest) => Promise<TResult>
  terminate: () => Promise<void>
}

interface Task<TRequest, TResult> {
  id: number
  payload: TRequest
  resolve: (result: TResult) => void
  reject: (error: Error) => void
}

interface Entry<TRequest, TResult> {
  worker: Worker
  task: Task<TRequest, TResult> | null
  dead: boolean
}

interface WorkerReply<TResult> {
  id: number
  result?: TResult
  error?: string
}

// Workers are spawned lazily up to `size` and replaced when one dies, so a crash fails only
// the task it was running instead of hanging the caller or shrinking the pool.
export const createWorkerPool = <TRequest, TResult>(
  script: string | URL,
  size: number
): WorkerPool<TRequest, TResult> => {
  const entries: Entry<TRequest, TResult>[] = []
  const queue: Task<TRequest, TResult>[] = []
  let nextId = 0
  let closed = false

  const dispatch = (): void => {
    while (queue.length > 0) {
      const entry = entries.find((e) => e.task === null) ?? (entries.length < size ? spawn() : null)
      if (!entry) return
      const task = queue.shift() as Task<TRequest, TResult>
      entry.task = task
      entry.worker.postMessage({ id: task.id, payload: task.payload })
    }
  }

  const spawn = (): Entry<TRequest, TResult> => {
    const entry: Entry<TRequest, TResult> = { worker: new Worker(script), task: null, dead: false }

    entry.worker.on('message', (msg: WorkerReply<TResult>) => {
      const task = entry.task
      if (!task || msg.id !== task.id) return
      entry.task = null
      if (msg.error !== undefined) task.reject(new Error(msg.error))
      else task.resolve(msg.result as TResult)
      dispatch()
    })

    const fail = (error: Error): void => {
      if (entry.dead) return
      entry.dead = true
      entries.splice(entries.indexOf(entry), 1)
      entry.task?.reject(error)
      entry.task = null
      if (!closed) dispatch()
    }
    entry.worker.on('error', fail)
    entry.worker.on('exit', (code) => fail(new Error(`OCR worker exited with code ${code}`)))

    entries.push(entry)
    return entry
  }

  return {
    run: (payload) =>
      new Promise<TResult>((resolve, reject) => {
        if (closed) {
          reject(new Error('OCR pool terminated'))
          return
        }
        queue.push({ id: nextId++, payload, resolve, reject })
        dispatch()
      }),

    terminate: async () => {
      closed = true
      const error = new Error('OCR pool terminated')
      for (const task of queue.splice(0)) task.reject(error)
      const live = entries.splice(0)
      for (const entry of live) {
        entry.dead = true
        entry.task?.reject(error)
        entry.task = null
      }
      await Promise.all(live.map((e) => e.worker.terminate()))
    }
  }
}
