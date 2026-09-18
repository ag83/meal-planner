# Ingredient Tag Catalog Recreation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `kind='ingredient'` portion of the built-in tag catalog with a curated 55-word list, hard-deleting every builtin ingredient tag not on the list (cascading to its aliases and any `recipe_tags` rows), splitting Стручковая фасоль off Фасоль into its own tag, and seeding curated Russian synonyms for every entry — all without touching `dish_type`/`cuisine` tags or changing how OCR ingest works.

**Architecture:** This repo's tag catalog is data (`resources/seed-tags.yaml`) loaded additively on every vault open (`seedFromFile` → `seedFromEntries`, `src/main/tags/seed.ts`), plus a `MIGRATIONS` array (`src/main/db/migrations.ts`) that mutates already-seeded vaults since the yaml loader can only insert, never delete or update. Retiring a builtin tag has always meant appending a new migration; this plan appends one (`v5 → v6`) that does a **scoped hard delete** (an explicit, user-approved exception to the project's normal disable-don't-delete convention — see Global Constraints) of exactly 13 named slugs, plus removes one misplaced alias, relying on the schema's existing `ON DELETE CASCADE` to clean up `tag_aliases` and `recipe_tags`. The yaml file is rewritten in the same pass so the next additive reseed matches the post-migration state instead of resurrecting deleted rows. Картофель, Лук, Бекон, Петрушка, and Дрожжи were on the user's original candidate retirement list but are being **kept**, per two rounds of explicit follow-up instruction, even though none of them is on the curated 55-word list.

**Tech Stack:** better-sqlite3 (WAL, `foreign_keys=ON`), js-yaml, Vitest, `natural`'s `PorterStemmerRu` via `src/main/tags/normalize.ts`.

## Global Constraints

- TypeScript everywhere in `src/`; named arrow functions only, no `function` declarations (CLAUDE.md "Conventions").
- DB writes go through prepared statements / `db.exec` inside a transaction when touching >1 row — `runMigrations` already wraps each migration function in `db.transaction()`.
- Vault paths / schema: bump `CURRENT_SCHEMA_VERSION` (`src/main/vault/manager.ts`) whenever `MIGRATIONS` grows, matching the project's existing 1:1 convention (currently 5 migrations ↔ `CURRENT_SCHEMA_VERSION = 5`).
- **Deliberate deviation from CLAUDE.md's "Don't delete built-in tags or aliases on seed re-apply" pitfall**: the user explicitly chose hard delete (with full awareness that it destroys `recipe_tags` history for retired tags) over the disable-only pattern used by every prior migration (v2 salt, v4 sauce, v5 black pepper). Task 6 updates CLAUDE.md to record this as an intentional, one-off exception — not a new default.
- `resources/seed-tags.yaml` seeding is additive-only (`ON CONFLICT(slug) DO NOTHING` / `ON CONFLICT(tag_id, lemma) DO NOTHING`) — a slug removed from the yaml is never re-inserted, but a slug left in the yaml **will** be silently re-created after a migration deletes it. The yaml edit and the migration must ship together.
- Comment style: no comments narrating WHAT; comment WHY only when non-obvious (e.g. a stemmer collision).
- Don't touch `dish_type` or `cuisine` tags — out of scope per user decision.
- Don't change `src/main/tags/matcher.ts`, `src/main/ingest/pipeline.ts`, or any IPC handler — the "don't add new tags during OCR" requirement is already satisfied by the existing architecture (the matcher only ever matches pre-seeded aliases; it never inserts new `tags` rows). No code change is needed or wanted there.

---

## Context: what changes and why

Comparing the user's 55-word list against the current 44-entry `kind='ingredient'` section of `resources/seed-tags.yaml`:

