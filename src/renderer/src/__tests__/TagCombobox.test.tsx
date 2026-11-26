// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TagCombobox } from '../components/TagCombobox'
import { aSuggestion, installApi } from './helpers'

let api: ReturnType<typeof installApi>['api']
const onSelect = vi.fn()

beforeEach(() => {
  api = installApi().api
  onSelect.mockReset()
  api.tags.suggest.mockResolvedValue([
    aSuggestion(),
    aSuggestion({ id: 11, label: 'Курица', recipeCount: 0 }),
    aSuggestion({ id: 12, label: 'Курага' })
  ])
})

afterEach(cleanup)

const input = (): HTMLInputElement => screen.getByPlaceholderText('Поиск тегов…')

describe('TagCombobox', () => {
  it('suggests unselected tags and picks one', async () => {
    render(<TagCombobox selectedIds={new Set([12])} onSelect={onSelect} />)
    await userEvent.type(input(), 'кур')

    const option = await screen.findByText('Печень')
    expect(screen.queryByText('Курага')).toBeNull()
    fireEvent.mouseDown(option)

    expect(onSelect).toHaveBeenCalledWith(aSuggestion())
    expect(input().value).toBe('')
    expect(screen.queryByText('Курица')).toBeNull()
  })

  it('closes on an outside click and reopens on focus', async () => {
    const selected = new Set<number>()
    render(<TagCombobox selectedIds={selected} onSelect={onSelect} />)
    await userEvent.type(input(), 'кур')
    await screen.findByText('Печень')

    fireEvent.mouseDown(screen.getByText('Печень').closest('ul')!)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Печень')).toBeNull()

    input().blur()
    fireEvent.focus(input())
    expect(screen.getByText('Печень')).toBeTruthy()
  })

  it('clears suggestions when the query is emptied', async () => {
    const selected = new Set<number>()
    render(<TagCombobox selectedIds={selected} onSelect={onSelect} />)
    await userEvent.type(input(), 'к')
    await screen.findByText('Печень')

    await userEvent.clear(input())

    await waitFor(() => expect(screen.queryByText('Печень')).toBeNull())
    fireEvent.focus(input())
    expect(screen.queryByText('Печень')).toBeNull()
  })
})
