// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import Detail from '../routes/detail'
import { aRecipe, aSuggestion, installApi } from './helpers'

let api: ReturnType<typeof installApi>['api']

beforeEach(() => {
  api = installApi().api
})

afterEach(cleanup)

const renderDetail = (): void => {
  render(
    <MemoryRouter initialEntries={['/gallery', '/recipe/r1']} initialIndex={1}>
      <Routes>
        <Route path="/recipe/:id" element={<Detail />} />
        <Route path="/gallery" element={<p>gallery page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

const loaded = async (): Promise<void> => {
  renderDetail()
  await screen.findByDisplayValue('Борщ')
}

const click = (name: string): Promise<void> => userEvent.click(screen.getByRole('button', { name }))

describe('Detail', () => {
  it('shows the recipe with its metadata', async () => {
    await loaded()
    expect(screen.getByText('свекла')).toBeTruthy()
    expect(screen.getByText('OCR confidence: 88%')).toBeTruthy()
    expect(screen.getByText('100 × 80px')).toBeTruthy()
    expect(screen.getByTitle('Auto-extracted').textContent).toContain('Курица')
    expect(screen.getByTitle('Added by you').textContent).toContain('Суп')
  })

  it('copes with an empty recipe', async () => {
    api.recipes.get.mockResolvedValue(
      aRecipe({ title: null, notes: null, ocrText: null, ocrConf: null, tags: [] })
    )
    renderDetail()
    await screen.findByPlaceholderText('Untitled recipe')
    expect(screen.queryByText('OCR Text')).toBeNull()
  })

  it('says so when the recipe is missing and returns to the gallery', async () => {
    api.recipes.get.mockResolvedValue(null)
    renderDetail()
    await screen.findByText('Recipe not found.')
    await click('Back to gallery')
    expect(screen.getByText('gallery page')).toBeTruthy()
  })

  it('saves trimmed title and notes on blur, with null for blanks', async () => {
    await loaded()
    const title = screen.getByDisplayValue('Борщ')
    fireEvent.change(title, { target: { value: '  Щи  ' } })
    fireEvent.change(screen.getByDisplayValue('заметка'), { target: { value: '   ' } })
    fireEvent.blur(title)
    expect(api.recipes.update).toHaveBeenCalledWith('r1', { title: 'Щи', notes: null })

    fireEvent.change(title, { target: { value: '' } })
    fireEvent.change(screen.getByPlaceholderText('Your notes…'), { target: { value: 'n' } })
    fireEvent.blur(screen.getByPlaceholderText('Your notes…'))
    expect(api.recipes.update).toHaveBeenLastCalledWith('r1', { title: null, notes: 'n' })
  })

  it('removes and adds tags', async () => {
    await loaded()
    await click('Remove Курица')
    expect(api.recipes.setTag).toHaveBeenCalledWith('r1', 1, false)
    await waitFor(() => expect(screen.queryByText('Курица')).toBeNull())

    api.tags.suggest.mockResolvedValue([aSuggestion()])
    api.recipes.get.mockResolvedValue(
      aRecipe({
        tags: [{ tagId: 10, label: 'Печень', kind: 'ingredient', source: 'user', confidence: 1 }]
      })
    )
    await userEvent.type(screen.getByPlaceholderText('Add tag…'), 'печ')
    fireEvent.mouseDown(await screen.findByText('Печень'))

    expect(api.recipes.setTag).toHaveBeenLastCalledWith('r1', 10, true)
    expect(await screen.findByRole('button', { name: 'Remove Печень' })).toBeTruthy()
  })

  it('re-runs OCR and shows the new text', async () => {
    await loaded()
    api.recipes.get.mockResolvedValue(aRecipe({ ocrText: 'новый текст' }))
    await click('Re-run')
    expect(api.recipes.reOcr).toHaveBeenCalledWith('r1')
    expect(await screen.findByText('новый текст')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Re-run' })).toBeTruthy()
  })

  it('can cancel deletion', async () => {
    await loaded()
    await click('Delete')
    await click('Cancel')
    expect(screen.queryByText('Delete this recipe?')).toBeNull()
    expect(api.recipes.delete).not.toHaveBeenCalled()
  })

  it('deletes after confirmation', async () => {
    await loaded()
    await click('Delete')
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    expect(api.recipes.delete).toHaveBeenCalledWith('r1')
    expect(await screen.findByText('gallery page')).toBeTruthy()
  })

  it('navigates back', async () => {
    await loaded()
    await click('← Back')
    expect(screen.getByText('gallery page')).toBeTruthy()
  })
})
