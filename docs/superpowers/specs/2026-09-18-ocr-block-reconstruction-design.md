# OCR Block Reconstruction & Cyrillic-Only Recognition

**Date:** 2026-09-18
**Status:** Approved, not yet implemented
**Supersedes:** parts of `2026-07-29-ocr-reading-order-design.md` (the geometric column-cut approach)

## Problem

Recipe screenshots are magazine pages. Stored `ocr_text` exhibits four defects, reported from
real use:

1. **Adjacent columns merge into single lines.** A three-column page reads as
   `<col1 row> <col2 row> <col3 row>` glued together.
2. **Hyphenated line breaks survive.** `блен-`, `используе-`, `вме-`, `необхо-` remain split.
3. **Paragraph breaks appear where none exist** in the source page.
4. **Bullets and letters are misrecognised** — `•` becomes `®`/`е`; `500 г` becomes `500 I`;
   `Томатов` becomes `TOматов`; `до` becomes `A0`; `зуб-` becomes `3y6-`; `также` becomes
   `TaKже`; `терке` becomes `Tepke`.

## Investigation

Measured against the real vault image `C_S0oyHTpi0K.png` (говядина в соусе из лука-порея),
1279×963, run through the actual pipeline (`sharp` 2× lanczos → greyscale → normalise →
tesseract.js 4.1.4, `PSM.AUTO`).

### The page is not a grid

The layout is L-shaped, not a uniform column grid:

- title and a pink ingredients box occupy a narrow left region (x ≈ 50–425)
- a photograph occupies the right two-thirds above y ≈ 660
- the left body column runs tall, y ≈ 470–950
- columns 2 and 3 begin only at y ≈ 665

No single vertical cut can describe this, because the number of text columns changes down the
page.

### Tesseract's own layout analysis is already correct

`recognize()` returned six blocks, correctly segmented and in reading order:

| block | bbox | content |
|---|---|---|
| 0 | (173,44)–(776,261) | title |
| 1 | (147,343)–(788,872) | ingredients box |
| 2 | (111,952)–(849,1908) | left body column |
| 3 | (892,1362)–(1632,1908) | middle column |
| 4 | (890,47)–(2558,1323) | the photograph |
| 5 | (1677,1377)–(2414,1907) | right column |

### The bug is that this structure is discarded

`worker.ts:93` calls `flattenWords(blocks)`, and `flattenWords` (`layout.ts:22-39`) walks
`blocks → paragraphs → lines → words` and returns a **flat array of words**, throwing away all
four levels. `reconstructLines` then re-derives layout geometrically from word boxes.

That geometric code is hard-limited to a single column split — `detectColumnCuts`
(`layout.ts:106-109`) returns `cut === null ? [] : [cut]`. On this page it found one cut at
x = 1655, splitting `[title + ingredients + col1 + col2] | [col3]` and gluing columns 1 and 2.

The July 2026 design added this geometry to compensate for `PSM.SINGLE_BLOCK` (6), which
performs no page layout analysis at all. The same change also set `PSM.AUTO` (3), which does.
The compensation was left in place after its justification disappeared, and it now produces a
worse result than the signal it discards.

**Defects 2 and 3 are downstream of defect 1.** `dehyphenate` requires the hyphen at a line end
(`-\n`); once columns are glued, `блен-` is followed by other text on the same line and cannot
match. The phantom paragraph breaks come from the median-gap heuristic firing on already-scrambled
geometry.

### Measured result of trusting the blocks

Same image, same engine, same settings — only the reconstruction changed:

> **1.** Говядину нарезать кусочками и обжарить в масле 5 минут, вынуть. Лук-порей промыть,
> нарезать полукольцами (только белую часть) и добавить в сотейник. Готовить 5 минут,
> помешивая. После чего влить 1 стакан кипятка или бульона и тушить до готовности мяса на
> небольшом огне, примерно 1,5 часа. В процессе готовки по необходимости доливать воду.
>
> **2.**Томаты в собственном соку измельчить в блендере. …
>
> поперчить и всыпать сахар по вкусу, если помидоры кислые. …

