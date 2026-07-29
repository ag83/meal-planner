import type Database from 'better-sqlite3'
import { normalizeTokens } from './normalize'

export interface TagMatch {
  tagId: number
  confidence: number
}

export const extractTags = (db: Database.Database, ocrText: string): TagMatch[] => {
  if (!ocrText.trim()) return []

  const stems = normalizeTokens(ocrText)
  if (stems.length === 0) return []

  const lookup = db.prepare<[string], { tag_id: number }>(
    'SELECT tag_id FROM tag_aliases WHERE lemma = ? AND disabled = 0 LIMIT 1'
  )

  const counts = new Map<number, number>()

  // Slide 1–3-token windows over the stemmed OCR stream
  for (let i = 0; i < stems.length; i++) {
    for (let len = 1; len <= 3 && i + len <= stems.length; len++) {
      const window = stems.slice(i, i + len).join(' ')
      const row = lookup.get(window)
      if (row) {
        counts.set(row.tag_id, (counts.get(row.tag_id) ?? 0) + 1)
      }
    }
  }

  if (counts.size === 0) return []

  const maxCount = Math.max(...counts.values())

  return Array.from(counts.entries()).map(([tagId, count]) => ({
    tagId,
    confidence: Math.min(1.0, count / maxCount)
  }))
}
