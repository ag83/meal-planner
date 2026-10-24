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

const LATIN_OR_CARET = /[A-Za-z^]/g

const repairToken = (token: string): string => {
  const marks = token.match(LATIN_OR_CARET) ?? []
  if (marks.length === 0) return token
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(token)
  const hasLatin = marks.some((ch) => ch !== '^')
  if (!hasLatin) return token
  if (!hasCyrillic && !marks.every((ch) => ch in LATIN_TO_CYRILLIC)) return token
  return token.replace(LATIN_OR_CARET, (ch) => LATIN_TO_CYRILLIC[ch] ?? ch)
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

const repairText = (text: string): string => repairDashes(repairCase(repairLookalikes(text)))

export const joinLines = (lines: string[]): string => {
  const paragraphs: string[][] = [[]]
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (paragraphs[paragraphs.length - 1].length > 0) paragraphs.push([])
    } else {
      paragraphs[paragraphs.length - 1].push(line.trim())
    }
  }

  return paragraphs
    .filter((p) => p.length > 0)
    .map((p) => repairText(dehyphenate(p.join('\n')).replace(/\n/g, ' ')))
    .join('\n\n')
    .trim()
}
