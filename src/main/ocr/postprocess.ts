// A hyphen ending a line, preceded by a letter and followed by a lowercase letter,
// is typesetting hyphenation rather than a real hyphen — rejoin it.
const HYPHEN_BREAK = /(\p{L})-[ \t]*\n[ \t]*(\p{Ll})/gu

export const dehyphenate = (text: string): string => text.replace(HYPHEN_BREAK, '$1$2')

// The recognizer's dictionary carries Latin letters, and on stretched or stylised words it
// picks them for the Cyrillic they resemble (sveжego, расtiтельного). A token that already has
// Cyrillic in it is Russian, so its Latin letters are misreads; a token with none is left alone
// (e-mail). Only letters with an unambiguous Cyrillic counterpart are mapped.
const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  a: 'а', c: 'с', e: 'е', g: 'г', i: 'и', k: 'к', m: 'м', o: 'о', p: 'р', s: 'с', t: 'т', u: 'и', v: 'в', x: 'х', y: 'у',
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У'
}

export const repairLookalikes = (text: string): string =>
  text.replace(/\S+/gu, (token) =>
    /\p{Script=Cyrillic}/u.test(token) ? token.replace(/[A-Za-z]/g, (ch) => LATIN_TO_CYRILLIC[ch] ?? ch) : token
  )

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
    .map((p) => repairLookalikes(dehyphenate(p.join('\n')).replace(/\n/g, ' ')))
    .join('\n\n')
    .trim()
}
