# Meal Planner — Specification

## 1. Product summary

A **local-first** desktop application for collecting recipes as photos/scans and finding them by **tags** (ingredients, dish types, cuisines). The user provides a folder; the app owns everything inside it. No accounts, no cloud, no telemetry.

OCR is used at ingest to **auto-extract tags** from a curated Russian-first dictionary; tag matching is morphology-aware (declensions, plurals) and synonym-aware (помидор/томат, кинза/кориандр).

### Goals
- Zero-friction recipe capture (drop a picture, tags appear, done).
- Survives OS reinstall: point the app at the old folder, everything works.
- Fast, curated tag-based search that is robust to Russian word forms and ingredient synonyms.

### Non-goals (v1)
- Free-text search over OCR content (parked for v2 — see §10).
- Multi-device sync, sharing, cloud backup.
- Meal scheduling, shopping lists, nutrition calculation.
- Editing the recipe image itself.

---

## 2. User stories

| # | As a … | I want … | so that … |
|---|--------|----------|-----------|
| U1 | first-time user | to pick a folder on first launch | the app knows where to store my data |
| U2 | returning user (new PC) | to point the app at an existing data folder | I recover my full library |
| U3 | user | to drop a recipe picture into the app | it gets OCR'd, auto-tagged, and added |
| U4 | user | to browse all recipes as a thumbnail gallery | I can visually scan my collection |
| U5 | user | to pick one or more tags from a searchable dropdown | I see recipes matching all picked tags |
| U6 | user | to type "том" and have the dropdown show "Помидор" | I don't have to know the canonical form or stem |
| U7 | user | to open a recipe to see its image, OCR text, and tags | I can read it, fix bad OCR, and curate tags |
| U8 | user | to add/remove tags on a recipe and manage the tag library | the index improves over time |
| U9 | user | to delete a recipe | the file and index entry both go away |

---

## 3. Functional requirements

### 3.1 Vault (data folder)
- **FR-V1**: On first run, show a folder picker. Selected folder is the *vault*.
- **FR-V2**: Path persisted in OS-standard config (`app.getPath('userData')/config.json`).
- **FR-V3**: If selected folder is empty → initialize layout (§5) and seed the tag library from `resources/seed-tags.yaml`.
- **FR-V4**: If selected folder already contains the layout → adopt it; reconcile DB ↔ filesystem (see §3.7).
- **FR-V5**: User can switch vaults via Settings (app reloads against new vault).

### 3.2 Recipe ingestion
- **FR-I1**: Accept images via (a) drag-and-drop onto the gallery, (b) "Add recipe" button → native open dialog, (c) folder import (recursive).
- **FR-I2**: Accepted formats: `jpg`, `jpeg`, `png`, `webp`, `heic` (heic via libheif; can be deferred).
- **FR-I3**: Pipeline per file:
  1. Compute SHA-256 of file bytes → reject duplicate (already in DB by hash).
  2. Generate unique filename: `<nanoid(12)>.<ext>`.
  3. Copy original to `<vault>/pictures/<new>.<ext>`.
  4. Generate thumbnail (max 512px long edge, webp) to `<vault>/thumbs/<new>.webp`.
  5. Run OCR (tesseract.js, default `rus+eng`, configurable).
  6. **Extract tags** from OCR text via the matching pipeline (§7) and insert into `recipe_tags` with `source='ocr'`.
  7. Insert row in `recipes` (raw OCR text retained in `ocr_text` for display and future features).
- **FR-I4**: Ingestion runs in a worker; UI shows per-file progress and is never blocked.
- **FR-I5**: On OCR failure, recipe is still saved with empty text and zero tags; user can retry from the detail view.

### 3.3 Gallery view (default)
- **FR-G1**: Virtualized grid of thumbnails, sorted by `created_at desc` by default.
- **FR-G2**: Sort options: newest, oldest, title (A–Z).
- **FR-G3**: Click → detail view.
- **FR-G4**: Hover/long-press → quick actions (delete, copy path).

### 3.4 Tag search
- **FR-S1**: Above the gallery sits a **searchable multi-select combobox**. Source items are canonical tags from the `tags` table.
- **FR-S2**: Typing filters the dropdown by **canonical label prefix OR alias prefix** (see §7). The dropdown shows only the canonical label per tag — never the alias the match happened on.
- **FR-S3**: Each dropdown row displays canonical label, kind (ingredient / dish_type / cuisine), and recipe count.
- **FR-S4**: Selecting a tag adds it as a pill above the combobox. Multiple pills accumulate.
- **FR-S5**: Gallery results are filtered to recipes matching **all selected tags (AND)** by default. A toggle switches to OR.
- **FR-S6**: No selection → show all recipes.
- **FR-S7**: Tag selections persist across navigation within a session; cleared on restart.

