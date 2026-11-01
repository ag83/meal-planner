// Typed facade over window.api — import this instead of calling window.api directly.
import type {
  VaultInfo,
  IngestProgress,
  RecipeSummary,
  RecipeFull,
  TagSuggestion,
  TagWithAliases,
  TagKind,
  Settings
} from '../../../shared/types'

export const vault = {
  getCurrent: (): Promise<VaultInfo | null> => window.api.vault.getCurrent(),
  pick: (): Promise<VaultInfo | null> => window.api.vault.pick(),
  open: (vaultPath: string): Promise<VaultInfo> => window.api.vault.open(vaultPath),
  openFolder: (): Promise<void> => window.api.vault.openFolder()
}

export const recipes = {
  list: (): Promise<RecipeSummary[]> => window.api.recipes.list(),
  filterByTags: (tagIds: number[], mode: 'and' | 'or'): Promise<RecipeSummary[]> =>
    window.api.recipes.filterByTags(tagIds, mode),
  get: (id: string): Promise<RecipeFull | null> => window.api.recipes.get(id),
  update: (id: string, patch: { title?: string | null; notes?: string | null }): Promise<void> =>
    window.api.recipes.update(id, patch),
  setTag: (id: string, tagId: number, on: boolean): Promise<void> =>
    window.api.recipes.setTag(id, tagId, on),
  reOcr: (id: string): Promise<void> => window.api.recipes.reOcr(id),
  delete: (id: string): Promise<void> => window.api.recipes.delete(id),
  pickFiles: (): Promise<string[]> => window.api.recipes.pickFiles(),
  ingest: (paths: string[]): Promise<void> => window.api.recipes.ingest(paths),
  onProgress: (cb: (p: IngestProgress) => void): (() => void) =>
    window.api.recipes.onProgress(cb)
}

export const tags = {
  suggest: (prefix: string, limit?: number): Promise<TagSuggestion[]> =>
    window.api.tags.suggest(prefix, limit),
  list: (kind?: TagKind): Promise<TagWithAliases[]> => window.api.tags.list(kind),
  create: (input: { label: string; kind: TagKind; aliases?: string[] }): Promise<number> =>
    window.api.tags.create(input),
  update: (
    id: number,
    patch: { label?: string; kind?: TagKind; disabled?: boolean }
  ): Promise<void> => window.api.tags.update(id, patch),
  addAlias: (tagId: number, surface: string): Promise<void> =>
    window.api.tags.addAlias(tagId, surface),
  removeAlias: (aliasId: number): Promise<void> => window.api.tags.removeAlias(aliasId),
  delete: (id: number): Promise<void> => window.api.tags.delete(id),
  retagAll: (): Promise<{ updated: number }> => window.api.tags.retagAll()
}

export const settings = {
  get: (): Promise<Settings> => window.api.settings.get(),
  update: (patch: Partial<Settings>): Promise<void> => window.api.settings.update(patch)
}
