# OCR Reading Order & Tag Matcher Precision

**Date:** 2026-07-29
**Status:** Approved, not yet implemented

## Problem

Recipe screenshots are magazine pages with two text columns. Two defects compound:

1. **Columns are read as single lines.** OCR emits `<left column text> <right column text>`
   glued together, producing incoherent stored text.
2. **Hyphenated line breaks are preserved verbatim.** Magazine typesetting breaks words at line
   ends (`па-\nсту`, `ин-\nдейку`, `готовно-\nсти`). The tokenizer then feeds the stemmer two
   fragments, and the real ingredient never matches its tag.

Investigating with two real screenshots surfaced a third, independent defect: the tag matcher
produces false positives (`Десерт` on both a spaghetti and a liver recipe, `Макароны` on the liver
recipe). This is not an OCR bug, and fixing OCR makes it worse — today's mangled text accidentally
suppresses matches that clean text will fire reliably.

## Root causes

### Column merging

`node_modules/tesseract.js/src/worker-script/constants/defaultParams.js:7` sets:

```js
tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // = '6'
```

tesseract.js overrides Tesseract's own default (PSM 3 = AUTO) with PSM 6, *"assume a single uniform
block of text."* PSM 6 performs no page layout analysis — it finds horizontal text lines spanning
the full image width. `src/main/ocr/worker.ts:66-77` never calls `setParameters`, so this default is
what runs.

### Tag false positives

Three distinct causes, confirmed against `resources/seed-tags.yaml`:

| Observed | Cause | Seed evidence |
|---|---|---|
| `сладкий перец` → **Десерт** | Sub-window shadowing. `matcher.ts:22-30` fires every window length at every position, so `сладк перец` matches Болгарский перец *and* bare `сладк` matches Десерт via alias `сладкое`. | `сладкий перец` alias at line 72 |
| `паста томатная` → **Макароны** | No tomato-paste tag exists, so the bare 1-token `паст` window matches Макароны's `паста` alias unopposed. | no `томатная паста` anywhere in seed |
| `печень` → **Десерт** | Stem collision. `PorterStemmerRu` maps both `печень` (liver) and `печенье` (cookie) to `печен`. No liver tag exists to compete. | `печень` absent; only `печенье` at line 400 |

Verified stem collisions:

```
печень   -> печен   |  печенье  -> печен    COLLIDE
сладкий  -> сладк   |  сладкое  -> сладк    COLLIDE
```

Additionally, bare `перец` is an alias for Болгарский перец (line 74), so `перец черный молотый`
tags bell pepper on any black-pepper recipe.

## Measured evidence

Recipes cropped from the two supplied screenshots (`r1` = spaghetti, 470×616; `r2` = liver,
758×795), run through tesseract.js 4.1.4 with `rus+eng`.

| Config | r1 conf | r2 conf | r2 time | Columns separated? |
|---|---|---|---|---|
| A. PSM 6 (current) | 59 | 72 | 2039 ms | No |
| B. PSM 3 | 83 | 86 | 1006 ms | Mostly |
| C. PSM 3 + 2× upscale | 84 | 82 | 2391 ms | Mostly |

PSM 3 is both more accurate and *faster*, because it stops trying to read the food photograph as
text.

**PSM 3 alone is insufficient.** This line survives in every PSM 3 variant:

```
печень куриная - 500 г Тульской обл.
```

Left-column ingredient merged with right-column byline *inside a single line object*. Block-level
reordering cannot fix it. Word-level geometry can — the gap is unmistakable:

```
gap= 302px  "печень куриная - 500 г"  ||  "Тульской обл."
```

r2's word x-histogram shows a clean gutter at x≈360 (coverage drops from ~25 words per 20px bin to
2). r1's histogram never reaches zero, so a gutter detector must find a *minimum-crossing cut*, not
an empty bin.

**Upscaling is safe once confidence-filtered.** 2× upscale recovered content PSM 3 alone dropped
entirely — the title `Спагетти с индейкой и грибами` and the whole pink «От шеф-повара» box. It
appears to explode r2 from 4 blocks to 19, but 11 of those are empty non-text regions Tesseract
correctly skipped. Only two are garbage, and they separate cleanly by confidence:

```
conf= 10.3  "охчЕтиелчтИСОКОТоичЕниуичЕ т оее т оо"   <- border noise
conf= 11.7  "`"                                        <- stray mark
conf= 63.4  "® 300 г шампиньонов _"                    <- real text, low conf
conf= 75.4  ",\[\ Р”, ' \ Я ПЕЧРЬ ' ремешайте. Влейте…" <- junk + good text MIXED
```

A threshold of 50 separates junk (10–12) from real text (≥63). The `conf=75.4` block mixes failed
title recognition into otherwise-good text, which is why filtering must be **word**-level, not
block-level.

## Design

### Module layout

```
src/main/ocr/
  worker.ts       (modified) — PSM 3, sharp preprocessing, returns word geometry
  layout.ts       (new)      — words + bboxes -> column-ordered lines
  postprocess.ts  (new)      — lines -> de-hyphenated, paragraph-joined text
