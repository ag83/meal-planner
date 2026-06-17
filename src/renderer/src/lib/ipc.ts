// Typed facade over window.api — import this instead of calling window.api directly.
import type { VaultInfo } from '../../../shared/types'

export const vault = {
  getCurrent: (): Promise<VaultInfo | null> => window.api.vault.getCurrent(),
  pick: (): Promise<VaultInfo | null> => window.api.vault.pick(),
  open: (vaultPath: string): Promise<VaultInfo> => window.api.vault.open(vaultPath)
}