Columns in correct order; hyphens repaired (`кусоч-ками`→`кусочками`, `бульо-на`→`бульона`,
`блен-дере`→`блендере`, `вме-сте`→`вместе`); no phantom breaks; title on one line.

### The photograph excludes itself

Block 4 contains exactly one word: `" "` at **confidence 95**. It is excluded by the
empty-after-`trim()` check, not by confidence and not by any word-count threshold. No
content-based filter is required, so no real content can be lost to one.

### Language: `rus+eng` causes the letter substitutions

`LANG = 'rus+eng'` (`worker.ts:13`) keeps Latin glyphs in the candidate set for every character.
Re-running with `rus` alone, block segmentation identical (6 blocks):

| `rus+eng` | `rus` | |
|---|---|---|
| `500 I` | `500 г` | fixed |
| `4 3y6- чика` | `4 зубчика` | fixed |
| `A0 готовности` | `до готовности` | fixed |
| `TaKже` | `также` | fixed |
| `Tepke` | `терке` | fixed |
| `400 I TOматов` | `400 ГТОматов` | still wrong |
| `тлук-порей` | `тлук-порей` | still wrong |
| `®` / `е` bullets | unchanged | still wrong |

Five of seven recognition defects resolve. The remainder are word-segmentation errors, not
homoglyph substitutions, and are accepted (see Non-goals).

### Latent bug: `ocr_lang` is decorative

`runOcr(imagePath)` (`worker.ts:85`) takes no language argument and always uses the module
constant. But `recipes:reOcr` (`recipes.ts:137-139`) accepts a `lang` parameter and writes it to
`recipes.ocr_lang`, as does `pipeline.ts:78`. **The stored value never reflects what actually
ran, and the IPC argument is silently ignored.** Changing the default makes this actively
misleading, so it is fixed here.

## Non-goals

- **No engine change.** PaddleOCR and EasyOCR were evaluated. Both have viable pure-JS ONNX
  ports (`ppu-paddle-ocr` ships an explicit Cyrillic model; `easyocr.js` is a native TS port),
  so Python is not the obstacle. The obstacle is that **both are detection + recognition only** —
  layout analysis is a separate model (`ppu-doclayout` / PP-StructureV3). Adopting either would
  discard the block segmentation this design proves is already correct, and require rebuilding
  column grouping from raw boxes — reintroducing the defect being fixed. EasyOCR's
  `paragraph=True` clusters by 2-D proximity with no column or reading-order awareness, so it
  does not substitute for that. Revisit only if measured recognition accuracy justifies it.
- **No homoglyph-repair module.** The language change removes the cause. The surviving `®`/`е`
  bullets are display-only: `tokenize` (`tags/normalize.ts:14-18`) discards single-character
  tokens, so they never reach the matcher.
- **No bulk re-OCR / migration.** Project is in development; the vault is recreated by hand.
  Existing rows keep `rus+eng` text until individually re-run.
- **No geometric fallback retained.** If Tesseract ever returns a single block, output degrades
  to "one region, read in order" — the pre-July behaviour, no worse than today.

## Design

### Pipeline

```
preprocess              unchanged   (2× lanczos → greyscale → normalise)
tesseract recognize     PSM.AUTO, lang now 'rus'
blocksToLines(blocks)   NEW         replaces flattenWords + reconstructLines
joinLines(lines)        unchanged   (dehyphenate + paragraph assembly)
```

### `blocksToLines`

```ts
export const blocksToLines = (
  blocks: TessBlock[],
  minConfidence = DEFAULT_MIN_CONFIDENCE
): string[]
```

Walks `blocks → paragraphs → lines → words`. A word survives when
`confidence >= minConfidence && text.trim() !== ''`. A line is its surviving words joined by a
space; empty lines are dropped. A `''` entry separates paragraphs.

