import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db/migrations'
import { seedFromEntries } from '../seed'
import { extractTags } from '../matcher'
import type { SeedEntry } from '../seed'

// Exercises the shipped tag rules end to end on a fresh vault: real seed-tags.yaml
// through the real matcher.
let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  const raw = fs.readFileSync(path.join(process.cwd(), 'resources', 'seed-tags.yaml'), 'utf-8')
  seedFromEntries(db, yaml.load(raw) as SeedEntry[])
})

afterEach(() => {
  db.close()
})

const labelsFor = (text: string): string[] => {
  const labelOf = db.prepare<[number], { label: string }>('SELECT label FROM tags WHERE id = ?')
  return extractTags(db, text)
    .map((m) => labelOf.get(m.tagId)?.label ?? '')
    .sort()
}

describe('shipped tag rules', () => {
  it('has no Соль tag at all', () => {
    const row = db.prepare<[], { n: number }>(
      `SELECT COUNT(*) AS n FROM tags WHERE slug = 'salt'`
    ).get()
    expect(row?.n).toBe(0)
  })

  it('does not tag salt from recipe text', () => {
    expect(labelsFor('соль по вкусу')).toEqual([])
    expect(labelsFor('добавьте морскую соль')).toEqual([])
  })

  it('has no Чёрный перец tag at all', () => {
    const row = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM tags WHERE slug = 'black_pepper'`)
      .get()
    expect(row?.n).toBe(0)
  })

  it('bare перец matches nothing', () => {
    expect(labelsFor('перец')).toEqual([])
    expect(labelsFor('поперчите, добавьте перец')).toEqual([])
    expect(labelsFor('перец черный молотый')).toEqual([])
  })

  it('Болгарский перец requires сладкий or болгарский', () => {
    expect(labelsFor('сладкий перец')).toEqual(['Болгарский перец'])
    expect(labelsFor('перец сладкий')).toEqual(['Болгарский перец'])
    expect(labelsFor('болгарский перец')).toEqual(['Болгарский перец'])
    expect(labelsFor('перец болгарский')).toEqual(['Болгарский перец'])
  })

  it('still isolates Болгарский перец from unqualified pepper text', () => {
    expect(labelsFor('чёрный молотый перец и сладкий перец')).toEqual(['Болгарский перец'])
  })

  it('bare масло matches nothing', () => {
    expect(labelsFor('добавьте масло')).toEqual([])
  })
})

describe('honey, orange, cottage cheese and yeast', () => {
  it('matches мёд in both ё and е spellings', () => {
    expect(labelsFor('2 ст. л. мёда')).toEqual(['Мёд'])
    expect(labelsFor('добавьте мед')).toEqual(['Мёд'])
    // Also picks up Соус, which is correct — assert only the honey part here.
    expect(labelsFor('медовый соус')).toContain('Мёд')
  })

  it('matches апельсин and its derived forms', () => {
    expect(labelsFor('1 апельсин')).toEqual(['Апельсин'])
    expect(labelsFor('апельсины среднего размера')).toEqual(['Апельсин'])
    expect(labelsFor('апельсиновая цедра')).toEqual(['Апельсин'])
    expect(labelsFor('цедра апельсина')).toEqual(['Апельсин'])
  })

  it('matches творог and its derived forms', () => {
    expect(labelsFor('200 г творога')).toEqual(['Творог'])
    expect(labelsFor('творожная масса')).toEqual(['Творог'])
    expect(labelsFor('творожная запеканка')).toContain('Творог')
  })

  it('matches дрожжи and its derived forms', () => {
    expect(labelsFor('дрожжи')).toEqual(['Дрожжи'])
    expect(labelsFor('11 г сухих дрожжей')).toEqual(['Дрожжи'])
    expect(labelsFor('дрожжевое тесто')).toEqual(['Дрожжи'])
  })

  it('does not confuse дрожать with дрожжи', () => {
    expect(labelsFor('руки дрожат')).toEqual([])
  })
})

describe('кукуруза and гриль', () => {
  it('matches кукуруза across cases', () => {
    expect(labelsFor('банка кукурузы')).toEqual(['Кукуруза'])
    expect(labelsFor('добавьте кукурузу')).toEqual(['Кукуруза'])
    expect(labelsFor('консервированная кукуруза')).toEqual(['Кукуруза'])
  })

  it('matches the кукурузный adjective, which stems differently', () => {
    expect(labelsFor('кукурузные зёрна')).toEqual(['Кукуруза'])
  })

  it('detects Гриль from шашлык', () => {
    expect(labelsFor('шашлык из свинины')).toContain('Гриль')
    expect(labelsFor('замариновать шашлыки')).toContain('Гриль')
  })

  it('detects Гриль from гриль', () => {
    expect(labelsFor('гриль')).toEqual(['Гриль'])
    expect(labelsFor('запечь на гриле')).toEqual(['Гриль'])
  })

  it('detects Гриль from мангал in both stem variants', () => {
    expect(labelsFor('мангал')).toEqual(['Гриль'])
    expect(labelsFor('жарить на мангале')).toEqual(['Гриль'])
    expect(labelsFor('угли в мангале')).toEqual(['Гриль'])
  })

  it('reports Гриль once for a text using all three words', () => {
    expect(labelsFor('шашлык на мангале или на гриле')).toEqual(['Гриль'])
  })

  it('has no Соус tag at all', () => {
    const row = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM tags WHERE slug = 'sauce'`)
      .get()
    expect(row?.n).toBe(0)
  })

  it('does not tag sauce from recipe text', () => {
    expect(labelsFor('полейте соусом')).toEqual([])
    expect(labelsFor('медовый соус')).toEqual(['Мёд'])
  })
})

