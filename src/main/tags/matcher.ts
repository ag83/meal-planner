import type Database from 'better-sqlite3'
import { tokenize, normalizeTokens } from './normalize'

export interface TagMatch {
  tagId: number
  confidence: number
}

const MAX_WINDOW = 3

export const extractTags = (db: Database.Database, ocrText: string): TagMatch[] => {
  if (!ocrText.trim()) return []

  const surfaces = tokenize(ocrText)
  const stems = normalizeTokens(ocrText)
  if (stems.length === 0) return []

  const lookupStem = db.prepare<[string], { tag_id: number }>(
    "SELECT tag_id FROM tag_aliases WHERE lemma = ? AND disabled = 0 AND match_mode = 'stem' LIMIT 1"
  )
  const lookupExact = db.prepare<[string], { tag_id: number }>(
    "SELECT tag_id FROM tag_aliases WHERE lemma = ? AND disabled = 0 AND match_mode = 'exact' LIMIT 1"
  )

  const counts = new Map<number, number>()

  // Greedy longest-match-wins: a matched window consumes its tokens, so a phrase
  // never also fires the shorter aliases nested inside it.
  let i = 0
  while (i < stems.length) {
    let matched = 0
    for (let len = Math.min(MAX_WINDOW, stems.length - i); len >= 1; len--) {
      const exact = lookupExact.get(surfaces.slice(i, i + len).join(' '))
      const row = exact ?? lookupStem.get(stems.slice(i, i + len).join(' '))
      if (row) {
        counts.set(row.tag_id, (counts.get(row.tag_id) ?? 0) + 1)
        matched = len
        break
      }
    }
    i += matched > 0 ? matched : 1
  }

  if (counts.size === 0) return []

  const maxCount = Math.max(...counts.values())

  return Array.from(counts.entries()).map(([tagId, count]) => ({
    tagId,
    confidence: Math.min(1.0, count / maxCount)
  }))
}
