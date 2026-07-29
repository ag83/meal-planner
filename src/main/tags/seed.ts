import fs from 'fs/promises'
import path from 'path'
import yaml from 'js-yaml'
import { app } from 'electron'
import type Database from 'better-sqlite3'
import { normalizeSurface } from './normalize'

export interface SeedEntry {
  slug: string
  label: string
  kind: 'ingredient' | 'dish_type' | 'cuisine'
  aliases: string[]
  exact_aliases?: string[]
}

// Exact aliases deliberately skip stemming — they exist for forms the stemmer
// collapses wrongly. Mirrored by tokenize in tags/matcher.ts.
const exactForm = (surface: string): string =>
  surface.normalize('NFC').toLowerCase().replace(/ё/g, 'е').trim()

// Additive upsert: inserts missing slugs/aliases; never overwrites or deletes user data.
export const seedFromEntries = (db: Database.Database, entries: SeedEntry[]): void => {
  const insertTag = db.prepare(`
    INSERT INTO tags (slug, label, kind, source, created_at)
    VALUES (@slug, @label, @kind, 'builtin', @createdAt)
    ON CONFLICT(slug) DO NOTHING
  `)

  const insertAlias = db.prepare(`
    INSERT INTO tag_aliases (tag_id, lemma, is_primary, source, match_mode)
    VALUES (@tagId, @lemma, @isPrimary, 'builtin', @matchMode)
    ON CONFLICT(tag_id, lemma) DO NOTHING
  `)

  const getTag = db.prepare<[string], { id: number }>(`SELECT id FROM tags WHERE slug = ?`)

  db.transaction(() => {
    for (const entry of entries) {
      insertTag.run({ slug: entry.slug, label: entry.label, kind: entry.kind, createdAt: Date.now() })

      const row = getTag.get(entry.slug)
      if (!row) continue

      const primaryLemma = normalizeSurface(entry.label)
      const seen = new Set<string>()

      insertAlias.run({ tagId: row.id, lemma: primaryLemma, isPrimary: 1, matchMode: 'stem' })
      seen.add(primaryLemma)

      for (const alias of entry.aliases) {
        const lemma = normalizeSurface(alias)
        if (seen.has(lemma)) continue
        insertAlias.run({
          tagId: row.id,
          lemma,
          isPrimary: lemma === primaryLemma ? 1 : 0,
          matchMode: 'stem'
        })
        seen.add(lemma)
      }

      for (const alias of entry.exact_aliases ?? []) {
        const lemma = exactForm(alias)
        if (seen.has(lemma)) continue
        insertAlias.run({ tagId: row.id, lemma, isPrimary: 0, matchMode: 'exact' })
        seen.add(lemma)
      }
    }
  })()
}

export const seedFromFile = async (db: Database.Database): Promise<void> => {
  const seedPath = app.isPackaged
    ? path.join(process.resourcesPath, 'seed-tags.yaml')
    : path.join(app.getAppPath(), 'resources', 'seed-tags.yaml')

  const raw = await fs.readFile(seedPath, 'utf-8')
  const entries = yaml.load(raw) as SeedEntry[]
  seedFromEntries(db, entries)
}
