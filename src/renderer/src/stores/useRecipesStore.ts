import { create } from 'zustand'
import type { RecipeSummary } from '../../../shared/types'

interface RecipesState {
  items: RecipeSummary[]
  loading: boolean
  load(): Promise<void>
}

export const useRecipesStore = create<RecipesState>((set) => ({
  items: [],
  loading: false,
  async load() {
    set({ loading: true })
    try {
      const items = await window.api.recipes.list()
      set({ items, loading: false })
    } catch {
      set({ loading: false })
    }
  }
}))
