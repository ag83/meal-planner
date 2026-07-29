import { PorterStemmerRu } from 'natural'

// One Segmenter instance — construction is cheap but we avoid recreating it per call.
const segmenter = new Intl.Segmenter('ru', { granularity: 'word' })

const preprocess = (text: string): string => {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е') // ё and е are treated as the same letter
}

// Split text into word-like tokens (strips punctuation, spaces, digits).
export const tokenize = (text: string): string[] => {
  return Array.from(segmenter.segment(preprocess(text)))
    .filter((s) => s.isWordLike && s.segment.length > 1)
    .map((s) => s.segment)
}

// Return the stemmed token stream for a block of text (used during ingest).
export const normalizeTokens = (text: string): string[] => {
  return tokenize(text).map((w) => PorterStemmerRu.stem(w))
}

// Normalize a single surface form (word or short phrase) to a space-joined stem string.
// This is the canonical representation stored in tag_aliases.lemma.
export const normalizeSurface = (surface: string): string => {
  const stems = normalizeTokens(surface)
  return stems.length > 0 ? stems.join(' ') : preprocess(surface).trim()
}