### 3.5 Recipe detail
- **FR-D1**: Full-size image, raw OCR text (editable for the human's notes — see §6), title field, free-form notes.
- **FR-D2**: **Tag chips** for current recipe. OCR-extracted chips are visually distinct from user-added chips.
- **FR-D3**: Add tag chip via the same combobox UX as search. Adds an entry to `recipe_tags` with `source='user'`.
- **FR-D4**: Remove tag chip → deletes the `recipe_tags` row. If it was OCR-extracted, also writes a suppression so re-OCR doesn't re-add it for this recipe.
- **FR-D5**: "Re-run OCR" button (with language override). Re-runs OCR and re-extracts tags, honoring user suppressions and preserving user-added tags.
- **FR-D6**: "Delete" removes the row, picture, thumbnail, and all `recipe_tags` (with confirm).

### 3.6 Tag library management (Settings)
- **FR-T1**: Settings panel lists all canonical tags grouped by `kind`, with their aliases and recipe counts.
- **FR-T2**: User can add a new canonical tag (label, kind) and add/remove aliases.
- **FR-T3**: User can edit/disable a built-in tag or alias; built-in rows are never destroyed, only flagged disabled, so seed re-application on upgrade is non-destructive.
- **FR-T4**: "Re-tag all recipes" action re-runs the matching pipeline (§7) against all recipes' stored `ocr_text` using the current tag library; OCR is not re-run.

### 3.7 Reconciliation (existing vault)
- **FR-R1**: On startup, list files in `pictures/` and rows in `recipes`. Files-without-row → re-ingest. Rows-without-file → mark missing (don't delete; user fixes in Settings).
- **FR-R2**: DB schema migrations run automatically on version bump.
- **FR-R3**: Tag-library seed is *additive only* on upgrade: missing built-in slugs and missing built-in aliases are inserted; nothing is overwritten or deleted.

---

## 4. Non-functional requirements

- **Performance**: gallery scroll @60fps with 5k recipes (virtualization is mandatory). Tag-combobox filter returns < 30 ms on 1k tags. Tag-filtered gallery returns < 50 ms on 5k recipes.
- **Offline**: 100% functional with no network. OCR language packs (`rus`, `eng`) bundled; additional packs downloaded on demand and cached in `userData`.
- **Privacy**: no telemetry, no external requests except optional language pack download.
- **Security**: Electron with `contextIsolation: true`, `nodeIntegration: false`, strict CSP, `sandbox: true` for renderer. All FS access goes through preload-exposed IPC.
- **Portability**: vault is fully self-contained — copying the folder to another machine + pointing the app at it = full restore.
- **Locale**: Russian-first (UI strings and tag library). English coexists in the OCR layer and in tag aliases when culturally appropriate.

---

## 5. Vault file layout

```
<vault>/
  meal-planner.db            # SQLite (better-sqlite3)
  meal-planner.db-wal        # WAL files (if WAL mode on)
  pictures/<id>.<ext>        # originals
  thumbs/<id>.webp           # 512px thumbnails
  vault.json                 # { schemaVersion, createdAt, appVersion }
```

Outside the vault, in Electron `userData`:
```
config.json                  # { vaultPath, ocrLanguages, theme }
tessdata/                    # downloaded tesseract language packs
```

---

## 6. Data model (SQLite)

```sql
-- Recipes ---------------------------------------------------------------
CREATE TABLE recipes (
  id           TEXT PRIMARY KEY,         -- nanoid(12), also filename stem
  ext          TEXT NOT NULL,
  sha256       TEXT NOT NULL UNIQUE,
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER,
  title        TEXT,                     -- user-editable, nullable
  notes        TEXT,                     -- free-form human notes
  ocr_lang     TEXT,                     -- e.g. "rus+eng"
  ocr_text     TEXT,                     -- raw recognized text (retained for v2 free-text search)
  ocr_conf     REAL,                     -- avg confidence 0..1
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  missing      INTEGER NOT NULL DEFAULT 0
);

-- Canonical tags: one row per concept. THIS is what the dropdown shows.
CREATE TABLE tags (
  id           INTEGER PRIMARY KEY,
  slug         TEXT    NOT NULL UNIQUE,  -- stable id, e.g. 'tomato'
  label        TEXT    NOT NULL,         -- 'Помидор' — displayed in UI
  kind         TEXT    NOT NULL,         -- 'ingredient' | 'dish_type' | 'cuisine' | 'user'
  source       TEXT    NOT NULL,         -- 'builtin' | 'user'
  disabled     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_tags_kind ON tags(kind) WHERE disabled = 0;

-- All recognized lemmas that resolve to a tag. Drives BOTH ingest matching AND dropdown search.
CREATE TABLE tag_aliases (
  id           INTEGER PRIMARY KEY,
  tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  lemma        TEXT    NOT NULL,         -- stemmed, lowercased, ё→е; may be multi-word (space-joined stems)
  is_primary   INTEGER NOT NULL DEFAULT 0, -- the lemma corresponding to tags.label
  source       TEXT    NOT NULL,         -- 'builtin' | 'user'
  disabled     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tag_id, lemma)
);
CREATE INDEX idx_tag_aliases_lemma ON tag_aliases(lemma) WHERE disabled = 0;

-- Recipe ↔ Tag (many-to-many)
CREATE TABLE recipe_tags (
  recipe_id    TEXT    NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  confidence   REAL    NOT NULL DEFAULT 1.0, -- normalized occurrence weight at ingest; 1.0 for user-set
  source       TEXT    NOT NULL,             -- 'ocr' | 'user'
  PRIMARY KEY (recipe_id, tag_id)
);
CREATE INDEX idx_recipe_tags_tag ON recipe_tags(tag_id);

-- Per-recipe suppressions: if user removes an OCR-extracted chip, don't re-add it on re-OCR.
CREATE TABLE recipe_tag_suppressions (
  recipe_id    TEXT    NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);
```

> **No FTS5 table in v1.** `ocr_text` is retained on `recipes` for display, debugging, and the v2 free-text search feature. Search in v1 is exclusively tag-driven.

---

## 7. Tag matching pipeline (Russian-first)

Used in **two places** with the **same normalization rules**:

1. **At ingest** — extract tags from OCR text → write `recipe_tags`.
2. **At dropdown query time** — match the user's typed prefix against alias lemmas → return canonical tags.

### 7.1 Normalization

```
text  →  NFC normalize
      →  lowercase
      →  ё → е
      →  Intl.Segmenter('word')               // Unicode-correct word boundaries
      →  strip tokens that are pure punctuation/numbers
      →  Snowball Russian stem (PorterStemmerRu from `natural`)
```

The **same** function (`normalize.ts`) runs over: OCR text, the seed YAML's aliases at seed time, user-typed dropdown input, and user-entered aliases in Settings. There is only one definition of "lemma."

### 7.2 Ingest matching

Given a normalized stream of stemmed tokens from OCR text:

1. Generate 1–3-token sliding windows joined by single space (matches multi-word aliases like `"болгарск перец"`).
2. `SELECT tag_id FROM tag_aliases WHERE lemma IN (:windows) AND disabled = 0`.
3. Aggregate occurrences per `tag_id`.
4. Insert `recipe_tags` rows with `confidence = log1p(count) / log1p(maxCount)`, `source='ocr'` — *skipping* any tag present in `recipe_tag_suppressions` for that recipe.

### 7.3 Dropdown query

Input: user-typed string (any length, possibly mid-word).

```sql
SELECT t.id, t.label, t.kind,
       (SELECT COUNT(*) FROM recipe_tags rt WHERE rt.tag_id = t.id) AS recipe_count
  FROM tags t
 WHERE t.disabled = 0
   AND t.id IN (
       SELECT tag_id FROM tag_aliases
        WHERE disabled = 0
          AND (lemma LIKE :stemmed_prefix || '%'    -- alias prefix on stem
            OR lemma = :stemmed_full)               -- exact stem when user typed a full word
   )
UNION
SELECT t.id, t.label, t.kind,
       (SELECT COUNT(*) FROM recipe_tags rt WHERE rt.tag_id = t.id) AS recipe_count
  FROM tags t
 WHERE t.disabled = 0
   AND lower(t.label) LIKE :raw_prefix || '%'      -- friendly fallback for label-prefix match
 ORDER BY recipe_count DESC, label ASC
 LIMIT 20;
```

The UI never shows the alias that matched — only `label`. Typing `том` returns the row `{label: "Помидор"}` because `томат` → stem `томат` exists in `tag_aliases`.

### 7.4 Result filtering (selected tags → recipes)

Default mode is **AND**:

```sql
-- AND: recipes that have all selected tags
SELECT r.* FROM recipes r
 JOIN recipe_tags rt ON rt.recipe_id = r.id
 WHERE rt.tag_id IN (:ids)
 GROUP BY r.id
HAVING COUNT(DISTINCT rt.tag_id) = :n
 ORDER BY r.created_at DESC;

-- OR (mode toggle): recipes with any of the selected tags
SELECT DISTINCT r.* FROM recipes r
 JOIN recipe_tags rt ON rt.recipe_id = r.id
 WHERE rt.tag_id IN (:ids)
 ORDER BY r.created_at DESC;
```

---

## 8. IPC surface (preload → main)

```ts
window.api = {
  vault: {
    getCurrent(): Promise<VaultInfo | null>
    pick(): Promise<VaultInfo>            // opens native dialog
    open(path: string): Promise<VaultInfo>
  },
  recipes: {
    list(opts: ListOpts): Promise<Recipe[]>
    filterByTags(tagIds: number[], mode: 'and' | 'or'): Promise<Recipe[]>
    get(id: string): Promise<RecipeFull>            // includes tags
    ingest(paths: string[]): Promise<IngestReport>  // emits 'ingest:progress'
    update(id: string, patch: Partial<RecipeMeta>): Promise<void>
    setTag(id: string, tagId: number, on: boolean): Promise<void>
    reOcr(id: string, lang?: string): Promise<void> // also re-extracts tags
    delete(id: string): Promise<void>
  },
  tags: {
    suggest(prefix: string, limit?: number): Promise<TagSuggestion[]>  // §7.3
    list(kind?: TagKind): Promise<TagWithAliases[]>
    create(input: { label: string; kind: TagKind; aliases: string[] }): Promise<Tag>
    update(id: number, patch: Partial<Tag>): Promise<void>
    addAlias(tagId: number, surface: string): Promise<void>            // raw surface, backend stems
    removeAlias(aliasId: number): Promise<void>
    delete(id: number): Promise<void>
    retagAll(): Promise<{ updated: number }>                           // §3.6 FR-T4
  },
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<void>
  },
  events: {
    on(channel: 'ingest:progress' | 'vault:changed' | 'tags:changed', cb): () => void
  }
}
```

All FS / DB / OCR / stemming work happens in main. Renderer only renders.

---

## 9. Error handling & edge cases

- **Unwritable vault** (permissions, drive unplugged) → modal explaining, button to pick another.
- **Picture file deleted externally** → `missing=1`, gallery shows a placeholder; offer "remove from library".
- **OCR worker crash** → restart up to 3× per session, log to `userData/logs/`.
- **Duplicate import** (same SHA-256) → toast "already in library", focus existing recipe.
- **Schema version newer than app** → refuse to open vault, prompt to update app.
- **Tag with zero recipes** → still shown in Settings tag library; hidden from search dropdown only if recipe count is zero *and* the tag is `source='builtin'` and `disabled=1`.
- **Conflicting alias** (user tries to attach `помидор` to two different tags) → reject with explanation pointing to the existing owner.

---

## 10. Out of scope for v1 (proposed v2 backlog)

1. **Free-text search over `ocr_text`** with FTS5 + Russian Snowball + trigram fallback. Schema is already ready — just add the virtual table and query parser.
2. **Smarter tag extraction**: confidence thresholds, contextual disambiguation (`перец` near `чили` → chili-pepper tag rather than generic pepper).
3. **Stopword list** for universal pantry items (соль, сахар) editable in Settings.
4. **Ingredient quantities** parsed from OCR (`2 ст. л.`, `300 г`).
5. **Meal scheduling** calendar; export as iCal.
6. **Shopping list** from a multi-recipe selection.
7. **Nutrition lookup** against an open food DB; cached locally.
8. **Perceptual-hash dedupe** (pHash via `sharp.raw()` + bit-distance).
9. **Export/import** (zip vault).
10. **Multiple vaults** with a quick switcher.
11. **Bulk OCR re-run** after upgrading tesseract.
12. **Mobile read-only viewer** (PWA pointed at a shared folder).
