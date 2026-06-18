import { contextBridge, ipcRenderer } from 'electron'
import type { IngestProgress } from '../shared/types'

const api: Window['api'] = {
  vault: {
    getCurrent: () => ipcRenderer.invoke('vault:getCurrent'),
    pick: () => ipcRenderer.invoke('vault:pick'),
    open: (vaultPath: string) => ipcRenderer.invoke('vault:open', vaultPath),
    openFolder: () => ipcRenderer.invoke('vault:openFolder')
  },
  recipes: {
    list: () => ipcRenderer.invoke('recipes:list'),
    filterByTags: (tagIds: number[], mode: 'and' | 'or') =>
      ipcRenderer.invoke('recipes:filterByTags', tagIds, mode),
    get: (id: string) => ipcRenderer.invoke('recipes:get', id),
    update: (id: string, patch: { title?: string | null; notes?: string | null }) =>
      ipcRenderer.invoke('recipes:update', id, patch),
    setTag: (id: string, tagId: number, on: boolean) =>
      ipcRenderer.invoke('recipes:setTag', id, tagId, on),
    reOcr: (id: string, lang?: string) => ipcRenderer.invoke('recipes:reOcr', id, lang),
    delete: (id: string) => ipcRenderer.invoke('recipes:delete', id),
    pickFiles: () => ipcRenderer.invoke('recipes:pickFiles'),
    ingest: (paths: string[]) => ipcRenderer.invoke('recipes:ingest', paths),
    onProgress: (cb: (p: IngestProgress) => void) => {
      const handler = (_: Electron.IpcRendererEvent, p: IngestProgress): void => cb(p)
      ipcRenderer.on('ingest:progress', handler)
      return () => ipcRenderer.removeListener('ingest:progress', handler)
    }
  },
  tags: {
    suggest: (prefix: string, limit?: number) =>
      ipcRenderer.invoke('tags:suggest', prefix, limit),
    list: (kind?) => ipcRenderer.invoke('tags:list', kind),
    create: (input) => ipcRenderer.invoke('tags:create', input),
    update: (id, patch) => ipcRenderer.invoke('tags:update', id, patch),
    addAlias: (tagId, surface) => ipcRenderer.invoke('tags:addAlias', tagId, surface),
    removeAlias: (aliasId) => ipcRenderer.invoke('tags:removeAlias', aliasId),
    delete: (id) => ipcRenderer.invoke('tags:delete', id),
    retagAll: () => ipcRenderer.invoke('tags:retagAll')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
