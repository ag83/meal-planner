# OCR Block Reconstruction & Cyrillic-Only Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~200 lines of geometric column-reconstruction with a direct read of Tesseract's own block structure, and switch default recognition to Russian-only, fixing column merging, surviving hyphens, phantom paragraphs, and Latin/Cyrillic character substitution.

**Architecture:** Tesseract already performs page layout analysis under `PSM.AUTO` and returns correctly segmented `blocks` in reading order. The current code discards that via `flattenWords` and re-derives layout from word geometry, which can only express one column split. This plan deletes the geometry and walks `blocks → paragraphs → lines → words` instead, preserving the existing `string[]`-with-`''`-separators contract so `postprocess.ts` is untouched. Separately, `LANG` moves from `'rus+eng'` to `'rus'`, removing Latin glyphs from the candidate set.

**Tech Stack:** TypeScript, Electron (main process), tesseract.js 4.1.4, sharp, Vitest.

## Global Constraints

- **TypeScript everywhere in `src/`**; no `.js` files under `src/`.
- **Named arrow functions only** — `const foo = (x: T): R => { ... }`. No `function` declarations or anonymous `function` expressions anywhere in `src/`.
- **No comments narrating WHAT** — code names carry that. Comment WHY only when non-obvious.
- **The renderer never touches `fs`, `path`, sqlite, or `child_process`** — all side effects go through IPC. This plan touches main-process code only.
- **`src/main/ocr/worker.ts` must keep `tessedit_pageseg_mode: PSM.AUTO`** — this entire design depends on Tesseract's layout analysis running. Never remove that call.
- **De-hyphenation and line joining stay in `src/main/ocr/postprocess.ts`**, upstream of both display and tag matching. Never move OCR text repair into `src/main/tags/normalize.ts`.
- **Conventional Commits**: `<type>(<scope>): <subject>`, imperative, lower case, no trailing period, ≤72 chars. Scopes in this repo: `ocr`, `tags`, `db`, `ipc`, `vault`, `ui`, `seed`.
- **Keep the `Co-Authored-By:` trailer** on assistant-authored commits.
- **Branch off `develop`** — never commit directly to `develop` or `master`.
- Verification commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

---

## Context the implementer needs

### Why this change exists (measured, not assumed)

Run against the real vault page `C_S0oyHTpi0K.png` (говядина, 1279×963), Tesseract returned six blocks, correctly segmented:

| block | bbox | content |
|---|---|---|
| 0 | (173,44)–(776,261) | title |
| 1 | (147,343)–(788,872) | ingredients box |
| 2 | (111,952)–(849,1908) | left body column |
| 3 | (892,1362)–(1632,1908) | middle column |
| 4 | (890,47)–(2558,1323) | the photograph |
| 5 | (1677,1377)–(2414,1907) | right column |

The existing geometric code found a single cut at x=1655, splitting `[title+ingredients+col1+col2] | [col3]` — gluing columns 1 and 2 into run-on lines.

**The photo block excludes itself.** Block 4 contains exactly one word: `" "` at **confidence 95**. It is removed by the empty-after-`trim()` check, *not* by confidence and *not* by any word-count rule. No content-based filter is needed, so none is added.

**Hyphens and phantom paragraphs are downstream symptoms.** `dehyphenate` needs the hyphen at a line end (`-\n`); once columns are glued, `блен-` has other text after it on the same line. Fixing the column merge fixes both, with no change to `postprocess.ts`.

### Existing files you will be working in

- `src/main/ocr/worker.ts` (99 lines) — sharp preprocessing, tesseract worker pool, `runOcr`.
- `src/main/ocr/layout.ts` (236 lines) — the geometry being deleted.
- `src/main/ocr/postprocess.ts` (22 lines) — `dehyphenate` + `joinLines`. **Do not modify.**
- `src/main/ingest/pipeline.ts` — calls `runOcr` at line 80, writes `ocr_lang` at line 78.
- `src/main/ipc/recipes.ts` — `recipes:reOcr` handler at lines 137–171.
- `src/main/ocr/__tests__/layout.test.ts` (24 tests) — tests the deleted code.
- `src/main/ocr/__tests__/fixtures/{liver,spaghetti}-words.json` — flat word arrays recorded *after* flattening, so they cannot drive block-based code.

### Test conventions in this repo

Tests live in `__tests__/` next to the code. Vitest, `environment: 'node'`, discovered via `include: ['src/**/*.{test,spec}.{ts,tsx}']` in `vitest.config.ts`. Fixtures are loaded with `fs.readFileSync` + `JSON.parse` (see `src/main/tags/__tests__/seed-rules.test.ts:19-20` for the established pattern) — **not** via JSON `import`, because `resolveJsonModule` is not enabled.

