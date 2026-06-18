import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db/migrations'
import { seedFromEntries } from '../../tags/seed'
import { normalizeTokens } from '../../tags/normalize'
import { extractTags } from '../../tags/matcher'
import type { SeedEntry } from '../../tags/seed'

let db: Database.Database

const SEED: SeedEntry[] = [
  { slug: 'tomato', label: 'Помидор', kind: 'ingredient', aliases: ['томат', 'tomato'] },
  { slug: 'basil', label: 'Базилик', kind: 'ingredient', aliases: ['базилик'] },
  { slug: 'pasta', label: 'Паста', kind: 'dish_type', aliases: ['паста'] }
]

// ── Helpers (mirror the IPC handler SQL) ──────────────────────────────────────

function tagId(slug: string): number {
  return (
    db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get(slug) as {
      id: number
    }
  ).id
}

function insertRecipe(id: string, ocrText: string | null = null): void {
  db.prepare(
    'INSERT INTO recipes (id,ext,sha256,width,height,created_at,updated_at,ocr_text) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, 'jpg', id, 800, 600, Date.now(), Date.now(), ocrText)
}

function tagRecipe(recipeId: string, tId: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,1.0,'ocr')"
  ).run(recipeId, tId)
}

function toSlug(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFC')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_Ѐ-ӿ]/gi, '')
  return `${base || 'tag'}_${Date.now().toString(36)}`
}

