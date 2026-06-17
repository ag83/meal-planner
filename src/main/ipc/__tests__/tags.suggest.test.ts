import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db/migrations'
import { seedFromEntries } from '../../tags/seed'
import { normalizeTokens } from '../../tags/normalize'
import type { SeedEntry } from '../../tags/seed'

let db: Database.Database

const SEED: SeedEntry[] = [
  {
    slug: 'tomato',
    label: 'Помидор',
    kind: 'ingredient',
    aliases: ['помидоры', 'томат', 'томаты']
  },
  { slug: 'basil', label: 'Базилик', kind: 'ingredient', aliases: ['базилик'] },
  { slug: 'soup', label: 'Суп', kind: 'dish_type', aliases: ['суп', 'супы'] },
  { slug: 'italian', label: 'Итальянская кухня', kind: 'cuisine', aliases: ['итальянская'] }
]

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  seedFromEntries(db, SEED)
})

afterEach(() => db.close())

// Mirrors the query in src/main/ipc/tags.ts
function suggestTags(
  prefix: string,
  limit = 20
): { id: number; label: string; kind: string; recipeCount: number }[] {
  const stems = normalizeTokens(prefix)
  const stemmedFull = stems.join(' ')
  if (!stemmedFull) return []
  const rawLower = prefix.trim().toLowerCase().replace(/ё/g, 'е').normalize('NFC')
  return db
    .prepare(
      `SELECT t.id, t.label, t.kind,
              (SELECT COUNT(*) FROM recipe_tags WHERE tag_id = t.id) AS recipeCount
       FROM tags t
       WHERE t.disabled = 0
         AND t.id IN (
           SELECT tag_id FROM tag_aliases
           WHERE disabled = 0 AND (lemma LIKE ? OR lemma = ?)
         )
       UNION
       SELECT t.id, t.label, t.kind,
              (SELECT COUNT(*) FROM recipe_tags WHERE tag_id = t.id) AS recipeCount
       FROM tags t
       WHERE t.disabled = 0 AND lower(t.label) LIKE ?
       ORDER BY recipeCount DESC, label ASC
       LIMIT ?`
    )
    .all(stemmedFull + '%', stemmedFull, rawLower + '%', limit) as {
    id: number
    label: string
    kind: string
    recipeCount: number
  }[]
}

describe('tags:suggest query', () => {
  it('returns empty for empty input', () => {
    expect(suggestTags('')).toEqual([])
  })

  it('matches by alias stem prefix — "том" → Помидор', () => {
    const results = suggestTags('том')
    const labels = results.map((r) => r.label)
    expect(labels).toContain('Помидор')
  })

  it('matches by label prefix — "Баз" → Базилик', () => {
    const results = suggestTags('Баз')
    const labels = results.map((r) => r.label)
    expect(labels).toContain('Базилик')
  })

  it('matches by label prefix case-insensitively — "суп" → Суп', () => {
    const results = suggestTags('суп')
    const labels = results.map((r) => r.label)
    expect(labels).toContain('Суп')
  })

  it('matches multi-word label prefix — "итал" → Итальянская кухня', () => {
    const results = suggestTags('итал')
    const labels = results.map((r) => r.label)
    expect(labels).toContain('Итальянская кухня')
  })

  it('returns only canonical label — alias "томат" never appears as a label', () => {
    const results = suggestTags('том')
    const labels = results.map((r) => r.label)
    expect(labels).not.toContain('томат')
    expect(labels).not.toContain('Томат')
  })

  it('does not return disabled tags', () => {
    db.prepare("UPDATE tags SET disabled = 1 WHERE slug = 'tomato'").run()
    const results = suggestTags('том')
    const labels = results.map((r) => r.label)
    expect(labels).not.toContain('Помидор')
  })

  it('does not return results from disabled aliases', () => {
    db.prepare(
      "UPDATE tag_aliases SET disabled = 1 WHERE lemma LIKE 'томат%'"
    ).run()
    const results = suggestTags('томат')
    const labels = results.map((r) => r.label)
    expect(labels).not.toContain('Помидор')
  })

  it('respects the limit parameter', () => {
    const results = suggestTags('а', 1)
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it('deduplicates — tag matching both alias and label appears once', () => {
    // "суп" matches both the alias lemma and the label prefix
    const results = suggestTags('суп')
    const soupRows = results.filter((r) => r.label === 'Суп')
    expect(soupRows).toHaveLength(1)
  })

  it('returns recipeCount = 0 when no recipes have the tag', () => {
    const results = suggestTags('том')
    const tomato = results.find((r) => r.label === 'Помидор')
    expect(tomato?.recipeCount).toBe(0)
  })

  it('returns correct recipeCount when recipes are tagged', () => {
    const tagId = (
      db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug = ?').get('tomato') as {
        id: number
      }
    ).id
    // Insert 2 fake recipes with the tomato tag
    for (const rid of ['r1', 'r2']) {
      db.prepare(
        'INSERT INTO recipes (id,ext,sha256,created_at,updated_at) VALUES (?,?,?,?,?)'
      ).run(rid, 'jpg', rid, Date.now(), Date.now())
      db.prepare(
        "INSERT INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,1.0,'ocr')"
      ).run(rid, tagId)
    }
    const results = suggestTags('том')
    const tomato = results.find((r) => r.label === 'Помидор')
    expect(tomato?.recipeCount).toBe(2)
  })

  it('orders results by recipeCount desc then label asc', () => {
    const basilId = (
      db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug = ?').get('basil') as {
        id: number
      }
    ).id
    // Give basil 3 recipes so it ranks above any other match
    for (let i = 0; i < 3; i++) {
      const rid = `rb${i}`
      db.prepare(
        'INSERT INTO recipes (id,ext,sha256,created_at,updated_at) VALUES (?,?,?,?,?)'
      ).run(rid, 'jpg', rid, Date.now(), Date.now())
      db.prepare(
        "INSERT INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,1.0,'ocr')"
      ).run(rid, basilId)
    }
    // 'ба' is long enough to pass the length>1 token filter and matches only Базилик in seed
    const results = suggestTags('ба')
    const basilIdx = results.findIndex((r) => r.label === 'Базилик')
    expect(basilIdx).toBe(0)
  })
})
