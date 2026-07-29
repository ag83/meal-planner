# OCR Reading Order & Matcher Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OCR read multi-column magazine pages in correct reading order with hyphenated words rejoined, and stop the tag matcher from producing false positives on the resulting cleaner text.

**Architecture:** `runOcr` keeps its current signature (`(imagePath) => Promise<OcrResult>`) so its two call sites need no changes. Internally it gains a sharp preprocessing step, switches Tesseract to PSM 3, and routes word-level geometry through two new pure modules — `layout.ts` (column detection and line reconstruction) and `postprocess.ts` (de-hyphenation and paragraph joining). Separately, `matcher.ts` switches to greedy longest-match-wins, the seed gains three missing tags, and `tag_aliases` gains a `match_mode` column for aliases that stemming cannot disambiguate.

**Tech Stack:** TypeScript, Electron main process, tesseract.js 4.1.4, sharp 0.35, better-sqlite3 12, Vitest 2, js-yaml.

## Global Constraints

- **Named arrow functions only.** `const foo = (x: T): R => { ... }`. No `function` declarations or anonymous `function` expressions anywhere in `src/`.
- **No comments narrating WHAT.** Comment WHY only when non-obvious.
- **The renderer never touches `fs`, `path`, sqlite, or `child_process`.** All work here is main-process only.
- **`src/main/tags/normalize.ts` must not be modified by this plan.** Touching it invalidates every stored alias and recipe tag. De-hyphenation lives in `src/main/ocr/postprocess.ts` instead.
- **DB writes go through prepared statements**, wrapped in a transaction when touching more than one row.
- **Seed re-application is strictly additive.** Insert missing slugs/aliases; never overwrite, delete, or re-enable user-disabled rows.
- **Confidence floor for OCR words is `50`.** Measured: junk sits at 10–12, real text bottoms out at 63.
- **`noUnusedLocals` and `noUnusedParameters` are enabled.** Any unused symbol fails `npm run typecheck`.
- Run `npm test` for tests, `npm run typecheck` for types, `npm run lint` for lint.

**Close the Meal Planner app before running `npm test`.** `pretest` runs `npm rebuild better-sqlite3`
to swap the native module from Electron's ABI to Node's. A running Electron instance holds
`better_sqlite3.node` open and the rebuild fails with `EPERM: operation not permitted, unlink`.
`posttest` rebuilds it back for Electron, so `npm run dev` after a test run is fine.

## File Structure

| File | Responsibility |
|---|---|
| `src/main/ocr/layout.ts` (new) | Pure. Word geometry → column-ordered lines of text. Knows nothing about images or tesseract. |
| `src/main/ocr/postprocess.ts` (new) | Pure. Lines → de-hyphenated, paragraph-joined text. |
| `src/main/ocr/worker.ts` (modify) | Sharp preprocessing, PSM 3, wires layout + postprocess. Keeps `runOcr` signature. |
| `src/main/tags/matcher.ts` (modify) | Greedy longest-match-wins; honours `match_mode`. |
| `src/main/db/migrations.ts` (modify) | Append v1→v2 migration adding `tag_aliases.match_mode`. |
| `src/main/vault/manager.ts` (modify) | Bump `CURRENT_SCHEMA_VERSION` 1 → 2. |
| `src/main/tags/seed.ts` (modify) | Parse and persist optional `exact_aliases` from the seed YAML. |
| `resources/seed-tags.yaml` (modify) | Add `печень`, `томатная паста`, `чёрный перец`; mark `печенье` exact. |

Test fixtures `src/main/ocr/__tests__/fixtures/{spaghetti,liver}-words.json` already exist in the working tree (recorded from real OCR runs of the two sample screenshots, confidence-filtered at 50). They are uncommitted — Task 1 commits them.

---

### Task 1: Layout module — types, flattening, confidence filter

**Files:**
- Create: `src/main/ocr/layout.ts`
- Create: `src/main/ocr/__tests__/layout.test.ts`
- Commit (already on disk): `src/main/ocr/__tests__/fixtures/spaghetti-words.json`, `src/main/ocr/__tests__/fixtures/liver-words.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `OcrWord`, `Bbox`, `TessBlock`, `flattenWords(blocks: TessBlock[]): OcrWord[]`, `DEFAULT_MIN_CONFIDENCE`.

- [ ] **Step 1: Write the failing test**

Create `src/main/ocr/__tests__/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { flattenWords, DEFAULT_MIN_CONFIDENCE } from '../layout'
import type { TessBlock } from '../layout'

const bbox = (x0: number, y0: number, x1: number, y1: number): { x0: number; y0: number; x1: number; y1: number } => ({
  x0,
  y0,
  x1,
  y1
})

const block = (words: { text: string; confidence: number; bbox: ReturnType<typeof bbox> }[]): TessBlock => ({
  paragraphs: [{ lines: [{ words }] }]
})

