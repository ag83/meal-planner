export interface VaultInfo {
  path: string
  schemaVersion: number
  createdAt: number
  appVersion: string
  isNew: boolean
}

export interface VaultJson {
  schemaVersion: number
  createdAt: number
  appVersion: string
}

export interface AppConfig {
  vaultPath: string | null
}
