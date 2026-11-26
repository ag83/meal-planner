import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const appListeners = new Map<string, (...args: unknown[]) => void>()
  const windows: unknown[] = []
  const is = { dev: false }
  const createWindow = vi.fn()
  return { appListeners, windows, is, createWindow }
})

vi.mock('electron', () => {
  const BrowserWindow = vi.fn(() => {
    const listeners = new Map<string, () => void>()
    const win = {
      on: vi.fn((event: string, cb: () => void) => listeners.set(event, cb)),
      show: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      webContents: { openDevTools: vi.fn(), setWindowOpenHandler: vi.fn() },
      emit: (event: string) => listeners.get(event)?.()
    }
    state.createWindow(win)
    return win
  })
  Object.assign(BrowserWindow, { getAllWindows: () => state.windows })
  return {
    BrowserWindow,
    app: {
      whenReady: () => Promise.resolve(),
      on: vi.fn((event: string, cb: () => void) => state.appListeners.set(event, cb)),
      quit: vi.fn()
    },
    protocol: { registerSchemesAsPrivileged: vi.fn() },
    shell: { openExternal: vi.fn() }
  }
})
vi.mock('@electron-toolkit/utils', () => ({
  is: state.is,
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() }
}))
vi.mock('../ipc/recipes', () => ({ registerRecipeHandlers: vi.fn() }))
vi.mock('../ipc/settings', () => ({ registerSettingsHandlers: vi.fn() }))
vi.mock('../ipc/tags', () => ({ registerTagHandlers: vi.fn() }))
vi.mock('../ipc/vault', () => ({ registerVaultHandlers: vi.fn() }))
vi.mock('../ocr/worker', () => ({
  terminateOcrPool: vi.fn(() => Promise.reject(new Error('stuck')))
}))
vi.mock('../protocol/thumb', () => ({ registerThumbProtocol: vi.fn() }))
vi.mock('../vault/manager', () => ({ vaultManager: { loadFromConfig: vi.fn() } }))

interface FakeWindow {
  emit(event: string): void
  show: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  webContents: {
    openDevTools: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
}

const boot = async (dev: boolean): Promise<FakeWindow> => {
  vi.resetModules()
  vi.clearAllMocks()
  state.is.dev = dev
  await import('../index')
  await vi.waitFor(() => expect(state.createWindow).toHaveBeenCalled())
  return state.createWindow.mock.calls[0][0] as FakeWindow
}

afterEach(() => {
  vi.unstubAllEnvs()
  state.windows.length = 0
})

describe('main entry', () => {
  it('creates a hardened window that loads the built renderer', async () => {
    const win = await boot(false)
    const { BrowserWindow, shell } = await import('electron')

    expect(vi.mocked(BrowserWindow).mock.calls[0][0]?.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    })
    expect(win.loadFile).toHaveBeenCalled()
    win.emit('ready-to-show')
    expect(win.show).toHaveBeenCalled()
    expect(win.webContents.openDevTools).not.toHaveBeenCalled()

    const openHandler = win.webContents.setWindowOpenHandler.mock.calls[0][0]
    expect(openHandler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('loads the dev server and opens dev tools in development', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    const win = await boot(true)

    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    win.emit('ready-to-show')
    expect(win.webContents.openDevTools).toHaveBeenCalled()
  })

  it('wires the app lifecycle events', async () => {
    await boot(false)
    const { app } = await import('electron')
    const { optimizer } = await import('@electron-toolkit/utils')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    state.appListeners.get('browser-window-created')!({}, {})
    expect(optimizer.watchWindowShortcuts).toHaveBeenCalled()

    state.appListeners.get('activate')!()
    expect(state.createWindow).toHaveBeenCalledTimes(2)
    state.windows.push({})
    state.appListeners.get('activate')!()
    expect(state.createWindow).toHaveBeenCalledTimes(2)

    state.appListeners.get('before-quit')!()
    await vi.waitFor(() => expect(error).toHaveBeenCalled())

    state.appListeners.get('window-all-closed')!()
    expect(app.quit).toHaveBeenCalledTimes(process.platform === 'darwin' ? 0 : 1)
    error.mockRestore()
  })
})
