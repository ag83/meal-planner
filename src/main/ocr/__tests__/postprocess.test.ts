import { describe, it, expect } from 'vitest'
import { joinLines, dehyphenate, repairLookalikes, repairCase, repairDashes } from '../postprocess'

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

describe('repairLookalikes', () => {
  it('turns Latin letters inside a Cyrillic word into Cyrillic', () => {
    expect(repairLookalikes('20 Г sveжego имбиря')).toBe('20 Г свежего имбиря')
    expect(repairLookalikes('расtiтельного масла')).toBe('растительного масла')
    expect(repairLookalikes('гпuбы')).toBe('гпибы')
  })

  it('repairs units glued to digits and punctuation', () => {
    expect(repairLookalikes('2CT.Л. меда ●100 MЛ')).toBe('2СТ.Л. меда ●100 МЛ')
  })

  it('leaves Latin words that contain a letter with no Cyrillic twin alone', () => {
    expect(repairLookalikes('e-mail Wi-Fi')).toBe('e-mail Wi-Fi')
  })

  it('repairs a whole word or single letter in Latin whose every letter has a twin', () => {
    expect(repairLookalikes('70 coyca барбекю')).toBe('70 соуса барбекю')
    expect(repairLookalikes('Сложить B миску')).toBe('Сложить В миску')
  })

  it('reads a caret as the л the display font draws', () => {
    expect(repairLookalikes('20 M^ масла')).toBe('20 Мл масла')
  })

  it('leaves Cyrillic text and digits untouched', () => {
    expect(repairLookalikes('Свинина «Вишневая» 700 г (6%)')).toBe('Свинина «Вишневая» 700 г (6%)')
  })

  it('is applied by joinLines after de-hyphenation', () => {
    expect(joinLines(['2 ст. л. расti-', 'тельного масла'])).toBe('2 ст. л. растительного масла')
  })
})

describe('repairCase', () => {
  it('lowercases capitals that follow a lowercase letter inside a word', () => {
    expect(repairCase('2 луКовицы, 45-60 миН, 15-20 мИн сВИНИНЫ')).toBe('2 луковицы, 45-60 мин, 15-20 мин свинины')
  })

  it('keeps a leading capital and all-caps words', () => {
    expect(repairCase('Ребра КГ СВИНЫХ МяКОТИ')).toBe('Ребра КГ СВИНЫХ Мякоти')
  })
})

describe('repairDashes', () => {
  it('turns a run of underscores into a dash', () => {
    expect(repairDashes('сверху __ подготовленные ребра')).toBe('сверху — подготовленные ребра')
  })

  it('leaves a single underscore alone', () => {
    expect(repairDashes('a_b')).toBe('a_b')
  })
})
