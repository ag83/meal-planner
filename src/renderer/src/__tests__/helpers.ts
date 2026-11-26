import { vi } from 'vitest'

import type {
  IngestProgress,
  RecipeFull,
  RecipeSummary,
  TagSuggestion,
  TagWithAliases,
  VaultInfo
} from '../../../shared/types'

export const aVault = (path = '/vault'): VaultInfo => ({
  path,
  schemaVersion: 6,
  createdAt: 0,
  appVersion: '0.1.0',
  isNew: false
})

export const aSummary = (patch: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id: 'r1',
  ext: 'jpg',
  title: 'Борщ',
  width: 100,
  height: 80,
  createdAt: 1000,
  tagCount: 0,
  ...patch
})

export const aRecipe = (patch: Partial<RecipeFull> = {}): RecipeFull => ({
  id: 'r1',
  ext: 'jpg',
  title: 'Борщ',
  notes: 'заметка',
  width: 100,
  height: 80,
  createdAt: 0,
  updatedAt: 0,
  ocrText: 'свекла',
  ocrLang: 'ru',
  ocrConf: 87.6,
  tags: [
    { tagId: 1, label: 'Курица', kind: 'ingredient', source: 'ocr', confidence: 1 },
    { tagId: 2, label: 'Суп', kind: 'dish_type', source: 'user', confidence: 1 }
  ],
  ...patch
})

export const aSuggestion = (patch: Partial<TagSuggestion> = {}): TagSuggestion => ({
  id: 10,
  label: 'Печень',
  kind: 'ingredient',
  recipeCount: 3,
  ...patch
})

export const aTag = (patch: Partial<TagWithAliases> = {}): TagWithAliases => ({
  id: 1,
  slug: 'chicken',
  label: 'Курица',
  kind: 'ingredient',
  source: 'builtin',
  disabled: false,
  recipeCount: 2,
  aliases: [
    { id: 100, lemma: 'куриц', isPrimary: true, source: 'builtin', disabled: false },
    { id: 101, lemma: 'пулярк', isPrimary: false, source: 'user', disabled: false },
    { id: 102, lemma: 'цып', isPrimary: false, source: 'builtin', disabled: true }
  ],
  ...patch
})

export const installApi = () => {
  const progress: { emit: (p: IngestProgress) => void } = { emit: () => undefined }
  const api = {
    vault: {
      getCurrent: vi.fn(async (): Promise<VaultInfo | null> => aVault()),
      pick: vi.fn(async (): Promise<VaultInfo | null> => null),
      open: vi.fn(async () => aVault()),
      openFolder: vi.fn(async () => undefined)
    },
    recipes: {
      list: vi.fn(async (): Promise<RecipeSummary[]> => []),
      filterByTags: vi.fn(async (): Promise<RecipeSummary[]> => []),
      get: vi.fn(async (): Promise<RecipeFull | null> => aRecipe()),
      update: vi.fn(async () => undefined),
      setTag: vi.fn(async () => undefined),
      reOcr: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      pickFiles: vi.fn(async (): Promise<string[]> => []),
      ingest: vi.fn(async () => undefined),
      onProgress: vi.fn((cb: (p: IngestProgress) => void) => {
        progress.emit = cb
        return () => undefined
      })
    },
    tags: {
      suggest: vi.fn(async (): Promise<TagSuggestion[]> => []),
      list: vi.fn(async (): Promise<TagWithAliases[]> => []),
      create: vi.fn(async () => 50),
      update: vi.fn(async () => undefined),
      addAlias: vi.fn(async () => undefined),
      removeAlias: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      retagAll: vi.fn(async () => ({ updated: 2 }))
    },
    settings: {
      get: vi.fn(async () => ({ theme: 'system' as const })),
      update: vi.fn(async () => undefined)
    }
  }
  window.api = api
  window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList)
  return { api, progress }
}
