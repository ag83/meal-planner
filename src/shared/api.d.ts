// Augments Window with the typed IPC surface exposed by the preload.
// Included by both tsconfig.node.json (preload) and tsconfig.web.json (renderer).
import type { VaultInfo, IngestProgress } from './types'

declare global {
  interface Window {
    api: {
      vault: {
        getCurrent(): Promise<VaultInfo | null>
        pick(): Promise<VaultInfo | null>
        open(vaultPath: string): Promise<VaultInfo>
      }
      recipes: {
        pickFiles(): Promise<string[]>
        ingest(paths: string[]): Promise<void>
        onProgress(cb: (p: IngestProgress) => void): () => void
      }
    }
  }
}

export {}
