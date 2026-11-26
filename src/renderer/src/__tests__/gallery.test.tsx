// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Gallery from '../routes/gallery'
import { useRecipesStore } from '../stores/useRecipesStore'
import { useTagFilterStore } from '../stores/useTagFilterStore'
import { aSuggestion, aSummary, aVault, installApi } from './helpers'

let api: ReturnType<typeof installApi>['api']
let progress: ReturnType<typeof installApi>['progress']

const items = [
  aSummary({ id: 'b', title: 'Борщ', createdAt: 1, tagCount: 1 }),
  aSummary({ id: 'a', title: 'Азу', createdAt: 3, tagCount: 2 }),
  aSummary({ id: 'c', title: null, createdAt: 2 })
]

beforeEach(() => {
  ;({ api, progress } = installApi())
  useRecipesStore.setState({ items: [], loading: false })
  useTagFilterStore.setState({ selectedTags: [], mode: 'and' })
  // jsdom has no layout: give the virtualizer a viewport and report a width.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback(
          [{ target, contentRect: { width: 600 } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver
        )
      }
      unobserve(): void {}
      disconnect(): void {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const renderGallery = (): void => {
  render(
    <MemoryRouter initialEntries={['/gallery']}>
      <Routes>
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/settings" element={<p>settings page</p>} />
        <Route path="/recipe/:id" element={<p>detail page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

const order = (): string[] =>
  screen.getAllByRole('link').map((a) => a.getAttribute('href') as string)

const click = (name: string): Promise<void> => userEvent.click(screen.getByRole('button', { name }))

describe('Gallery', () => {
  it('shows the empty state', async () => {
    renderGallery()
    expect(await screen.findByText(/Drop photos here/)).toBeTruthy()
  })

  it('does not load recipes without a vault', async () => {
    api.vault.getCurrent.mockResolvedValue(null)
    renderGallery()
    await screen.findByText(/Drop photos here/)
    expect(api.recipes.list).not.toHaveBeenCalled()
  })

  it('lists, counts and sorts recipes', async () => {
    api.recipes.list.mockResolvedValue(items)
    renderGallery()
    await screen.findByText('3 recipes')
    expect(order()).toEqual(['/recipe/a', '/recipe/c', '/recipe/b'])
    expect(screen.getByText('1 tag')).toBeTruthy()
    expect(screen.getByText('2 tags')).toBeTruthy()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'oldest')
    expect(order()).toEqual(['/recipe/b', '/recipe/c', '/recipe/a'])
    await userEvent.selectOptions(screen.getByRole('combobox'), 'title')
    expect(order()).toEqual(['/recipe/c', '/recipe/a', '/recipe/b'])
  })

  it('opens a recipe', async () => {
    api.recipes.list.mockResolvedValue([items[0]])
    renderGallery()
    await screen.findByText('1 recipe')
    await userEvent.click(screen.getByRole('link'))
    expect(screen.getByText('detail page')).toBeTruthy()
  })

  it('filters by selected tags with AND and OR', async () => {
    api.recipes.list.mockResolvedValue(items)
    api.recipes.filterByTags.mockResolvedValue([items[0]])
    api.tags.suggest.mockResolvedValue([aSuggestion()])
    renderGallery()
    await screen.findByText('3 recipes')

    await userEvent.type(screen.getByPlaceholderText('Поиск тегов…'), 'печ')
    fireEvent.mouseDown(await screen.findByText('Печень'))
    await screen.findByText('1 recipe')
    expect(api.recipes.filterByTags).toHaveBeenLastCalledWith([10], 'and')

    act(() => useTagFilterStore.getState().addTag(aSuggestion({ id: 11, label: 'Курица' })))
    await click('OR')
    await waitFor(() => expect(api.recipes.filterByTags).toHaveBeenLastCalledWith([10, 11], 'or'))
    await click('AND')
    await waitFor(() => expect(api.recipes.filterByTags).toHaveBeenLastCalledWith([10, 11], 'and'))

    await click('Remove Курица')
    await click('Clear all')
    await screen.findByText('3 recipes')
  })

  it('shows a no-match state when filtering fails and clears it', async () => {
    api.recipes.list.mockResolvedValue(items)
    api.recipes.filterByTags.mockRejectedValue(new Error('x'))
    useTagFilterStore.setState({ selectedTags: [aSuggestion()] })
    renderGallery()
    await screen.findByText('No recipes match the selected tags')
    await click('Clear filter')
    await screen.findByText('3 recipes')
  })

  it('ingests picked files and reports progress', async () => {
    let finish: () => void = () => undefined
    api.recipes.pickFiles.mockResolvedValue(['C:\\in\\a.jpg', '/in/b.jpg', '/in/c.jpg'])
    api.recipes.ingest.mockImplementation(
      () => new Promise<undefined>((resolve) => (finish = () => resolve(undefined)))
    )
    renderGallery()
    await click('+ Add Recipes')

    expect(screen.getByText('Adding recipes…')).toBeTruthy()
    act(() => progress.emit({ filePath: 'C:\\in\\a.jpg', status: 'ocr' }))
    expect(screen.getByText('OCR…')).toBeTruthy()
    act(() => {
      progress.emit({ filePath: 'C:\\in\\a.jpg', status: 'done' })
      progress.emit({ filePath: '/in/b.jpg', status: 'duplicate' })
      progress.emit({ filePath: '/in/c.jpg', status: 'error' })
    })
    expect(screen.getByText('a.jpg')).toBeTruthy()
    await act(async () => finish())

    expect(screen.getByText('1 added, 1 dup, 1 err')).toBeTruthy()
    await click('✕')
    expect(screen.queryByText('a.jpg')).toBeNull()
  })

  it('ignores an empty file pick', async () => {
    renderGallery()
    await click('+ Add Recipes')
    expect(api.recipes.ingest).not.toHaveBeenCalled()
  })

  it('shows the drop overlay and ingests dropped files', async () => {
    renderGallery()
    const surface = (await screen.findByRole('heading', { name: 'My Recipes' })).closest(
      'header'
    )!.parentElement!

    fireEvent.dragEnter(surface)
    fireEvent.dragEnter(surface)
    fireEvent.dragOver(surface)
    fireEvent.dragLeave(surface)
    expect(screen.getByText('Drop recipe photos')).toBeTruthy()
    fireEvent.dragLeave(surface)
    expect(screen.queryByText('Drop recipe photos')).toBeNull()

    await act(async () => {
      fireEvent.drop(surface, {
        dataTransfer: { files: [{ path: '/in/a.jpg' }, { path: '' }] }
      })
    })
    expect(api.recipes.ingest).toHaveBeenCalledWith(['/in/a.jpg'])
  })

  it('switches vault and reloads', async () => {
    renderGallery()
    await screen.findByText(/Drop photos here/)
    await click('Switch vault')
    expect(api.recipes.list).toHaveBeenCalledTimes(1)

    api.vault.pick.mockResolvedValue(aVault('/other'))
    await click('Switch vault')
    await waitFor(() => expect(api.recipes.list).toHaveBeenCalledTimes(2))
  })

  it('links to settings', async () => {
    renderGallery()
    await click('Settings')
    expect(screen.getByText('settings page')).toBeTruthy()
  })
})
