import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db/migrations'

let db: Database.Database

// Mirrors the AND/OR queries in src/main/ipc/recipes.ts
const filterByTags = (
  ids: number[],
  mode: 'and' | 'or'
): { id: string; tagCount: number }[] => {
  if (ids.length === 0) return []
  const ph = ids.map(() => '?').join(',')
  if (mode === 'and') {
    return db
      .prepare(
        `SELECT r.id, (SELECT COUNT(*) FROM recipe_tags WHERE recipe_id = r.id) AS tagCount
         FROM recipes r
         WHERE r.missing = 0
           AND r.id IN (
             SELECT recipe_id FROM recipe_tags
             WHERE tag_id IN (${ph})
             GROUP BY recipe_id
             HAVING COUNT(DISTINCT tag_id) = ?
           )
         ORDER BY r.created_at DESC`
      )
      .all([...ids, ids.length]) as { id: string; tagCount: number }[]
  } else {
    return db
      .prepare(
        `SELECT DISTINCT r.id, (SELECT COUNT(*) FROM recipe_tags WHERE recipe_id = r.id) AS tagCount
         FROM recipes r
         JOIN recipe_tags rt ON rt.recipe_id = r.id
         WHERE r.missing = 0 AND rt.tag_id IN (${ph})
         ORDER BY r.created_at DESC`
      )
      .all(ids) as { id: string; tagCount: number }[]
  }
}

// Helpers
const insertTag = (slug: string): number => {
  db.prepare(
    "INSERT INTO tags (slug,label,kind,source,created_at) VALUES (?,?,'ingredient','builtin',?)"
  ).run(slug, slug, Date.now())
  return (db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get(slug) as { id: number }).id
}

const insertRecipe = (id: string, missing = 0): void => {
  db.prepare(
    'INSERT INTO recipes (id,ext,sha256,created_at,updated_at,missing) VALUES (?,?,?,?,?,?)'
  ).run(id, 'jpg', id, Date.now(), Date.now(), missing)
}

const tagRecipe = (recipeId: string, tagId: number): void => {
  db.prepare(
    "INSERT INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,1.0,'ocr')"
  ).run(recipeId, tagId)
}

let tomatoId: number
let chickenId: number

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)

  tomatoId = insertTag('tomato')
  chickenId = insertTag('chicken')

  // r1: tomato + chicken
  insertRecipe('r1')
  tagRecipe('r1', tomatoId)
  tagRecipe('r1', chickenId)

  // r2: tomato only
  insertRecipe('r2')
  tagRecipe('r2', tomatoId)

  // r3: chicken only
  insertRecipe('r3')
  tagRecipe('r3', chickenId)
})

afterEach(() => db.close())

describe('recipes:filterByTags — AND mode', () => {
  it('returns empty for empty id list', () => {
    expect(filterByTags([], 'and')).toEqual([])
  })

  it('single tag returns all recipes with that tag', () => {
    const ids = filterByTags([tomatoId], 'and').map((r) => r.id)
    expect(ids).toContain('r1')
    expect(ids).toContain('r2')
    expect(ids).not.toContain('r3')
  })

  it('two tags returns only recipes with both', () => {
    const ids = filterByTags([tomatoId, chickenId], 'and').map((r) => r.id)
    expect(ids).toEqual(['r1'])
  })

  it('excludes missing=1 recipes', () => {
    insertRecipe('r4', 1)
    tagRecipe('r4', tomatoId)
    tagRecipe('r4', chickenId)
    const ids = filterByTags([tomatoId, chickenId], 'and').map((r) => r.id)
    expect(ids).not.toContain('r4')
  })

  it('tagCount reflects total tags on recipe, not just matching ones', () => {
    const results = filterByTags([tomatoId], 'and')
    const r1 = results.find((r) => r.id === 'r1')
    expect(r1?.tagCount).toBe(2) // r1 has both tomato + chicken
  })
})

describe('recipes:filterByTags — OR mode', () => {
  it('returns empty for empty id list', () => {
    expect(filterByTags([], 'or')).toEqual([])
  })

  it('single tag behaves same as AND with one tag', () => {
    const ids = filterByTags([tomatoId], 'or').map((r) => r.id)
    expect(ids).toContain('r1')
    expect(ids).toContain('r2')
    expect(ids).not.toContain('r3')
  })

  it('two tags returns recipes with any of them', () => {
    const ids = filterByTags([tomatoId, chickenId], 'or').map((r) => r.id)
    expect(ids).toContain('r1')
    expect(ids).toContain('r2')
    expect(ids).toContain('r3')
  })

  it('does not duplicate a recipe that matches both tags', () => {
    const results = filterByTags([tomatoId, chickenId], 'or')
    const r1Rows = results.filter((r) => r.id === 'r1')
    expect(r1Rows).toHaveLength(1)
  })

  it('excludes missing=1 recipes', () => {
    insertRecipe('r5', 1)
    tagRecipe('r5', tomatoId)
    const ids = filterByTags([tomatoId], 'or').map((r) => r.id)
    expect(ids).not.toContain('r5')
  })
})
