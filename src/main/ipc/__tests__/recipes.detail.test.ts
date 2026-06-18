import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db/migrations'
import { seedFromEntries } from '../../tags/seed'
import type { SeedEntry } from '../../tags/seed'

let db: Database.Database

const SEED: SeedEntry[] = [
  { slug: 'tomato', label: 'Помидор', kind: 'ingredient', aliases: ['томат'] },
  { slug: 'basil', label: 'Базилик', kind: 'ingredient', aliases: ['базилик'] },
  { slug: 'chicken', label: 'Курица', kind: 'ingredient', aliases: ['курица'] }
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function tagId(slug: string): number {
  return (
    db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get(slug) as {
      id: number
    }
  ).id
}

function insertRecipe(id: string): void {
  db.prepare(
    'INSERT INTO recipes (id,ext,sha256,width,height,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, 'jpg', id, 800, 600, Date.now(), Date.now())
}

function tagRecipe(recipeId: string, tId: number, source: 'ocr' | 'user' = 'ocr'): void {
  db.prepare(
    'INSERT OR IGNORE INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,1.0,?)'
  ).run(recipeId, tId, source)
}

function suppress(recipeId: string, tId: number): void {
  db.prepare(
    'INSERT OR IGNORE INTO recipe_tag_suppressions (recipe_id,tag_id) VALUES (?,?)'
  ).run(recipeId, tId)
}

// Mirror of the get query in ipc/recipes.ts
function getRecipe(id: string): { id: string; title: string | null; tags: unknown[] } | null {
  const recipe = db
    .prepare('SELECT id, title, notes FROM recipes WHERE id=?')
    .get(id) as { id: string; title: string | null; notes: string | null } | undefined
  if (!recipe) return null
  const tags = db
    .prepare(
      `SELECT rt.tag_id AS tagId, t.label, t.kind, rt.source, rt.confidence
       FROM recipe_tags rt JOIN tags t ON t.id=rt.tag_id
       WHERE rt.recipe_id=? ORDER BY rt.source DESC, t.label ASC`
    )
    .all(id)
  return { ...recipe, tags }
}

// Mirror of the setTag logic in ipc/recipes.ts
function setTag(recipeId: string, tId: number, on: boolean): void {
  if (on) {
    db.transaction(() => {
      db.prepare(
        'DELETE FROM recipe_tag_suppressions WHERE recipe_id=? AND tag_id=?'
      ).run(recipeId, tId)
      db.prepare(
        "INSERT OR REPLACE INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,1.0,'user')"
      ).run(recipeId, tId)
    })()
  } else {
    const existing = db
      .prepare<[string, number], { source: string }>(
        'SELECT source FROM recipe_tags WHERE recipe_id=? AND tag_id=?'
      )
      .get(recipeId, tId)
    db.transaction(() => {
      if (existing?.source === 'ocr') {
        db.prepare(
          'INSERT OR IGNORE INTO recipe_tag_suppressions (recipe_id,tag_id) VALUES (?,?)'
        ).run(recipeId, tId)
      }
      db.prepare('DELETE FROM recipe_tags WHERE recipe_id=? AND tag_id=?').run(recipeId, tId)
    })()
  }
}

// Mirror of the reOcr tag-replacement logic (DB part only — OCR itself is untestable here)
function applyReOcrTags(
  recipeId: string,
  ocrText: string,
  matches: { tagId: number; confidence: number }[]
): void {
  db.transaction(() => {
    db.prepare('UPDATE recipes SET ocr_text=?,updated_at=? WHERE id=?').run(
      ocrText,
      Date.now(),
      recipeId
    )
    db.prepare("DELETE FROM recipe_tags WHERE recipe_id=? AND source='ocr'").run(recipeId)
    const insert = db.prepare(
      "INSERT OR IGNORE INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,?,'ocr')"
    )
    const isSuppressed = db.prepare(
      'SELECT 1 FROM recipe_tag_suppressions WHERE recipe_id=? AND tag_id=?'
    )
    for (const { tagId: tId, confidence } of matches) {
      if (!isSuppressed.get(recipeId, tId)) insert.run(recipeId, tId, confidence)
    }
  })()
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  seedFromEntries(db, SEED)
  insertRecipe('r1')
})

afterEach(() => db.close())

// ── recipes:get ──────────────────────────────────────────────────────────────

describe('recipes:get', () => {
  it('returns null for unknown id', () => {
    expect(getRecipe('unknown')).toBeNull()
  })

  it('returns recipe with empty tags array when no tags', () => {
    const r = getRecipe('r1')
    expect(r).not.toBeNull()
    expect(r!.tags).toEqual([])
  })

  it('returns recipe with its tags', () => {
    tagRecipe('r1', tagId('tomato'), 'ocr')
    tagRecipe('r1', tagId('basil'), 'user')
    const r = getRecipe('r1')
    expect((r!.tags as { label: string }[]).map((t) => t.label).sort()).toEqual([
      'Базилик',
      'Помидор'
    ])
  })

  it('includes source on each tag', () => {
    tagRecipe('r1', tagId('tomato'), 'ocr')
    tagRecipe('r1', tagId('basil'), 'user')
    const r = getRecipe('r1')
    const tags = r!.tags as { label: string; source: string }[]
    expect(tags.find((t) => t.label === 'Помидор')?.source).toBe('ocr')
    expect(tags.find((t) => t.label === 'Базилик')?.source).toBe('user')
  })
})

// ── recipes:update ───────────────────────────────────────────────────────────

describe('recipes:update', () => {
  it('updates title', () => {
    db.prepare('UPDATE recipes SET title=?, notes=?, updated_at=? WHERE id=?').run(
      'Борщ',
      null,
      Date.now(),
      'r1'
    )
    const row = db.prepare('SELECT title FROM recipes WHERE id=?').get('r1') as {
      title: string
    }
    expect(row.title).toBe('Борщ')
  })

  it('sets title to null (clearing it)', () => {
    db.prepare('UPDATE recipes SET title=?, notes=?, updated_at=? WHERE id=?').run(
      null,
      null,
      Date.now(),
      'r1'
    )
    const row = db.prepare('SELECT title FROM recipes WHERE id=?').get('r1') as {
      title: string | null
    }
    expect(row.title).toBeNull()
  })

  it('updates notes without touching title', () => {
    db.prepare('UPDATE recipes SET title=?, notes=?, updated_at=? WHERE id=?').run(
      'Борщ',
      null,
      Date.now(),
      'r1'
    )
    db.prepare('UPDATE recipes SET title=?, notes=?, updated_at=? WHERE id=?').run(
      'Борщ',
      'Очень вкусный',
      Date.now(),
      'r1'
    )
    const row = db.prepare('SELECT title, notes FROM recipes WHERE id=?').get('r1') as {
      title: string
      notes: string
    }
    expect(row.title).toBe('Борщ')
    expect(row.notes).toBe('Очень вкусный')
  })
})

// ── recipes:setTag — adding ───────────────────────────────────────────────────

describe('recipes:setTag (add)', () => {
  it('inserts a user-sourced tag', () => {
    setTag('r1', tagId('tomato'), true)
    const row = db
      .prepare('SELECT source FROM recipe_tags WHERE recipe_id=? AND tag_id=?')
      .get('r1', tagId('tomato')) as { source: string } | undefined
    expect(row?.source).toBe('user')
  })

  it('removes any existing suppression when adding a tag', () => {
    suppress('r1', tagId('tomato'))
    setTag('r1', tagId('tomato'), true)
    const s = db
      .prepare('SELECT 1 FROM recipe_tag_suppressions WHERE recipe_id=? AND tag_id=?')
      .get('r1', tagId('tomato'))
    expect(s).toBeUndefined()
  })

  it('is idempotent — adding an already-present tag does not duplicate it', () => {
    setTag('r1', tagId('tomato'), true)
    setTag('r1', tagId('tomato'), true)
    const count = (
      db
        .prepare('SELECT COUNT(*) AS n FROM recipe_tags WHERE recipe_id=? AND tag_id=?')
        .get('r1', tagId('tomato')) as { n: number }
    ).n
    expect(count).toBe(1)
  })
})

// ── recipes:setTag — removing ─────────────────────────────────────────────────

describe('recipes:setTag (remove)', () => {
  it('removes the tag from recipe_tags', () => {
    tagRecipe('r1', tagId('tomato'), 'ocr')
    setTag('r1', tagId('tomato'), false)
    const row = db
      .prepare('SELECT 1 FROM recipe_tags WHERE recipe_id=? AND tag_id=?')
      .get('r1', tagId('tomato'))
    expect(row).toBeUndefined()
  })

  it('adds a suppression when removing an OCR-sourced tag', () => {
    tagRecipe('r1', tagId('tomato'), 'ocr')
    setTag('r1', tagId('tomato'), false)
    const s = db
      .prepare('SELECT 1 FROM recipe_tag_suppressions WHERE recipe_id=? AND tag_id=?')
      .get('r1', tagId('tomato'))
    expect(s).toBeDefined()
  })

  it('does NOT add a suppression when removing a user-sourced tag', () => {
    tagRecipe('r1', tagId('basil'), 'user')
    setTag('r1', tagId('basil'), false)
    const s = db
      .prepare('SELECT 1 FROM recipe_tag_suppressions WHERE recipe_id=? AND tag_id=?')
      .get('r1', tagId('basil'))
    expect(s).toBeUndefined()
  })
})

// ── reOcr tag-replacement logic ───────────────────────────────────────────────

describe('reOcr tag-replacement logic', () => {
  it('replaces existing OCR tags with new matches', () => {
    tagRecipe('r1', tagId('tomato'), 'ocr')
    applyReOcrTags('r1', 'some text', [{ tagId: tagId('basil'), confidence: 1.0 }])
    const tags = db
      .prepare('SELECT tag_id FROM recipe_tags WHERE recipe_id=?')
      .all('r1') as { tag_id: number }[]
    expect(tags.map((t) => t.tag_id)).toContain(tagId('basil'))
    expect(tags.map((t) => t.tag_id)).not.toContain(tagId('tomato'))
  })

  it('skips suppressed tags — suppressed tag not re-added', () => {
    suppress('r1', tagId('tomato'))
    applyReOcrTags('r1', 'text', [{ tagId: tagId('tomato'), confidence: 1.0 }])
    const row = db
      .prepare('SELECT 1 FROM recipe_tags WHERE recipe_id=? AND tag_id=?')
      .get('r1', tagId('tomato'))
    expect(row).toBeUndefined()
  })

  it('preserves user-added tags across re-OCR', () => {
    tagRecipe('r1', tagId('chicken'), 'user')
    tagRecipe('r1', tagId('tomato'), 'ocr')
    applyReOcrTags('r1', 'text', [{ tagId: tagId('basil'), confidence: 1.0 }])
    const tags = db
      .prepare('SELECT tag_id, source FROM recipe_tags WHERE recipe_id=?')
      .all('r1') as { tag_id: number; source: string }[]
    const userTags = tags.filter((t) => t.source === 'user')
    expect(userTags.map((t) => t.tag_id)).toContain(tagId('chicken'))
  })

  it('updates ocr_text on the recipe row', () => {
    applyReOcrTags('r1', 'новый текст OCR', [])
    const row = db.prepare('SELECT ocr_text FROM recipes WHERE id=?').get('r1') as {
      ocr_text: string
    }
    expect(row.ocr_text).toBe('новый текст OCR')
  })
})

// ── recipes:delete (DB cascade) ───────────────────────────────────────────────

describe('recipes:delete (cascade)', () => {
  it('deletes the recipe row', () => {
    db.prepare('DELETE FROM recipes WHERE id=?').run('r1')
    expect(db.prepare('SELECT 1 FROM recipes WHERE id=?').get('r1')).toBeUndefined()
  })

  it('cascades to recipe_tags', () => {
    tagRecipe('r1', tagId('tomato'))
    db.prepare('DELETE FROM recipes WHERE id=?').run('r1')
    const rows = db.prepare('SELECT 1 FROM recipe_tags WHERE recipe_id=?').all('r1')
    expect(rows).toHaveLength(0)
  })

  it('cascades to recipe_tag_suppressions', () => {
    suppress('r1', tagId('tomato'))
    db.prepare('DELETE FROM recipes WHERE id=?').run('r1')
    const rows = db
      .prepare('SELECT 1 FROM recipe_tag_suppressions WHERE recipe_id=?')
      .all('r1')
    expect(rows).toHaveLength(0)
  })
})
