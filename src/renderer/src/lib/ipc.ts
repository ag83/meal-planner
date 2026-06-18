// Typed facade over window.api — import this instead of calling window.api directly.
import type { VaultInfo, IngestProgress, RecipeSummary, RecipeFull, TagSuggestion } from '../../../shared/types'

export const vault = {
  getCurrent: (): Promise<VaultInfo | null> => window.api.vault.getCurrent(),
  pick: (): Promise<VaultInfo | null> => window.api.vault.pick(),
  open: (vaultPath: string): Promise<VaultInfo> => window.api.vault.open(vaultPath)
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
  reOcr: (id: string, lang?: string): Promise<void> => window.api.recipes.reOcr(id, lang),
  delete: (id: string): Promise<void> => window.api.recipes.delete(id),
  pickFiles: (): Promise<string[]> => window.api.recipes.pickFiles(),
  ingest: (paths: string[]): Promise<void> => window.api.recipes.ingest(paths),
  onProgress: (cb: (p: IngestProgress) => void): (() => void) =>
    window.api.recipes.onProgress(cb)
}

export const tags = {
  suggest: (prefix: string, limit?: number): Promise<TagSuggestion[]> =>
    window.api.tags.suggest(prefix, limit)
}
