import { contextBridge, ipcRenderer } from 'electron'
import type { IngestProgress } from '../shared/types'

const api: Window['api'] = {
  vault: {
    getCurrent: () => ipcRenderer.invoke('vault:getCurrent'),
    pick: () => ipcRenderer.invoke('vault:pick'),
    open: (vaultPath: string) => ipcRenderer.invoke('vault:open', vaultPath)
  },
  recipes: {
    list: () => ipcRenderer.invoke('recipes:list'),
    pickFiles: () => ipcRenderer.invoke('recipes:pickFiles'),
    ingest: (paths: string[]) => ipcRenderer.invoke('recipes:ingest', paths),
    onProgress: (cb: (p: IngestProgress) => void) => {
      const handler = (_: Electron.IpcRendererEvent, p: IngestProgress): void => cb(p)
      ipcRenderer.on('ingest:progress', handler)
      return () => ipcRenderer.removeListener('ingest:progress', handler)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
