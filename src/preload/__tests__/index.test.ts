import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
}))
vi.mock('electron', () => electron)

type Api = Record<string, Record<string, (...args: unknown[]) => unknown>>

const load = async (isolated: boolean): Promise<void> => {
  vi.resetModules()
  vi.clearAllMocks()
  Object.defineProperty(process, 'contextIsolated', { value: isolated, configurable: true })
  await import('../index')
}

afterEach(() => vi.unstubAllGlobals())

describe('preload', () => {
  it('maps every API method onto its IPC channel', async () => {
    await load(true)
    const api = electron.contextBridge.exposeInMainWorld.mock.calls[0][1] as Api

    const cases: [string, string, unknown[], string][] = [
      ['vault', 'getCurrent', [], 'vault:getCurrent'],
      ['vault', 'pick', [], 'vault:pick'],
      ['vault', 'open', ['/v'], 'vault:open'],
      ['vault', 'openFolder', [], 'vault:openFolder'],
      ['recipes', 'list', [], 'recipes:list'],
      ['recipes', 'filterByTags', [[1], 'or'], 'recipes:filterByTags'],
      ['recipes', 'get', ['a'], 'recipes:get'],
      ['recipes', 'update', ['a', {}], 'recipes:update'],
      ['recipes', 'setTag', ['a', 1, true], 'recipes:setTag'],
      ['recipes', 'reOcr', ['a'], 'recipes:reOcr'],
      ['recipes', 'delete', ['a'], 'recipes:delete'],
      ['recipes', 'pickFiles', [], 'recipes:pickFiles'],
      ['recipes', 'ingest', [['p']], 'recipes:ingest'],
      ['tags', 'suggest', ['к', 5], 'tags:suggest'],
      ['tags', 'list', ['user'], 'tags:list'],
      ['tags', 'create', [{}], 'tags:create'],
      ['tags', 'update', [1, {}], 'tags:update'],
      ['tags', 'addAlias', [1, 'a'], 'tags:addAlias'],
      ['tags', 'removeAlias', [1], 'tags:removeAlias'],
      ['tags', 'delete', [1], 'tags:delete'],
      ['tags', 'retagAll', [], 'tags:retagAll'],
      ['settings', 'get', [], 'settings:get'],
      ['settings', 'update', [{}], 'settings:update']
    ]
    for (const [group, method, args, channel] of cases) {
      api[group][method](...args)
      expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(channel, ...args)
    }
  })

  it('subscribes to ingest progress and unsubscribes the same handler', async () => {
    await load(true)
    const api = electron.contextBridge.exposeInMainWorld.mock.calls[0][1] as Api
    const callback = vi.fn()

    const unsubscribe = api.recipes.onProgress(callback) as () => void
    const [channel, handler] = electron.ipcRenderer.on.mock.calls[0]
    handler({}, { status: 'done' })
    unsubscribe()

    expect(channel).toBe('ingest:progress')
    expect(callback).toHaveBeenCalledWith({ status: 'done' })
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(channel, handler)
  })

  it('falls back to a window global without context isolation', async () => {
    const fakeWindow: { api?: unknown } = {}
    vi.stubGlobal('window', fakeWindow)
    await load(false)

    expect(fakeWindow.api).toBeDefined()
    expect(electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled()
  })
})
