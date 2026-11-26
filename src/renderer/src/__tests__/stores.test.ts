// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { recipes, settings, tags, vault } from '../lib/ipc'
import { useRecipesStore } from '../stores/useRecipesStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useTagFilterStore } from '../stores/useTagFilterStore'
import { aSuggestion, aSummary, installApi } from './helpers'

let api: ReturnType<typeof installApi>['api']

beforeEach(() => {
  api = installApi().api
  document.documentElement.className = ''
  useRecipesStore.setState({ items: [], loading: false })
  useSettingsStore.setState({ theme: 'system', loaded: false })
  useTagFilterStore.setState({ selectedTags: [], mode: 'and' })
})

describe('useRecipesStore', () => {
  it('loads recipes', async () => {
    api.recipes.list.mockResolvedValue([aSummary()])
    await useRecipesStore.getState().load()
    expect(useRecipesStore.getState()).toMatchObject({ items: [aSummary()], loading: false })
  })

  it('stops loading when the call fails', async () => {
    api.recipes.list.mockRejectedValue(new Error('x'))
    await useRecipesStore.getState().load()
    expect(useRecipesStore.getState()).toMatchObject({ items: [], loading: false })
  })
})

describe('useSettingsStore', () => {
  const isDark = (): boolean => document.documentElement.classList.contains('dark')

  it('loads settings and follows the system preference', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().loaded).toBe(true)
    expect(isDark()).toBe(true)
  })

  it('applies explicit themes on update', async () => {
    await useSettingsStore.getState().update({ theme: 'dark' })
    expect(isDark()).toBe(true)
    await useSettingsStore.getState().update({ theme: 'light' })
    expect(isDark()).toBe(false)
    await useSettingsStore.getState().update({})
    expect(useSettingsStore.getState().theme).toBe('light')
    expect(api.settings.update).toHaveBeenCalledTimes(3)
  })
})

describe('useTagFilterStore', () => {
  it('adds each tag once, removes, switches mode and clears', () => {
    const store = useTagFilterStore.getState()
    store.addTag(aSuggestion())
    store.addTag(aSuggestion())
    store.addTag(aSuggestion({ id: 11 }))
    expect(useTagFilterStore.getState().selectedTags.map((t) => t.id)).toEqual([10, 11])

    store.removeTag(10)
    store.setMode('or')
    expect(useTagFilterStore.getState()).toMatchObject({ mode: 'or' })
    expect(useTagFilterStore.getState().selectedTags).toHaveLength(1)

    store.clear()
    expect(useTagFilterStore.getState().selectedTags).toEqual([])
  })
})

describe('ipc facade', () => {
  it('forwards every call to window.api', async () => {
    const callback = vi.fn()
    await Promise.all([
      vault.getCurrent(),
      vault.pick(),
      vault.open('/v'),
      vault.openFolder(),
      recipes.list(),
      recipes.filterByTags([1], 'and'),
      recipes.get('a'),
      recipes.update('a', {}),
      recipes.setTag('a', 1, true),
      recipes.reOcr('a'),
      recipes.delete('a'),
      recipes.pickFiles(),
      recipes.ingest(['p']),
      tags.suggest('к', 3),
      tags.list('user'),
      tags.create({ label: 'a', kind: 'user' }),
      tags.update(1, {}),
      tags.addAlias(1, 'a'),
      tags.removeAlias(1),
      tags.delete(1),
      tags.retagAll(),
      settings.get(),
      settings.update({})
    ])
    recipes.onProgress(callback)

    for (const group of Object.values(api)) {
      for (const method of Object.values(group)) expect(method).toHaveBeenCalled()
    }
    expect(api.recipes.setTag).toHaveBeenCalledWith('a', 1, true)
  })
})