It returns `string[]` with `''` paragraph markers — **the same contract `reconstructLines` has
today** — so `postprocess.ts` needs no change. Its de-hyphenation and paragraph assembly were
never broken; they were being fed scrambled input.

Paragraph granularity comes from Tesseract's `paragraphs`, not from block boundaries, so a block
containing two paragraphs (block 1, the ingredients box) still splits correctly.

### Deletions

`layout.ts` is removed. Roughly 200 of its 236 lines existed solely to compensate for the absent
layout analysis: `findSingleCut`, `countCrossings`, `detectColumnCuts`, `midpoint`,
`overlapsVertically`, `groupWordsIntoLines`, `groupIntoLines`, `typicalWordGap`, `isSpanningLine`,
`median`, `centreY`, `lineTop`, `lineBottom`, `flattenWords`, `reconstructLines`, and the
constants `MIN_WORDS_FOR_SPLIT`, `SEARCH_MARGIN`, `MIN_SIDE_SHARE`, `MIN_PLATEAU_SHARE`,
`MIN_PLATEAU_PX`, `CROSSING_TOLERANCE_SHARE`, `VERTICAL_OVERLAP_RATIO`, `PARAGRAPH_GAP_RATIO`,
`MIN_LINES_FOR_GAP_ANALYSIS`, `SPAN_GAP_RATIO`.

Surviving: `Bbox`, `OcrWord`, `TessBlock`, `DEFAULT_MIN_CONFIDENCE`.

### Rename `layout.ts` → `blocks.ts`

The module no longer performs layout analysis; it reads the layout Tesseract produced. Keeping
the name would re-invite the same mistake.

### Language plumbing

- `worker.ts`: `const LANG = 'rus'` as the default; `runOcr(imagePath, lang = LANG)` passes the
  value to the worker and returns it in `OcrResult.lang`.
- `pipeline.ts` and `recipes.ts`: write `ocr_lang` from the value `runOcr` actually used, not a
  literal.
- `rus` specifically, not Tesseract's generic `script/Cyrillic` model — the Russian-trained model
  is materially better on Russian.

### Worker pool and language

The pool (`worker.ts:37-50`) initialises each worker with a fixed language at construction.
Honouring a per-call `lang` therefore requires either re-initialising a worker when the requested
language differs from its current one, or keying the pool by language. The implementation should
take the simpler path: re-initialise on mismatch, since non-default languages are rare.

## File structure

| file | change |
|---|---|
| `src/main/ocr/layout.ts` | deleted |
| `src/main/ocr/blocks.ts` | new — types, `DEFAULT_MIN_CONFIDENCE`, `blocksToLines` |
| `src/main/ocr/preprocess.ts` | new — `preprocessImage`, extracted from `worker.ts`; no `electron` import |
| `src/main/ocr/worker.ts` | `LANG='rus'`; `runOcr(path, lang)`; calls `preprocessImage` + `blocksToLines` |
| `src/main/ocr/postprocess.ts` | unchanged |
| `src/main/ingest/pipeline.ts` | pass lang through; `ocr_lang` from result |
| `src/main/ipc/recipes.ts` | pass `lang` into `runOcr` |
| `src/main/ocr/__tests__/layout.test.ts` | deleted |
| `src/main/ocr/__tests__/blocks.test.ts` | new |
| `src/main/ocr/__tests__/fixtures/liver-words.json` | deleted (word-level; recorded post-flatten, cannot drive block code) |
| `src/main/ocr/__tests__/fixtures/spaghetti-words.json` | deleted (same) |
| `src/main/ocr/__tests__/fixtures/*-blocks.json` | new — block-level |
| `src/main/ocr/__tests__/fixtures/images/*.png` | new — committed source pages |
| recorder entry point | new — see "Recorder must run under the test ABI" |
| `package.json` | add `ocr:record` script |
| `CLAUDE.md` | update pitfalls naming `layout.ts`; add language invariant |

## Testing

