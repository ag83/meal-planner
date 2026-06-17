// Typed facade over window.api — import this instead of calling window.api directly.
import type { VaultInfo, IngestProgress, RecipeSummary, TagSuggestion } from '../../../shared/types'

export const vault = {
  getCurrent: (): Promise<VaultInfo | null> => window.api.vault.getCurrent(),
  pick: (): Promise<VaultInfo | null> => window.api.vault.pick(),
  open: (vaultPath: string): Promise<VaultInfo> => window.api.vault.open(vaultPath)
}

export const recipes = {
  list: (): Promise<RecipeSummary[]> => window.api.recipes.list(),
  filterByTags: (tagIds: number[], mode: 'and' | 'or'): Promise<RecipeSummary[]> =>
    window.api.recipes.filterByTags(tagIds, mode),
  pickFiles: (): Promise<string[]> => window.api.recipes.pickFiles(),
  ingest: (paths: string[]): Promise<void> => window.api.recipes.ingest(paths),
  onProgress: (cb: (p: IngestProgress) => void): (() => void) =>
    window.api.recipes.onProgress(cb)
}

export const tags = {
  suggest: (prefix: string, limit?: number): Promise<TagSuggestion[]> =>
    window.api.tags.suggest(prefix, limit)
}
