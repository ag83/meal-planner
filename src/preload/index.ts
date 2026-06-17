import { contextBridge, ipcRenderer } from 'electron'

const api: Window['api'] = {
  vault: {
    getCurrent: () => ipcRenderer.invoke('vault:getCurrent'),
    pick: () => ipcRenderer.invoke('vault:pick'),
    open: (vaultPath: string) => ipcRenderer.invoke('vault:open', vaultPath)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
