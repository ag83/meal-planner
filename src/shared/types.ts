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

export type IngestStatus = 'hashing' | 'duplicate' | 'copying' | 'thumbnail' | 'ocr' | 'tagging' | 'done' | 'error'

export interface IngestProgress {
  filePath: string
  status: IngestStatus
  recipeId?: string
  error?: string
}

export interface RecipeSummary {
  id: string
  ext: string
  title: string | null
  width: number
  height: number
  createdAt: number
  tagCount: number
}

export type TagKind = 'ingredient' | 'dish_type' | 'cuisine' | 'user'

export interface TagSuggestion {
  id: number
  label: string
  kind: TagKind
  recipeCount: number
}
