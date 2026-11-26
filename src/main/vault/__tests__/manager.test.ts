import fs from 'fs/promises'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeTempDir, paths } from '../../__tests__/electronMock'
import { closeDb, getDb, initDb } from '../../db/connection'
import { vaultManager } from '../manager'

vi.mock('electron', async () => (await import('../../__tests__/electronMock')).electronModule)

let root: string

beforeEach(async () => {
  root = await makeTempDir()
  paths.userData = root
})

afterEach(async () => {
  closeDb()
  await fs.rm(root, { recursive: true, force: true })
})

describe('vaultManager', () => {
  it('initializes a new vault, seeds tags and remembers it', async () => {
    const vaultPath = path.join(root, 'v')
    const info = await vaultManager.open(vaultPath)

    expect(info).toMatchObject({ isNew: true, schemaVersion: 6, appVersion: '9.9.9' })
    await expect(fs.readdir(vaultPath)).resolves.toEqual(
      expect.arrayContaining(['vault.json', 'pictures', 'thumbs', 'meal-planner.db'])
    )
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM tags').get()).not.toEqual({ n: 0 })
    await expect(vaultManager.loadFromConfig()).resolves.toMatchObject({
      path: vaultPath,
      isNew: false
    })
  })

  it('refuses a vault from a newer schema', async () => {
    await fs.writeFile(path.join(root, 'vault.json'), JSON.stringify({ schemaVersion: 99 }))
    await expect(vaultManager.open(root)).rejects.toThrow('newer version')
  })

  it('surfaces a corrupt vault.json', async () => {
    await fs.writeFile(path.join(root, 'vault.json'), '{nope')
    await expect(vaultManager.open(root)).rejects.toThrow()
  })

  it('loads nothing without config, or when the vault folder is gone', async () => {
    await expect(vaultManager.loadFromConfig()).resolves.toBeNull()
    await fs.writeFile(
      path.join(root, 'config.json'),
      JSON.stringify({ vaultPath: path.join(root, 'missing') })
    )
    await expect(vaultManager.loadFromConfig()).resolves.toBeNull()
  })
})

describe('db connection', () => {
  it('throws before initialization', () => {
    closeDb()
    expect(() => getDb()).toThrow('not initialized')
  })

  it('reuses the handle for one path and reopens for another', async () => {
    const other = path.join(root, 'other')
    await fs.mkdir(other)
    const first = initDb(root)
    expect(initDb(root)).toBe(first)
    expect(initDb(other)).not.toBe(first)
    expect(first.open).toBe(false)
  })
})
