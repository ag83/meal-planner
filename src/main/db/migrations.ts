import type Database from 'better-sqlite3'

type Migration = (db: Database.Database) => void

// Each entry migrates from version N to N+1.
// Never edit existing entries — append new ones.
const MIGRATIONS: Migration[] = [
  // v0 → v1: initial schema
  (db) => {
    db.exec(`
      CREATE TABLE recipes (
        id           TEXT    PRIMARY KEY,
        ext          TEXT    NOT NULL,
        sha256       TEXT    NOT NULL UNIQUE,
        width        INTEGER,
        height       INTEGER,
        bytes        INTEGER,
        title        TEXT,
        notes        TEXT,
        ocr_lang     TEXT,
        ocr_text     TEXT,
        ocr_conf     REAL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        missing      INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE tags (
        id           INTEGER PRIMARY KEY,
        slug         TEXT    NOT NULL UNIQUE,
        label        TEXT    NOT NULL,
        kind         TEXT    NOT NULL CHECK(kind IN ('ingredient','dish_type','cuisine','user')),
        source       TEXT    NOT NULL CHECK(source IN ('builtin','user')),
        disabled     INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_tags_kind ON tags(kind) WHERE disabled = 0;

      CREATE TABLE tag_aliases (
        id           INTEGER PRIMARY KEY,
        tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        lemma        TEXT    NOT NULL,
        is_primary   INTEGER NOT NULL DEFAULT 0,
        source       TEXT    NOT NULL CHECK(source IN ('builtin','user')),
        disabled     INTEGER NOT NULL DEFAULT 0,
        UNIQUE(tag_id, lemma)
      );
      CREATE INDEX idx_tag_aliases_lemma ON tag_aliases(lemma) WHERE disabled = 0;

      CREATE TABLE recipe_tags (
        recipe_id    TEXT    NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        confidence   REAL    NOT NULL DEFAULT 1.0,
        source       TEXT    NOT NULL CHECK(source IN ('ocr','user')),
        PRIMARY KEY (recipe_id, tag_id)
      );
      CREATE INDEX idx_recipe_tags_tag ON recipe_tags(tag_id);

      CREATE TABLE recipe_tag_suppressions (
        recipe_id    TEXT    NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (recipe_id, tag_id)
      );
    `)
  },
  // v1 → v2: match_mode on aliases, for forms that stemming cannot disambiguate
  // (печень/печенье both stem to печен).
  (db) => {
    db.exec(`
      ALTER TABLE tag_aliases ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'stem'
        CHECK(match_mode IN ('stem','exact'));
    `)
  },
  // v1 → v2 seeding is additive, so corrections to built-in rules cannot reach
  // existing vaults through resources/seed-tags.yaml alone. Lemmas below are the
  // stemmed forms as stored (перец→перец, масло→масл, соль→сол); they are written
  // as literals so a future stemmer change cannot silently retarget this migration.
  // Only source='builtin' rows are touched — user aliases are never disabled here.
  (db) => {
    db.exec(`
      UPDATE tag_aliases SET disabled = 1
        WHERE source = 'builtin' AND lemma = 'перец'
          AND tag_id = (SELECT id FROM tags WHERE slug = 'bell_pepper');

      UPDATE tag_aliases SET disabled = 1
        WHERE source = 'builtin' AND lemma = 'масл'
          AND tag_id = (SELECT id FROM tags WHERE slug = 'butter');

      UPDATE tag_aliases SET disabled = 1
        WHERE source = 'builtin'
          AND tag_id = (SELECT id FROM tags WHERE slug = 'salt');

      UPDATE tags SET disabled = 1 WHERE slug = 'salt' AND source = 'builtin';
    `)
  }
]

export const runMigrations = (db: Database.Database): void => {
  const version = db.pragma('user_version', { simple: true }) as number
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      MIGRATIONS[i](db)
      db.pragma(`user_version = ${i + 1}`)
    })()
  }
}
