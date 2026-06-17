import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { vaultManager } from '../vault/manager'
import { normalizeTokens } from '../tags/normalize'

export function registerTagHandlers(): void {
  ipcMain.handle('tags:suggest', (_event, prefix: unknown, limit: unknown) => {
    if (typeof prefix !== 'string' || !prefix.trim()) return []
    if (!vaultManager.getCurrent()) return []

    const db = getDb()
    const limitN = typeof limit === 'number' ? Math.min(limit, 50) : 20

    const stems = normalizeTokens(prefix)
    const stemmedFull = stems.join(' ')
    if (!stemmedFull) return []

    const rawLower = prefix.trim().toLowerCase().replace(/ё/g, 'е').normalize('NFC')

    // §7.3: alias prefix/exact match UNION label prefix match, ordered by recipe count
    return db
      .prepare(
        `
        SELECT t.id, t.label, t.kind,
               (SELECT COUNT(*) FROM recipe_tags WHERE tag_id = t.id) AS recipeCount
        FROM tags t
        WHERE t.disabled = 0
          AND t.id IN (
            SELECT tag_id FROM tag_aliases
            WHERE disabled = 0
              AND (lemma LIKE ? OR lemma = ?)
          )
        UNION
        SELECT t.id, t.label, t.kind,
               (SELECT COUNT(*) FROM recipe_tags WHERE tag_id = t.id) AS recipeCount
        FROM tags t
        WHERE t.disabled = 0
          AND lower(t.label) LIKE ?
        ORDER BY recipeCount DESC, label ASC
        LIMIT ?
      `
      )
      .all(stemmedFull + '%', stemmedFull, rawLower + '%', limitN)
  })
}
