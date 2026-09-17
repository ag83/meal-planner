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

  it('sets user_version to 6 after migration', () => {
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true }) as number).toBe(6)
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

describe('v2 → v3 tag rule corrections', () => {
  const seedV2 = (): void => {
    runMigrations(db)
    db.pragma('user_version = 2')
    const insertTag = db.prepare(
      `INSERT INTO tags (slug, label, kind, source, created_at) VALUES (?,?,'ingredient','builtin',1)`
    )
    for (const [slug, label] of [
      ['bell_pepper', 'Болгарский перец'],
      ['butter', 'Сливочное масло'],
      ['salt', 'Соль']
    ]) {
      insertTag.run(slug, label)
    }
    const idOf = (slug: string): number =>
      db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get(slug)!.id
    const insertAlias = db.prepare(
      `INSERT INTO tag_aliases (tag_id, lemma, is_primary, source, match_mode) VALUES (?,?,0,?, 'stem')`
    )
    insertAlias.run(idOf('bell_pepper'), 'перец', 'builtin')
    insertAlias.run(idOf('bell_pepper'), 'сладк перец', 'builtin')
    insertAlias.run(idOf('butter'), 'масл', 'builtin')
    insertAlias.run(idOf('butter'), 'масл сливочн', 'builtin')
    insertAlias.run(idOf('salt'), 'сол', 'builtin')
  }

  const isDisabled = (slug: string, lemma: string): number =>
    db
      .prepare<[string, string], { disabled: number }>(
        'SELECT disabled FROM tag_aliases WHERE lemma=? AND tag_id=(SELECT id FROM tags WHERE slug=?)'
      )
      .get(lemma, slug)!.disabled

  it('disables the bare перец alias on Болгарский перец', () => {
    seedV2()
    runMigrations(db)
    expect(isDisabled('bell_pepper', 'перец')).toBe(1)
  })

  it('leaves the qualified сладкий перец alias enabled', () => {
    seedV2()
    runMigrations(db)
    expect(isDisabled('bell_pepper', 'сладк перец')).toBe(0)
  })

  it('removes Сливочное масло entirely once the full migration chain runs', () => {
    // Butter's bare "масло" alias was corrected in v3 (disable it, keep the
    // qualified one), but v5->v6 later hard-deletes the whole 'butter' slug —
    // see migrations.ts. seedV2() always replays every pending migration, so
    // the only observable end state here is full removal, not the
    // intermediate v3 disable. The v3 correction itself stays covered by the
    // bell_pepper and salt cases above/below, whose slugs v6 doesn't touch.
    seedV2()
    runMigrations(db)
    const tag = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM tags WHERE slug='butter'`)
      .get()
    expect(tag?.n).toBe(0)
  })

  it('disables the salt tag and its aliases', () => {
    seedV2()
    runMigrations(db)
    expect(isDisabled('salt', 'сол')).toBe(1)
    const tag = db
      .prepare<[], { disabled: number }>(`SELECT disabled FROM tags WHERE slug='salt'`)
      .get()
    expect(tag?.disabled).toBe(1)
  })

  it('does not touch user-created aliases with the same lemma', () => {
    seedV2()
    const bellId = db
      .prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?')
      .get('bell_pepper')!.id
    db.prepare(
      `INSERT INTO tags (slug,label,kind,source,created_at) VALUES ('mine','Мой','ingredient','user',1)`
    ).run()
    const mineId = db
      .prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?')
      .get('mine')!.id
    db.prepare(
      `INSERT INTO tag_aliases (tag_id,lemma,is_primary,source,match_mode) VALUES (?,'перец',0,'user','stem')`
    ).run(mineId)

    runMigrations(db)

    expect(isDisabled('mine', 'перец')).toBe(0)
    expect(isDisabled('bell_pepper', 'перец')).toBe(1)
    expect(bellId).not.toBe(mineId)
  })

  it('is a no-op on a fresh vault with none of those rows', () => {
    expect(() => runMigrations(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true }) as number).toBe(6)
  })
})

describe('v4 → v5 disables the Чёрный перец tag', () => {
  it('disables the black_pepper tag and its builtin aliases', () => {
    runMigrations(db)
    db.pragma('user_version = 4')
    db.prepare(
      `INSERT INTO tags (slug,label,kind,source,created_at) VALUES ('black_pepper','Чёрный перец','ingredient','builtin',1)`
    ).run()
    const id = db
      .prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?')
      .get('black_pepper')!.id
    const insertAlias = db.prepare(
      `INSERT INTO tag_aliases (tag_id,lemma,is_primary,source,match_mode) VALUES (?,?,0,'builtin','stem')`
    )
    insertAlias.run(id, 'перец')
    insertAlias.run(id, 'молот перец')

    runMigrations(db)

    const aliases = db
      .prepare<[number], { disabled: number }>('SELECT disabled FROM tag_aliases WHERE tag_id=?')
      .all(id)
    expect(aliases.every((a) => a.disabled === 1)).toBe(true)
    const tag = db
      .prepare<[], { disabled: number }>(`SELECT disabled FROM tags WHERE slug='black_pepper'`)
      .get()
    expect(tag?.disabled).toBe(1)
  })
})

describe('v3 → v4 disables the Соус tag', () => {
  it('disables the sauce tag and its builtin aliases', () => {
    runMigrations(db)
    db.pragma('user_version = 3')
    db.prepare(
      `INSERT INTO tags (slug,label,kind,source,created_at) VALUES ('sauce','Соус','dish_type','builtin',1)`
    ).run()
    const id = db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get('sauce')!
      .id
    const insertAlias = db.prepare(
      `INSERT INTO tag_aliases (tag_id,lemma,is_primary,source,match_mode) VALUES (?,?,0,?, 'stem')`
    )
    insertAlias.run(id, 'соус', 'builtin')
    insertAlias.run(id, 'маринад', 'builtin')

    runMigrations(db)

    const aliases = db
      .prepare<[number], { lemma: string; disabled: number }>(
        'SELECT lemma, disabled FROM tag_aliases WHERE tag_id=?'
      )
      .all(id)
    expect(aliases.every((a) => a.disabled === 1)).toBe(true)
    const tag = db
      .prepare<[], { disabled: number }>(`SELECT disabled FROM tags WHERE slug='sauce'`)
      .get()
    expect(tag?.disabled).toBe(1)
  })

  it('leaves a user-created sauce alias alone', () => {
    runMigrations(db)
    db.pragma('user_version = 3')
    db.prepare(
      `INSERT INTO tags (slug,label,kind,source,created_at) VALUES ('sauce','Соус','dish_type','builtin',1)`
    ).run()
    const id = db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get('sauce')!
      .id
    db.prepare(
      `INSERT INTO tag_aliases (tag_id,lemma,is_primary,source,match_mode) VALUES (?,'мойсоус',0,'user','stem')`
    ).run(id)

    runMigrations(db)

    const mine = db
      .prepare<[number], { disabled: number }>(
        `SELECT disabled FROM tag_aliases WHERE tag_id=? AND lemma='мойсоус'`
      )
      .get(id)
    expect(mine?.disabled).toBe(0)
  })
})

describe('v5 → v6 recreates the ingredient tag catalog', () => {
  it('hard-deletes retired builtin ingredient tags, cascading to aliases and recipe_tags', () => {
    runMigrations(db)
    db.pragma('user_version = 5')
    db.prepare(
      `INSERT INTO tags (slug,label,kind,source,created_at) VALUES ('garlic','Чеснок','ingredient','builtin',1)`
    ).run()
    const garlicId = db
      .prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?')
      .get('garlic')!.id
    db.prepare(
      `INSERT INTO tag_aliases (tag_id,lemma,is_primary,source,match_mode) VALUES (?,?,1,'builtin','stem')`
    ).run(garlicId, 'чеснок')
    db.prepare(
      `INSERT INTO recipes (id,ext,sha256,created_at,updated_at) VALUES ('r1','jpg','abc',1,1)`
    ).run()
    db.prepare(
      `INSERT INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES ('r1',?,1.0,'ocr')`
    ).run(garlicId)

    runMigrations(db)

    const tagRow = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM tags WHERE slug='garlic'`)
      .get()
    expect(tagRow?.n).toBe(0)
    const aliasRow = db
      .prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM tag_aliases WHERE tag_id=?')
      .get(garlicId)
    expect(aliasRow?.n).toBe(0)
    const recipeTagRow = db
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM recipe_tags WHERE recipe_id=?')
      .get('r1')
    expect(recipeTagRow?.n).toBe(0)
  })

  it('deletes all 13 retired builtin ingredient slugs, keeping Картофель, Лук, Бекон, Петрушка, and Дрожжи', () => {
    runMigrations(db)
    db.pragma('user_version = 5')
    const retired = [
      'garlic', 'carrot', 'tomato_paste', 'beet', 'fish',
      'butter', 'oil', 'flour', 'sugar', 'rice', 'pasta', 'bread', 'dill'
    ]
    const kept = ['potato', 'onion', 'bacon', 'parsley', 'yeast']
    const insertTag = db.prepare(
      `INSERT INTO tags (slug,label,kind,source,created_at) VALUES (?,?,'ingredient','builtin',1)`
    )
    for (const slug of retired) insertTag.run(slug, slug)
    for (const slug of kept) insertTag.run(slug, slug)

    runMigrations(db)

    const remaining = db
      .prepare<[], { slug: string }>('SELECT slug FROM tags')
      .all()
      .map((r) => r.slug)
    for (const slug of retired) expect(remaining).not.toContain(slug)
    for (const slug of kept) expect(remaining).toContain(slug)
  })

  it('removes the стручковая фасоль alias from Фасоль without touching the tag', () => {
    runMigrations(db)
    db.pragma('user_version = 5')
    db.prepare(
      `INSERT INTO tags (slug,label,kind,source,created_at) VALUES ('beans','Фасоль','ingredient','builtin',1)`
    ).run()
    const beansId = db
      .prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?')
      .get('beans')!.id
    db.prepare(
      `INSERT INTO tag_aliases (tag_id,lemma,is_primary,source,match_mode) VALUES (?,?,1,'builtin','stem')`
    ).run(beansId, 'фасол')
    db.prepare(
      `INSERT INTO tag_aliases (tag_id,lemma,is_primary,source,match_mode) VALUES (?,?,0,'builtin','stem')`
    ).run(beansId, 'стручков фасол')

    runMigrations(db)

    const remaining = db
      .prepare<[number], { lemma: string }>('SELECT lemma FROM tag_aliases WHERE tag_id=?')
      .all(beansId)
      .map((r) => r.lemma)
    expect(remaining).toEqual(['фасол'])
    const tag = db
      .prepare<[], { disabled: number }>(`SELECT disabled FROM tags WHERE slug='beans'`)
      .get()
    expect(tag?.disabled).toBe(0)
  })

  it('leaves a user-created tag with a retired slug untouched', () => {
    runMigrations(db)
    db.pragma('user_version = 5')
    db.prepare(
      `INSERT INTO tags (slug,label,kind,source,created_at) VALUES ('garlic','Чеснок','ingredient','user',1)`
    ).run()

    runMigrations(db)

    const row = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM tags WHERE slug='garlic'`)
      .get()
    expect(row?.n).toBe(1)
  })

  it('is a no-op on a fresh vault with none of those rows', () => {
    expect(() => runMigrations(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true }) as number).toBe(6)
  })
})