1. **Unit** — `blocksToLines` against synthetic blocks: confidence filtering; a whitespace-only
   word at high confidence excluded (the block-4 photo case); paragraph separators emitted
   between paragraphs but not before the first; empty input; a block whose words are all filtered
   out contributing nothing.
2. **Integration** — committed block-level fixtures through `blocksToLines → joinLines`,
   asserting the three body columns appear in order and that `кусоч-ками`, `бульо-на`,
   `блен-дере`, `вме-сте` are rejoined.
3. **Recording** — `npm run ocr:record` regenerates fixtures from real images via the actual
   Tesseract pipeline. Kept out of `npm test` so the suite does not download language data or pay
   ~3–5 s per image.

Fixtures are the baseline any future engine evaluation must beat, which is how the deferred
engine decision (see Non-goals) gets made on evidence rather than impression.

### Fixture source images live in the repo

Recording must not read from the vault. Vault filenames are `nanoid` ids that change whenever a
recipe is re-added, and the project is in a phase where the vault is recreated by hand — a
recorder pointed at `<vault>/pictures/<id>.png` breaks on the next recreate.

Two representative pages are committed to `src/main/ocr/__tests__/fixtures/images/` at original
resolution (downscaling would change OCR output and void the fixture's purpose):

| file | source | why |
|---|---|---|
| `beef-three-column.png` | vault `C_S0oyHTpi0K.png`, 1279×963, 1.87 MB | the L-shaped three-column case this design is built on; includes a photo block |
| `pork-two-column.png` | vault `U7wPAUTu_Xl6.png`, 0.59 MB | simpler two-region page, guards against over-fitting to the hard case |

≈2.5 MB total. Acceptable for fixtures that pin OCR behaviour across engine and preprocessing
changes.

### Recorder must import the real preprocessing, not restate it

Native-module ABI is *not* the constraint here. `sharp` is N-API and runs unmodified under bare
Node (verified: `node -e "require('sharp')…"` succeeds under Node 20 with no rebuild);
`tesseract.js` is JS plus WASM. Only `better-sqlite3` needs the Electron↔Node rebuild dance, and
the recorder has no reason to touch the database.

The real constraint is drift. Fixtures are only meaningful if recorded through **the same
preprocessing production uses** — the 2× lanczos upscale, greyscale and normalise in
`worker.ts:18-27`. A standalone `scripts/*.mjs` recorder cannot import that TypeScript, so it
would have to restate those `sharp` calls, and the copy would silently diverge the first time
preprocessing is tuned. That is precisely the failure mode `CLAUDE.md` already records for
`layout.ts` + `postprocess.ts`: two components each correct alone, wrong in composition.

Two consequences:

1. **Extract preprocessing.** `preprocessImage(imagePath: string): Promise<Buffer>` moves out of
   `worker.ts` into `src/main/ocr/preprocess.ts`, which must not import `electron` so that
   non-Electron callers can use it. `worker.ts` imports it.
2. **Run the recorder through Vitest,** so it can import that TypeScript module directly. It
   lives outside the default suite via a separate config, keeping `npm test` free of model
   downloads and multi-second runs.

## Accepted residue

Documented, not fixed: `ГТОматов` (lost space — `томат` will not match on that occurrence),
`тлук-порей` (`1`→`т`; the tag still matches from `Лук-порей` in the body text), `®`/`е` for
bullets (display only), `МЯКОТИ ГОВЯДИны` capitalisation (harmless — the matcher lowercases).

## Risks

- **Dropping `eng` garbles genuinely Latin text.** Brand names or English words in a recipe will
  be forced into Cyrillic. Mitigated by the now-functional per-recipe `lang` override, which lets
  a specific recipe be re-run as `rus+eng`.
- **Reliance on Tesseract's block segmentation.** If it is wrong on some page, there is no
  geometric fallback. Accepted: the fallback being removed is what produces the current defect,
  and degradation is to single-block reading order.
- **Fixture staleness.** A tesseract.js upgrade may shift output and fail the integration tests.
  That is the intended signal; `npm run ocr:record` is the remedy.