describe('фасоль, фарш and бекон', () => {
  it('matches фасоль across cases', () => {
    expect(labelsFor('банка фасоли')).toEqual(['Фасоль'])
    expect(labelsFor('с фасолью')).toEqual(['Фасоль'])
    expect(labelsFor('красная фасоль')).toEqual(['Фасоль'])
  })

  it('matches the фасолевый adjective, which stems differently', () => {
    expect(labelsFor('фасолевый суп')).toContain('Фасоль')
  })

  it('matches фарш, which the seed already carried', () => {
    expect(labelsFor('500 г фарша')).toEqual(['Фарш'])
    expect(labelsFor('мясной фарш')).toEqual(['Фарш'])
    expect(labelsFor('куриный фарш')).toContain('Фарш')
  })

  it('does not confuse фаршированный with фарш', () => {
    expect(labelsFor('фаршированные кабачки')).not.toContain('Фарш')
  })

  it('matches бекон across cases', () => {
    expect(labelsFor('бекон')).toEqual(['Бекон'])
    expect(labelsFor('полоски бекона')).toEqual(['Бекон'])
    expect(labelsFor('обжарить с беконом')).toEqual(['Бекон'])
  })
})

describe('recreated ingredient catalog (v6)', () => {
  it('has none of the 13 retired ingredient tags', () => {
    const retired = [
      'garlic', 'carrot', 'tomato_paste', 'beet', 'fish',
      'butter', 'oil', 'flour', 'sugar', 'rice', 'pasta', 'bread', 'dill'
    ]
    const slugs = db
      .prepare<[], { slug: string }>('SELECT slug FROM tags')
      .all()
      .map((r) => r.slug)
    for (const slug of retired) expect(slugs).not.toContain(slug)
  })

  it('keeps Картофель, Лук, Бекон, Петрушка, and Дрожжи despite none being on the curated list', () => {
    expect(labelsFor('отварной картофель')).toEqual(['Картофель'])
    expect(labelsFor('нарезанный репчатый лук')).toEqual(['Лук'])
    expect(labelsFor('полоски бекона')).toEqual(['Бекон'])
    expect(labelsFor('свежая петрушка')).toEqual(['Петрушка'])
    expect(labelsFor('сухие дрожжи')).toEqual(['Дрожжи'])
  })

  it('matches авокадо', () => {
    expect(labelsFor('салат с авокадо')).toContain('Авокадо')
  })

  it('separates Стручковая фасоль from Фасоль', () => {
    expect(labelsFor('стручковая фасоль')).toEqual(['Стручковая фасоль'])
    expect(labelsFor('зелёная фасоль')).toEqual(['Стручковая фасоль'])
    expect(labelsFor('красная фасоль')).toEqual(['Фасоль'])
  })

  it('matches лосось, including the сёмга synonym moved from the retired fish tag', () => {
    expect(labelsFor('стейк из лосося')).toEqual(['Лосось'])
    expect(labelsFor('малосольная сёмга')).toContain('Лосось')
  })

  it('no longer tags скумбрия or треска as fish — they were only ever aliases of the retired fish tag', () => {
    // "горячего" incidentally stems to the same root as Второе блюдо's
    // "горячее" alias — assert on the absence of fish tags specifically,
    // not on an empty result.
    expect(labelsFor('скумбрия горячего копчения')).not.toContain('Лосось')
    expect(labelsFor('скумбрия горячего копчения')).not.toContain('Тунец')
    expect(labelsFor('филе трески')).toEqual([])
  })

  it('matches лук-порей as distinct from лук', () => {
    expect(labelsFor('лук-порей')).toEqual(['Лук-порей'])
    expect(labelsFor('репчатый лук')).toEqual(['Лук'])
  })

  it('matches сосиски and сарделька as the same tag', () => {
    expect(labelsFor('отварить сосиски')).toEqual(['Сосиски'])
    expect(labelsFor('сарделька на гриле')).toContain('Сосиски')
  })
})
