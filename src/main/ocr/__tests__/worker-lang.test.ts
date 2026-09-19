import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: (): string => '/tmp/meal-planner-test' } }))

describe('OCR language default', () => {
  it('defaults to Russian only, not rus+eng', async () => {
    const { DEFAULT_LANG } = await import('../worker')
    expect(DEFAULT_LANG).toBe('rus')
  })

  it('does not permit Latin glyphs via an eng traineddata', async () => {
    const { DEFAULT_LANG } = await import('../worker')
    expect(DEFAULT_LANG).not.toContain('eng')
  })
})