Run a single file with `npx vitest run <path>`. Note `npm test` maps to bare `vitest` (watch mode) — use `npx vitest run` for one-shot runs.

---

## File Structure

| file | responsibility |
|---|---|
| `src/main/ocr/preprocess.ts` | **new.** `preprocessImage` — sharp upscale/greyscale/normalise. No `electron` import, so non-Electron callers (the fixture recorder) can use it. |
| `src/main/ocr/blocks.ts` | **new.** Tesseract result types + `blocksToLines`. Pure, no I/O. |
| `src/main/ocr/layout.ts` | **deleted.** |
| `src/main/ocr/worker.ts` | worker pool + `runOcr`; composes `preprocessImage` and `blocksToLines`. |
| `src/main/ocr/postprocess.ts` | unchanged. |
| `src/main/ingest/pipeline.ts` | pass lang through; store the lang actually used. |
| `src/main/ipc/recipes.ts` | pass `lang` into `runOcr`. |
| `src/main/ocr/__tests__/blocks.test.ts` | **new.** Unit tests for `blocksToLines`. |
| `src/main/ocr/__tests__/reconstruction.test.ts` | **new.** Integration: recorded fixtures → `blocksToLines` → `joinLines`. |
| `src/main/ocr/__tests__/record-fixtures.record.ts` | **new.** Regenerates fixtures from real images. Outside the default suite. |
| `src/main/ocr/__tests__/fixtures/images/*.png` | **new.** Committed source pages. |
| `src/main/ocr/__tests__/fixtures/*.blocks.json` | **new.** Recorded block structure. |
| `vitest.record.config.ts` | **new.** Config whose `include` picks up `*.record.ts`. |

---

### Task 1: Extract `preprocessImage` into its own module

Pure refactor, no behaviour change. It exists so the fixture recorder can import the *real* preprocessing rather than restating the sharp calls — a duplicated copy would silently diverge the first time preprocessing is tuned.

**Files:**
- Create: `src/main/ocr/preprocess.ts`
- Create: `src/main/ocr/__tests__/preprocess.test.ts`
- Modify: `src/main/ocr/worker.ts:1-27` (remove local `preprocess`, import instead)

**Interfaces:**
- Produces: `preprocessImage(imagePath: string): Promise<Buffer>` and `UPSCALE: number` (value `2`), both from `src/main/ocr/preprocess.ts`. Task 4's recorder imports `preprocessImage`.

- [ ] **Step 1: Write the failing test**

Create `src/main/ocr/__tests__/preprocess.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import path from 'path'
import sharp from 'sharp'
import { preprocessImage, UPSCALE } from '../preprocess'

// process.cwd()-relative, matching the established fixture-loading pattern in
// src/main/tags/__tests__/seed-rules.test.ts:19. Avoids __dirname, which is not
// reliably available in Vitest's ESM transform.
const IMAGE = path.join(
  process.cwd(),
  'src/main/ocr/__tests__/fixtures/images/pork-two-column.png'
)

describe('preprocessImage', () => {
  it('upscales by UPSCALE', async () => {
    const original = await sharp(IMAGE).metadata()
    const out = await sharp(await preprocessImage(IMAGE)).metadata()

    expect(out.width).toBe(original.width! * UPSCALE)
  })

  it('desaturates to greyscale', async () => {
    // sharp's .greyscale() equalises R/G/B rather than re-encoding to a
    // single-channel PNG, so the real invariant is equal channel means, not
    // metadata().channels === 1.
    const stats = await sharp(await preprocessImage(IMAGE)).stats()
    const [r, g, b] = stats.channels.map((c) => c.mean)
    expect(r).toBeCloseTo(g, 1)
    expect(g).toBeCloseTo(b, 1)
  })
})
```

**Deviation note:** the original plan asserted `metadata().channels === 1`. Verified against the actual sharp output: `.greyscale()` desaturates (R=G=B) but keeps a 3-channel sRGB PNG encoding in the installed sharp version — this is existing, unchanged behavior, not a regression. The test above asserts the real invariant instead.

This test needs the fixture image, which Task 4 formally introduces. Add it now so this task is self-contained:

```bash
mkdir -p src/main/ocr/__tests__/fixtures/images
cp "E:/DIFF/CODE/MealPlanner/test/pictures/U7wPAUTu_Xl6.png" src/main/ocr/__tests__/fixtures/images/pork-two-column.png
cp "E:/DIFF/CODE/MealPlanner/test/pictures/C_S0oyHTpi0K.png" src/main/ocr/__tests__/fixtures/images/beef-three-column.png
```

If those vault paths no longer exist (the vault is recreated by hand during development), any magazine-style recipe screenshot works for this task's assertion — but Task 4's text assertions are specific to these two pages, so prefer restoring them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/ocr/__tests__/preprocess.test.ts`
Expected: FAIL — `Failed to resolve import "../preprocess"`.

- [ ] **Step 3: Create the module**

Create `src/main/ocr/preprocess.ts`:

```ts
import sharp from 'sharp'

