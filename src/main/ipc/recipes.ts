import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getDb } from '../db/connection'
import { vaultManager } from '../vault/manager'
import { ingestFile } from '../ingest/pipeline'
import type { IngestProgress } from '../../shared/types'

export function registerRecipeHandlers(): void {
  ipcMain.handle('recipes:pickFiles', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: 'Add Recipes',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      properties: ['openFile', 'multiSelections']
    })
    return canceled ? [] : filePaths
  })

  ipcMain.handle('recipes:ingest', async (event, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
      throw new Error('Invalid paths argument')
    }

    const vault = vaultManager.getCurrent()
    if (!vault) throw new Error('No vault open')

    const db = getDb()
    const win = BrowserWindow.fromWebContents(event.sender)

    const sendProgress = (p: IngestProgress): void => {
      win?.webContents.send('ingest:progress', p)
    }

    for (const filePath of paths as string[]) {
      await ingestFile(db, vault.path, filePath, sendProgress)
    }
  })
}
