import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
})

afterEach(() => {
  db.close()
})

describe('runMigrations', () => {
  it('creates all expected tables', () => {
    runMigrations(db)

    const tables = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )
      .all()
      .map((r) => r.name)

    expect(tables).toContain('recipes')
    expect(tables).toContain('tags')
    expect(tables).toContain('tag_aliases')
    expect(tables).toContain('recipe_tags')
    expect(tables).toContain('recipe_tag_suppressions')
  })

  it('sets user_version to 2 after migration', () => {
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true }) as number).toBe(2)
  })

  it('tag_aliases has match_mode defaulting to stem', () => {
    runMigrations(db)
    db.prepare(
      `INSERT INTO tags (slug, label, kind, source, created_at) VALUES ('t1','T','ingredient','builtin',1)`
    ).run()
    const tagId = db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get('t1')!
      .id
    db.prepare(
      `INSERT INTO tag_aliases (tag_id, lemma, is_primary, source) VALUES (?,'лемма',1,'builtin')`
    ).run(tagId)
    const row = db.prepare<[], { match_mode: string }>('SELECT match_mode FROM tag_aliases').get()
    expect(row?.match_mode).toBe('stem')
  })

  it('tag_aliases rejects an unknown match_mode', () => {
    runMigrations(db)
    db.prepare(
      `INSERT INTO tags (slug, label, kind, source, created_at) VALUES ('t1','T','ingredient','builtin',1)`
    ).run()
    const tagId = db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get('t1')!
      .id
    expect(() => {
      db.prepare(
        `INSERT INTO tag_aliases (tag_id, lemma, is_primary, source, match_mode) VALUES (?,'лемма',1,'builtin','bogus')`
      ).run(tagId)
    }).toThrow()
  })

  it('migrates a v1 database without losing alias rows', () => {
    db.exec(`
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('ingredient','dish_type','cuisine','user')),
        source TEXT NOT NULL CHECK(source IN ('builtin','user')),
        disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE tag_aliases (
        id INTEGER PRIMARY KEY,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        lemma TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL CHECK(source IN ('builtin','user')),
        disabled INTEGER NOT NULL DEFAULT 0, UNIQUE(tag_id, lemma)
      );
      INSERT INTO tags (slug,label,kind,source,created_at) VALUES ('t1','T','ingredient','builtin',1);
      INSERT INTO tag_aliases (tag_id,lemma,is_primary,source) VALUES (1,'старая лемма',1,'builtin');
    `)
    db.pragma('user_version = 1')

    runMigrations(db)

    const row = db
      .prepare<[], { lemma: string; match_mode: string }>(
        'SELECT lemma, match_mode FROM tag_aliases'
      )
      .get()
    expect(row?.lemma).toBe('старая лемма')
    expect(row?.match_mode).toBe('stem')
  })

  it('is idempotent — running twice does not throw', () => {
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
  })

  it('recipes table has missing column defaulting to 0', () => {
    runMigrations(db)
    db.prepare(
      `INSERT INTO recipes (id, ext, sha256, created_at, updated_at) VALUES ('r1','jpg','abc',1,1)`
    ).run()
    const row = db.prepare<[], { missing: number }>('SELECT missing FROM recipes').get()
    expect(row?.missing).toBe(0)
  })

  it('tag kind constraint rejects unknown kind', () => {
    runMigrations(db)
    expect(() => {
      db.prepare(
        `INSERT INTO tags (slug, label, kind, source, created_at) VALUES ('x','X','bad','builtin',1)`
      ).run()
    }).toThrow()
  })

  it('recipe_tags references cascade on recipe delete', () => {
    runMigrations(db)
    db.prepare(
      `INSERT INTO recipes (id, ext, sha256, created_at, updated_at) VALUES ('r1','jpg','abc',1,1)`
    ).run()
    db.prepare(
      `INSERT INTO tags (slug, label, kind, source, created_at) VALUES ('t1','T','ingredient','builtin',1)`
    ).run()
    const tagRow = db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get('t1')!
    db.prepare(
      `INSERT INTO recipe_tags (recipe_id, tag_id, confidence, source) VALUES ('r1',${tagRow.id},1.0,'user')`
    ).run()

    db.prepare('DELETE FROM recipes WHERE id=?').run('r1')
    const count = db
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM recipe_tags')
      .get()!.n
    expect(count).toBe(0)
  })
})