- **31 tags are kept as-is** (same slug, same aliases): orange, eggplant, beef, mushroom, zucchini, cabbage, shrimp, corn, chicken, lemon, honey, milk, cucumber, bell_pepper, liver, tomato, pork, cream, sour_cream, cheese, cottage_cheese, minced_meat, spinach, apple, egg, beans (beans loses one alias — see below), **potato, onion, bacon, parsley, and yeast**. None of Картофель (potato), Лук (onion), Бекон (bacon), Петрушка (parsley), or Дрожжи (yeast) is on the curated 55-word list, but the user explicitly asked to keep all five anyway — treat them as a standing exception, not an oversight.
- **13 tags are hard-deleted** (builtin, not on the new list and not exempted): `garlic, carrot, tomato_paste, beet, fish, butter, oil, flour, sugar, rice, pasta, bread, dill`. This includes the generic Рыба (fish) catch-all — its former aliases сёмга/семга move to the new Лосось tag; скумбрия/треска/минтай/судак/карп/горбуша are not on the new list and lose all tagging.
- **29 tags are new**: avocado, peanut, lamb, broccoli, swede, brussels_sprouts, grapes, green_peas, pear, goose, turkey, squid, kefir, sausage, crab_sticks, dried_apricot, salmon, chicken_leg, olives, nuts, napa_cabbage, leek, celery, pickled_cucumber, hot_dogs, green_beans, tuna, prunes, lentils.
- **Стручковая фасоль splits off Фасоль** into its own `green_beans` tag (confirmed with the user). The alias `стручковая фасоль` is removed from `beans`; its stemmed lemma is `стручков фасол` (verified by running the real `normalizeSurface` pipeline: NFC → lowercase → ё→е → `Intl.Segmenter('ru','word')` → `PorterStemmerRu.stem` on each token → space-join).

---

## File Structure

- **Modify:** `src/main/db/migrations.ts` — append the `v5 → v6` migration.
- **Modify:** `src/main/db/__tests__/migrations.test.ts` — bump two `user_version` assertions from 5→6, add a `v5 → v6` describe block.
- **Modify:** `src/main/vault/manager.ts` — `CURRENT_SCHEMA_VERSION` 5→6.
- **Modify:** `resources/seed-tags.yaml` — rewrite the Ingredients section only.
- **Modify:** `src/main/tags/__tests__/seed-rules.test.ts` — remove assertions that referenced now-deleted tags (butter/oil, yeast, bacon), fix the Стручковая фасоль assertion, add coverage for the new catalog.
- **Modify:** `CLAUDE.md` — document the v6 retirement list and the hard-delete exception, matching the existing pitfalls style.

**Interfaces used throughout (no signatures change — this plan is data + one migration, not new code surface):**
- `runMigrations(db: Database.Database): void` — `src/main/db/migrations.ts`. Runs `MIGRATIONS[version..]` in order, each wrapped in its own transaction, bumping `PRAGMA user_version`.
- `seedFromEntries(db: Database.Database, entries: SeedEntry[]): void` and `seedFromFile(db): Promise<void>` — `src/main/tags/seed.ts`. Additive; `SeedEntry = { slug, label, kind, aliases: string[], exact_aliases?: string[] }`.
- `extractTags(db, ocrText: string): TagMatch[]` — `src/main/tags/matcher.ts`. Unchanged; used by tests to assert matching behavior.
- `normalizeSurface(surface: string): string` — `src/main/tags/normalize.ts`. Unchanged; used to derive the literal stem hardcoded into the migration.

---

### Task 1: Add the `v5 → v6` migration (hard-delete retired tags, split Стручковая фасоль)

**Files:**
- Modify: `src/main/db/migrations.ts`
- Test: `src/main/db/__tests__/migrations.test.ts`

**Interfaces:**
- Consumes: the existing `Migration = (db: Database.Database) => void` type and `MIGRATIONS: Migration[]` array (currently 5 entries, indices 0–4).
- Produces: `MIGRATIONS[5]`, bringing `PRAGMA user_version` to 6. Downstream: Task 2 relies on this to bump `CURRENT_SCHEMA_VERSION`; Task 4's yaml rewrite relies on these 13 slugs no longer existing so the additive reseed doesn't fight the migration.

- [ ] **Step 1: Write the failing tests**