```

`layout.ts` and `postprocess.ts` operate on plain data, never on images. Their tests are JSON
fixtures — no magazine images committed to git, no OCR or network in CI.

### 1. Preprocessing

In `worker.ts`, before recognition: 2× lanczos upscale, greyscale, normalise, via `sharp` to an
in-memory buffer. Justified by recovering the title and pink callout box; costs roughly 2× runtime.

Bounding boxes return in upscaled coordinates. Every consumer uses them relatively, so no
back-mapping is needed. If a future feature links text to image regions, divide by the scale factor.

### 2. OCR settings

`worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })` after `initialize`. This is the core
fix for column merging.

### 3. Layout reconstruction (`layout.ts`)

1. Flatten `data.blocks → paragraphs → lines → words`, retaining bbox and confidence.
2. Drop words with `confidence < 50`.
3. Detect column gutters from an x-coverage histogram over surviving words, choosing the vertical
   cut that crosses the fewest word boxes. Not "find an empty bin" — r1 has no empty bin.
4. Assign each word to a column by bbox midpoint. Group words into lines by y-overlap; sort lines
   by y, words within a line by x.
5. Emit columns left to right.
6. **Degrade to single-column when no cut clears the confidence threshold.** A wrong column split is
   worse than none; the failure mode must be "no worse than today."

This is what repairs `печень куриная - 500 г Тульской обл.`

### 4. Text repair (`postprocess.ts`)

- Join a line ending in `-` with the next line when that line starts lowercase, dropping the hyphen.
- Collapse remaining intra-paragraph newlines to spaces.
- Preserve blank lines between paragraphs.

This lives in `src/main/ocr/`, deliberately **not** in `tags/normalize.ts`. It is OCR text repair
upstream of both display and matching, not a matching rule, so the project's one-normalizer
invariant holds and `normalize.ts` is untouched by this work.

Because repair runs before `ocr_text` is persisted, both the detail-view display
(`src/renderer/src/routes/detail.tsx:236`) and the tag matcher benefit from the same stored text.

### 5. Matcher precision (`matcher.ts`)

**5a. Longest-match-wins.** Replace the all-windows-at-all-positions loop (`matcher.ts:22-30`) with
a greedy left-to-right scan: at each position take the longest matching window (3→1) and consume its
tokens. Fixes `сладкий перец` → Десерт, and is a prerequisite for 5b.

**5b. Seed gaps.** Add tags for `печень`, `томатная паста`, and `чёрный перец`, each with aliases in
both word orders — OCR yields `паста томатная` while the natural alias is `томатная паста`. Combined
with 5a, the longer alias then beats the bare one, fixing `паста томатная` → Макароны and the bare
`перец` problem.

**5c. Exact-match aliases.** `печень`/`печенье` both stem to `печен`, so no window logic separates
them — and adding a `печень` tag alone would just make `печен` ambiguous between two tags.

Add `tag_aliases.match_mode TEXT NOT NULL DEFAULT 'stem' CHECK(match_mode IN ('stem','exact'))`.
`exact` compares the normalized surface form rather than the stem. Mark `печенье` as `exact`, seeded
with its inflected forms to limit recall loss on declensions.

This is the only schema change in the spec. It requires:

1. A migration appended to `MIGRATIONS` in `src/main/db/migrations.ts`, advancing
   `PRAGMA user_version` from 1 to 2.
2. Bumping `CURRENT_SCHEMA_VERSION` in `src/main/vault/manager.ts:9` from 1 to 2.
3. A test running old→new against a fixture vault.

**Gotcha:** these are two independent counters that happen to both be `1` today.
`PRAGMA user_version` (indexed off `MIGRATIONS.length`) drives the migration runner;
`CURRENT_SCHEMA_VERSION` is written into `vault.json` and is only read as a forward-compatibility
guard — `manager.ts:28` refuses to open a vault whose `schemaVersion` exceeds the app's. Bumping one
without the other either skips the migration or lets an older build silently open a migrated vault.

### 6. Backfill

No bulk re-OCR. Stored `ocr_text` improves only when a recipe is re-OCR'd through the existing
per-recipe control from Phase 7. Existing recipes keep their current text until the user chooses to
refresh them.

## Testing

- `layout.ts` — JSON fixtures recorded from `data.blocks` for both screenshots. Assert column
  ordering, the 302px intra-line split, confidence filtering, and single-column fallback when no
  gutter is confident.
- `postprocess.ts` — unit tests for hyphen joining (including the `из-за` / `по-русски` ambiguity),
  paragraph preservation, and line collapsing.
- `matcher.ts` — assert that `сладкий перец` yields only Болгарский перец, `паста томатная` yields
  only томатная паста, and `печень` no longer yields Десерт.
- Migration — old→new fixture vault test for `match_mode`.

## Risks and limitations

- **Designed against two screenshots.** The gutter detector is validated on one clean case (r2) and
  one ambiguous case (r1). Expect a second round of tuning against the full vault.
- **Seed curation is open-ended.** The three false positives found here are unlikely to be the only
  ones; the stem collisions were found by inspection, not systematically.
- **Exact-match reduces recall** on inflected forms of any alias marked `exact`. Mitigated by
  seeding explicit inflections, but the trade-off is real.
- **Upscaling doubles OCR time.** Acceptable for ingest, and partly offset by PSM 3 being faster
  than PSM 6 on photo-heavy pages.

## Out of scope

- Bulk re-OCR of the existing vault.
- Free-text search over `ocr_text` (v2 feature).
- Replacing `PorterStemmerRu` with a real Russian lemmatizer. This would fix the collision class at
  its root, but `natural` has no Russian lemmatizer and swapping the algorithm invalidates every
  stored alias and recipe tag.
- The empty `tessdata` cache observed at `%APPDATA%/meal-planner/tessdata` despite
  `cacheMethod: 'readWrite'`, which suggests language data is re-downloaded on every run. Worth a
  separate investigation.
