import { describe, it, expect } from 'vitest'
import { joinLines, dehyphenate } from '../postprocess'

describe('dehyphenate', () => {
  it('rejoins a word broken across lines', () => {
    expect(dehyphenate('поми-\nдоры')).toBe('помидоры')
  })

  it('rejoins the real magazine break ин-/дейку', () => {
    expect(dehyphenate('кубиками ин-\nдейку, обжарьте')).toBe('кубиками индейку, обжарьте')
  })

  it('rejoins across a line with trailing whitespace', () => {
    expect(dehyphenate('па-  \n  сту')).toBe('пасту')
  })

  it('does not join when the next line starts uppercase', () => {
    expect(dehyphenate('что-\nТо')).toBe('что-\nТо')
  })

  it('does not join when the hyphen is surrounded by spaces', () => {
    expect(dehyphenate('соль - \nпо вкусу')).toBe('соль - \nпо вкусу')
  })

  it('leaves text without hyphenated breaks unchanged', () => {
    expect(dehyphenate('первая строка\nвторая строка')).toBe('первая строка\nвторая строка')
  })
})

describe('joinLines', () => {
  it('collapses lines of one paragraph into a single line', () => {
    expect(joinLines(['первая часть', 'вторая часть'])).toBe('первая часть вторая часть')
  })

  it('preserves a paragraph break marked by a blank line', () => {
    expect(joinLines(['абзац один', '', 'абзац два'])).toBe('абзац один\n\nабзац два')
  })

  it('rejoins hyphenated breaks across the line boundary', () => {
    expect(joinLines(['нарежьте ин-', 'дейку кубиками'])).toBe('нарежьте индейку кубиками')
  })

  it('collapses runs of blank lines into one paragraph break', () => {
    expect(joinLines(['раз', '', '', '', 'два'])).toBe('раз\n\nдва')
  })

  it('trims leading and trailing whitespace', () => {
    expect(joinLines(['', '  текст  ', ''])).toBe('текст')
  })

  it('returns an empty string for no lines', () => {
    expect(joinLines([])).toBe('')
  })
})