export const UPSCALE = 2

// Screenshots run 8-12px x-height; Tesseract wants >=20px. Upscaling also recovers
// stylised headings that are otherwise dropped entirely.
export const preprocessImage = async (imagePath: string): Promise<Buffer> => {
  const image = sharp(imagePath)
  const { width } = await image.metadata()
  if (!width) return image.greyscale().normalise().toBuffer()
  return image
    .resize({ width: width * UPSCALE, kernel: 'lanczos3' })
    .greyscale()
    .normalise()
    .toBuffer()
}
```

- [ ] **Step 4: Rewire `worker.ts`**

In `src/main/ocr/worker.ts`, delete the local `preprocess` function (lines 18–27) and the now-unused `sharp` import, then add `import { preprocessImage } from './preprocess'` alongside the other local imports. Also delete the now-unused `const UPSCALE = 2` at line 14.

Change the call site inside `runOcr` from:

```ts
    const buffer = await preprocess(imagePath)
```

to:

```ts
    const buffer = await preprocessImage(imagePath)
```

- [ ] **Step 5: Run tests, typecheck and lint**

Run: `npx vitest run src/main/ocr/ && npm run typecheck && npm run lint`
Expected: all PASS. Typecheck catches a missed `sharp` or `UPSCALE` reference in `worker.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/main/ocr/preprocess.ts src/main/ocr/__tests__/preprocess.test.ts src/main/ocr/worker.ts src/main/ocr/__tests__/fixtures/images
git commit -m "refactor(ocr): extract preprocessImage into its own module

Lets the fixture recorder import the real preprocessing instead of
restating the sharp pipeline, which would silently diverge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Replace geometric reconstruction with block traversal

The core change. Adds `blocksToLines`, wires it into `runOcr`, and deletes `layout.ts` with its tests and stale fixtures.

**Files:**
- Create: `src/main/ocr/blocks.ts`
- Create: `src/main/ocr/__tests__/blocks.test.ts`
- Delete: `src/main/ocr/layout.ts`
- Delete: `src/main/ocr/__tests__/layout.test.ts`
- Delete: `src/main/ocr/__tests__/fixtures/liver-words.json`
- Delete: `src/main/ocr/__tests__/fixtures/spaghetti-words.json`
- Modify: `src/main/ocr/worker.ts` (imports and `runOcr` body)

**Interfaces:**
- Consumes: `preprocessImage(imagePath: string): Promise<Buffer>` from Task 1.
- Produces, all from `src/main/ocr/blocks.ts`:
  - `OcrWord = { text: string; confidence: number }`
  - `TessLine = { words: OcrWord[] }`
  - `TessParagraph = { lines: TessLine[] }`
  - `TessBlock = { paragraphs: TessParagraph[] }`
  - `DEFAULT_MIN_CONFIDENCE: number` (value `50`)
  - `blocksToLines(blocks: TessBlock[], minConfidence?: number): string[]`

  Task 4 imports `TessBlock` and `blocksToLines`.

**Note on a deliberate deviation from the spec:** the spec lists `Bbox` among surviving types. Drop it. Once geometry is gone nothing reads coordinates, so `OcrWord` needs only `text` and `confidence`. This also makes recorded fixtures far smaller. Structural typing means tesseract's richer word objects still satisfy the narrower interface.

- [ ] **Step 1: Write the failing tests**

