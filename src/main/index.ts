import { app, shell, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerVaultHandlers } from './ipc/vault'
import { registerRecipeHandlers } from './ipc/recipes'
import { registerTagHandlers } from './ipc/tags'
import { registerSettingsHandlers } from './ipc/settings'
import { registerThumbProtocol } from './protocol/thumb'
import { vaultManager } from './vault/manager'
import { terminateOcrPool } from './ocr/worker'

// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'recipe-thumb', privileges: { secure: true, standard: true, supportFetchAPI: true } }
])

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (is.dev) mainWindow.webContents.openDevTools()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.mealplanner')

  // Register IPC handlers before the window is created so the renderer's
  // first getCurrent() call always finds them.
  registerVaultHandlers()
  registerRecipeHandlers()
  registerTagHandlers()
  registerSettingsHandlers()
  registerThumbProtocol()

  // Pre-load vault from persisted config. If this fails the renderer's
  // getCurrent() returns null and the first-run screen is shown.
  await vaultManager.loadFromConfig()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  terminateOcrPool().catch(console.error)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
