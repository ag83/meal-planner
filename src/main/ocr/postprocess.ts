// A hyphen ending a line, preceded by a letter and followed by a lowercase letter,
// is typesetting hyphenation rather than a real hyphen — rejoin it.
const HYPHEN_BREAK = /(\p{L})-[ \t]*\n[ \t]*(\p{Ll})/gu

export const dehyphenate = (text: string): string => text.replace(HYPHEN_BREAK, '$1$2')

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
    .map((p) => dehyphenate(p.join('\n')).replace(/\n/g, ' '))
    .join('\n\n')
    .trim()
}
