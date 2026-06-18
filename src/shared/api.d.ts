// Augments Window with the typed IPC surface exposed by the preload.
// Included by both tsconfig.node.json (preload) and tsconfig.web.json (renderer).
import type { VaultInfo, IngestProgress, RecipeSummary, RecipeFull, TagSuggestion } from './types'

declare global {
  interface Window {
    api: {
      vault: {
        getCurrent(): Promise<VaultInfo | null>
        pick(): Promise<VaultInfo | null>
        open(vaultPath: string): Promise<VaultInfo>
      }
      recipes: {
        list(): Promise<RecipeSummary[]>
        filterByTags(tagIds: number[], mode: 'and' | 'or'): Promise<RecipeSummary[]>
        get(id: string): Promise<RecipeFull | null>
        update(id: string, patch: { title?: string | null; notes?: string | null }): Promise<void>
        setTag(id: string, tagId: number, on: boolean): Promise<void>
        reOcr(id: string, lang?: string): Promise<void>
        delete(id: string): Promise<void>
        pickFiles(): Promise<string[]>
        ingest(paths: string[]): Promise<void>
        onProgress(cb: (p: IngestProgress) => void): () => void
      }
      tags: {
        suggest(prefix: string, limit?: number): Promise<TagSuggestion[]>
      }
    }
  }
}

export {}
