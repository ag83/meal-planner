import { create } from 'zustand'
import type { Settings } from '../../../shared/types'

interface SettingsState extends Settings {
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<Settings>): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'system',
  loaded: false,

  load: async () => {
    const s = await window.api.settings.get()
    set({ ...s, loaded: true })
    applyTheme(s.theme)
  },

  update: async (patch) => {
    await window.api.settings.update(patch)
    set(patch)
    if (patch.theme) applyTheme(patch.theme)
  }
}))

const applyTheme = (theme: Settings['theme']): void => {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    // system: follow prefers-color-scheme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}