Create `src/main/ocr/__tests__/blocks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { blocksToLines } from '../blocks'
import type { OcrWord, TessBlock } from '../blocks'

const w = (text: string, confidence = 90): OcrWord => ({ text, confidence })

// paragraphs -> lines -> words
const mkBlock = (paragraphs: OcrWord[][][]): TessBlock => ({
  paragraphs: paragraphs.map((lines) => ({ lines: lines.map((words) => ({ words })) }))
})

describe('blocksToLines', () => {
  it('returns an empty array for no blocks', () => {
    expect(blocksToLines([])).toEqual([])
  })

  it('joins the words of a line with single spaces', () => {
    const blocks = [mkBlock([[[w('соль'), w('и'), w('сахар')]]])]
    expect(blocksToLines(blocks)).toEqual(['соль и сахар'])
  })

  it('keeps each line of a paragraph as its own entry', () => {
    const blocks = [mkBlock([[[w('первая')], [w('вторая')]]])]
    expect(blocksToLines(blocks)).toEqual(['первая', 'вторая'])
  })

  it('separates paragraphs with a blank entry but never leads with one', () => {
    const blocks = [mkBlock([[[w('один')]], [[w('два')]]])]
    expect(blocksToLines(blocks)).toEqual(['один', '', 'два'])
  })

  it('separates paragraphs across different blocks too', () => {
    const blocks = [mkBlock([[[w('блок')]]]), mkBlock([[[w('другой')]]])]
    expect(blocksToLines(blocks)).toEqual(['блок', '', 'другой'])
  })

  it('drops words below the confidence threshold', () => {
    const blocks = [mkBlock([[[w('хорошо', 90), w('мусор', 20)]]])]
    expect(blocksToLines(blocks)).toEqual(['хорошо'])
  })

  it('honours an explicit confidence threshold', () => {
    const blocks = [mkBlock([[[w('a', 60), w('b', 40)]]])]
    expect(blocksToLines(blocks, 50)).toEqual(['a'])
    expect(blocksToLines(blocks, 30)).toEqual(['a b'])
  })

  // Tesseract reports the photo region as a single whitespace word at confidence 95,
  // so emptiness — not confidence — is what must exclude it.
  it('drops a whitespace-only word even at high confidence', () => {
    const blocks = [mkBlock([[[w(' ', 95)]]])]
    expect(blocksToLines(blocks)).toEqual([])
  })

  it('contributes nothing, not even a separator, for a fully filtered block', () => {
    const blocks = [
      mkBlock([[[w('текст')]]]),
      mkBlock([[[w(' ', 95)]]]),
      mkBlock([[[w('дальше')]]])
    ]
    expect(blocksToLines(blocks)).toEqual(['текст', '', 'дальше'])
  })

  it('drops an empty line but keeps the surrounding ones in the same paragraph', () => {
    const blocks = [mkBlock([[[w('до')], [w(' ', 95)], [w('после')]]])]
    expect(blocksToLines(blocks)).toEqual(['до', 'после'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/ocr/__tests__/blocks.test.ts`
Expected: FAIL — `Failed to resolve import "../blocks"`.

- [ ] **Step 3: Create `blocks.ts`**

Create `src/main/ocr/blocks.ts`:

```ts
export interface OcrWord {
  text: string
  confidence: number
}

export interface TessLine {
  words: OcrWord[]
}

export interface TessParagraph {
  lines: TessLine[]
}

// Structural subset of tesseract.js output — declared locally so this stays
// testable without importing tesseract types into unit tests.
export interface TessBlock {
  paragraphs: TessParagraph[]
}

export const DEFAULT_MIN_CONFIDENCE = 50

// Tesseract's PSM.AUTO layout analysis already orders blocks and groups them into
// paragraphs and lines; this reads that result rather than re-deriving it from
// word geometry. Blank entries mark paragraph boundaries for postprocess.joinLines.
export const blocksToLines = (
  blocks: TessBlock[],
  minConfidence = DEFAULT_MIN_CONFIDENCE
): string[] => {
  const out: string[] = []

  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      const lines: string[] = []

      for (const line of paragraph.lines) {
        const text = line.words
          .filter((word) => word.confidence >= minConfidence && word.text.trim().length > 0)
          .map((word) => word.text)
          .join(' ')
          .trim()
        if (text.length > 0) lines.push(text)
      }

      if (lines.length === 0) continue
      if (out.length > 0) out.push('')
      out.push(...lines)
    }
  }

  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/ocr/__tests__/blocks.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Wire it into `worker.ts`**

In `src/main/ocr/worker.ts`, replace the two layout imports:

```ts
import { flattenWords, reconstructLines } from './layout'
import { joinLines } from './postprocess'
import type { TessBlock } from './layout'
```

with:

```ts
import { blocksToLines } from './blocks'
import { joinLines } from './postprocess'
import type { TessBlock } from './blocks'
```

and replace these two lines in `runOcr`:

```ts
    const words = flattenWords((blocks ?? []) as TessBlock[])
    const text = joinLines(reconstructLines(words))
```

with:

```ts
    const text = joinLines(blocksToLines((blocks ?? []) as TessBlock[]))
