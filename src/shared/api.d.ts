// Augments Window with the typed IPC surface exposed by the preload.
// Included by both tsconfig.node.json (preload) and tsconfig.web.json (renderer).
import type { VaultInfo, IngestProgress, RecipeSummary, TagSuggestion } from './types'

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