Open `src/main/db/__tests__/migrations.test.ts` and append a new `describe` block right after the existing `describe('v4 → v5 disables the Чёрный перец tag', ...)` block (ends around line 259):

```ts
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
```

Also update the two now-stale assertions elsewhere in the same file:
- Line 36 (`it('sets user_version to 5 after migration', ...)`): change `.toBe(5)` to `.toBe(6)`.
- Line 228 (inside the `v1 → v2` describe block's `it('is a no-op on a fresh vault with none of those rows', ...)`): change `.toBe(5)` to `.toBe(6)`.

**Also fix a pre-existing test that the v6 migration breaks as a side effect.** The `v2 → v3 tag rule corrections` describe block's `seedV2()` helper inserts a fixture tag with slug `'butter'` (to test that migration's `масл` alias-disable logic), and every test in that block calls the top-level `runMigrations(db)`, which always replays every pending migration — including the new v6 one. Since `'butter'` is one of the 13 real retired slugs, v6 hard-deletes that fixture row before the test can inspect it, so `it('disables the bare масло alias on Сливочное масло', ...)` breaks with `Cannot read properties of undefined (reading 'disabled')`. Replace that test's body (leave `seedV2()` and the `'butter'` slug itself alone — the real v3 migration's SQL is hardcoded to match `slug = 'butter'` literally, so renaming the fixture would silently break the v3 assertion instead):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- migrations`
Expected: the four new tests in `v5 → v6 recreates the ingredient tag catalog` FAIL (retired slugs still present / stray alias still present / final `user_version` is 5, not 6). The two edited assertions (now expecting 6) also FAIL against the current 5-migration array.

- [ ] **Step 3: Implement the migration**

In `src/main/db/migrations.ts`, append a 6th entry to the `MIGRATIONS` array, immediately after the `v4 → v5` (Чёрный перец) entry and before the closing `]`:

```ts
  // v5 → v6: recreate the ingredient catalog against a curated 55-word list.
  // Hard-deletes builtin ingredient tags outside that list — ON DELETE CASCADE
  // removes their tag_aliases and recipe_tags rows too. This is a deliberate,
  // one-off exception to the disable-don't-delete pattern used by v2/v4/v5;
  // see CLAUDE.md. Картофель, Лук, Бекон, Петрушка, and Дрожжи are NOT on the
  // curated list but are kept deliberately, per explicit user instruction.
  // Стручковая фасоль becomes its own tag (green_beans), so its alias is
  // removed from Фасоль; the literal below is the output of
  // normalizeSurface('стручковая фасоль') at the time this migration was
  // written, pinned so a future stemmer change cannot silently retarget it.
  (db) => {
    db.exec(`
      DELETE FROM tags WHERE source = 'builtin' AND slug IN (
        'garlic','carrot','tomato_paste','beet','fish',
        'butter','oil','flour','sugar','rice','pasta','bread','dill'
      );

      DELETE FROM tag_aliases
        WHERE source = 'builtin'
          AND lemma = 'стручков фасол'
          AND tag_id = (SELECT id FROM tags WHERE slug = 'beans');
    `)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- migrations`
Expected: PASS — all tests in `src/main/db/__tests__/migrations.test.ts`, including the new `v5 → v6` block and the two edited assertions.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrations.ts src/main/db/__tests__/migrations.test.ts
git commit -m "feat(db)!: hard-delete retired ingredient tags in v5 to v6

BREAKING CHANGE: schemaVersion 5 -> 6; retires 13 builtin ingredient
tags (garlic, carrot, tomato_paste, beet, fish, butter, oil, flour,
sugar, rice, pasta, bread, dill) via hard delete instead of the usual
disable-only pattern, and splits the Стручковая фасоль alias off
Фасоль into its own tag. Картофель, Лук, Бекон, Петрушка, and Дрожжи
are kept despite not being on the new curated list, per explicit user
request."
```

---

### Task 2: Bump `CURRENT_SCHEMA_VERSION`

**Files:**
- Modify: `src/main/vault/manager.ts`

**Interfaces:**
- Consumes: nothing new — `CURRENT_SCHEMA_VERSION` is a private module constant used by `VaultManager.open()` (compatibility gate) and `VaultManager.initializeVault()` (stamps new vaults' `vault.json`).
- Produces: new vaults created after this change get `vault.json.schemaVersion = 6`.

This is a one-line change with no independent test (the constant has no direct unit test in the codebase; its effect is exercised indirectly through vault-open integration behavior, which is unchanged by this plan). Fold verification into Task 5's full-suite run.

- [ ] **Step 1: Update the constant**

In `src/main/vault/manager.ts` line 9:

```ts
const CURRENT_SCHEMA_VERSION = 6
```

- [ ] **Step 2: Commit**

```bash
git add src/main/vault/manager.ts
git commit -m "chore(vault): bump CURRENT_SCHEMA_VERSION to 6"
```

---

### Task 3: Rewrite the Ingredients section of `resources/seed-tags.yaml`

**Files:**
- Modify: `resources/seed-tags.yaml`

**Interfaces:**
- Consumes: `SeedEntry` shape from `src/main/tags/seed.ts` (`slug`, `label`, `kind: 'ingredient'`, `aliases: string[]`, optional `exact_aliases`).
- Produces: the yaml entries `seedFromFile` inserts additively into `tags`/`tag_aliases` on every vault open, for both fresh vaults and existing vaults that just ran Task 1's migration.

No new automated test in this task — `seed-rules.test.ts` (Task 4) is the real-yaml verification for this content.

- [ ] **Step 1: Replace lines 5–429 of `resources/seed-tags.yaml`**

Everything from the `# ── Ingredients ─────...` comment through the line immediately before `# ── Dish types ───...` (i.e. the entire current Ingredients section, including the `tomato_paste`, `Чёрный перец`/`Соль` omission comments, and every ingredient entry) is replaced with the block below. The `# ── Dish types ───` section and everything after it is untouched.

```yaml
# ── Ingredients ─────────────────────────────────────────────────────────────
# The ingredient catalog below is the curated v6 list (see migrations.ts,
# v5 -> v6). Earlier builtin ingredient tags not on this list — Чеснок,
# Морковь, Сливочное масло, Растительное масло, Мука, Сахар, Рис, Макароны,
# Хлеб, Укроп, Томатная паста, Свёкла, and the generic Рыба catch-all — were
# hard-deleted by that migration, joining Соль (migration v3) and Чёрный
# перец (migration v5) among tags retired from earlier seed revisions.
# Картофель, Лук, Бекон, Петрушка, and Дрожжи are NOT on the curated 55-word
# list this catalog is otherwise built from, but were deliberately kept at
# explicit user request (across two rounds of follow-up) — do not fold them
# back into a future retirement pass without checking with the user first.
# This file only ever adds tags additively, so a retirement always needs a
# paired migration — see CLAUDE.md pitfalls.

- slug: avocado
  label: Авокадо
  kind: ingredient
  aliases: []

- slug: orange
  label: Апельсин
  kind: ingredient
  aliases:
    - апельсины
    - апельсиновый
    - апельсиновая цедра
    - цедра апельсина
    - апельсиновый сок

- slug: peanut
  label: Арахис
  kind: ingredient
  aliases:
    - арахисовый
    - арахисовое масло

- slug: eggplant
  label: Баклажан
  kind: ingredient
  aliases:
    - баклажаны
    - синенькие
    - баклажанчик

- slug: lamb
  label: Баранина
  kind: ingredient
  aliases:
    - баранья нога
    - мясо баранины
    - бараний

- slug: broccoli
  label: Брокколи
  kind: ingredient
  aliases:
    - капуста брокколи

- slug: swede
  label: Брюква
  kind: ingredient
  aliases:
    - брюквы
    - брюквенный

- slug: brussels_sprouts
  label: Брюссельская капуста
  kind: ingredient
  aliases:
    - кочанчики брюссельской капусты

- slug: grapes
  label: Виноград
  kind: ingredient
  aliases:
    - виноградный
    - гроздь винограда
    - виноградинки

- slug: beef
  label: Говядина
  kind: ingredient
  aliases:
    - говяжье мясо
    - телятина
    - говяжья вырезка
    - вырезка говяжья

- slug: green_peas
  label: Зелёный горошек
  kind: ingredient
  aliases:
    - горошек
    - зелёного горошка
    - консервированный горошек

- slug: mushroom
  label: Грибы
  kind: ingredient
  aliases:
    - гриб
    - грибочки
    - грибы лесные
    - шампиньон
    - шампиньоны
    - вешенки
    - вешенка
    - белые грибы
    - белый гриб

- slug: pear
  label: Груша
  kind: ingredient
  aliases:
    - груши
    - грушевый
    - грушу

- slug: goose
  label: Гусь
  kind: ingredient
  aliases:
    - гуся
    - гусиный
    - гусятина

- slug: turkey
  label: Индейка
  kind: ingredient
  aliases:
    - индюшка
    - индюшатина
    - филе индейки

- slug: zucchini
  label: Кабачок
  kind: ingredient
  aliases:
    - кабачки
    - цукини
    - кабачочек

- slug: squid
  label: Кальмар
  kind: ingredient
  aliases:
    - кальмары
    - кальмаров
    - кольца кальмара

- slug: cabbage
  label: Капуста
  kind: ingredient
  aliases:
    - капустка
    - белокочанная капуста
    - белокочанная

- slug: kefir
  label: Кефир
  kind: ingredient
  aliases:
    - кефира
    - кефирный

- slug: sausage
  label: Колбаса
  kind: ingredient
  aliases:
    - колбасы
    - колбасный
    - варёная колбаса
    - копчёная колбаса

- slug: crab_sticks
  label: Крабовые палочки
  kind: ingredient
  aliases:
    - крабовая палочка
    - палочки крабовые

- slug: shrimp
  label: Креветки
  kind: ingredient
  aliases:
    - креветка
    - тигровые креветки
    - королевские креветки

- slug: corn
  label: Кукуруза
  kind: ingredient
  # "кукурузный" stems to кукурузн, not кукуруз — both forms are needed.
  aliases:
    - кукурузный
    - кукурузные зёрна
    - консервированная кукуруза
    - кукуруза консервированная

- slug: dried_apricot
  label: Курага
  kind: ingredient
  aliases:
    - кураги
    - курагу

- slug: chicken
  label: Курица
  kind: ingredient
  aliases:
    - куриное мясо
    - курятина
    - куриная грудка
    - грудка куриная
    - куриное филе
    - филе курицы
    - бедро куриное
    - куриные бёдра

- slug: lemon
  label: Лимон
  kind: ingredient
  aliases:
    - лимоны
    - лимончик
    - лимонный сок
    - сок лимона

- slug: salmon
  label: Лосось
  kind: ingredient
  aliases:
    - лосося
    - сёмга
    - семга

- slug: honey
  label: Мёд
  kind: ingredient
  aliases:
    - медовый
    - медовая
    - жидкий мёд
    - натуральный мёд

- slug: milk
  label: Молоко
  kind: ingredient
  aliases:
    - молочко
    - цельное молоко
    - обезжиренное молоко

- slug: cucumber
  label: Огурец
  kind: ingredient
  aliases:
    - огурцы
    - огурчик
    - огурчики

- slug: chicken_leg
  label: Окорочка
  kind: ingredient
  aliases:
    - окорочок
    - куриные окорочка
    - окорочков

- slug: olives
  label: Оливки
  kind: ingredient
  aliases:
    - оливка
    - оливок
    - маслины

- slug: nuts
  label: Орехи
  kind: ingredient
  aliases:
    - орех
    - орешки
    - грецкие орехи

- slug: napa_cabbage
  label: Пекинская капуста
  kind: ingredient
  aliases:
    - китайская капуста

# Not on the curated 55-word list — kept deliberately at explicit user
# request. See migrations.ts v5 -> v6 and the file header comment above.
- slug: potato
  label: Картофель
  kind: ingredient
  aliases:
    - картошка
    - картофан
    - картошечка
    - картоха

- slug: onion
  label: Лук
  kind: ingredient
  aliases:
    - луковица
    - лучок
    - репчатый лук
    - лук репчатый

- slug: bacon
  label: Бекон
  kind: ingredient
  aliases:
    - копчёный бекон
    - бекон копчёный
    - полоски бекона

- slug: parsley
  label: Петрушка
  kind: ingredient
  aliases:
    - петрушечка
    - зелень петрушки
    - свежая петрушка

- slug: yeast
  label: Дрожжи
  kind: ingredient
  aliases:
    - дрожжевой
    - сухие дрожжи
    - живые дрожжи
    - свежие дрожжи
    - прессованные дрожжи

- slug: bell_pepper
  label: Болгарский перец
  kind: ingredient
  # Deliberately no bare "перец" — unqualified pepper is black pepper.
  aliases:
    - перец болгарский
    - сладкий перец
    - перец сладкий

- slug: liver
  label: Печень
  kind: ingredient
  aliases:
    - печень куриная
    - куриная печень
    - печень говяжья
    - говяжья печень

- slug: tomato
  label: Помидор
  kind: ingredient
  aliases:
    - помидоры
    - томат
    - томаты
    - томатик
    - помидорчик

- slug: leek
  label: Лук-порей
  kind: ingredient
  aliases: []

- slug: pork
  label: Свинина
  kind: ingredient
  aliases:
    - свиное мясо
    - свиная шея
    - шея свиная
    - свиная корейка
    - окорок свиной

- slug: celery
  label: Сельдерей
  kind: ingredient
  aliases:
    - сельдерея
    - стебель сельдерея
    - корень сельдерея

- slug: cream
  label: Сливки
  kind: ingredient
  aliases:
    - сливки 33%
    - сливки 20%
    - жирные сливки
    - нежирные сливки

- slug: sour_cream
  label: Сметана
  kind: ingredient
  aliases:
    - сметанка
    - сметана 20%
    - жирная сметана

- slug: pickled_cucumber
  label: Солёный огурец
  kind: ingredient
  aliases:
    - солёные огурцы
    - маринованный огурец

- slug: hot_dogs
  label: Сосиски
  kind: ingredient
  aliases:
    - сосиска
    - сосисок
    - сарделька
    - сардельки

- slug: green_beans
  label: Стручковая фасоль
  kind: ingredient
  aliases:
    - стручковой фасоли
    - зелёная фасоль

- slug: cheese
  label: Сыр
  kind: ingredient
  aliases:
    - сырок
    - твёрдый сыр
    - твердый сыр
    - плавленый сыр
    - моцарелла
    - пармезан
    - фета
    - брынза
    - голландский сыр
    - российский сыр

- slug: cottage_cheese
  label: Творог
  kind: ingredient
  aliases:
    - творожный
    - творожная масса
    - творожок
    - зернёный творог

- slug: tuna
  label: Тунец
  kind: ingredient
  aliases:
    - тунца
    - консервированный тунец

- slug: minced_meat
  label: Фарш
  kind: ingredient
  aliases:
    - мясной фарш
    - фарш куриный
    - фарш говяжий
    - фарш свиной
    - фарш смешанный

- slug: beans
  label: Фасоль
  kind: ingredient
  # "фасолевый" stems to фасолев, not фасол — both forms are needed.
  aliases:
    - фасолевый
    - красная фасоль
    - белая фасоль

- slug: prunes
  label: Чернослив
  kind: ingredient
  aliases:
    - чернослива
    - сушёная слива

- slug: lentils
  label: Чечевица
  kind: ingredient
  aliases:
    - чечевицы
    - красная чечевица

- slug: spinach
  label: Шпинат
  kind: ingredient
  aliases:
    - шпинатные листья
    - листья шпината

- slug: apple
  label: Яблоко
  kind: ingredient
  aliases:
    - яблоки
    - яблочко
    - яблоко зелёное
    - яблоко красное

- slug: egg
  label: Яйцо
  kind: ingredient
  aliases:
    - яйца
    - куриное яйцо
    - яйца куриные
    - яичко

```

- [ ] **Step 2: Verify the yaml parses and has exactly 60 ingredient entries**

Run: `node -e "const y=require('js-yaml').load(require('fs').readFileSync('resources/seed-tags.yaml','utf-8')); const ing=y.filter(e=>e.kind==='ingredient'); console.log(ing.length); console.log(new Set(ing.map(e=>e.slug)).size)"`
Expected: prints `60` then `60` (count matches, all slugs unique — 55 from the curated list plus the Картофель/Лук/Бекон/Петрушка/Дрожжи exceptions). If either number is wrong, fix the yaml before proceeding — do not move on with a mismatch.

- [ ] **Step 3: Commit**

```bash
git add resources/seed-tags.yaml
git commit -m "feat(seed): recreate ingredient tag catalog from curated list

Keeps 31 existing tags (including Картофель, Лук, Бекон, Петрушка,
and Дрожжи, retained at explicit user request despite not being on
the curated list), adds 29 new ones, and splits Стручковая фасоль
off Фасоль into its own tag. Pairs with the v5->v6 migration that
hard-deletes the 13 retired tags from existing vaults."
```

---

### Task 4: Fix and extend `seed-rules.test.ts` for the new catalog

**Files:**
- Modify: `src/main/tags/__tests__/seed-rules.test.ts`

**Interfaces:**
- Consumes: `seedFromEntries(db, entries: SeedEntry[])`, `extractTags(db, ocrText): TagMatch[]`, the file's own `labelsFor(text: string): string[]` helper (sorted array of matched tag labels).
- Produces: nothing consumed elsewhere — this is the real-yaml end-to-end safety net referenced in CLAUDE.md's OCR pitfall ("Don't verify OCR changes with unit tests alone... run real screenshots end to end"); this file is the closest thing to that for tag matching and must track the yaml exactly.

This test file loads the **real** `resources/seed-tags.yaml` (see its `beforeEach`), so Task 3's rewrite breaks some existing assertions. Note that the yeast (lines 107–115) and bacon (lines 184–188) tests are **not** among them — Дрожжи and Бекон are on the kept-exceptions list, unchanged from the current yaml, so those tests keep passing as-is and must NOT be touched. Only the butter/oil tests (lines 71–83) and the bare Стручковая фасоль assertion folded into Фасоль (line 167) reference tags that actually change after this plan.

- [ ] **Step 1: Remove now-invalid assertions**

In the `describe('shipped tag rules', ...)` block, delete these three `it` blocks entirely (they test the now-deleted butter/oil tags):

```ts
  it('оливковое масло is Растительное масло, not Сливочное', () => {
    expect(labelsFor('оливковое масло')).toEqual(['Растительное масло'])
    expect(labelsFor('масло оливковое')).toEqual(['Растительное масло'])
  })

  it('bare масло matches nothing', () => {
    expect(labelsFor('добавьте масло')).toEqual([])
  })

  it('still recognises qualified butter and vegetable oil', () => {
    expect(labelsFor('сливочное масло')).toEqual(['Сливочное масло'])
    expect(labelsFor('растительное масло')).toEqual(['Растительное масло'])
  })
```

Leave the `describe('honey, orange, cottage cheese and yeast', ...)` block and its yeast `it` blocks completely alone — Дрожжи is kept.

Leave the `describe('фасоль, фарш и бекон', ...)` block's бекон `it` block completely alone — Бекон is kept. Only fix the now-wrong assertion inside that same block's `it('matches фасоль across cases', ...)` — Стручковая фасоль is its own tag now, not folded into Фасоль:

```ts
  it('matches фасоль across cases', () => {
    expect(labelsFor('банка фасоли')).toEqual(['Фасоль'])
    expect(labelsFor('с фасолью')).toEqual(['Фасоль'])
    expect(labelsFor('красная фасоль')).toEqual(['Фасоль'])
  })
```

(Drop the `стручковая фасоль` line from that `it` — it's covered by the new dedicated test below instead.)

- [ ] **Step 2: Add coverage for the recreated catalog**

Append a new `describe` block at the end of the file (after the `фасоль and фарш` block):

```ts
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
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npm run test -- seed-rules`
Expected: PASS — every test in `src/main/tags/__tests__/seed-rules.test.ts`.

If any assertion in the new `describe('recreated ingredient catalog (v6)', ...)` block fails because a stem doesn't match the way this plan assumed (e.g. an inflected form doesn't collapse to the expected lemma), adjust the yaml's `aliases` list for that tag in `resources/seed-tags.yaml` (Task 3) — do not weaken the test to match wrong behavior.

- [ ] **Step 4: Commit**

```bash
git add src/main/tags/__tests__/seed-rules.test.ts
git commit -m "test(tags): update seed-rules for the v6 ingredient catalog

Removes assertions for the deleted butter/oil tags, fixes the
Стручковая фасоль assertion now that it's a separate tag, adds
coverage for new tags and for the fish -> лосось/тунец split, and
confirms Картофель/Лук/Бекон/Петрушка/Дрожжи remain despite being
off the curated list."
```

---

### Task 5: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a pitfall entry**

In the "Common pitfalls to avoid" section, after the existing bullet about `печень`/`печенье` stem collisions, add:

```markdown
- **Migration v6 hard-deletes 13 builtin ingredient tags** (`garlic, carrot, tomato_paste, beet, fish, butter, oil, flour, sugar, rice, pasta, bread, dill`) instead of disabling them — a deliberate, one-off exception to the disable-don't-delete rule below, made at explicit user request with full awareness it destroys `recipe_tags` history for those tags on existing vaults. Картофель, Лук, Бекон, Петрушка, and Дрожжи were on the original candidate list too but were kept at explicit user request (across two rounds of follow-up) despite not being part of the curated 55-word list. Don't treat any of this as a new default: every other retirement (Соль, Соус, Чёрный перец, and any future one) should still disable, not delete.
```

- [ ] **Step 2: Update the schema cheatsheet mention of `recipe_tag_suppressions` seed note**

In the "Schema cheatsheet" section, the existing sentence "Seed re-application on upgrade is **strictly additive**..." stays accurate and unchanged — no edit needed there, since it's still true for every migration except the documented v6 exception above.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): record the v6 hard-delete as a one-off exception"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS, all suites — in particular `src/main/db/__tests__/migrations.test.ts`, `src/main/tags/__tests__/seed-rules.test.ts`, `src/main/tags/__tests__/seed.test.ts`, `src/main/tags/__tests__/matcher.test.ts`, `src/main/ipc/__tests__/tags.management.test.ts`, `src/main/ipc/__tests__/tags.suggest.test.ts`, `src/main/ipc/__tests__/recipes.filter.test.ts`, `src/main/ipc/__tests__/recipes.detail.test.ts`, `src/main/vault/__tests__/reconcile.test.ts`.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS with no errors (this plan touches no `.ts` type surface beyond a one-line constant change and test files, but confirm anyway per CLAUDE.md's stated command set).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS — confirms `resources/seed-tags.yaml` still parses correctly and is picked up by the packaged build path in `src/main/tags/seed.ts`'s `seedFromFile`.

- [ ] **Step 4: Manual smoke check (optional but recommended given the destructive migration)**

If a local dev vault exists with recipes already tagged Чеснок/Рис/etc., run `npm run dev`, open it, and confirm: (a) the app starts without error, (b) `Settings → Tag Library` no longer lists any of the 13 retired tags but still lists Картофель, Лук, Бекон, Петрушка, and Дрожжи, (c) recipes previously tagged Чеснок no longer show that chip while recipes tagged Картофель still do, (d) `Retag All` in Settings re-tags existing recipes against the new catalog (e.g. a recipe mentioning "авокадо" picks up the new tag) without throwing.
