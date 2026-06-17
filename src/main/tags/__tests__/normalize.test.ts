import { describe, it, expect } from 'vitest'
import { tokenize, normalizeTokens, normalizeSurface } from '../normalize'

describe('tokenize', () => {
  it('splits Russian text into word tokens', () => {
    expect(tokenize('Жареная курица')).toEqual(['жареная', 'курица'])
  })

  it('strips punctuation between words', () => {
    expect(tokenize('суп, перец!')).toEqual(['суп', 'перец'])
  })

  it('filters single-character tokens', () => {
    expect(tokenize('с луком и морковью')).toEqual(['луком', 'морковью'])
  })

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('normalizeSurface — ё→е replacement', () => {
  it('treats ё and е as equivalent', () => {
    const withYo = normalizeSurface('Свёкла')
    const withYe = normalizeSurface('Свекла')
    expect(withYo).toBe(withYe)
  })

  it('normalizes Помидоры to the same stem as Помидор', () => {
    const singular = normalizeSurface('Помидор')
    const plural = normalizeSurface('Помидоры')
    expect(singular).toBe(plural)
  })
})

describe('normalizeSurface — general stemming', () => {
  it('lowercases input', () => {
    const upper = normalizeSurface('КУРИЦА')
    const lower = normalizeSurface('курица')
    expect(upper).toBe(lower)
  })

  it('produces space-joined stems for multi-word input', () => {
    const result = normalizeSurface('куриная грудка')
    expect(result).toContain(' ')
  })

  it('returns something for single-letter-only input', () => {
    // degenerate: all tokens filtered → falls back to preprocessed string
    const result = normalizeSurface('а')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('normalizeTokens', () => {
  it('stems Помидоры to the same as Помидор', () => {
    const [s] = normalizeTokens('Помидоры')
    const [p] = normalizeTokens('Помидор')
    expect(s).toBe(p)
  })

  it('returns an array of stemmed strings', () => {
    const tokens = normalizeTokens('жареная курица')
    expect(tokens).toHaveLength(2)
    tokens.forEach((t) => expect(typeof t).toBe('string'))
  })
})
