import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import type { VaultInfo, VaultJson, AppConfig } from '../../shared/types'
import { initDb } from '../db/connection'
import { seedFromFile } from '../tags/seed'
import { reconcile } from './reconcile'

const CURRENT_SCHEMA_VERSION = 4

class VaultManager {
  private current: VaultInfo | null = null

  getCurrent(): VaultInfo | null {
    return this.current
  }

  async open(vaultPath: string): Promise<VaultInfo> {
    const vaultJsonPath = path.join(vaultPath, 'vault.json')

    let isNew = false
    let vaultJson: VaultJson

    try {
      const raw = await fs.readFile(vaultJsonPath, 'utf-8')
      vaultJson = JSON.parse(raw) as VaultJson

      if (vaultJson.schemaVersion > CURRENT_SCHEMA_VERSION) {
        throw new Error(
          `This vault was created with a newer version of Meal Planner (schema v${vaultJson.schemaVersion}). Please update the app.`
        )
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        vaultJson = await this.initializeVault(vaultPath)
        isNew = true
      } else {
        throw err
      }
    }

    // Ensure subdirs exist in case vault was created outside the app or partially initialized.
    await fs.mkdir(path.join(vaultPath, 'pictures'), { recursive: true })
    await fs.mkdir(path.join(vaultPath, 'thumbs'), { recursive: true })

    await this.persistConfig(vaultPath)

    const db = initDb(vaultPath)
    await seedFromFile(db)
    await reconcile(db, vaultPath)

    this.current = {
      path: vaultPath,
      schemaVersion: vaultJson.schemaVersion,
      createdAt: vaultJson.createdAt,
      appVersion: vaultJson.appVersion,
      isNew
    }

    return this.current
  }

  async loadFromConfig(): Promise<VaultInfo | null> {
    const config = await this.readConfig()
    if (!config?.vaultPath) return null

    try {
      await fs.access(config.vaultPath)
      return await this.open(config.vaultPath)
    } catch {
      // Vault path gone (drive unplugged, folder deleted) — treat as no vault.
      return null
    }
  }

  private async initializeVault(vaultPath: string): Promise<VaultJson> {
    await fs.mkdir(vaultPath, { recursive: true })
    await fs.mkdir(path.join(vaultPath, 'pictures'), { recursive: true })
    await fs.mkdir(path.join(vaultPath, 'thumbs'), { recursive: true })

    const vaultJson: VaultJson = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: Date.now(),
      appVersion: app.getVersion()
    }

    await fs.writeFile(path.join(vaultPath, 'vault.json'), JSON.stringify(vaultJson, null, 2))
    return vaultJson
  }

  private configPath(): string {
    return path.join(app.getPath('userData'), 'config.json')
  }

  private async readConfig(): Promise<AppConfig | null> {
    try {
      const raw = await fs.readFile(this.configPath(), 'utf-8')
      return JSON.parse(raw) as AppConfig
    } catch {
      return null
    }
  }

  private async persistConfig(vaultPath: string): Promise<void> {
    const config: AppConfig = { vaultPath }
    await fs.writeFile(this.configPath(), JSON.stringify(config, null, 2))
  }
}

export const vaultManager = new VaultManager()