describe('flattenWords', () => {
  it('flattens the block/paragraph/line/word hierarchy', () => {
    const blocks: TessBlock[] = [
      block([
        { text: 'привет', confidence: 90, bbox: bbox(0, 0, 50, 20) },
        { text: 'мир', confidence: 88, bbox: bbox(60, 0, 90, 20) }
      ])
    ]
    expect(flattenWords(blocks).map((w) => w.text)).toEqual(['привет', 'мир'])
  })

  it('drops words below the confidence floor', () => {
    const blocks: TessBlock[] = [
      block([
        { text: 'хорошо', confidence: 63, bbox: bbox(0, 0, 50, 20) },
        { text: 'мусор', confidence: 11, bbox: bbox(60, 0, 90, 20) }
      ])
    ]
    expect(flattenWords(blocks).map((w) => w.text)).toEqual(['хорошо'])
  })

  it('drops whitespace-only words', () => {
    const blocks: TessBlock[] = [
      block([
        { text: '  ', confidence: 95, bbox: bbox(0, 0, 5, 20) },
        { text: 'текст', confidence: 95, bbox: bbox(10, 0, 60, 20) }
      ])
    ]
    expect(flattenWords(blocks).map((w) => w.text)).toEqual(['текст'])
  })

  it('exposes a confidence floor of 50', () => {
    expect(DEFAULT_MIN_CONFIDENCE).toBe(50)
  })

  it('returns an empty array for no blocks', () => {
    expect(flattenWords([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/ocr/__tests__/layout.test.ts`
Expected: FAIL — cannot resolve `../layout`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/ocr/layout.ts`:

```ts
export interface Bbox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  confidence: number
  bbox: Bbox
}

// Structural subset of tesseract.js output — declared locally so the pure layout
// logic stays testable without importing tesseract types into unit tests.
export interface TessBlock {
  paragraphs: { lines: { words: OcrWord[] }[] }[]
}

export const DEFAULT_MIN_CONFIDENCE = 50

export const flattenWords = (blocks: TessBlock[], minConfidence = DEFAULT_MIN_CONFIDENCE): OcrWord[] => {
  const out: OcrWord[] = []
  for (const b of blocks) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        for (const w of l.words) {
          if (w.confidence >= minConfidence && w.text.trim().length > 0) {
            out.push({ text: w.text, confidence: w.confidence, bbox: w.bbox })
          }
        }
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/ocr/__tests__/layout.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/ocr/layout.ts src/main/ocr/__tests__/layout.test.ts src/main/ocr/__tests__/fixtures
git commit -m "Add OCR word flattening with confidence filter"
```

---

### Task 2: Column detection

Finds the vertical cut that crosses the fewest word boxes. Measured on the real fixtures: r1 has a zero-crossing plateau at x=208–226, r2 at x=358–382, both sharply separated from neighbouring positions (r2 drops from 9 crossings to 0 within 10px).

**Files:**
- Modify: `src/main/ocr/layout.ts`
- Modify: `src/main/ocr/__tests__/layout.test.ts`

**Interfaces:**
- Consumes: `OcrWord`, `Bbox` from Task 1.
- Produces: `detectColumnCuts(words: OcrWord[]): number[]` — sorted x positions, empty for single-column.

- [ ] **Step 1: Write the failing test**

Append to `src/main/ocr/__tests__/layout.test.ts`:

```ts
import { detectColumnCuts } from '../layout'
import spaghettiWords from './fixtures/spaghetti-words.json'
import liverWords from './fixtures/liver-words.json'
import type { OcrWord } from '../layout'

// Build a synthetic two-column page: 20 rows, left column x 0..180, right column x 220..400.
const twoColumnPage = (): OcrWord[] => {
  const words: OcrWord[] = []
  for (let row = 0; row < 20; row++) {
    const y = row * 25
    words.push({ text: `л${row}`, confidence: 90, bbox: { x0: 0, y0: y, x1: 180, y1: y + 18 } })
    words.push({ text: `п${row}`, confidence: 90, bbox: { x0: 220, y0: y, x1: 400, y1: y + 18 } })
  }
  return words
}

const singleColumnPage = (): OcrWord[] => {
  const words: OcrWord[] = []
  for (let row = 0; row < 20; row++) {
    const y = row * 25
    words.push({ text: `с${row}`, confidence: 90, bbox: { x0: 0, y0: y, x1: 400, y1: y + 18 } })
  }
  return words
}

describe('detectColumnCuts', () => {
  it('finds the gutter in a synthetic two-column page', () => {
    const cuts = detectColumnCuts(twoColumnPage())
    expect(cuts).toHaveLength(1)
    expect(cuts[0]).toBeGreaterThan(180)
    expect(cuts[0]).toBeLessThan(220)
  })

  it('returns no cuts for a single-column page', () => {
    expect(detectColumnCuts(singleColumnPage())).toEqual([])
  })

  it('returns no cuts when there are too few words to be confident', () => {
    expect(detectColumnCuts(twoColumnPage().slice(0, 3))).toEqual([])
  })

  it('finds the real gutter in the spaghetti fixture', () => {
    const cuts = detectColumnCuts(spaghettiWords as OcrWord[])
    expect(cuts).toHaveLength(1)
    expect(cuts[0]).toBeGreaterThanOrEqual(208)
    expect(cuts[0]).toBeLessThanOrEqual(226)
  })

  it('finds the real gutter in the liver fixture', () => {
    const cuts = detectColumnCuts(liverWords as OcrWord[])
    expect(cuts).toHaveLength(1)
    expect(cuts[0]).toBeGreaterThanOrEqual(358)
    expect(cuts[0]).toBeLessThanOrEqual(382)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/ocr/__tests__/layout.test.ts`
Expected: FAIL — `detectColumnCuts` is not exported.

The JSON fixture imports need no tsconfig change: `resolveJsonModule: true` is already inherited from `@electron-toolkit/tsconfig/tsconfig.json`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/ocr/layout.ts`:

```ts
const MIN_WORDS_FOR_SPLIT = 12
const SEARCH_MARGIN = 0.2 // ignore the outer 20% of page width on each side
const MIN_SIDE_SHARE = 0.08 // each column must hold at least 8% of words
const MIN_PLATEAU_SHARE = 0.02 // gutter must be at least 2% of page width wide

const midpoint = (w: OcrWord): number => (w.bbox.x0 + w.bbox.x1) / 2

// A "crossing" is a word whose box strictly spans x. A real gutter has zero.
const countCrossings = (words: OcrWord[], x: number): number =>
  words.filter((w) => w.bbox.x0 < x && w.bbox.x1 > x).length

const findSingleCut = (words: OcrWord[]): number | null => {
  if (words.length < MIN_WORDS_FOR_SPLIT) return null

  const minX = Math.min(...words.map((w) => w.bbox.x0))
  const maxX = Math.max(...words.map((w) => w.bbox.x1))
  const width = maxX - minX
  if (width <= 0) return null

  const lo = Math.round(minX + width * SEARCH_MARGIN)
  const hi = Math.round(maxX - width * SEARCH_MARGIN)

  const zeros: number[] = []
  for (let x = lo; x <= hi; x++) {
    if (countCrossings(words, x) === 0) zeros.push(x)
  }
  if (zeros.length === 0) return null

  // Take the widest contiguous run of zero-crossing positions.
  let bestStart = 0
  let bestLen = 0
  let runStart = 0
  for (let i = 1; i <= zeros.length; i++) {
    const broken = i === zeros.length || zeros[i] !== zeros[i - 1] + 1
    if (broken) {
      const len = i - runStart
      if (len > bestLen) {
        bestLen = len
        bestStart = runStart
      }
      runStart = i
    }
  }

  if (bestLen < width * MIN_PLATEAU_SHARE) return null

  const cut = zeros[bestStart + Math.floor(bestLen / 2)]
  const left = words.filter((w) => midpoint(w) < cut).length
  const right = words.length - left
  const minSide = words.length * MIN_SIDE_SHARE
  if (left < minSide || right < minSide) return null

  return cut
}

export const detectColumnCuts = (words: OcrWord[]): number[] => {
  const cut = findSingleCut(words)
  return cut === null ? [] : [cut]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/ocr/__tests__/layout.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/ocr/layout.ts src/main/ocr/__tests__/layout.test.ts
git commit -m "Add minimum-crossing column gutter detection"
```

---

### Task 3: Line reconstruction

Assigns words to columns, regroups them into lines by vertical overlap, and emits columns left to right. This is what repairs `печень куриная - 500 г Тульской обл.` — a 302px intra-line gap that block-level reordering cannot touch.

**Files:**
- Modify: `src/main/ocr/layout.ts`
- Modify: `src/main/ocr/__tests__/layout.test.ts`

**Interfaces:**
- Consumes: `OcrWord`, `detectColumnCuts` from Tasks 1–2.
- Produces: `reconstructLines(words: OcrWord[]): string[]` — text lines in reading order.

- [ ] **Step 1: Write the failing test**

Append to `src/main/ocr/__tests__/layout.test.ts`:

```ts
import { reconstructLines } from '../layout'

describe('reconstructLines', () => {
  it('emits left column fully before right column', () => {
    const words: OcrWord[] = [
      { text: 'лево1', confidence: 90, bbox: { x0: 0, y0: 0, x1: 150, y1: 18 } },
      { text: 'право1', confidence: 90, bbox: { x0: 300, y0: 0, x1: 450, y1: 18 } },
      { text: 'лево2', confidence: 90, bbox: { x0: 0, y0: 30, x1: 150, y1: 48 } },
      { text: 'право2', confidence: 90, bbox: { x0: 300, y0: 30, x1: 450, y1: 48 } }
    ]
    // Too few words to trigger a split, so force it with a padded page.
    const padded = [...words]
    for (let i = 0; i < 10; i++) {
      const y = 60 + i * 30
      padded.push({ text: `л${i}`, confidence: 90, bbox: { x0: 0, y0: y, x1: 150, y1: y + 18 } })
      padded.push({ text: `п${i}`, confidence: 90, bbox: { x0: 300, y0: y, x1: 450, y1: y + 18 } })
    }
    const lines = reconstructLines(padded)
    const leftIdx = lines.findIndex((l) => l.includes('лево2'))
    const rightIdx = lines.findIndex((l) => l.includes('право1'))
    expect(leftIdx).toBeGreaterThanOrEqual(0)
    expect(rightIdx).toBeGreaterThan(leftIdx)
  })

  it('splits a line merged across the gutter', () => {
    const words: OcrWord[] = []
    for (let i = 0; i < 10; i++) {
      const y = i * 30
      words.push({ text: `лево${i}`, confidence: 90, bbox: { x0: 0, y0: y, x1: 150, y1: y + 18 } })
      words.push({ text: `право${i}`, confidence: 90, bbox: { x0: 300, y0: y, x1: 450, y1: y + 18 } })
    }
    const lines = reconstructLines(words)
    for (const line of lines) {
      expect(line.includes('лево') && line.includes('право')).toBe(false)
    }
  })

  it('orders words within a line by x', () => {
    const words: OcrWord[] = [
      { text: 'второе', confidence: 90, bbox: { x0: 100, y0: 0, x1: 180, y1: 18 } },
      { text: 'первое', confidence: 90, bbox: { x0: 0, y0: 0, x1: 90, y1: 18 } }
    ]
    expect(reconstructLines(words)).toEqual(['первое второе'])
  })

  it('groups words into one line when their boxes overlap vertically', () => {
    const words: OcrWord[] = [
      { text: 'а', confidence: 90, bbox: { x0: 0, y0: 0, x1: 20, y1: 20 } },
      { text: 'б', confidence: 90, bbox: { x0: 30, y0: 3, x1: 50, y1: 23 } }
    ]
    expect(reconstructLines(words)).toEqual(['а б'])
  })

  it('separates words into different lines when boxes do not overlap vertically', () => {
    const words: OcrWord[] = [
      { text: 'верх', confidence: 90, bbox: { x0: 0, y0: 0, x1: 40, y1: 18 } },
      { text: 'низ', confidence: 90, bbox: { x0: 0, y0: 40, x1: 40, y1: 58 } }
    ]
    expect(reconstructLines(words)).toEqual(['верх', 'низ'])
  })

  it('returns an empty array for no words', () => {
    expect(reconstructLines([])).toEqual([])
  })

  it('does not merge the two columns of the liver fixture into one line', () => {
    const lines = reconstructLines(liverWords as OcrWord[])
    const merged = lines.find((l) => l.includes('печень куриная') && l.includes('Тульской'))
    expect(merged).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/ocr/__tests__/layout.test.ts`
Expected: FAIL — `reconstructLines` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/ocr/layout.ts`:

```ts
const VERTICAL_OVERLAP_RATIO = 0.5

const overlapsVertically = (a: OcrWord, b: OcrWord): boolean => {
  const overlap = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0)
  if (overlap <= 0) return false
  const shorter = Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0)
  return shorter > 0 && overlap / shorter >= VERTICAL_OVERLAP_RATIO
}

const groupIntoLines = (words: OcrWord[]): string[] => {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0)
  const lines: OcrWord[][] = []

  for (const word of sorted) {
    const line = lines.find((l) => l.some((w) => overlapsVertically(w, word)))
    if (line) line.push(word)
    else lines.push([word])
  }

  return lines
    .map((l) => [...l].sort((a, b) => a.bbox.x0 - b.bbox.x0))
    .sort((a, b) => a[0].bbox.y0 - b[0].bbox.y0)
    .map((l) => l.map((w) => w.text).join(' '))
}

export const reconstructLines = (words: OcrWord[]): string[] => {
  if (words.length === 0) return []

  const cuts = detectColumnCuts(words)
  if (cuts.length === 0) return groupIntoLines(words)

  const bounds = [-Infinity, ...cuts, Infinity]
  const out: string[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const column = words.filter((w) => midpoint(w) >= bounds[i] && midpoint(w) < bounds[i + 1])
    if (column.length > 0) out.push(...groupIntoLines(column))
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/ocr/__tests__/layout.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/ocr/layout.ts src/main/ocr/__tests__/layout.test.ts
git commit -m "Reconstruct column-ordered lines from word geometry"
```

---

### Task 4: Text repair — de-hyphenation and paragraph joining

**Files:**
- Create: `src/main/ocr/postprocess.ts`
- Create: `src/main/ocr/__tests__/postprocess.test.ts`

**Interfaces:**
- Consumes: nothing (takes `string[]`).
- Produces: `joinLines(lines: string[]): string`, `dehyphenate(text: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/main/ocr/__tests__/postprocess.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { joinLines, dehyphenate } from '../postprocess'

describe('dehyphenate', () => {
  it('rejoins a word broken across lines', () => {
    expect(dehyphenate('поми-\nдоры')).toBe('помидоры')
  })

  it('rejoins the real magazine break ин-/дейку', () => {
    expect(dehyphenate('кубиками ин-\nдейку, обжарьте')).toBe('кубиками индейку, обжарьте')
  })

  it('rejoins across a line with trailing whitespace', () => {
    expect(dehyphenate('па-  \n  сту')).toBe('пасту')
  })

  it('does not join when the next line starts uppercase', () => {
    expect(dehyphenate('что-\nТо')).toBe('что-\nТо')
  })

  it('does not join when the hyphen is surrounded by spaces', () => {
    expect(dehyphenate('соль - \nпо вкусу')).toBe('соль - \nпо вкусу')
  })

  it('leaves text without hyphenated breaks unchanged', () => {
    expect(dehyphenate('первая строка\nвторая строка')).toBe('первая строка\nвторая строка')
  })
})

describe('joinLines', () => {
  it('collapses lines of one paragraph into a single line', () => {
    expect(joinLines(['первая часть', 'вторая часть'])).toBe('первая часть вторая часть')
  })

  it('preserves a paragraph break marked by a blank line', () => {
    expect(joinLines(['абзац один', '', 'абзац два'])).toBe('абзац один\n\nабзац два')
  })

  it('rejoins hyphenated breaks across the line boundary', () => {
    expect(joinLines(['нарежьте ин-', 'дейку кубиками'])).toBe('нарежьте индейку кубиками')
  })

  it('collapses runs of blank lines into one paragraph break', () => {
    expect(joinLines(['раз', '', '', '', 'два'])).toBe('раз\n\nдва')
  })

  it('trims leading and trailing whitespace', () => {
    expect(joinLines(['', '  текст  ', ''])).toBe('текст')
  })

  it('returns an empty string for no lines', () => {
    expect(joinLines([])).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/ocr/__tests__/postprocess.test.ts`
Expected: FAIL — cannot resolve `../postprocess`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/ocr/postprocess.ts`:

```ts
// A hyphen ending a line, preceded by a letter and followed by a lowercase letter,
// is typesetting hyphenation rather than a real hyphen — rejoin it.
const HYPHEN_BREAK = /(\p{L})-[ \t]*\n[ \t]*(\p{Ll})/gu

export const dehyphenate = (text: string): string => text.replace(HYPHEN_BREAK, '$1$2')

export const joinLines = (lines: string[]): string => {
  const paragraphs: string[][] = [[]]
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (paragraphs[paragraphs.length - 1].length > 0) paragraphs.push([])
    } else {
      paragraphs[paragraphs.length - 1].push(line.trim())
    }
  }

  return paragraphs
    .filter((p) => p.length > 0)
    .map((p) => dehyphenate(p.join('\n')).replace(/\n/g, ' '))
    .join('\n\n')
    .trim()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/ocr/__tests__/postprocess.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/ocr/postprocess.ts src/main/ocr/__tests__/postprocess.test.ts
git commit -m "Add OCR de-hyphenation and paragraph joining"
```

---

### Task 5: Wire preprocessing, PSM 3, and reconstruction into the worker

**Files:**
- Modify: `src/main/ocr/worker.ts`

**Interfaces:**
- Consumes: `flattenWords`, `reconstructLines` (Tasks 1–3), `joinLines` (Task 4).
- Produces: unchanged `runOcr(imagePath: string): Promise<OcrResult>` where `OcrResult = { text, confidence, lang }`. Both call sites (`src/main/ingest/pipeline.ts:80`, `src/main/ipc/recipes.ts:149`) continue to work untouched.

No unit test — this task is I/O wiring over already-tested pure modules. It is verified by the manual check in Step 4.

- [ ] **Step 1: Add the PSM constant and preprocessing**

In `src/main/ocr/worker.ts`, add `sharp` to the imports and `PSM` to the tesseract.js import:

```ts
import sharp from 'sharp'
import { createWorker, PSM } from 'tesseract.js'
```

Add below `const LANG = 'rus+eng'`:

```ts
const UPSCALE = 2

// Screenshots run 8-12px x-height; Tesseract wants >=20px. Upscaling also recovers
// stylised headings that are otherwise dropped entirely.
const preprocess = async (imagePath: string): Promise<Buffer> => {
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

- [ ] **Step 2: Set PSM 3 at pool construction**

In `buildPool`, after `await worker.initialize(LANG)`, add:

```ts
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
```

- [ ] **Step 3: Route recognition through layout reconstruction**

Add the imports:

```ts
import { flattenWords, reconstructLines } from './layout'
import { joinLines } from './postprocess'
import type { TessBlock } from './layout'
```

Replace the body of `runOcr` (currently `worker.ts:66-77`) with:

```ts
export const runOcr = async (imagePath: string): Promise<OcrResult> => {
  await ensurePool()
  const entry = await acquireWorker()
  try {
    const buffer = await preprocess(imagePath)
    const {
      data: { blocks, confidence }
    } = await entry.worker.recognize(buffer)
    const words = flattenWords((blocks ?? []) as TessBlock[])
    const text = joinLines(reconstructLines(words))
    return { text, confidence, lang: LANG }
  } finally {
    entry.busy = false
  }
}
```

- [ ] **Step 4: Verify against the real screenshots**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

Then run the app with `npm run dev`, ingest `E:\DIFF\CODE\MealPlanner\tmp\Untitled.png`, and open the recipe detail. Confirm in the OCR TEXT panel that:
- The left ingredient column appears as a contiguous run, not interleaved with the right column.
- `индейку`, `готовности`, and `пасту` appear as whole words, not split across a hyphen.

- [ ] **Step 5: Commit**

```bash
git add src/main/ocr/worker.ts
git commit -m "Use PSM 3 with upscaling and column-aware text reconstruction"
```

---

### Task 6: Migration — `tag_aliases.match_mode`

**Files:**
- Modify: `src/main/db/migrations.ts`
- Modify: `src/main/vault/manager.ts:9`
- Modify: `src/main/db/__tests__/migrations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `tag_aliases.match_mode TEXT NOT NULL DEFAULT 'stem'`, constrained to `('stem','exact')`. `PRAGMA user_version` becomes 2.

**Gotcha:** two independent counters are both `1` today. `PRAGMA user_version` (indexed off `MIGRATIONS.length`) drives the migration runner; `CURRENT_SCHEMA_VERSION` in `vault/manager.ts:9` is written into `vault.json` and read at `manager.ts:28` as a forward-compatibility guard. Both must be bumped.

- [ ] **Step 1: Write the failing test**

Append to `src/main/db/__tests__/migrations.test.ts` inside the existing `describe('runMigrations', ...)`:

```ts
  it('sets user_version to 2 after migration', () => {
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true }) as number).toBe(2)
  })

  it('tag_aliases has match_mode defaulting to stem', () => {
    runMigrations(db)
    db.prepare(
      `INSERT INTO tags (slug, label, kind, source, created_at) VALUES ('t1','T','ingredient','builtin',1)`
    ).run()
    const tagId = db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get('t1')!.id
    db.prepare(
      `INSERT INTO tag_aliases (tag_id, lemma, is_primary, source) VALUES (?,'лемма',1,'builtin')`
    ).run(tagId)
    const row = db.prepare<[], { match_mode: string }>('SELECT match_mode FROM tag_aliases').get()
    expect(row?.match_mode).toBe('stem')
  })

  it('tag_aliases rejects an unknown match_mode', () => {
    runMigrations(db)
    db.prepare(
      `INSERT INTO tags (slug, label, kind, source, created_at) VALUES ('t1','T','ingredient','builtin',1)`
    ).run()
    const tagId = db.prepare<[string], { id: number }>('SELECT id FROM tags WHERE slug=?').get('t1')!.id
    expect(() => {
      db.prepare(
        `INSERT INTO tag_aliases (tag_id, lemma, is_primary, source, match_mode) VALUES (?,'лемма',1,'builtin','bogus')`
      ).run(tagId)
    }).toThrow()
  })

  it('migrates a v1 database without losing alias rows', () => {
    // Build a v1 database by running only the first migration.
    db.exec(`
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('ingredient','dish_type','cuisine','user')),
        source TEXT NOT NULL CHECK(source IN ('builtin','user')),
        disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE tag_aliases (
        id INTEGER PRIMARY KEY,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        lemma TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL CHECK(source IN ('builtin','user')),
        disabled INTEGER NOT NULL DEFAULT 0, UNIQUE(tag_id, lemma)
      );
      INSERT INTO tags (slug,label,kind,source,created_at) VALUES ('t1','T','ingredient','builtin',1);
      INSERT INTO tag_aliases (tag_id,lemma,is_primary,source) VALUES (1,'старая лемма',1,'builtin');
    `)
    db.pragma('user_version = 1')

    runMigrations(db)

    const row = db
      .prepare<[], { lemma: string; match_mode: string }>('SELECT lemma, match_mode FROM tag_aliases')
      .get()
    expect(row?.lemma).toBe('старая лемма')
    expect(row?.match_mode).toBe('stem')
  })
```

Delete the now-superseded `'sets user_version to 1 after migration'` test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/db/__tests__/migrations.test.ts`
Expected: FAIL — `user_version` is 1, and `match_mode` does not exist.

- [ ] **Step 3: Write minimal implementation**

Append a second entry to the `MIGRATIONS` array in `src/main/db/migrations.ts`, after the existing v0→v1 entry:

```ts
  ,
  // v1 → v2: match_mode on aliases, for forms that stemming cannot disambiguate
  // (печень/печенье both stem to печен).
  (db) => {
    db.exec(`
      ALTER TABLE tag_aliases ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'stem'
        CHECK(match_mode IN ('stem','exact'));
    `)
  }
```

In `src/main/vault/manager.ts:9`:

```ts
const CURRENT_SCHEMA_VERSION = 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/db/__tests__/migrations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrations.ts src/main/vault/manager.ts src/main/db/__tests__/migrations.test.ts
git commit -m "Add tag_aliases.match_mode column and bump schema to v2"
```

---

### Task 7: Seed loader support for exact aliases

**Files:**
- Modify: `src/main/tags/seed.ts`
- Modify: `src/main/tags/__tests__/seed.test.ts`

**Interfaces:**
- Consumes: `match_mode` column from Task 6.
- Produces: `SeedEntry` gains optional `exact_aliases?: string[]`. Those are stored with `match_mode='exact'` and their lemma is the **normalized surface**, not the stem.

Exact aliases must bypass stemming — that is the entire point. `normalizeSurface` stems, so a separate normalizer is needed. It must **not** live in `normalize.ts`; add a local `exactForm` helper in `seed.ts` performing only the shared preprocessing (NFC, lowercase, ё→е) that `matcher.ts` will mirror in Task 8.

- [ ] **Step 1: Write the failing test**

Append to `src/main/tags/__tests__/seed.test.ts`:

```ts
  it('stores exact_aliases with match_mode exact', () => {
    seedFromEntries(db, [
      {
        slug: 'dessert',
        label: 'Десерт',
        kind: 'dish_type',
        aliases: ['сладость'],
        exact_aliases: ['печенье', 'печенья']
      }
    ])

    const rows = db
      .prepare<[], { lemma: string; match_mode: string }>(
        `SELECT lemma, match_mode FROM tag_aliases WHERE match_mode='exact' ORDER BY lemma`
      )
      .all()

    expect(rows.map((r) => r.lemma)).toEqual(['печенье', 'печенья'])
    expect(rows.every((r) => r.match_mode === 'exact')).toBe(true)
  })

  it('normalises ё to е in exact aliases', () => {
    seedFromEntries(db, [
      { slug: 'x', label: 'X', kind: 'ingredient', aliases: [], exact_aliases: ['Чёрный'] }
    ])
    const row = db
      .prepare<[], { lemma: string }>(`SELECT lemma FROM tag_aliases WHERE match_mode='exact'`)
      .get()
    expect(row?.lemma).toBe('черный')
  })

  it('leaves regular aliases as match_mode stem', () => {
    seedFromEntries(db, [
      { slug: 'y', label: 'Y', kind: 'ingredient', aliases: ['помидоры'] }
    ])
    const modes = db
      .prepare<[], { match_mode: string }>('SELECT match_mode FROM tag_aliases')
      .all()
      .map((r) => r.match_mode)
    expect(modes.every((m) => m === 'stem')).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/tags/__tests__/seed.test.ts`
Expected: FAIL — `exact_aliases` is not a property of `SeedEntry`.

- [ ] **Step 3: Write minimal implementation**

In `src/main/tags/seed.ts`, extend the interface:

```ts
export interface SeedEntry {
  slug: string
  label: string
  kind: 'ingredient' | 'dish_type' | 'cuisine'
  aliases: string[]
  exact_aliases?: string[]
}
```

Add above `seedFromEntries`:

```ts
// Exact aliases deliberately skip stemming — they exist for forms the stemmer
// collapses wrongly. Mirrored by matchesExact in tags/matcher.ts.
const exactForm = (surface: string): string =>
  surface.normalize('NFC').toLowerCase().replace(/ё/g, 'е').trim()
```

Change `insertAlias` to carry the mode:

```ts
  const insertAlias = db.prepare(`
    INSERT INTO tag_aliases (tag_id, lemma, is_primary, source, match_mode)
    VALUES (@tagId, @lemma, @isPrimary, 'builtin', @matchMode)
    ON CONFLICT(tag_id, lemma) DO NOTHING
  `)
```

Update the two existing `insertAlias.run(...)` calls to pass `matchMode: 'stem'`, then append inside the `for (const entry of entries)` loop, after the existing alias loop:

```ts
      for (const alias of entry.exact_aliases ?? []) {
        const lemma = exactForm(alias)
        if (seen.has(lemma)) continue
        insertAlias.run({ tagId: row.id, lemma, isPrimary: 0, matchMode: 'exact' })
        seen.add(lemma)
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/tags/__tests__/seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/tags/seed.ts src/main/tags/__tests__/seed.test.ts
git commit -m "Support exact-match aliases in the tag seed loader"
```

---

### Task 8: Matcher — longest-match-wins and exact-mode aliases

**Files:**
- Modify: `src/main/tags/matcher.ts`
- Modify: `src/main/tags/__tests__/matcher.test.ts`

**Interfaces:**
- Consumes: `match_mode` (Task 6), exact alias rows (Task 7).
- Produces: unchanged `extractTags(db, ocrText): TagMatch[]`.

`normalize.ts` is **not** modified. `matcher.ts` needs raw surface tokens alongside stems, which `tokenize` already provides.

- [ ] **Step 1: Write the failing test**

Append to `src/main/tags/__tests__/matcher.test.ts`. Extend the existing `SEED` constant with the tags the new tests need:

```ts
const EXTRA_SEED: SeedEntry[] = [
  { slug: 'liver', label: 'Печень', kind: 'ingredient', aliases: ['печень куриная', 'куриная печень'] },
  {
    slug: 'tomato_paste',
    label: 'Томатная паста',
    kind: 'ingredient',
    aliases: ['паста томатная', 'томатная паста']
  },
  { slug: 'pasta', label: 'Макароны', kind: 'ingredient', aliases: ['паста', 'спагетти'] },
  {
    slug: 'dessert',
    label: 'Десерт',
    kind: 'dish_type',
    aliases: ['сладкое', 'сладость'],
    exact_aliases: ['печенье', 'печенья', 'печеньем']
  }
]
```

Add a nested describe block:

```ts
describe('extractTags precision', () => {
  beforeEach(() => {
    seedFromEntries(db, EXTRA_SEED)
  })

  it('сладкий перец matches only Болгарский перец, not Десерт', () => {
    const ids = extractTags(db, '1 сладкий перец').map((m) => m.tagId)
    expect(ids).toContain(tagIdFor('bell_pepper'))
    expect(ids).not.toContain(tagIdFor('dessert'))
  })

  it('паста томатная matches Томатная паста, not Макароны', () => {
    const ids = extractTags(db, 'паста томатная - 2 ст. л.').map((m) => m.tagId)
    expect(ids).toContain(tagIdFor('tomato_paste'))
    expect(ids).not.toContain(tagIdFor('pasta'))
  })

  it('печень does not match Десерт via the печенье stem collision', () => {
    const ids = extractTags(db, 'печень куриная - 500 г').map((m) => m.tagId)
    expect(ids).toContain(tagIdFor('liver'))
    expect(ids).not.toContain(tagIdFor('dessert'))
  })

  it('печенье still matches Десерт through its exact alias', () => {
    const ids = extractTags(db, 'подать печенье к чаю').map((m) => m.tagId)
    expect(ids).toContain(tagIdFor('dessert'))
  })

  it('bare спагетти still matches Макароны', () => {
    const ids = extractTags(db, 'отварите спагетти').map((m) => m.tagId)
    expect(ids).toContain(tagIdFor('pasta'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/tags/__tests__/matcher.test.ts`
Expected: FAIL — `сладкий перец` also yields Десерт, `паста томатная` also yields Макароны, `печень` yields Десерт.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `src/main/tags/matcher.ts` with:

```ts
import type Database from 'better-sqlite3'
import { tokenize, normalizeTokens } from './normalize'

export interface TagMatch {
  tagId: number
  confidence: number
}

const MAX_WINDOW = 3

export const extractTags = (db: Database.Database, ocrText: string): TagMatch[] => {
  if (!ocrText.trim()) return []

  const surfaces = tokenize(ocrText)
  const stems = normalizeTokens(ocrText)
  if (stems.length === 0) return []

  const lookupStem = db.prepare<[string], { tag_id: number }>(
    "SELECT tag_id FROM tag_aliases WHERE lemma = ? AND disabled = 0 AND match_mode = 'stem' LIMIT 1"
  )
  const lookupExact = db.prepare<[string], { tag_id: number }>(
    "SELECT tag_id FROM tag_aliases WHERE lemma = ? AND disabled = 0 AND match_mode = 'exact' LIMIT 1"
  )

  const counts = new Map<number, number>()

  // Greedy longest-match-wins: a matched window consumes its tokens, so a phrase
  // never also fires the shorter aliases nested inside it.
  let i = 0
  while (i < stems.length) {
    let matched = 0
    for (let len = Math.min(MAX_WINDOW, stems.length - i); len >= 1; len--) {
      const exact = lookupExact.get(surfaces.slice(i, i + len).join(' '))
      const row = exact ?? lookupStem.get(stems.slice(i, i + len).join(' '))
      if (row) {
        counts.set(row.tag_id, (counts.get(row.tag_id) ?? 0) + 1)
        matched = len
        break
      }
    }
    i += matched > 0 ? matched : 1
  }

  if (counts.size === 0) return []

  const maxCount = Math.max(...counts.values())

  return Array.from(counts.entries()).map(([tagId, count]) => ({
    tagId,
    confidence: Math.min(1.0, count / maxCount)
  }))
}
```

`tokenize` already applies NFC, lowercase, and ё→е, matching `exactForm` in `seed.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/tags/__tests__/matcher.test.ts`
Expected: PASS, including the pre-existing tests.

If `'most-frequent tag gets confidence 1.0'` now fails, that is expected behaviour drift from consuming matched tokens — verify the new counts are correct and update that test's expectation rather than reverting the algorithm.

- [ ] **Step 5: Commit**

```bash
git add src/main/tags/matcher.ts src/main/tags/__tests__/matcher.test.ts
git commit -m "Use longest-match-wins and exact aliases in tag matcher"
```

---

### Task 9: Seed data — missing tags and the exact печенье alias

**Files:**
- Modify: `resources/seed-tags.yaml`

**Interfaces:**
- Consumes: `exact_aliases` support (Task 7), longest-match-wins (Task 8).
- Produces: no code interface.

- [ ] **Step 1: Add the three missing tags**

In `resources/seed-tags.yaml`, in the Ingredients section (immediately after the `bell_pepper` entry that currently ends at line 74 with `    - перец`), insert:

```yaml
- slug: liver
  label: Печень
  kind: ingredient
  aliases:
    - печень куриная
    - куриная печень
    - печень говяжья
    - говяжья печень

- slug: tomato_paste
  label: Томатная паста
  kind: ingredient
  aliases:
    - паста томатная
    - томат-паста

- slug: black_pepper
  label: Чёрный перец
  kind: ingredient
  aliases:
    - перец чёрный
    - перец черный молотый
    - чёрный молотый перец
    - молотый перец
```

Both word orders are listed deliberately: OCR yields `паста томатная` while the natural alias is `томатная паста`, and longest-match-wins only helps if the longer form is actually present.

- [ ] **Step 2: Convert печенье to an exact alias**

In the `dessert` entry (currently lines 391–401), remove `    - печенье` from `aliases` and add an `exact_aliases` block:

```yaml
- slug: dessert
  label: Десерт
  kind: dish_type
  aliases:
    - сладкое
    - сладость
    - выпечка сладкая
    - торт
    - пирожное
    - кекс
  exact_aliases:
    - печенье
    - печенья
    - печеньем
    - печений
```

`печенье` moves to exact matching because it and `печень` both stem to `печен`; the inflections are listed explicitly to limit the recall lost by skipping the stemmer.

- [ ] **Step 3: Verify the seed loads and matches correctly**

Run: `npm test`
Expected: all pass.

Then run `npm run dev`, and in Settings confirm `Печень`, `Томатная паста`, and `Чёрный перец` appear in the tag library.

- [ ] **Step 4: Re-OCR the sample recipes and confirm the false tags are gone**

With the app running, open each of the two sample recipes and use the per-recipe re-OCR control. Confirm:
- The liver recipe no longer carries `Десерт` or `Макароны`, and gains `Печень` and `Томатная паста`.
- The spaghetti recipe no longer carries `Десерт`.

- [ ] **Step 5: Commit**

```bash
git add resources/seed-tags.yaml
git commit -m "Add liver, tomato paste and black pepper tags; make печенье exact"
```

---

### Task 10: Full verification and documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the whole suite**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass. Do not proceed until they do.

- [ ] **Step 2: Update the project status notes**

In `CLAUDE.md`, under the OCR discussion, add to the "Common pitfalls to avoid" list:

```markdown
- **Don't rely on tesseract.js's default page segmentation.** It ships `PSM.SINGLE_BLOCK` (6), which performs no page layout analysis and reads multi-column pages straight across the columns. `src/main/ocr/worker.ts` sets `PSM.AUTO` (3) explicitly. Never remove that call.
- **Don't put OCR text repair in `tags/normalize.ts`.** De-hyphenation and line joining live in `src/main/ocr/postprocess.ts`, upstream of both display and matching, so the single-normalizer rule survives.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document OCR page segmentation and text repair invariants"
```

---

## Known follow-ups (deliberately not in this plan)

- **Seed curation is incomplete.** The three false positives fixed here were found by inspecting two screenshots, not systematically. Expect more stem collisions across a real vault. A useful future task is a script that reports alias pairs from different tags sharing a stem.
- **Column detection handles two columns.** `detectColumnCuts` returns at most one cut. Three-column layouts will fall back to a single split. Extend by recursing into each side with a minimum-column-width guard if real pages need it.
- **Existing recipes keep their old text** until re-OCR'd individually. Bulk re-OCR was explicitly ruled out of scope.
- **The `tessdata` cache at `%APPDATA%/meal-planner/tessdata` is empty** despite `cacheMethod: 'readWrite'`, suggesting ~15 MB of language data is re-downloaded on every run. Unrelated to this plan but worth investigating.
