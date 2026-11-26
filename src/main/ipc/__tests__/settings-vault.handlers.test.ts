import fs from 'fs/promises'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { electronModule, invoke, makeTempDir, paths } from '../../__tests__/electronMock'
import { closeDb } from '../../db/connection'
import { registerSettingsHandlers } from '../settings'
import { registerVaultHandlers } from '../vault'

vi.mock('electron', async () => (await import('../../__tests__/electronMock')).electronModule)

let root: string

beforeAll(async () => {
  registerSettingsHandlers()
  registerVaultHandlers()
  root = await makeTempDir()
  paths.userData = root
})

afterAll(async () => {
  closeDb()
  await fs.rm(root, { recursive: true, force: true })
})

describe('settings handlers', () => {
  it('defaults to the system theme and persists changes', async () => {
    await expect(invoke('settings:get')).resolves.toEqual({ theme: 'system' })
    await invoke('settings:update', { theme: 'dark' })
    await expect(invoke('settings:get')).resolves.toEqual({ theme: 'dark' })
  })

  it('ignores invalid patches and keeps other config keys', async () => {
    const config = path.join(root, 'config.json')
    await fs.writeFile(config, JSON.stringify({ vaultPath: '/v', theme: 'light' }))
    await invoke('settings:update', null)
    await invoke('settings:update', {})
    expect(JSON.parse(await fs.readFile(config, 'utf-8'))).toEqual({
      vaultPath: '/v',
      theme: 'light'
    })
  })
})

describe('vault handlers', () => {
  it('does not open a folder when no vault is open', async () => {
    await invoke('vault:openFolder')
    expect(electronModule.shell.openPath).not.toHaveBeenCalled()
    await expect(invoke('vault:getCurrent')).resolves.toBeNull()
  })

  it('returns null when the picker is cancelled', async () => {
    electronModule.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(invoke('vault:pick')).resolves.toBeNull()
  })

  it('opens the picked folder as a vault', async () => {
    const vaultPath = path.join(root, 'picked')
    electronModule.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [vaultPath]
    })
    await expect(invoke('vault:pick')).resolves.toMatchObject({ path: vaultPath, isNew: true })
    await invoke('vault:openFolder')
    expect(electronModule.shell.openPath).toHaveBeenCalledWith(vaultPath)
  })

  it('opens a vault by path and validates it', async () => {
    const vaultPath = path.join(root, 'picked')
    await expect(invoke('vault:open', vaultPath)).resolves.toMatchObject({ isNew: false })
    await expect(invoke('vault:open', '')).rejects.toThrow('Invalid vault path')
  })
})
