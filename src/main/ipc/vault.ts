import { ipcMain, dialog, BrowserWindow } from 'electron'
import { vaultManager } from '../vault/manager'

export function registerVaultHandlers(): void {
  ipcMain.handle('vault:getCurrent', () => vaultManager.getCurrent())

  ipcMain.handle('vault:pick', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose vault folder'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return vaultManager.open(result.filePaths[0])
  })

  ipcMain.handle('vault:open', (_event, vaultPath: string) => {
    if (typeof vaultPath !== 'string' || !vaultPath) {
      throw new Error('Invalid vault path')
    }
    return vaultManager.open(vaultPath)
  })
}
