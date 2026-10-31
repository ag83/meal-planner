// A hyphen ending a line, preceded by a letter and followed by a lowercase letter,
// is typesetting hyphenation rather than a real hyphen — rejoin it.
const HYPHEN_BREAK = /(\p{L})-[ \t]*\n[ \t]*(\p{Ll})/gu

export const dehyphenate = (text: string): string => text.replace(HYPHEN_BREAK, '$1$2')

// The recognizer's dictionary carries Latin letters, and on stretched or stylised words it
// picks them for the Cyrillic they resemble (sveжego, расtiтельного, coyca). A token that
// already has Cyrillic in it is Russian, so its Latin letters are misreads. A token written
// wholly in Latin is repaired only when every letter has a Cyrillic twin, which spares e-mail.
// The display font draws л as a caret, so ^ reads as л in a token being repaired.
const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  a: 'а', c: 'с', e: 'е', g: 'г', i: 'и', k: 'к', m: 'м', o: 'о', p: 'р', s: 'с', t: 'т', u: 'и', v: 'в', x: 'х', y: 'у',
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
  '^': 'л'
}

// Latin l has no look-alike among Cyrillic capitals, but inside a Cyrillic word it is the
// rounded foot of л (меl-). A wholly Latin token with an l is left alone.
const LATIN_IN_CYRILLIC_ONLY: Readonly<Record<string, string>> = { l: 'л' }

const LATIN_OR_CARET = /[A-Za-z^]/g

const repairToken = (token: string): string => {
  const marks = token.match(LATIN_OR_CARET) ?? []
  if (marks.length === 0) return token
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(token)
  const hasLatin = marks.some((ch) => ch !== '^')
  if (!hasLatin) return token
  if (!hasCyrillic && !marks.every((ch) => ch in LATIN_TO_CYRILLIC)) return token
  return token.replace(
    LATIN_OR_CARET,
    (ch) => LATIN_TO_CYRILLIC[ch] ?? (hasCyrillic ? LATIN_IN_CYRILLIC_ONLY[ch] : undefined) ?? ch
  )
}

export const repairLookalikes = (text: string): string => text.replace(/\S+/gu, repairToken)

// Bold type with a tall x-height reads as capitals, and the recognizer sometimes flips only some
// letters of a word (луКовицы, миН). A capital after a lowercase letter inside one word is
// never Russian spelling, so the word is lowercased after its first letter.
export const repairCase = (text: string): string =>
  text.replace(/\p{Script=Cyrillic}+/gu, (word) =>
    /\p{Ll}\p{Lu}/u.test(word) ? word[0] + word.slice(1).toLowerCase() : word
  )

export const repairDashes = (text: string): string => text.replace(/_{2,}/g, '—')

// A bold face reads small words as capitals too: С, И in the middle of a sentence and МИН after
// a number. A one-letter capital counts only after a lowercase word or a comma and before a
// lowercase word, which spares initials (И. С. Митянина) and a sentence-opening В.
const STRAY_LETTER = /(?<=[\p{Ll},;] )[АВИКОСУЯ](?= \p{Ll})/gu
const CAPITAL_UNIT = /(?<=\d\s?)(?:МИН|ЧАС|ШТ|КГ|МЛ|Г|Л)(?!\p{L})/gu

export const repairStrayCapitals = (text: string): string =>
  text.replace(STRAY_LETTER, (ch) => ch.toLowerCase()).replace(CAPITAL_UNIT, (unit) => unit.toLowerCase())

const repairText = (text: string): string => repairStrayCapitals(repairDashes(repairCase(repairLookalikes(text))))

// A word broken at the foot of one column carries on at the top of the next block, which the
// layout makes a paragraph of its own. Same test as HYPHEN_BREAK: letter, hyphen, lowercase.
const mergeSplitWords = (paragraphs: string[][]): string[][] =>
  paragraphs.reduce<string[][]>((merged, paragraph) => {
    const last = merged[merged.length - 1]
    if (last && /\p{L}-$/u.test(last[last.length - 1]) && /^\p{Ll}/u.test(paragraph[0])) last.push(...paragraph)
    else merged.push([...paragraph])
    return merged
  }, [])

export const joinLines = (lines: string[]): string => {
  const paragraphs: string[][] = [[]]
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (paragraphs[paragraphs.length - 1].length > 0) paragraphs.push([])
    } else {
      paragraphs[paragraphs.length - 1].push(line.trim())
    }
  }

  return mergeSplitWords(paragraphs.filter((p) => p.length > 0))
    .map((p) => repairText(dehyphenate(p.join('\n')).replace(/\n/g, ' ')))
    .join('\n\n')
    .trim()
}
