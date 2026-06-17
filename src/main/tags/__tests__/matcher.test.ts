import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db/migrations'
import { seedFromEntries } from '../seed'
import { extractTags } from '../matcher'
import type { SeedEntry } from '../seed'

let db: Database.Database

const SEED: SeedEntry[] = [
  {
    slug: 'tomato',
    label: 'Помидор',
    kind: 'ingredient',
    aliases: ['помидоры', 'томат', 'томаты']
  },
  {
    slug: 'bell_pepper',
    label: 'Болгарский перец',
    kind: 'ingredient',
    aliases: ['перец болгарский', 'сладкий перец']
  },
  {
    slug: 'chicken',
    label: 'Курица',
    kind: 'ingredient',
    aliases: ['куриная грудка', 'куриное филе']
  }
]

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  seedFromEntries(db, SEED)
})

afterEach(() => {
  db.close()
})

function tagIdFor(slug: string): number {
  return (db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug = ?').get(slug) as { id: number }).id
}

describe('extractTags', () => {
  it('returns empty array for empty text', () => {
    expect(extractTags(db, '')).toEqual([])
  })

  it('returns empty array for whitespace-only text', () => {
    expect(extractTags(db, '   \n  ')).toEqual([])
  })

  it('matches a single-word ingredient from OCR text', () => {
    const matches = extractTags(db, 'Добавьте помидоры и обжарьте')
    const ids = matches.map((m) => m.tagId)
    expect(ids).toContain(tagIdFor('tomato'))
  })

  it('matches via alias stem — томат → Помидор', () => {
    const matches = extractTags(db, 'положить томат нарезанный')
    const ids = matches.map((m) => m.tagId)
    expect(ids).toContain(tagIdFor('tomato'))
  })

  it('matches a multi-word ingredient via 2-token window', () => {
    const matches = extractTags(db, 'нарежьте болгарский перец')
    const ids = matches.map((m) => m.tagId)
    expect(ids).toContain(tagIdFor('bell_pepper'))
  })

  it('does not return duplicates for the same tag', () => {
    const matches = extractTags(db, 'томат помидор помидоры')
    const tomatoMatches = matches.filter((m) => m.tagId === tagIdFor('tomato'))
    expect(tomatoMatches).toHaveLength(1)
  })

  it('returns multiple distinct tags from the same text', () => {
    // Use base / nominative forms that are directly in the seed aliases
    const matches = extractTags(db, 'куриная грудка томат болгарский перец')
    const ids = matches.map((m) => m.tagId)
    expect(ids).toContain(tagIdFor('chicken'))
    expect(ids).toContain(tagIdFor('tomato'))
    expect(ids).toContain(tagIdFor('bell_pepper'))
  })

  it('confidence is in range (0, 1]', () => {
    const matches = extractTags(db, 'томат курица болгарский перец')
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      expect(m.confidence).toBeGreaterThan(0)
      expect(m.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('most-frequent tag gets confidence 1.0', () => {
    // Repeat "томат" many times so it outscores everything else
    const matches = extractTags(db, 'томат томат томат томат томат курица')
    const tomatoMatch = matches.find((m) => m.tagId === tagIdFor('tomato'))
    expect(tomatoMatch?.confidence).toBe(1.0)
  })

  it('returns no matches for text with no known ingredients', () => {
    const matches = extractTags(db, 'lorem ipsum dolor sit amet')
    expect(matches).toEqual([])
  })
})
