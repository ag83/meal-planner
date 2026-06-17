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

  it('sets user_version to 1 after migration', () => {
    runMigrations(db)
    const version = db.pragma('user_version', { simple: true }) as number
    expect(version).toBe(1)
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
    const tagRow = db.prepare<[], { id: number }>('SELECT id FROM tags WHERE slug=?').get('t1')!
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
