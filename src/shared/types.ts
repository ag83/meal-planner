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

export type AppTheme = 'system' | 'light' | 'dark'

export interface AppConfig {
  vaultPath: string | null
  theme?: AppTheme
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

export interface RecipeTag {
  tagId: number
  label: string
  kind: TagKind
  source: 'ocr' | 'user'
  confidence: number
}

export interface RecipeFull {
  id: string
  ext: string
  title: string | null
  notes: string | null
  width: number
  height: number
  createdAt: number
  updatedAt: number
  ocrText: string | null
  ocrLang: string | null
  ocrConf: number | null
  tags: RecipeTag[]
}

export interface TagAlias {
  id: number
  lemma: string
  isPrimary: boolean
  source: 'builtin' | 'user'
  disabled: boolean
}

export interface TagWithAliases {
  id: number
  slug: string
  label: string
  kind: TagKind
  source: 'builtin' | 'user'
  disabled: boolean
  recipeCount: number
  aliases: TagAlias[]
}

export interface Settings {
  theme: AppTheme
}
