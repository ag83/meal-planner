// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import SettingsScreen from '../routes/settings'
import { useSettingsStore } from '../stores/useSettingsStore'
import { aTag, aVault, installApi } from './helpers'

let api: ReturnType<typeof installApi>['api']

const custom = aTag({
  id: 2,
  label: 'Моё',
  kind: 'user',
  source: 'user',
  disabled: false,
  aliases: []
})

beforeEach(() => {
  api = installApi().api
  api.tags.list.mockResolvedValue([aTag(), custom])
  useSettingsStore.setState({ theme: 'system', loaded: false })
})

afterEach(cleanup)

const renderSettings = async (): Promise<void> => {
  render(
    <MemoryRouter initialEntries={['/gallery', '/settings']} initialIndex={1}>
      <Routes>
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/gallery" element={<p>gallery page</p>} />
      </Routes>
    </MemoryRouter>
  )
  await screen.findByText('(2 tags)')
}

const click = (name: string): Promise<void> => userEvent.click(screen.getByRole('button', { name }))
const clickTitle = (title: string, index = 0): Promise<void> =>
  userEvent.click(screen.getAllByTitle(title)[index])

describe('Settings screen', () => {
  it('shows the vault and opens its folder', async () => {
    await renderSettings()
    expect(screen.getByText('/vault')).toBeTruthy()
    await click('Open folder')
    expect(api.vault.openFolder).toHaveBeenCalled()
  })

  it('handles a missing vault and switches to a picked one', async () => {
    api.vault.getCurrent.mockResolvedValue(null)
    await renderSettings()
    expect(screen.getByText('No vault loaded')).toBeTruthy()
    await click('Switch vault…')
    expect(api.tags.list).toHaveBeenCalledTimes(1)

    api.vault.pick.mockResolvedValue(aVault('/new'))
    await click('Switch vault…')
    expect(await screen.findByText('/new')).toBeTruthy()
    expect(api.tags.list).toHaveBeenCalledTimes(2)
  })

  it('changes the theme', async () => {
    await renderSettings()
    await userEvent.selectOptions(screen.getByDisplayValue('System default'), 'dark')
    expect(api.settings.update).toHaveBeenCalledWith({ theme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('does not reload settings already loaded', async () => {
    useSettingsStore.setState({ loaded: true })
    await renderSettings()
    expect(api.settings.get).not.toHaveBeenCalled()
  })

  it.each([
    [1, 'Done — 1 recipe updated.'],
    [2, 'Done — 2 recipes updated.']
  ])('re-tags %i recipes', async (updated, message) => {
    api.tags.retagAll.mockResolvedValue({ updated })
    await renderSettings()
    await click('Re-tag all')
    expect(await screen.findByText(message)).toBeTruthy()
  })

  it('filters the library by kind', async () => {
    await renderSettings()
    await click('Custom')
    expect(screen.queryByText('Курица')).toBeNull()
    expect(screen.getByText('Моё')).toBeTruthy()
    await click('Cuisine')
    expect(screen.queryByText('Моё')).toBeNull()
    await click('All')
    expect(screen.getByText('Курица')).toBeTruthy()
  })

  it('disables, re-enables and deletes tags', async () => {
    await renderSettings()
    await clickTitle('Disable')
    expect(api.tags.update).toHaveBeenCalledWith(1, { disabled: true })
    await clickTitle('Enable')
    expect(api.tags.update).toHaveBeenLastCalledWith(1, { disabled: false })

    await clickTitle('Delete tag')
    expect(api.tags.delete).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.queryByText('Моё')).toBeNull())
  })

  it('renames a tag, and ignores unchanged or cancelled edits', async () => {
    await renderSettings()
    const edit = async (): Promise<HTMLElement> => {
      await userEvent.dblClick(screen.getByText('Курица'))
      return screen.getByDisplayValue('Курица')
    }

    fireEvent.keyDown(await edit(), { key: 'Escape' })
    fireEvent.blur(await edit())
    expect(api.tags.update).not.toHaveBeenCalled()

    const field = await edit()
    fireEvent.change(field, { target: { value: ' Цыпа ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(api.tags.update).toHaveBeenCalledWith(1, { label: 'Цыпа' })
    expect(await screen.findByText('Цыпа')).toBeTruthy()
  })

  it('shows aliases and removes one', async () => {
    await renderSettings()
    await clickTitle('Show aliases')
    expect(screen.getByText('(primary)')).toBeTruthy()
    expect(screen.getByText('(custom)')).toBeTruthy()

    await clickTitle('Remove alias')
    expect(api.tags.removeAlias).toHaveBeenCalledWith(101)
    await waitFor(() => expect(screen.queryByText('(custom)')).toBeNull())
    await clickTitle('Show aliases')
    expect(screen.queryByText('(primary)')).toBeNull()
  })

  it('adds an alias, surfacing errors and allowing cancel', async () => {
    await renderSettings()
    await clickTitle('Show aliases')
    const field = (): HTMLElement => screen.getByPlaceholderText('e.g. томат')

    await click('+ Add alias')
    await click('Add')
    expect(api.tags.addAlias).not.toHaveBeenCalled()
    fireEvent.keyDown(field(), { key: 'Escape' })
    await click('+ Add alias')
    await click('Cancel')

    await click('+ Add alias')
    api.tags.addAlias.mockRejectedValueOnce(new Error('taken'))
    await userEvent.type(field(), 'пиле{Enter}')
    expect(await screen.findByText('taken')).toBeTruthy()

    api.tags.list.mockResolvedValue([aTag({ label: 'Курочка' }), custom])
    await userEvent.type(field(), 'й')
    expect(screen.queryByText('taken')).toBeNull()
    await click('Add')

    expect(api.tags.addAlias).toHaveBeenLastCalledWith(1, 'пилей')
    expect(await screen.findByText('Курочка')).toBeTruthy()
  })

  it('creates a tag and inserts it in the library', async () => {
    await renderSettings()
    await click('+ Add new tag')
    await click('Create')
    expect(screen.getByText('Label is required')).toBeTruthy()

    await userEvent.type(screen.getByPlaceholderText('Label (e.g. Авокадо)'), 'Авокадо')
    await userEvent.type(screen.getByPlaceholderText(/Aliases/), 'avocado, , авокадо')
    await userEvent.selectOptions(screen.getByDisplayValue('Ingredient'), 'cuisine')
    api.tags.list.mockResolvedValue([aTag({ id: 50, label: 'Авокадо', kind: 'cuisine' })])
    await click('Create')

    expect(api.tags.create).toHaveBeenCalledWith({
      label: 'Авокадо',
      kind: 'cuisine',
      aliases: ['avocado', 'авокадо']
    })
    expect(await screen.findByText('(3 tags)')).toBeTruthy()
  })

  it('reports a creation error and cancels the form', async () => {
    api.tags.create.mockRejectedValue(new Error('nope'))
    await renderSettings()
    await click('+ Add new tag')
    await userEvent.type(screen.getByPlaceholderText('Label (e.g. Авокадо)'), 'x')
    await click('Create')
    expect(await screen.findByText('nope')).toBeTruthy()
    await click('Cancel')
    expect(screen.getByRole('button', { name: '+ Add new tag' })).toBeTruthy()
  })

  it('navigates back', async () => {
    await renderSettings()
    await click('← Back')
    expect(screen.getByText('gallery page')).toBeTruthy()
  })
})
