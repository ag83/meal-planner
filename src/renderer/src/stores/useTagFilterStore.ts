import { create } from 'zustand'
import type { TagSuggestion } from '../../../shared/types'

interface TagFilterState {
  selectedTags: TagSuggestion[]
  mode: 'and' | 'or'
  addTag: (tag: TagSuggestion) => void
  removeTag: (id: number) => void
  setMode: (mode: 'and' | 'or') => void
  clear: () => void
}

export const useTagFilterStore = create<TagFilterState>((set, get) => ({
  selectedTags: [],
  mode: 'and',
  addTag: (tag) => {
    if (get().selectedTags.some((t) => t.id === tag.id)) return
    set((s) => ({ selectedTags: [...s.selectedTags, tag] }))
  },
  removeTag: (id) => set((s) => ({ selectedTags: s.selectedTags.filter((t) => t.id !== id) })),
  setMode: (mode) => set({ mode }),
  clear: () => set({ selectedTags: [] })
}))