```

- [ ] **Step 6: Delete the geometry and its stale fixtures**

```bash
git rm src/main/ocr/layout.ts src/main/ocr/__tests__/layout.test.ts
git rm src/main/ocr/__tests__/fixtures/liver-words.json src/main/ocr/__tests__/fixtures/spaghetti-words.json
```

The two JSON fixtures are flat word arrays recorded *after* flattening — the block structure is already absent from them, so they cannot drive block-based code. Task 4 records replacements.

- [ ] **Step 7: Verify nothing still references the deleted module**

Run: `grep -rnE "from '\./layout'|reconstructLines|flattenWords|detectColumnCuts" src/ --include=*.ts`
Expected: no matches.

Then: `npm run typecheck && npm run lint && npx vitest run`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/main/ocr
git commit -m "feat(ocr): read tesseract block structure instead of re-deriving layout

PSM.AUTO already performs page layout analysis and returns blocks in
reading order, but flattenWords discarded all four levels of it and the
geometric replacement could express only one column split, gluing
adjacent columns on three-column pages. Surviving hyphens and phantom
paragraph breaks were downstream of that, so they resolve here too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Default to Cyrillic-only recognition and make `ocr_lang` truthful

Switches `LANG` to `'rus'`, which removes Latin glyphs from the candidate set. Measured on the говядина page, this fixes `500 I`→`500 г`, `3y6-`→`зуб`, `A0`→`до`, `TaKже`→`также`, `Tepke`→`терке`, with identical block segmentation.

It also fixes a latent bug: `runOcr(imagePath)` takes no language argument, so the `lang` parameter accepted by `recipes:reOcr` is silently ignored and the `recipes.ocr_lang` column records a value that never ran.

**Files:**
- Modify: `src/main/ocr/worker.ts` (LANG, `PoolEntry`, `buildPool`, `runOcr`)
- Modify: `src/main/ingest/pipeline.ts:75-96`
- Modify: `src/main/ipc/recipes.ts:137-159`
- Create: `src/main/ocr/__tests__/worker-lang.test.ts`

**Interfaces:**
- Consumes: `blocksToLines` and `TessBlock` from Task 2.
- Produces: `runOcr(imagePath: string, lang?: string): Promise<OcrResult>` where `OcrResult = { text: string; confidence: number; lang: string }`. `OcrResult.lang` is the language actually used and is what callers must persist. `DEFAULT_LANG: string` (value `'rus'`) is exported from `src/main/ocr/worker.ts`.

- [ ] **Step 1: Write the failing test**

`runOcr` needs a real Electron app object and tesseract workers, so this test covers the contract that is cheap to test and was actually broken — that the default language is exported and Russian-only.

Create `src/main/ocr/__tests__/worker-lang.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: (): string => '/tmp/meal-planner-test' } }))

