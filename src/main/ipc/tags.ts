import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { vaultManager } from '../vault/manager'
import { normalizeTokens } from '../tags/normalize'
import { extractTags } from '../tags/matcher'

const toSlug = (label: string): string => {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFC')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_Ѐ-ӿ]/gi, '')
  return `${base || 'tag'}_${Date.now().toString(36)}`
}

type TagRow = {
  id: number
  slug: string
  label: string
  kind: string
  source: string
  disabled: number
}

type AliasRow = {
  id: number
  lemma: string
  is_primary: number
  source: string
  disabled: number
}

export const registerTagHandlers = (): void => {
  // ── suggest ───────────────────────────────────────────────────────────────

  ipcMain.handle('tags:suggest', (_event, prefix: unknown, limit: unknown) => {
    if (typeof prefix !== 'string' || !prefix.trim()) return []
    if (!vaultManager.getCurrent()) return []

    const db = getDb()
    const limitN = typeof limit === 'number' ? Math.min(limit, 50) : 20

    const stems = normalizeTokens(prefix)
    const stemmedFull = stems.join(' ')
    if (!stemmedFull) return []

    const rawLower = prefix.trim().toLowerCase().replace(/ё/g, 'е').normalize('NFC')

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

  // ── list ──────────────────────────────────────────────────────────────────

  ipcMain.handle('tags:list', (_event, kind: unknown) => {
    if (!vaultManager.getCurrent()) return []
    const db = getDb()
    const kindFilter = typeof kind === 'string' ? kind : null

    const tagRows = (
      kindFilter
        ? db.prepare('SELECT * FROM tags WHERE kind=? ORDER BY label ASC').all(kindFilter)
        : db.prepare('SELECT * FROM tags ORDER BY kind ASC, label ASC').all()
    ) as TagRow[]

    const getAliases = db.prepare<[number], AliasRow>(
      'SELECT * FROM tag_aliases WHERE tag_id=? ORDER BY is_primary DESC, lemma ASC'
    )
    const getCount = db.prepare<[number], { n: number }>(
      'SELECT COUNT(*) AS n FROM recipe_tags WHERE tag_id=?'
    )

    return tagRows.map((t) => ({
      id: t.id,
      slug: t.slug,
      label: t.label,
      kind: t.kind,
      source: t.source,
      disabled: !!t.disabled,
      recipeCount: (getCount.get(t.id) as { n: number }).n,
      aliases: getAliases.all(t.id).map((a) => ({
        id: a.id,
        lemma: a.lemma,
        isPrimary: !!a.is_primary,
        source: a.source,
        disabled: !!a.disabled
      }))
    }))
  })

  // ── create ────────────────────────────────────────────────────────────────

  ipcMain.handle('tags:create', (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid input')
    const { label, kind, aliases = [] } = input as {
      label: string
      kind: string
      aliases?: string[]
    }
    if (!label?.trim()) throw new Error('Label is required')
    if (!['ingredient', 'dish_type', 'cuisine', 'user'].includes(kind)) {
      throw new Error('Invalid kind')
    }

    const db = getDb()
    const slug = toSlug(label)

    return db.transaction(() => {
      const result = db
        .prepare(
          "INSERT INTO tags (slug, label, kind, source, disabled, created_at) VALUES (?,?,?,'user',0,?)"
        )
        .run(slug, label.trim(), kind, Date.now())

      const tagId = result.lastInsertRowid as number

      const primaryLemma = normalizeTokens(label.trim()).join(' ')
      if (primaryLemma) {
        db.prepare(
          "INSERT OR IGNORE INTO tag_aliases (tag_id, lemma, is_primary, source) VALUES (?,?,1,'user')"
        ).run(tagId, primaryLemma)
      }

      for (const surface of aliases) {
        const lemma = normalizeTokens(surface).join(' ')
        if (lemma && lemma !== primaryLemma) {
          db.prepare(
            "INSERT OR IGNORE INTO tag_aliases (tag_id, lemma, is_primary, source) VALUES (?,?,0,'user')"
          ).run(tagId, lemma)
        }
      }

      return tagId
    })()
  })

  // ── update ────────────────────────────────────────────────────────────────

  ipcMain.handle('tags:update', (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'number') throw new Error('Invalid tag id')
    if (!patch || typeof patch !== 'object') throw new Error('Invalid patch')
    const db = getDb()
    const { label, kind, disabled } = patch as Partial<{
      label: string
      kind: string
      disabled: boolean
    }>

    db.transaction(() => {
      if (label !== undefined) {
        if (!label.trim()) throw new Error('Label cannot be empty')
        db.prepare('UPDATE tags SET label=? WHERE id=?').run(label.trim(), id)
      }
      if (kind !== undefined) {
        db.prepare('UPDATE tags SET kind=? WHERE id=?').run(kind, id)
      }
      if (disabled !== undefined) {
        db.prepare('UPDATE tags SET disabled=? WHERE id=?').run(disabled ? 1 : 0, id)
      }
    })()
  })

  // ── addAlias ──────────────────────────────────────────────────────────────

  ipcMain.handle('tags:addAlias', (_event, tagId: unknown, surface: unknown) => {
    if (typeof tagId !== 'number') throw new Error('Invalid tag id')
    if (typeof surface !== 'string' || !surface.trim()) throw new Error('Invalid alias')

    const db = getDb()
    const lemma = normalizeTokens(surface.trim()).join(' ')
    if (!lemma) throw new Error('Alias normalizes to empty string')

    const existing = db
      .prepare<[string], { tag_id: number }>(
        'SELECT tag_id FROM tag_aliases WHERE lemma=? AND disabled=0 LIMIT 1'
      )
      .get(lemma)
    if (existing && existing.tag_id !== tagId) {
      throw new Error('This alias is already assigned to another tag')
    }

    db.prepare(
      "INSERT OR IGNORE INTO tag_aliases (tag_id, lemma, is_primary, source, disabled) VALUES (?,?,0,'user',0)"
    ).run(tagId, lemma)
  })

  // ── removeAlias ───────────────────────────────────────────────────────────

  ipcMain.handle('tags:removeAlias', (_event, aliasId: unknown) => {
    if (typeof aliasId !== 'number') throw new Error('Invalid alias id')
    const db = getDb()
    const row = db
      .prepare<[number], { source: string; is_primary: number }>(
        'SELECT source, is_primary FROM tag_aliases WHERE id=?'
      )
      .get(aliasId)
    if (!row) return
    if (row.is_primary) throw new Error('Cannot remove the primary alias')

    if (row.source === 'builtin') {
      db.prepare('UPDATE tag_aliases SET disabled=1 WHERE id=?').run(aliasId)
    } else {
      db.prepare('DELETE FROM tag_aliases WHERE id=?').run(aliasId)
    }
  })

  // ── delete ────────────────────────────────────────────────────────────────

  ipcMain.handle('tags:delete', (_event, id: unknown) => {
    if (typeof id !== 'number') throw new Error('Invalid tag id')
    const db = getDb()
    const row = db
      .prepare<[number], { source: string }>('SELECT source FROM tags WHERE id=?')
      .get(id)
    if (!row) return

    if (row.source === 'builtin') {
      db.prepare('UPDATE tags SET disabled=1 WHERE id=?').run(id)
    } else {
      db.prepare('DELETE FROM tags WHERE id=?').run(id)
    }
  })

  // ── retagAll ──────────────────────────────────────────────────────────────

  ipcMain.handle('tags:retagAll', () => {
    if (!vaultManager.getCurrent()) return { updated: 0 }
    const db = getDb()

    const allRecipes = db
      .prepare<[], { id: string; ocr_text: string | null }>(
        'SELECT id, ocr_text FROM recipes WHERE ocr_text IS NOT NULL'
      )
      .all()

    let updated = 0

    db.transaction(() => {
      const deleteOcr = db.prepare(
        "DELETE FROM recipe_tags WHERE recipe_id=? AND source='ocr'"
      )
      const isSuppressed = db.prepare<[string, number], { n: number }>(
        'SELECT 1 AS n FROM recipe_tag_suppressions WHERE recipe_id=? AND tag_id=?'
      )
      const insert = db.prepare(
        "INSERT OR IGNORE INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,?,'ocr')"
      )

      for (const recipe of allRecipes) {
        if (!recipe.ocr_text) continue
        const matches = extractTags(db, recipe.ocr_text)
        deleteOcr.run(recipe.id)
        for (const { tagId, confidence } of matches) {
          if (!isSuppressed.get(recipe.id, tagId)) {
            insert.run(recipe.id, tagId, confidence)
          }
        }
        updated++
      }
    })()

    return { updated }
  })
}
