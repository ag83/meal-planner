import { ipcMain, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import { vaultManager } from '../vault/manager'
import type { Settings, AppTheme } from '../../shared/types'

const DEFAULTS: Settings = {
  theme: 'system'
}

const configPath = (): string => {
  return path.join(app.getPath('userData'), 'config.json')
}

const readRawConfig = async (): Promise<Record<string, unknown>> => {
  try {
    const raw = await fs.readFile(configPath(), 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

export const registerSettingsHandlers = (): void => {
  ipcMain.handle('settings:get', async (): Promise<Settings> => {
    const config = await readRawConfig()
    return {
      theme: (config.theme as AppTheme | undefined) ?? DEFAULTS.theme
    }
  })

  ipcMain.handle('settings:update', async (_event, patch: unknown): Promise<void> => {
    if (!patch || typeof patch !== 'object') return
    const config = await readRawConfig()
    const p = patch as Partial<Settings>
    if (p.theme !== undefined) config.theme = p.theme
    await fs.writeFile(configPath(), JSON.stringify(config, null, 2))
  })

  ipcMain.handle('vault:openFolder', async (): Promise<void> => {
    const current = vaultManager.getCurrent()
    if (current) await shell.openPath(current.path)
  })
}