describe('OCR language default', () => {
  it('defaults to Russian only, not rus+eng', async () => {
    const { DEFAULT_LANG } = await import('../worker')
    expect(DEFAULT_LANG).toBe('rus')
  })

  it('does not permit Latin glyphs via an eng traineddata', async () => {
    const { DEFAULT_LANG } = await import('../worker')
    expect(DEFAULT_LANG).not.toContain('eng')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/ocr/__tests__/worker-lang.test.ts`
Expected: FAIL — `DEFAULT_LANG` is not exported (`undefined`).

- [ ] **Step 3: Change the language and thread it through the pool**

In `src/main/ocr/worker.ts`:

Replace `const LANG = 'rus+eng'` with:

```ts
// Russian-only: 'rus+eng' keeps Latin glyphs in the candidate set for every
// character, which produced 500 I for 500 г, TaKже for также, A0 for до.
// The Russian-trained model also beats the generic script/Cyrillic one.
export const DEFAULT_LANG = 'rus'
```

Replace every remaining `LANG` reference in the file with `DEFAULT_LANG`.

Add `lang` to the pool entry so a worker can be re-initialised when a caller asks for something else:

```ts
interface PoolEntry {
  worker: Worker
  busy: boolean
  lang: string
}
```

In `buildPool`, change the returned object from `{ worker, busy: false }` to:

```ts
      return { worker, busy: false, lang: DEFAULT_LANG }
```

and change its `loadLanguage`/`initialize` calls to use `DEFAULT_LANG`.

Replace `runOcr` with:

```ts
export const runOcr = async (imagePath: string, lang = DEFAULT_LANG): Promise<OcrResult> => {
  await ensurePool()
  const entry = await acquireWorker()
  try {
    // Non-default languages are rare, so re-initialising on demand beats keying
    // a separate pool per language.
    if (entry.lang !== lang) {
      await entry.worker.loadLanguage(lang)
      await entry.worker.initialize(lang)
      entry.lang = lang
    }

    const buffer = await preprocessImage(imagePath)
    const {
      data: { blocks, confidence }
    } = await entry.worker.recognize(buffer)
    const text = joinLines(blocksToLines((blocks ?? []) as TessBlock[]))
    return { text, confidence, lang }
  } finally {
    entry.busy = false
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/ocr/__tests__/worker-lang.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Make `pipeline.ts` store the language actually used**

In `src/main/ingest/pipeline.ts`, delete the hardcoded `const ocrLang = 'rus+eng'` (line 78) and change the OCR block so the stored value comes from the result:

```ts
  onProgress({ filePath: srcPath, status: 'ocr' })
  let ocrText = ''
  let ocrConf = 0
  let ocrLang = ''
  try {
    const result = await runOcr(destPath)
    ocrText = result.text
    ocrConf = result.confidence
    ocrLang = result.lang
  } catch (err) {
    // OCR failure is non-fatal — recipe is still saved without text
    console.warn(`[ingest] OCR failed for ${id}:`, err)
  }
```

The `INSERT` at lines 93–96 already binds `@ocrLang`, so no further change is needed there.

- [ ] **Step 6: Make `recipes:reOcr` honour and persist its `lang` argument**

In `src/main/ipc/recipes.ts`, the handler currently computes `ocrLang` and then ignores it when calling `runOcr`. Replace line 139:

```ts
    const ocrLang = typeof lang === 'string' ? lang : 'rus+eng'
```

with:

```ts
    const requestedLang = typeof lang === 'string' && lang.trim() ? lang : undefined
```

and replace line 149:

```ts
    const { text, confidence } = await runOcr(imagePath)
```

with:

```ts
    const { text, confidence, lang: ocrLang } = await runOcr(imagePath, requestedLang)
```

The existing `UPDATE` at lines 153–159 already binds `ocrLang`, and now receives the language that actually ran.

- [ ] **Step 7: Verify the whole suite, types and lint**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all PASS.

Then confirm no stale literal remains: `grep -rn "rus+eng" src/`
Expected: no matches, other than the explanatory comment in `worker.ts`, the negative assertion in `worker-lang.test.ts`, and the still-selectable `<option value="rus+eng">` entries in `detail.tsx` and `settings.tsx`.

**Deviation found and fixed here, not anticipated by the plan:** this grep surfaces three renderer/settings files the plan's Task 3 file list omitted, all defaulting to `'rus+eng'`:

- `src/renderer/src/routes/detail.tsx:47` — `useState('rus+eng')` for the "Re-run OCR" dropdown. This one is not decorative: it is sent as an *explicit* `lang` argument on every re-run, silently overriding `runOcr`'s new `DEFAULT_LANG` default for the one UI path that actually exercises it. Change to `useState('rus')`.
- `src/main/ipc/settings.ts:10` and `src/renderer/src/stores/useSettingsStore.ts:12` — the global "OCR Language" setting's default. Traced its only consumer (`settings:get`/`settings:update`); confirmed `src/main/ingest/pipeline.ts` never calls `settings:get` at all, so this default was already decorative before this plan and remains so — but leaving it stated as `'rus+eng'` would misrepresent the actual default to anyone reading the Settings screen. Change both to `'rus'`.

Do not wire the Settings `ocrLang` value into `pipeline.ts` as part of this task — that is a real feature (making ingest honour a user-configured language), not a truthfulness fix, and is out of scope here.

- [ ] **Step 8: Commit**

```bash
git add src/main/ocr/worker.ts src/main/ocr/__tests__/worker-lang.test.ts src/main/ingest/pipeline.ts src/main/ipc/recipes.ts
git commit -m "feat(ocr): default to russian-only recognition

rus+eng kept Latin glyphs in the candidate set for every character,
yielding 500 I for 500 г, TaKже for также and A0 for до. Block
segmentation is unchanged by the switch.

Also threads lang through runOcr: recipes:reOcr accepted a lang
argument that was silently ignored, and ocr_lang recorded a value that
never ran.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Record real fixtures and lock the behaviour with an integration test

Unit tests alone are what let the previous design ship broken — `layout.ts` and `postprocess.ts` each passed their own tests while their composition produced run-on paragraphs. This task adds the end-to-end coverage that would have caught it, and the recorder that keeps it refreshable.

**Files:**
- Create: `vitest.record.config.ts`
- Create: `src/main/ocr/__tests__/record-fixtures.record.ts`
- Create: `src/main/ocr/__tests__/fixtures/beef-three-column.blocks.json` (generated)
- Create: `src/main/ocr/__tests__/fixtures/pork-two-column.blocks.json` (generated)
- Create: `src/main/ocr/__tests__/reconstruction.test.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `preprocessImage` (Task 1); `blocksToLines`, `TessBlock` (Task 2); `joinLines` from `src/main/ocr/postprocess.ts` (unchanged, existing).
- Produces: `npm run ocr:record`, and `fixtures/<name>.blocks.json` files containing `TessBlock[]` serialised as JSON.

- [ ] **Step 1: Add the recorder config and npm script**

Create `vitest.record.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

// Separate from vitest.config.ts so `npm test` never downloads language data or
// pays several seconds per image. Run via `npm run ocr:record`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.record.ts'],
    testTimeout: 300000
  }
})
```

In `package.json`, add to `scripts` after the `"test"` entry:

```json
    "ocr:record": "vitest run --config vitest.record.config.ts",
```

- [ ] **Step 2: Write the recorder**

Create `src/main/ocr/__tests__/record-fixtures.record.ts`:

```ts
import fs from 'fs/promises'
import path from 'path'
import { describe, it, vi } from 'vitest'
import { createWorker, PSM } from 'tesseract.js'
import { preprocessImage } from '../preprocess'
import type { OcrWord, TessBlock } from '../blocks'

// worker.ts imports `electron` for its tessdata cache path. This recorder only
// wants DEFAULT_LANG from it, so stub the module rather than duplicate the
// language string and let it drift from production.
vi.mock('electron', () => ({ app: { getPath: (): string => '/tmp/meal-planner-record' } }))

const { DEFAULT_LANG } = await import('../worker')

const FIXTURES = path.join(process.cwd(), 'src/main/ocr/__tests__/fixtures')

const PAGES = ['beef-three-column', 'pork-two-column']

// Keep only what blocksToLines consumes; coordinates are no longer read by
// anything, and dropping them keeps the fixtures small and readable.
const strip = (blocks: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[]): TessBlock[] =>
  blocks.map((block) => ({
    paragraphs: block.paragraphs.map((paragraph) => ({
      lines: paragraph.lines.map((line) => ({
        words: line.words.map((word) => ({ text: word.text, confidence: word.confidence }))
      }))
    }))
  }))

describe('record OCR fixtures', () => {
  it('regenerates block fixtures from the committed source images', async () => {
    const worker = await createWorker()
    await worker.loadLanguage(DEFAULT_LANG)
    await worker.initialize(DEFAULT_LANG)
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })

    try {
      for (const page of PAGES) {
        const buffer = await preprocessImage(path.join(FIXTURES, 'images', `${page}.png`))
        const { data } = await worker.recognize(buffer)
        const blocks = strip((data.blocks ?? []) as never)
        await fs.writeFile(
          path.join(FIXTURES, `${page}.blocks.json`),
          `${JSON.stringify(blocks, null, 1)}\n`,
          'utf-8'
        )
        console.log(`recorded ${page}: ${blocks.length} blocks`)
      }
    } finally {
      await worker.terminate()
    }
  })
})
```

- [ ] **Step 3: Generate the fixtures**

Run: `npm run ocr:record`
Expected: PASS, logging `recorded beef-three-column: 6 blocks` and `recorded pork-two-column: <n> blocks`, and writing two `.blocks.json` files into `src/main/ocr/__tests__/fixtures/`.

Confirm they exist and are non-trivial: `ls -la src/main/ocr/__tests__/fixtures/*.blocks.json`

- [ ] **Step 4: Write the integration test**

Every expected string below was observed from a real run of this exact pipeline (`preprocessImage` → `PSM.AUTO` → `rus` → `blocksToLines` → `joinLines`).

Create `src/main/ocr/__tests__/reconstruction.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { blocksToLines } from '../blocks'
import { joinLines } from '../postprocess'
import type { TessBlock } from '../blocks'

const FIXTURES = path.join(process.cwd(), 'src/main/ocr/__tests__/fixtures')

const load = (name: string): TessBlock[] =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.blocks.json`), 'utf-8')) as TessBlock[]

const textOf = (name: string): string => joinLines(blocksToLines(load(name)))

describe('three-column page', () => {
  it('reads the left column as one contiguous passage', () => {
    expect(textOf('beef-three-column')).toContain(
      'Готовить 5 минут, помешивая. После чего влить 1 стакан кипятка или бульона и тушить до готовности'
    )
  })

  it('does not glue the next column onto the left column', () => {
    expect(textOf('beef-three-column')).not.toContain('После чего влить соку')
  })

  it('reads the middle and right columns as their own passages', () => {
    const text = textOf('beef-three-column')
    expect(text).toContain('соку измельчить в блендере')
    expect(text).toContain('Тушить все вместе 15 минут')
  })

  it('rejoins words hyphenated across line breaks', () => {
    const text = textOf('beef-three-column')
    for (const word of ['кусочками', 'полукольцами', 'бульона', 'блендере', 'вместе']) {
      expect(text).toContain(word)
    }
    expect(text).not.toContain('бульо-')
    expect(text).not.toContain('блен-')
  })

  it('keeps the title on a single line', () => {
    expect(textOf('beef-three-column')).toContain('Говядина в соусе из лука-порея')
  })

  it('excludes the photograph region', () => {
    // Tesseract returns it as one whitespace word at confidence 95.
    expect(textOf('beef-three-column')).not.toMatch(/\n\s+\n/)
  })
})

describe('two-column page', () => {
  it('rejoins words hyphenated across line breaks', () => {
    const text = textOf('pork-two-column')
    for (const word of ['консервированных', 'обжарить', 'полукольцами', 'разрезать']) {
      expect(text).toContain(word)
    }
  })

  it('reads the ingredient sentence contiguously', () => {
    expect(textOf('pork-two-column')).toContain(
      '300 г свинины, луковица, 3 зубчика чеснока'
    )
  })
})
```

- [ ] **Step 5: Run the integration test**

Run: `npx vitest run src/main/ocr/__tests__/reconstruction.test.ts`
Expected: PASS — 8 tests.

If an assertion fails on a substring, **do not weaken the assertion to match**. Print the actual output first (`console.log(textOf('beef-three-column'))`) and confirm whether the reconstruction genuinely regressed or tesseract.js produced different characters than recorded. Only adjust an expected string when the difference is a recognition variance unrelated to ordering or hyphenation.

- [ ] **Step 6: Run the full suite and verify `npm test` skips the recorder**

Run: `npx vitest run`
Expected: PASS. Confirm the recorder did **not** run — there should be no `recorded beef-three-column` line in the output, because `vitest.config.ts` includes only `*.{test,spec}.{ts,tsx}`.

Then: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add vitest.record.config.ts package.json src/main/ocr/__tests__/record-fixtures.record.ts src/main/ocr/__tests__/fixtures src/main/ocr/__tests__/reconstruction.test.ts
git commit -m "test(ocr): add block fixtures and end-to-end reconstruction tests

layout.ts and postprocess.ts each passed their own unit tests while
their composition produced run-on paragraphs. These fixtures exercise
the real composition, and double as the baseline any future engine
change must beat.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Update `CLAUDE.md`

Three entries in `CLAUDE.md` describe the code this plan deletes. Leaving them would point the next session at a module that no longer exists.

**Files:**
- Modify: `CLAUDE.md:120`, `CLAUDE.md:164`, plus a new pitfall and a language note.

- [ ] **Step 1: Fix the data-flow description**

`CLAUDE.md:120` currently reads `… OCR (2× upscale → PSM 3 → `ocr/layout.ts` reorders columns → `ocr/postprocess.ts` de-hyphenates) …`. Replace that parenthetical with:

```
OCR (2× upscale → PSM 3 → `ocr/blocks.ts` reads Tesseract's block structure → `ocr/postprocess.ts` de-hyphenates)
```

- [ ] **Step 2: Fix the unit-test pitfall**

`CLAUDE.md:164` names the deleted file. Replace that bullet with:

```markdown
- **Don't verify OCR changes with unit tests alone.** The former `layout.ts` and `postprocess.ts` each passed their own tests while their *composition* produced one run-on paragraph. `src/main/ocr/__tests__/reconstruction.test.ts` now exercises the real composition against recorded fixtures; run `npm run ocr:record` and re-check them after any change to preprocessing, PSM, or the engine.
```

- [ ] **Step 3: Add the two new invariants**

Immediately after the `PSM.AUTO` bullet (`CLAUDE.md:162`), add:

```markdown
- **Don't re-derive page layout from word geometry.** Tesseract's `PSM.AUTO` already returns `blocks` segmented and in reading order; `src/main/ocr/blocks.ts` reads that directly. A previous design flattened the structure away and rebuilt it from word bounding boxes, which could express only a single column split and glued adjacent columns on three-column pages. Measured on a real page, Tesseract's own segmentation was correct and the geometric replacement was not.
- **Don't add `eng` back to the OCR language.** `src/main/ocr/worker.ts` sets `DEFAULT_LANG = 'rus'`. Including `eng` keeps Latin glyphs in the candidate set for every character and produces `500 I` for `500 г`, `TaKже` for `также`, `A0` for `до`. A recipe genuinely containing English can be re-run per-recipe through the `lang` argument of `recipes:reOcr`.
```

- [ ] **Step 4: Record the accepted residue**

Add after the bullets from Step 3:

```markdown
- **Known OCR residue, deliberately not fixed:** `®` and `е` appear where the source has `•` (display only — `tokenize` discards single-character tokens, so the matcher never sees them); `400 г томатов` may come through as `ГТОматов`, losing that occurrence's `томат` match; low-confidence words are dropped by the `DEFAULT_MIN_CONFIDENCE = 50` filter, which cost `свитой` from one title during testing.
```

- [ ] **Step 5: Verify the documentation matches reality**

Run: `grep -n "layout.ts" CLAUDE.md`
Expected: no matches except inside the Step 2 bullet, where it is explicitly described as former.

Run: `grep -rn "rus+eng" CLAUDE.md src/`
Expected: matches only in the Step 3 bullet explaining why not to use it.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): record the block-reconstruction and russian-only invariants

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Full gate**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`
Expected: all PASS. `develop` requires all four green on every commit.

- [ ] **Real-app check**

Run `npm run dev`, add the говядина screenshot as a new recipe, and confirm in the detail view's OCR TEXT panel that the three body columns read as three separate coherent paragraphs rather than interleaved lines, and that `зубчика`, `до готовности` and `терке` appear without Latin substitutions.

This step is not optional — `CLAUDE.md` records that OCR changes have previously passed their tests while being wrong in composition.
