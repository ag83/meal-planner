// Augments Window with the typed IPC surface exposed by the preload.
// Included by both tsconfig.node.json (preload) and tsconfig.web.json (renderer).
import type { VaultInfo } from './types'

declare global {
  interface Window {
    api: {
      vault: {
        getCurrent(): Promise<VaultInfo | null>
        pick(): Promise<VaultInfo | null>
        open(vaultPath: string): Promise<VaultInfo>
      }
    }
  }
}

export {}
