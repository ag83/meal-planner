// Stand-in for the `electron` module: only the surface the main process touches.
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

export const handlers = new Map<string, Handler>()
export const paths = { userData: '' }
export const sentToRenderer = vi.fn()
export const fakeWindow = { webContents: { send: sentToRenderer } }

export const electronModule = {
  app: {
    isPackaged: false,
    getPath: vi.fn(() => paths.userData),
    getAppPath: vi.fn(() => process.cwd()),
    getVersion: vi.fn(() => '9.9.9')
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
  },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => fakeWindow) }
}

export const invoke = async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return (await handler({ sender: {} }, ...args)) as T
}

export const makeTempDir = (): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), 'meal-planner-test-'))
