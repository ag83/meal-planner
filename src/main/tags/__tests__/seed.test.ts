import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db/migrations'
import { seedFromEntries } from '../seed'
import type { SeedEntry } from '../seed'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

const ENTRIES: SeedEntry[] = [
  {
    slug: 'tomato',
    label: 'Помидор',
    kind: 'ingredient',
    aliases: ['помидоры', 'томат', 'томаты']
  },
  {
    slug: 'soup',
    label: 'Суп',
    kind: 'dish_type',
    aliases: ['супчик', 'бульон']
  }
]

describe('seedFromEntries', () => {
  it('inserts tags', () => {
    seedFromEntries(db, ENTRIES)
    const count = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM tags').get()!.n
    expect(count).toBe(2)
  })

  it('inserts aliases including the primary label stem', () => {
    seedFromEntries(db, ENTRIES)
    const aliases = db
      .prepare<[], { lemma: string }>('SELECT lemma FROM tag_aliases')
      .all()
      .map((r) => r.lemma)
    // At least one alias per tag
    expect(aliases.length).toBeGreaterThanOrEqual(2)
  })

  it('is idempotent — running twice inserts no duplicates', () => {
    seedFromEntries(db, ENTRIES)
    seedFromEntries(db, ENTRIES)

    const tagCount = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM tags').get()!.n
    expect(tagCount).toBe(2)

    const aliasCount = db
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM tag_aliases')
      .get()!.n
    const firstRun = db
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM tag_aliases')
      .get()!.n
    expect(aliasCount).toBe(firstRun)
  })

  it('deduplicates aliases that stem to the same lemma', () => {
    // 'помидоры' and 'помидор' should stem identically
    const entries: SeedEntry[] = [
      {
        slug: 'tomato',
        label: 'Помидор',
        kind: 'ingredient',
        aliases: ['помидоры', 'помидор'] // same stem as label
      }
    ]
    seedFromEntries(db, entries)

    const aliases = db
      .prepare<[string], { lemma: string }>('SELECT lemma FROM tag_aliases WHERE tag_id = (SELECT id FROM tags WHERE slug = ?)')
      .all('tomato')
    const lemmas = aliases.map((r) => r.lemma)
    // No duplicate lemma strings
    expect(new Set(lemmas).size).toBe(lemmas.length)
  })

  it('marks primary alias correctly', () => {
    seedFromEntries(db, [ENTRIES[0]])
    const primary = db
      .prepare<[string], { lemma: string; is_primary: number }>(
        'SELECT lemma, is_primary FROM tag_aliases WHERE tag_id = (SELECT id FROM tags WHERE slug = ?) AND is_primary = 1'
      )
      .all('tomato')
    expect(primary.length).toBe(1)
  })

  it('does not overwrite existing user tags on re-seed', () => {
    // Insert a user tag with the same slug — seed should leave it alone.
    db.prepare(
      `INSERT INTO tags (slug, label, kind, source, created_at) VALUES ('tomato','МойПомидор','ingredient','user',1)`
    ).run()
    seedFromEntries(db, ENTRIES)
    const row = db.prepare<[string], { label: string; source: string }>(
      'SELECT label, source FROM tags WHERE slug = ?'
    ).get('tomato')!
    expect(row.label).toBe('МойПомидор')
    expect(row.source).toBe('user')
  })

  it('stores exact_aliases with match_mode exact', () => {
    seedFromEntries(db, [
      {
        slug: 'dessert',
        label: 'Десерт',
        kind: 'dish_type',
        aliases: ['сладость'],
        exact_aliases: ['печенье', 'печенья']
      }
    ])

    const rows = db
      .prepare<[], { lemma: string; match_mode: string }>(
        `SELECT lemma, match_mode FROM tag_aliases WHERE match_mode='exact' ORDER BY lemma`
      )
      .all()

    expect(rows.map((r) => r.lemma)).toEqual(['печенье', 'печенья'])
    expect(rows.every((r) => r.match_mode === 'exact')).toBe(true)
  })

  it('normalises ё to е in exact aliases', () => {
    seedFromEntries(db, [
      { slug: 'x', label: 'X', kind: 'ingredient', aliases: [], exact_aliases: ['Чёрный'] }
    ])
    const row = db
      .prepare<[], { lemma: string }>(`SELECT lemma FROM tag_aliases WHERE match_mode='exact'`)
      .get()
    expect(row?.lemma).toBe('черный')
  })

  it('leaves regular aliases as match_mode stem', () => {
    seedFromEntries(db, [{ slug: 'y', label: 'Y', kind: 'ingredient', aliases: ['помидоры'] }])
    const modes = db
      .prepare<[], { match_mode: string }>('SELECT match_mode FROM tag_aliases')
      .all()
      .map((r) => r.match_mode)
    expect(modes.every((m) => m === 'stem')).toBe(true)
  })
})