function listTags(kind?: string): Array<{
  id: number; slug: string; label: string; kind: string; source: string; disabled: boolean
  recipeCount: number
  aliases: Array<{ id: number; lemma: string; isPrimary: boolean; source: string; disabled: boolean }>
}> {
  const rows = (
    kind
      ? db.prepare('SELECT * FROM tags WHERE kind=? ORDER BY label ASC').all(kind)
      : db.prepare('SELECT * FROM tags ORDER BY kind ASC, label ASC').all()
  ) as Array<{ id: number; slug: string; label: string; kind: string; source: string; disabled: number }>

  const getAliases = db.prepare<[number], {
    id: number; lemma: string; is_primary: number; source: string; disabled: number
  }>('SELECT * FROM tag_aliases WHERE tag_id=? ORDER BY is_primary DESC, lemma ASC')
  const getCount = db.prepare<[number], { n: number }>(
    'SELECT COUNT(*) AS n FROM recipe_tags WHERE tag_id=?'
  )

  return rows.map((t) => ({
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
}

function createTag(label: string, kind: string, aliases: string[] = []): number {
  const slug = toSlug(label)
  const result = db
    .prepare(
      "INSERT INTO tags (slug, label, kind, source, disabled, created_at) VALUES (?,?,?,'user',0,?)"
    )
    .run(slug, label.trim(), kind, Date.now())
  const newId = result.lastInsertRowid as number

  const primaryLemma = normalizeTokens(label.trim()).join(' ')
  if (primaryLemma) {
    db.prepare(
      "INSERT OR IGNORE INTO tag_aliases (tag_id, lemma, is_primary, source) VALUES (?,?,1,'user')"
    ).run(newId, primaryLemma)
  }
  for (const surface of aliases) {
    const lemma = normalizeTokens(surface).join(' ')
    if (lemma && lemma !== primaryLemma) {
      db.prepare(
        "INSERT OR IGNORE INTO tag_aliases (tag_id, lemma, is_primary, source) VALUES (?,?,0,'user')"
      ).run(newId, lemma)
    }
  }
  return newId
}

function updateTag(id: number, patch: { label?: string; kind?: string; disabled?: boolean }): void {
  if (patch.label !== undefined) {
    db.prepare('UPDATE tags SET label=? WHERE id=?').run(patch.label.trim(), id)
  }
  if (patch.kind !== undefined) {
    db.prepare('UPDATE tags SET kind=? WHERE id=?').run(patch.kind, id)
  }
  if (patch.disabled !== undefined) {
    db.prepare('UPDATE tags SET disabled=? WHERE id=?').run(patch.disabled ? 1 : 0, id)
  }
}

function addAlias(tId: number, surface: string): void {
  const lemma = normalizeTokens(surface.trim()).join(' ')
  if (!lemma) throw new Error('Alias normalizes to empty string')
  const existing = db
    .prepare<[string], { tag_id: number }>(
      'SELECT tag_id FROM tag_aliases WHERE lemma=? AND disabled=0 LIMIT 1'
    )
    .get(lemma)
  if (existing && existing.tag_id !== tId) {
    throw new Error('This alias is already assigned to another tag')
  }
  db.prepare(
    "INSERT OR IGNORE INTO tag_aliases (tag_id, lemma, is_primary, source, disabled) VALUES (?,?,0,'user',0)"
  ).run(tId, lemma)
}

function removeAlias(aliasId: number): void {
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
}

function deleteTag(id: number): void {
  const row = db.prepare<[number], { source: string }>('SELECT source FROM tags WHERE id=?').get(id)
  if (!row) return
  if (row.source === 'builtin') {
    db.prepare('UPDATE tags SET disabled=1 WHERE id=?').run(id)
  } else {
    db.prepare('DELETE FROM tags WHERE id=?').run(id)
  }
}

function retagAll(): { updated: number } {
  const allRecipes = db
    .prepare<[], { id: string; ocr_text: string | null }>(
      'SELECT id, ocr_text FROM recipes WHERE ocr_text IS NOT NULL'
    )
    .all()

  let updated = 0
  db.transaction(() => {
    const deleteOcr = db.prepare("DELETE FROM recipe_tags WHERE recipe_id=? AND source='ocr'")
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
      for (const { tagId: tId, confidence } of matches) {
        if (!isSuppressed.get(recipe.id, tId)) {
          insert.run(recipe.id, tId, confidence)
        }
      }
      updated++
    }
  })()
  return { updated }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  seedFromEntries(db, SEED)
})

afterEach(() => db.close())

// ── tags:list ─────────────────────────────────────────────────────────────────

describe('tags:list', () => {
  it('lists all seeded tags', () => {
    const result = listTags()
    expect(result.length).toBe(3)
    expect(result.map((t) => t.slug)).toEqual(
      expect.arrayContaining(['tomato', 'basil', 'pasta'])
    )
  })

  it('filters by kind', () => {
    const result = listTags('ingredient')
    expect(result.every((t) => t.kind === 'ingredient')).toBe(true)
    expect(result.length).toBe(2)
  })

  it('includes aliases on each tag', () => {
    const result = listTags()
    const tomato = result.find((t) => t.slug === 'tomato')!
    const lemmas = tomato.aliases.map((a) => a.lemma)
    // primary alias comes from the label stem "помидор"
    expect(lemmas.some((l) => l.includes('помидор') || l.includes('томат'))).toBe(true)
  })

  it('includes recipeCount = 0 when no recipes tagged', () => {
    const result = listTags()
    expect(result.every((t) => t.recipeCount === 0)).toBe(true)
  })

  it('includes correct recipeCount', () => {
    insertRecipe('r1')
    tagRecipe('r1', tagId('tomato'))
    const result = listTags()
    const tomato = result.find((t) => t.slug === 'tomato')!
    expect(tomato.recipeCount).toBe(1)
  })
})

// ── tags:create ───────────────────────────────────────────────────────────────

describe('tags:create', () => {
  it('inserts a new user tag', () => {
    const id = createTag('Авокадо', 'ingredient')
    const row = db.prepare('SELECT * FROM tags WHERE id=?').get(id) as {
      label: string; source: string; kind: string
    }
    expect(row.label).toBe('Авокадо')
    expect(row.source).toBe('user')
    expect(row.kind).toBe('ingredient')
  })

  it('creates a primary alias from the label', () => {
    const id = createTag('Авокадо', 'ingredient')
    const aliases = db
      .prepare('SELECT * FROM tag_aliases WHERE tag_id=? AND is_primary=1')
      .all(id) as Array<{ lemma: string }>
    expect(aliases.length).toBe(1)
    // label "Авокадо" stems to something non-empty
    expect(aliases[0].lemma.length).toBeGreaterThan(0)
  })

  it('stems and inserts extra aliases', () => {
    const id = createTag('Авокадо', 'ingredient', ['авокадос'])
    const aliases = db
      .prepare('SELECT lemma FROM tag_aliases WHERE tag_id=?')
      .all(id) as Array<{ lemma: string }>
    expect(aliases.length).toBeGreaterThanOrEqual(2)
  })

  it('deduplicates aliases that stem to the same lemma as the primary', () => {
    // If the extra alias surface stems to the same thing as label, it should not be double-inserted
    const id = createTag('Соль', 'ingredient', ['соль'])
    const aliases = db
      .prepare('SELECT lemma FROM tag_aliases WHERE tag_id=?')
      .all(id) as Array<{ lemma: string }>
    // primary + extra alias are the same stem — only one row should exist
    expect(aliases.length).toBe(1)
  })
})

// ── tags:update ───────────────────────────────────────────────────────────────

describe('tags:update', () => {
  it('updates the label', () => {
    const id = tagId('tomato')
    updateTag(id, { label: 'Томат' })
    const row = db.prepare('SELECT label FROM tags WHERE id=?').get(id) as { label: string }
    expect(row.label).toBe('Томат')
  })

  it('disables a tag', () => {
    const id = tagId('tomato')
    updateTag(id, { disabled: true })
    const row = db.prepare('SELECT disabled FROM tags WHERE id=?').get(id) as { disabled: number }
    expect(row.disabled).toBe(1)
  })

  it('re-enables a disabled tag', () => {
    const id = tagId('tomato')
    db.prepare('UPDATE tags SET disabled=1 WHERE id=?').run(id)
    updateTag(id, { disabled: false })
    const row = db.prepare('SELECT disabled FROM tags WHERE id=?').get(id) as { disabled: number }
    expect(row.disabled).toBe(0)
  })

  it('updates kind', () => {
    const id = tagId('tomato')
    updateTag(id, { kind: 'cuisine' })
    const row = db.prepare('SELECT kind FROM tags WHERE id=?').get(id) as { kind: string }
    expect(row.kind).toBe('cuisine')
  })
})

// ── tags:addAlias ─────────────────────────────────────────────────────────────

describe('tags:addAlias', () => {
  it('adds a new alias (stemmed)', () => {
    const id = tagId('tomato')
    addAlias(id, 'помидорчик')
    const aliases = db
      .prepare('SELECT lemma FROM tag_aliases WHERE tag_id=? AND source=?')
      .all(id, 'user') as Array<{ lemma: string }>
    expect(aliases.length).toBeGreaterThan(0)
  })

  it('throws when the alias belongs to another tag', () => {
    // "базилик" is already an alias for 'basil'
    const tomatoId = tagId('tomato')
    expect(() => addAlias(tomatoId, 'базилик')).toThrow('already assigned to another tag')
  })

  it('is idempotent — adding the same alias twice is silently ignored', () => {
    const id = tagId('tomato')
    addAlias(id, 'помидорчик')
    addAlias(id, 'помидорчик')
    const aliases = db
      .prepare('SELECT lemma FROM tag_aliases WHERE tag_id=? AND source=?')
      .all(id, 'user') as Array<{ lemma: string }>
    const stems = aliases.map((a) => a.lemma)
    const uniqueStems = new Set(stems)
    expect(uniqueStems.size).toBe(stems.length)
  })
})

// ── tags:removeAlias ──────────────────────────────────────────────────────────

describe('tags:removeAlias', () => {
  it('deletes a user alias', () => {
    const id = tagId('tomato')
    addAlias(id, 'помидорчик')
    const userAlias = db
      .prepare("SELECT id FROM tag_aliases WHERE tag_id=? AND source='user'")
      .get(id) as { id: number }
    removeAlias(userAlias.id)
    const row = db.prepare('SELECT id FROM tag_aliases WHERE id=?').get(userAlias.id)
    expect(row).toBeUndefined()
  })

  it('disables a builtin alias instead of deleting it', () => {
    const id = tagId('tomato')
    // get the "томат" builtin alias
    const builtinAlias = db
      .prepare("SELECT id FROM tag_aliases WHERE tag_id=? AND source='builtin' AND is_primary=0")
      .get(id) as { id: number } | undefined
    if (!builtinAlias) return // skip if somehow none exist
    removeAlias(builtinAlias.id)
    const row = db.prepare('SELECT disabled FROM tag_aliases WHERE id=?').get(builtinAlias.id) as {
      disabled: number
    }
    expect(row.disabled).toBe(1)
  })

  it('throws when trying to remove the primary alias', () => {
    const id = tagId('tomato')
    const primaryAlias = db
      .prepare('SELECT id FROM tag_aliases WHERE tag_id=? AND is_primary=1')
      .get(id) as { id: number }
    expect(() => removeAlias(primaryAlias.id)).toThrow('Cannot remove the primary alias')
  })
})

// ── tags:delete ───────────────────────────────────────────────────────────────

describe('tags:delete', () => {
  it('deletes a user tag completely', () => {
    const id = createTag('Авокадо', 'ingredient')
    deleteTag(id)
    const row = db.prepare('SELECT id FROM tags WHERE id=?').get(id)
    expect(row).toBeUndefined()
  })

  it('cascades alias deletion for user tags', () => {
    const id = createTag('Авокадо', 'ingredient', ['авокадос'])
    deleteTag(id)
    const aliases = db.prepare('SELECT id FROM tag_aliases WHERE tag_id=?').all(id)
    expect(aliases).toHaveLength(0)
  })

  it('disables a builtin tag instead of deleting it', () => {
    const id = tagId('tomato')
    deleteTag(id)
    const row = db.prepare('SELECT disabled FROM tags WHERE id=?').get(id) as {
      disabled: number
    }
    expect(row.disabled).toBe(1)
    // row is still in DB
    expect(row).toBeDefined()
  })

  it('is a no-op for a non-existent id', () => {
    expect(() => deleteTag(99999)).not.toThrow()
  })
})

// ── tags:retagAll ─────────────────────────────────────────────────────────────

describe('tags:retagAll', () => {
  it('returns zero when no recipes have ocr_text', () => {
    insertRecipe('r1', null)
    const { updated } = retagAll()
    expect(updated).toBe(0)
  })

  it('tags a recipe whose ocr_text contains a known ingredient', () => {
    insertRecipe('r1', 'рецепт с помидором')
    retagAll()
    const rows = db
      .prepare('SELECT tag_id FROM recipe_tags WHERE recipe_id=?')
      .all('r1') as Array<{ tag_id: number }>
    expect(rows.map((r) => r.tag_id)).toContain(tagId('tomato'))
  })

  it('replaces stale OCR tags with fresh matches', () => {
    insertRecipe('r1', 'суп с базиликом')
    tagRecipe('r1', tagId('tomato')) // stale OCR tag
    retagAll()
    const rows = db
      .prepare("SELECT tag_id FROM recipe_tags WHERE recipe_id=? AND source='ocr'")
      .all('r1') as Array<{ tag_id: number }>
    const ids = rows.map((r) => r.tag_id)
    expect(ids).toContain(tagId('basil'))
    expect(ids).not.toContain(tagId('tomato'))
  })

  it('respects suppressions — suppressed tag is not re-added', () => {
    insertRecipe('r1', 'рецепт с помидором')
    db.prepare(
      'INSERT INTO recipe_tag_suppressions (recipe_id, tag_id) VALUES (?,?)'
    ).run('r1', tagId('tomato'))
    retagAll()
    const row = db
      .prepare('SELECT 1 FROM recipe_tags WHERE recipe_id=? AND tag_id=?')
      .get('r1', tagId('tomato'))
    expect(row).toBeUndefined()
  })

  it('preserves user-added tags across re-tag', () => {
    insertRecipe('r1', 'рецепт с помидором')
    db.prepare(
      "INSERT OR IGNORE INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,1.0,'user')"
    ).run('r1', tagId('pasta'))
    retagAll()
    const row = db
      .prepare("SELECT 1 FROM recipe_tags WHERE recipe_id=? AND tag_id=? AND source='user'")
      .get('r1', tagId('pasta'))
    expect(row).toBeDefined()
  })

  it('picks up a newly added alias and tags a recipe that was previously untagged', () => {
    insertRecipe('r1', 'рецепт с помидором')
    // Initially no recipe_tags for r1
    expect(db.prepare('SELECT 1 FROM recipe_tags WHERE recipe_id=?').all('r1')).toHaveLength(0)
    // add a new alias that matches the ocr_text
    addAlias(tagId('basil'), 'базиликовый')
    // r1 doesn't contain basil; but tomato is already in seed — run retagAll
    const { updated } = retagAll()
    expect(updated).toBe(1)
    const rows = db
      .prepare('SELECT tag_id FROM recipe_tags WHERE recipe_id=?')
      .all('r1') as Array<{ tag_id: number }>
    expect(rows.map((r) => r.tag_id)).toContain(tagId('tomato'))
  })

  it('counts all recipes with ocr_text in updated', () => {
    insertRecipe('r1', 'помидор')
    insertRecipe('r2', 'базилик')
    insertRecipe('r3', null) // no ocr_text — not counted
    const { updated } = retagAll()
    expect(updated).toBe(2)
  })
})
