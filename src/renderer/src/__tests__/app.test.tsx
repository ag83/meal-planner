// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import FirstRun from '../routes/first-run'
import Root from '../routes/root'
import { aVault, installApi } from './helpers'

let api: ReturnType<typeof installApi>['api']

beforeEach(() => {
  api = installApi().api
  window.location.hash = ''
})

afterEach(cleanup)

const renderAt = (element: React.JSX.Element): void => {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={element} />
        <Route path="/gallery" element={<p>gallery page</p>} />
        <Route path="/first-run" element={<p>first run page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Root', () => {
  it('goes to the gallery when a vault is open', async () => {
    renderAt(<Root />)
    expect(await screen.findByText('gallery page')).toBeTruthy()
  })

  it('goes to first run without a vault', async () => {
    api.vault.getCurrent.mockResolvedValue(null)
    renderAt(<Root />)
    expect(await screen.findByText('first run page')).toBeTruthy()
  })
})

describe('FirstRun', () => {
  const choose = (): Promise<void> =>
    userEvent.click(screen.getByRole('button', { name: 'Choose folder' }))

  it('opens the gallery after picking a folder', async () => {
    api.vault.pick.mockResolvedValue(aVault())
    renderAt(<FirstRun />)
    await choose()
    expect(await screen.findByText('gallery page')).toBeTruthy()
  })

  it('stays put when the picker is cancelled', async () => {
    renderAt(<FirstRun />)
    await choose()
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeTruthy()
  })

  it.each([
    [new Error('disk full'), 'disk full'],
    ['weird', 'Failed to open vault folder.']
  ])('shows a failure', async (failure, message) => {
    api.vault.pick.mockRejectedValue(failure)
    renderAt(<FirstRun />)
    await choose()
    expect(await screen.findByText(message)).toBeTruthy()
  })
})

describe('App', () => {
  it('routes from the root to first run', async () => {
    api.vault.getCurrent.mockResolvedValue(null)
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Choose folder' })).toBeTruthy()
  })

  it('mounts into #root from the entry point', async () => {
    api.vault.getCurrent.mockResolvedValue(null)
    vi.resetModules()
    document.body.innerHTML = '<div id="root"></div>'
    await import('../main')
    expect(await screen.findByText('Meal Planner')).toBeTruthy()
    document.body.innerHTML = ''
  })
})
