import { describe, it, expect } from 'vitest'
import {
  joinLines,
  dehyphenate,
  repairLookalikes,
  repairCase,
  repairDashes,
  repairStrayCapitals
} from '../postprocess'

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

  it('rejoins a word hyphenated across a column break, dropping the hyphen', () => {
    expect(joinLines(['Добавьте мел-', '', 'ко нарезанные перцы'])).toBe('Добавьте мелко нарезанные перцы')
  })

  it('keeps the paragraph break when the next block starts a new sentence', () => {
    expect(joinLines(['абзац один-', '', 'Абзац два'])).toBe('абзац один-\n\nАбзац два')
  })

  it('keeps the break after a spaced dash that ends a block', () => {
    expect(joinLines(['перец черный молотый -', '', 'соль - по вкусу'])).toBe(
      'перец черный молотый -\n\nсоль - по вкусу'
    )
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

describe('repairLookalikes with l', () => {
  it('reads a Latin l inside a Cyrillic word as л', () => {
    expect(repairLookalikes('Добавьте меl-')).toBe('Добавьте мел-')
  })

  it('leaves a wholly Latin token containing l alone', () => {
    expect(repairLookalikes('mail@all.ru')).toBe('mail@all.ru')
    expect(repairLookalikes('all')).toBe('all')
  })
})

describe('repairStrayCapitals', () => {
  it('lowercases a one-letter word capitalised in the middle of a sentence', () => {
    expect(repairStrayCapitals('лук С морковкой, добавьте. Залейте томатами И пастой')).toBe(
      'лук с морковкой, добавьте. Залейте томатами и пастой'
    )
  })

  it('keeps initials and a letter that starts a sentence', () => {
    expect(repairStrayCapitals('густым. И. С. Митянина. В казане на 5 л')).toBe('густым. И. С. Митянина. В казане на 5 л')
  })

  it('lowercases a time or weight unit printed in capitals after a number', () => {
    expect(repairStrayCapitals('тушите 2-3 МИН. Добавьте, 10 МИН, 500 Г муки')).toBe(
      'тушите 2-3 мин. Добавьте, 10 мин, 500 г муки'
    )
  })

  it('keeps a capitalised word that is not a unit', () => {
    expect(repairStrayCapitals('2 ГОСТ СВЧ')).toBe('2 ГОСТ СВЧ')
  })

  it('is applied by joinLines', () => {
    expect(joinLines(['обжарьте лук C морковкой', 'и пастой, 2-3 МИН.'])).toBe('обжарьте лук с морковкой и пастой, 2-3 мин.')
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
