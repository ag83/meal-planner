# PaddleOCR via ONNX Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `tesseract.js` with a from-scratch ONNX Runtime pipeline (PaddleOCR's detector, Cyrillic recognizer, and layout model) so OCR quality improves and multi-column reading order keeps working, entirely inside Node/Electron with no Python runtime shipped.

**Architecture:** Three ONNX models (text detection, text recognition, layout detection) run via `onnxruntime-node` inside a `worker_threads` pool. A ported recursive XY-cut algorithm orders detected layout regions; detected text lines are assigned into regions by bbox overlap; the result is assembled into the same `TessBlock[]` shape `blocks.ts` already consumes, so everything downstream (de-hyphenation, paragraph joining, tag matching) is untouched.

**Tech Stack:** `onnxruntime-node`, `sharp` (already a dependency, used for all resize/crop/pixel-buffer work), Node `worker_threads`, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-paddleocr-onnx-integration-design.md`

## Global Constraints

- Replace `tesseract.js` entirely — no dual-engine mode, no engine-selection UI (spec Decisions).
- No runtime model download — ONNX models are bundled at build time via `electron-builder` `extraResources`, never fetched over the network (spec Non-goals).
- No table/formula/seal/chart/footnote layout handling — only `text`, `paragraph_title`, `doc_title`, `image` labels are consumed (spec Non-goals).
- No `schemaVersion` bump — this plan does not touch the database (spec Non-goals).
- `runOcr(imagePath, lang?)` in `src/main/ocr/worker.ts` keeps its existing external signature; `src/main/ocr/blocks.ts` and `src/main/ocr/postprocess.ts` are **not modified** (spec Design — this is the central isolation property of the whole plan).
- TypeScript everywhere, named arrow functions only, no `function` declarations (CLAUDE.md conventions).
- Don't block the main Electron event loop with synchronous OCR (CLAUDE.md pitfalls) — enforced here via a `worker_threads` pool, same invariant tesseract.js's own pool satisfied.

---

## Task 0: Export ONNX models and the recognizer dictionary

This task produces binary artifacts, not application code. It has no TDD red/green cycle — its "test" is a shape/sanity check against the exported files. It must run before every later task, since every later task's tests load these files.

**Files:**
- Create: `resources/models/det.onnx`
- Create: `resources/models/rec.onnx`
- Create: `resources/models/layout.onnx`
- Create: `resources/eslav-dict.txt`
- Create: `scripts/export-onnx-models.py` (checked in — re-running this script is how a model gets re-exported if PaddleOCR ships an update; it is not run by `npm` scripts or CI, only by a developer)

**Interfaces:**
- Produces: three `.onnx` files consumed by Tasks 3, 5, 6 via `onnxruntime-node`'s `InferenceSession.create(path)`.
- Produces: `resources/eslav-dict.txt`, one character per line, consumed by Task 4.

- [x] **Step 1: Write the export script**

The three source models are the PaddleX "inference model" directories already cached locally at `C:\Users\AG\.paddlex\official_models\<name>\` (or wherever `PaddleOCR(lang="ru")` / `PPStructureV3(lang="ru", use_region_detection=False)` downloaded them during the investigation that produced the spec — if they are not present, running those two constructors once downloads them). `paddle2onnx` 2.1.0 (latest) failed to import on Windows during that investigation (`DLL load failed... paddle2onnx_cpp2py_export`) — confirmed again during plan execution. `paddle2onnx` **1.3.1** does import successfully on Windows and provides the same `--model_dir`/`--model_filename`/`--params_filename`/`--save_file` CLI flags, but ships no `__main__.py`, so it must be invoked as the `paddle2onnx` console-script executable directly, not via `python -m paddle2onnx`. Install it with `pip install paddle2onnx==1.3.1`. If 1.3.1 ever stops working too, fall back to running this script under WSL/Linux/CI instead — it does not need to run on the same machine as the rest of this plan, since its output is three portable files.

```python
# scripts/export-onnx-models.py
import json
import shutil
import subprocess
import sys
from pathlib import Path

MODELS_ROOT = Path.home() / ".paddlex" / "official_models"
OUT_DIR = Path(__file__).resolve().parent.parent / "resources" / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)

PADDLE2ONNX_EXE = shutil.which("paddle2onnx")
if PADDLE2ONNX_EXE is None:
    print("ERROR: paddle2onnx console script not found on PATH. "
          "pip install paddle2onnx==1.3.1 into the active environment first.",
          file=sys.stderr)
    sys.exit(1)

EXPORTS = [
    ("PP-OCRv5_server_det", "det.onnx"),
    ("eslav_PP-OCRv5_mobile_rec", "rec.onnx"),
    ("PP-DocLayout_plus-L", "layout.onnx"),
]

for model_name, out_name in EXPORTS:
    model_dir = MODELS_ROOT / model_name
    if not model_dir.exists():
        print(f"ERROR: {model_dir} not found. Run PaddleOCR(lang='ru') and "
              f"PPStructureV3(lang='ru', use_region_detection=False) once to "
              f"download it.", file=sys.stderr)
        sys.exit(1)
    out_path = OUT_DIR / out_name
    subprocess.run(
        [
            PADDLE2ONNX_EXE,
            "--model_dir", str(model_dir),
            "--model_filename", "inference.json",
            "--params_filename", "inference.pdiparams",
            "--save_file", str(out_path),
        ],
        check=True,
    )
    print(f"exported {model_dir.name} -> {out_path}")

# Recognizer dictionary: PaddleOCR's BaseRecLabelDecode appends a literal
# space character (use_space_char=True by default) before CTCLabelDecode
# prepends the blank token at index 0. So the real class layout is:
#   index 0            -> blank
#   index 1..N         -> character_dict[0..N-1]
#   index N+1 (last)   -> ' ' (space, appended here, not in character_dict)
# Verified empirically against rec.onnx: character_dict had 517 entries,
# the exported model has 519 output classes (517 + blank + space).
# write_bytes (not write_text) to force LF line endings regardless of
# platform — write_text on Windows translates \n to \r\n, which would
# silently corrupt every dictionary character with a trailing \r once
# read back with a plain split('\n').
rec_config = json.loads((MODELS_ROOT / "eslav_PP-OCRv5_mobile_rec" / "config.json").read_text(encoding="utf-8"))
chars = rec_config["PostProcess"]["character_dict"] + [" "]
dict_path = Path(__file__).resolve().parent.parent / "resources" / "eslav-dict.txt"
dict_path.write_bytes(("\n".join(chars) + "\n").encode("utf-8"))
print(f"wrote {len(chars)} characters (including trailing space) -> {dict_path}")
```

Also add to `.gitattributes` (create it if it doesn't exist) so git's `autocrlf` never rewrites this file's line endings on checkout, which would reintroduce the exact corruption above:

```
resources/eslav-dict.txt text eol=lf
resources/models/*.onnx binary
```

- [x] **Step 2: Run the export**

```bash
python scripts/export-onnx-models.py
```

Expected: three `.onnx` files under `resources/models/`, and `resources/eslav-dict.txt` with one character per line (518 lines: 517 from `eslav_PP-OCRv5_mobile_rec`'s `character_dict` array plus the appended space — verified empirically during plan execution; if the `character_dict` count differs because PaddleOCR shipped an updated dictionary, that's fine, downstream code reads the file's actual length, nothing hardcodes 518).

Actually run on this machine via WSL/Ubuntu, not native Windows Python — `paddle2onnx` 1.3.1 imports on Windows but can't parse the newer PIR-format `inference.json` these PaddleX models use (produced empty 0-byte `.onnx` files, silently, since the CLI exits 0 even on failure); `paddle2onnx` 2.1.0 understands the format but never imports on Windows at all. Both work fine on Linux. Real export was done in a `uv`-managed Python 3.12 venv inside WSL Ubuntu (the distro's own default Python, 3.14, has no `paddlepaddle` wheel yet), after installing the `libgomp1` system library `paddlepaddle` needs. Resulting files: `det.onnx` 88,045,223 bytes, `layout.onnx` 129,841,520 bytes, `rec.onnx` 7,887,531 bytes.

- [x] **Step 3: Sanity-check the exports load and report the shapes this plan assumes**

```python
# scripts/verify-onnx-exports.py (throwaway — run once, do not commit)
import onnxruntime as ort

for name in ["det.onnx", "rec.onnx", "layout.onnx"]:
    path = f"resources/models/{name}"
    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    print(f"\n{name}")
    for inp in sess.get_inputs():
        print(f"  input  {inp.name}: {inp.shape} {inp.type}")
    for out in sess.get_outputs():
        print(f"  output {out.name}: {out.shape} {out.type}")
```

```bash
python scripts/verify-onnx-exports.py
```

Expected: `det.onnx` and `rec.onnx` each show one input named `x` with a 4D shape containing dynamic dimensions (height/width marked as strings or `-1`, not fixed numbers) — if width shows as a fixed number instead of dynamic, the source model's dynamic-shape declaration was lost during export and Task 5's variable-width recognition will not work; re-export is required before continuing.

**Verified during plan execution** (recorded here so Task 6 doesn't have to rediscover it): `layout.onnx` is not a bare DETR output — it's PaddleDetection's standard three-input serving contract:

- Inputs: `image` (`[N,3,800,800]` float, the resized/normalized pixels), `im_shape` (`[N,2]` float, the resized height/width — always `[800,800]`), `scale_factor` (`[N,2]` float, `[800/originalHeight, 800/originalWidth]`).
- Outputs: `fetch_name_0` (`[M,6]` float, rows of `[labelId, score, x0, y0, x1, y1]`) and `fetch_name_1` (`[N]` int32, a `bbox_num`-per-image count — irrelevant for this app's always-batch-size-1 calls).
- Boxes in `fetch_name_0` are **already in original image pixel coordinates** — the graph does the `scale_factor` rescaling internally. No manual rescale is needed or correct in `decodeLayout`.
- The model emits many overlapping candidate boxes per real region at different label guesses (e.g. the title region showed up three times: `text` at score 0.70, `paragraph_title` at 0.46, `doc_title` at 0.32) — this is **not** NMS output. A plain score threshold at 0.5 is sufficient to resolve this on the beef fixture: exactly six rows survive, one per real region, each the correct label, with coordinates matching the regions already recorded in this spec's Investigation section almost exactly (e.g. row 2 `[48.6, 472.4, 423.0, 951.0]` vs. the recorded step-1 region `[48, 472, 423, 951]`). No separate per-region deduplication step is needed.
- `labelId` is a direct 0-indexed index into `LAYOUT_LABELS` (confirmed: `labelId=1` → `LAYOUT_LABELS[1]` = `'image'`, matched the photo region; `labelId=2` → `'text'`, matched every text region).

This replaces Task 6's original Shape-A/Shape-B uncertainty entirely — Task 6 below is written directly against this confirmed contract, not as a discovery step.

- [ ] **Step 4: Commit**

```bash
git add resources/models/det.onnx resources/models/rec.onnx resources/models/layout.onnx resources/eslav-dict.txt scripts/export-onnx-models.py
git commit -m "build(ocr): export PaddleOCR detector, eslav recognizer, and layout model to ONNX"
```

---

## Task 1: `onnxruntime-node` dependency and shared tensor conversion

**Files:**
- Modify: `package.json` (add `onnxruntime-node`, remove nothing yet — `tesseract.js` is removed in Task 11 once nothing references it)
- Create: `src/main/ocr/paddle/tensor.ts`
- Test: `src/main/ocr/paddle/__tests__/tensor.test.ts`

**Interfaces:**
- Produces: `rgbaToChwFloat32(pixels: Buffer, width: number, height: number, channels: 3 | 4, mean: readonly [number, number, number], std: readonly [number, number, number], swapRB: boolean): Float32Array` — consumed by Tasks 3, 5, 6.

- [x] **Step 1: Install the dependency**

```bash
npm install onnxruntime-node
```

- [x] **Step 2: Write the failing test**

`rgbaToChwFloat32` must: read interleaved HWC pixel data, normalize each channel as `(value/255 - mean[c]) / std[c]`, write it out in planar CHW order, and swap the R/B channel positions when `swapRB` is true (PaddleOCR's `DecodeImage` step reads `img_mode: "BGR"`; `sharp`'s `.raw()` output is RGB, so this flag makes channel 0 of the output tensor be what the model was trained on as "B").

```typescript
// src/main/ocr/paddle/__tests__/tensor.test.ts
import { describe, it, expect } from 'vitest'
import { rgbaToChwFloat32 } from '../tensor'

describe('rgbaToChwFloat32', () => {
  it('normalizes and transposes a 1x2 RGB image to planar CHW', () => {
    // pixel 0: R=255,G=0,B=0 ; pixel 1: R=0,G=255,B=0  (1 row, 2 cols, 3 channels)
    const pixels = Buffer.from([255, 0, 0, 0, 255, 0])
    const result = rgbaToChwFloat32(pixels, 2, 1, 3, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], false)
    // (255/255 - 0.5)/0.5 = 1 ; (0/255 - 0.5)/0.5 = -1
    expect(Array.from(result)).toEqual([
      1, -1, // R channel, both pixels
      -1, 1, // G channel, both pixels
      -1, -1 // B channel, both pixels
    ])
  })

  it('swaps R and B channel positions when swapRB is true', () => {
    const pixels = Buffer.from([255, 0, 0, 0, 255, 0])
    const result = rgbaToChwFloat32(pixels, 2, 1, 3, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], true)
    expect(Array.from(result)).toEqual([
      -1, -1, // channel 0 is now B (was R)
      -1, 1,  // channel 1 is G, unchanged
      1, -1   // channel 2 is now R (was B)
    ])
  })

  it('ignores a 4th alpha channel when channels=4', () => {
    const pixels = Buffer.from([255, 0, 0, 200, 0, 255, 0, 200])
    const result = rgbaToChwFloat32(pixels, 2, 1, 4, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], false)
    expect(result.length).toBe(6)
    expect(Array.from(result)).toEqual([1, -1, -1, 1, -1, -1])
  })
})
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ocr/paddle/__tests__/tensor.test.ts`
Expected: FAIL — `../tensor` has no exported member `rgbaToChwFloat32` (module doesn't exist yet).

- [x] **Step 4: Write the implementation**

```typescript
// src/main/ocr/paddle/tensor.ts
export const rgbaToChwFloat32 = (
  pixels: Buffer,
  width: number,
  height: number,
  channels: 3 | 4,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
  swapRB: boolean
): Float32Array => {
  const pixelCount = width * height
  const out = new Float32Array(pixelCount * 3)
  const order = swapRB ? [2, 1, 0] : [0, 1, 2]

  for (let i = 0; i < pixelCount; i++) {
    const base = i * channels
    for (let c = 0; c < 3; c++) {
      const srcChannel = order[c]
      const value = pixels[base + srcChannel] / 255
      out[c * pixelCount + i] = (value - mean[c]) / std[c]
    }
  }

  return out
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ocr/paddle/__tests__/tensor.test.ts`
Expected: PASS (3 tests)

- [x] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/ocr/paddle/tensor.ts src/main/ocr/paddle/__tests__/tensor.test.ts
git commit -m "feat(ocr): add onnxruntime-node and shared pixel-to-tensor conversion"
```

---

## Task 2: Connected-component labeling

Text detection's DB postprocess needs to turn a thresholded binary mask into a list of blob bounding boxes. This is the one piece of classic computer-vision code the pipeline needs that isn't a direct port of something already read from PaddleX's source — `cv2.findContours` + `cv2.minAreaRect` in the Python reference. Per the spec's investigation, recipe photos are flat, non-rotated captures (preprocessing in `src/main/ocr/preprocess.ts` only upscales/greyscales/normalizes, no deskew), so this plan uses **axis-aligned bounding boxes** instead of porting `minAreaRect`'s rotated-rectangle geometry — a deliberate simplification, not an oversight. If a future recipe photo is rotated enough for this to matter, rotated-box support is a follow-up.

**Files:**
- Create: `src/main/ocr/paddle/connectedComponents.ts`
- Test: `src/main/ocr/paddle/__tests__/connectedComponents.test.ts`

**Interfaces:**
- Produces: `interface Component { minX: number; minY: number; maxX: number; maxY: number; pixelCount: number }` and `findConnectedComponents(mask: Uint8Array, width: number, height: number): Component[]` — consumed by Task 3.

- [x] **Step 1: Write the failing test**

```typescript
// src/main/ocr/paddle/__tests__/connectedComponents.test.ts
import { describe, it, expect } from 'vitest'
import { findConnectedComponents } from '../connectedComponents'

const maskFromRows = (rows: string[]): { mask: Uint8Array; width: number; height: number } => {
  const width = rows[0].length
  const height = rows.length
  const mask = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    row.split('').forEach((char, x) => {
      mask[y * width + x] = char === '1' ? 1 : 0
    })
  })
  return { mask, width, height }
}

describe('findConnectedComponents', () => {
  it('finds a single rectangular blob', () => {
    const { mask, width, height } = maskFromRows(['00000', '01110', '01110', '00000'])
    const result = findConnectedComponents(mask, width, height)
    expect(result).toEqual([{ minX: 1, minY: 1, maxX: 3, maxY: 2, pixelCount: 6 }])
  })

  it('finds two separate blobs', () => {
    const { mask, width, height } = maskFromRows(['11000', '00000', '00011'])
    const result = findConnectedComponents(mask, width, height)
    expect(result).toHaveLength(2)
    expect(result).toEqual(
      expect.arrayContaining([
        { minX: 0, minY: 0, maxX: 1, maxY: 0, pixelCount: 2 },
        { minX: 3, minY: 2, maxX: 4, maxY: 2, pixelCount: 2 }
      ])
    )
  })

  it('connects diagonally-touching pixels (8-connectivity)', () => {
    const { mask, width, height } = maskFromRows(['10', '01'])
    const result = findConnectedComponents(mask, width, height)
    expect(result).toEqual([{ minX: 0, minY: 0, maxX: 1, maxY: 1, pixelCount: 2 }])
  })

  it('returns an empty array for an all-zero mask', () => {
    const { mask, width, height } = maskFromRows(['000', '000'])
    expect(findConnectedComponents(mask, width, height)).toEqual([])
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ocr/paddle/__tests__/connectedComponents.test.ts`
Expected: FAIL — module doesn't exist.

- [x] **Step 3: Write the implementation**

Iterative BFS flood fill (not recursive — a full-page mask can have components spanning hundreds of thousands of pixels, and a recursive implementation would overflow the call stack).

```typescript
// src/main/ocr/paddle/connectedComponents.ts
export interface Component {
  minX: number
  minY: number
  maxX: number
  maxY: number
  pixelCount: number
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
]

export const findConnectedComponents = (mask: Uint8Array, width: number, height: number): Component[] => {
  const visited = new Uint8Array(width * height)
  const components: Component[] = []
  const queue: number[] = []

  for (let startIdx = 0; startIdx < mask.length; startIdx++) {
    if (mask[startIdx] === 0 || visited[startIdx] === 1) continue

    visited[startIdx] = 1
    queue.length = 0
    queue.push(startIdx)

    let minX = startIdx % width
    let maxX = minX
    let minY = Math.floor(startIdx / width)
    let maxY = minY
    let pixelCount = 0

    while (queue.length > 0) {
      const idx = queue.pop() as number
      const x = idx % width
      const y = Math.floor(idx / width)
      pixelCount++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nIdx = ny * width + nx
        if (mask[nIdx] === 1 && visited[nIdx] === 0) {
          visited[nIdx] = 1
          queue.push(nIdx)
        }
      }
    }

    components.push({ minX, minY, maxX, maxY, pixelCount })
  }

  return components
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ocr/paddle/__tests__/connectedComponents.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add src/main/ocr/paddle/connectedComponents.ts src/main/ocr/paddle/__tests__/connectedComponents.test.ts
git commit -m "feat(ocr): add connected-component labeling for DB text detection"
```

---

## Task 3: Text detection (DB postprocess)

Per Task 0's exported model and the config read from `PP-OCRv5_server_det/config.json`: `DBPostProcess` with `thresh=0.3`, `box_thresh=0.6`, `unclip_ratio=1.5`; preprocessing resizes the longer side to 960 (`resize_long`), rounds both dimensions to the nearest multiple of 32 (minimum 32), normalizes with ImageNet mean `[0.485, 0.456, 0.406]` / std `[0.229, 0.224, 0.225]`, and decodes as BGR.

This task separates the **pure decode logic** (`decodeDetection`, no I/O, fully unit-testable) from the **ONNX/image I/O glue** (`runDetection`), so the algorithmic correctness can be tested fast and without a real model file.

**Files:**
- Create: `src/main/ocr/paddle/detect.ts`
- Test: `src/main/ocr/paddle/__tests__/detect.test.ts`

**Interfaces:**
- Consumes: `rgbaToChwFloat32` (Task 1), `findConnectedComponents` (Task 2).
- Produces: `interface DetectedBox { x0: number; y0: number; x1: number; y1: number }`, `decodeDetection(probMap: Float32Array, mapWidth: number, mapHeight: number, ratioW: number, ratioH: number): DetectedBox[]`, `preprocessForDetection(imagePath: string): Promise<{ tensorData: Float32Array; width: number; height: number; ratioW: number; ratioH: number }>`, `runDetection(session: import('onnxruntime-node').InferenceSession, imagePath: string): Promise<DetectedBox[]>` — `DetectedBox[]` is consumed by Task 7 (assembly) and Task 5 (recognition crops each box).

- [x] **Step 1: Write the failing test for `decodeDetection`**

A 10x10 probability map with one 4x4 high-probability blob at (2,2)-(5,5), everything else 0. `box_thresh` is checked against the component's mean probability; `unclip_ratio` expands the box using DB's real formula `distance = area * unclipRatio / perimeter`, applied on all four sides.

```typescript
// src/main/ocr/paddle/__tests__/detect.test.ts
import { describe, it, expect } from 'vitest'
import { decodeDetection } from '../detect'

const buildProbMap = (width: number, height: number, highBoxes: Array<[number, number, number, number]>, highValue: number): Float32Array => {
  const map = new Float32Array(width * height)
  for (const [x0, y0, x1, y1] of highBoxes) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        map[y * width + x] = highValue
      }
    }
  }
  return map
}

describe('decodeDetection', () => {
  it('finds one box above thresh/box_thresh and expands it by unclip_ratio', () => {
    const map = buildProbMap(10, 10, [[2, 2, 5, 5]], 0.9)
    const boxes = decodeDetection(map, 10, 10, 1, 1, { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 })
    expect(boxes).toHaveLength(1)
    // component spans inclusive pixel indices [2,5] on both axes, so in
    // continuous coordinates the box is (2,2)-(6,6): width=4 height=4
    // area=16 perimeter=16, distance = 16 * 1.5 / 16 = 1.5
    const box = boxes[0]
    expect(box.x0).toBeCloseTo(0.5, 5)
    expect(box.y0).toBeCloseTo(0.5, 5)
    expect(box.x1).toBeCloseTo(7.5, 5)
    expect(box.y1).toBeCloseTo(7.5, 5)
  })

  it('rejects a blob whose mean probability is below box_thresh', () => {
    const map = buildProbMap(10, 10, [[2, 2, 5, 5]], 0.4)
    const boxes = decodeDetection(map, 10, 10, 1, 1, { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 })
    expect(boxes).toHaveLength(0)
  })

  it('rescales coordinates back to original image space using ratioW/ratioH', () => {
    const map = buildProbMap(10, 10, [[2, 2, 5, 5]], 0.9)
    // model saw the image resized 2x horizontally, 1x vertically, so ratioW=2 means
    // original = model_coordinate / ratioW
    const boxes = decodeDetection(map, 10, 10, 2, 1, { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 })
    expect(boxes[0].x0).toBeCloseTo(0.25, 5)
    expect(boxes[0].x1).toBeCloseTo(3.75, 5)
    expect(boxes[0].y0).toBeCloseTo(0.5, 5)
    expect(boxes[0].y1).toBeCloseTo(7.5, 5)
  })

  it('returns an empty array when nothing is above thresh', () => {
    const map = new Float32Array(100)
    expect(decodeDetection(map, 10, 10, 1, 1, { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5 })).toEqual([])
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ocr/paddle/__tests__/detect.test.ts`
Expected: FAIL — module doesn't exist.

- [x] **Step 3: Write the implementation**

```typescript
// src/main/ocr/paddle/detect.ts
import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import { Tensor } from 'onnxruntime-node'
import { rgbaToChwFloat32 } from './tensor'
import { findConnectedComponents } from './connectedComponents'

export const DET_RESIZE_LONG = 960
export const DET_MEAN: readonly [number, number, number] = [0.485, 0.456, 0.406]
export const DET_STD: readonly [number, number, number] = [0.229, 0.224, 0.225]

export interface DetectedBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface DecodeOptions {
  thresh?: number
  boxThresh?: number
  unclipRatio?: number
}

const roundToMultipleOf32 = (value: number): number => Math.max(32, Math.round(value / 32) * 32)

export const decodeDetection = (
  probMap: Float32Array,
  mapWidth: number,
  mapHeight: number,
  ratioW: number,
  ratioH: number,
  opts: DecodeOptions = {}
): DetectedBox[] => {
  const thresh = opts.thresh ?? 0.3
  const boxThresh = opts.boxThresh ?? 0.6
  const unclipRatio = opts.unclipRatio ?? 1.5

  const mask = new Uint8Array(mapWidth * mapHeight)
  for (let i = 0; i < probMap.length; i++) {
    mask[i] = probMap[i] > thresh ? 1 : 0
  }

  const components = findConnectedComponents(mask, mapWidth, mapHeight)
  const boxes: DetectedBox[] = []

  for (const component of components) {
    let sum = 0
    for (let y = component.minY; y <= component.maxY; y++) {
      for (let x = component.minX; x <= component.maxX; x++) {
        sum += probMap[y * mapWidth + x]
      }
    }
    const area = (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1)
    const meanScore = sum / area
    if (meanScore < boxThresh) continue

    const width = component.maxX - component.minX + 1
    const height = component.maxY - component.minY + 1
    const perimeter = 2 * (width + height)
    const distance = (width * height * unclipRatio) / perimeter

    boxes.push({
      x0: (component.minX - distance) / ratioW,
      y0: (component.minY - distance) / ratioH,
      x1: (component.maxX + 1 + distance) / ratioW,
      y1: (component.maxY + 1 + distance) / ratioH
    })
  }

  return boxes
}

export const preprocessForDetection = async (
  imagePath: string
): Promise<{ tensorData: Float32Array; width: number; height: number; ratioW: number; ratioH: number }> => {
  const image = sharp(imagePath)
  const metadata = await image.metadata()
  const originalWidth = metadata.width ?? 0
  const originalHeight = metadata.height ?? 0
  const longSide = Math.max(originalWidth, originalHeight)
  const scale = DET_RESIZE_LONG / longSide
  const resizedWidth = roundToMultipleOf32(originalWidth * scale)
  const resizedHeight = roundToMultipleOf32(originalHeight * scale)

  const { data } = await image
    .resize(resizedWidth, resizedHeight, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const tensorData = rgbaToChwFloat32(data, resizedWidth, resizedHeight, 3, DET_MEAN, DET_STD, true)

  return {
    tensorData,
    width: resizedWidth,
    height: resizedHeight,
    ratioW: resizedWidth / originalWidth,
    ratioH: resizedHeight / originalHeight
  }
}

export const runDetection = async (session: InferenceSession, imagePath: string): Promise<DetectedBox[]> => {
  const { tensorData, width, height, ratioW, ratioH } = await preprocessForDetection(imagePath)
  const inputName = session.inputNames[0]
  const feeds = { [inputName]: new Tensor('float32', tensorData, [1, 3, height, width]) }
  const output = await session.run(feeds)
  const outputName = session.outputNames[0]
  const probMap = output[outputName].data as Float32Array
  return decodeDetection(probMap, width, height, ratioW, ratioH)
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ocr/paddle/__tests__/detect.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: Verify `runDetection` end-to-end against the real exported model and a real fixture image**

This is the first point this plan touches a real `.onnx` file — confirm it loads and produces plausible boxes before building anything on top of it.

```typescript
// scratch check, not committed — run with: npx tsx <this file>
import { InferenceSession } from 'onnxruntime-node'
import { runDetection } from './src/main/ocr/paddle/detect'

const main = async (): Promise<void> => {
  const session = await InferenceSession.create('resources/models/det.onnx')
  const boxes = await runDetection(session, 'src/main/ocr/__tests__/fixtures/images/pork-two-column.png')
  console.log(`found ${boxes.length} boxes`)
  console.log(boxes.slice(0, 5))
}

main()
```

Expected: a plausible number of boxes for a two-column recipe page (tens, not zero and not thousands) with coordinates inside the image's actual pixel dimensions. If this throws about a tensor shape mismatch, re-check the input tensor's dimension order and name against `session.inputNames`/`session.inputMetadata` logged from Task 0 Step 3.

- [x] **Step 6: Commit**

```bash
git add src/main/ocr/paddle/detect.ts src/main/ocr/paddle/__tests__/detect.test.ts
git commit -m "feat(ocr): add DB text detection against the ONNX detector"
```

---

## Task 4: CTC decode for the recognizer

Per Task 0: `CTCLabelDecode` prepends a `blank` token at class index 0, so class index `i` for `i >= 1` maps to `dict[i - 1]` (the dictionary file written in Task 0 has no blank entry — that's implicit — but does already include the trailing space character PaddleOCR's `use_space_char` adds, since Task 0 appends it when writing the file; verified empirically that 517 `character_dict` entries + blank + space = 519, matching `rec.onnx`'s real output class count exactly).

**Files:**
- Create: `src/main/ocr/paddle/ctcDecode.ts`
- Test: `src/main/ocr/paddle/__tests__/ctcDecode.test.ts`

**Interfaces:**
- Produces: `ctcGreedyDecode(logits: Float32Array, timeSteps: number, numClasses: number, dict: readonly string[]): { text: string; confidence: number }` — consumed by Task 5.

- [x] **Step 1: Write the failing test**

Greedy CTC decode: at each timestep, take the argmax class; collapse consecutive repeats of the *same* class into one; drop every occurrence of class 0 (blank) — including a blank between two instances of the same real character, which is exactly what allows CTC to represent a doubled letter.

```typescript
// src/main/ocr/paddle/__tests__/ctcDecode.test.ts
import { describe, it, expect } from 'vitest'
import { ctcGreedyDecode } from '../ctcDecode'

const dict = ['a', 'b', 'c'] // class 1='a', class 2='b', class 3='c'; class 0 is blank

const logitsFromClasses = (classes: number[], numClasses: number): Float32Array => {
  const logits = new Float32Array(classes.length * numClasses)
  classes.forEach((cls, t) => {
    logits[t * numClasses + cls] = 10 // dominant logit for the chosen class
  })
  return logits
}

describe('ctcGreedyDecode', () => {
  it('decodes a simple sequence with no repeats or blanks', () => {
    const logits = logitsFromClasses([1, 2, 3], 4)
    const result = ctcGreedyDecode(logits, 3, 4, dict)
    expect(result.text).toBe('abc')
  })

  it('collapses consecutive repeated classes into one character', () => {
    const logits = logitsFromClasses([1, 1, 1, 2], 4)
    const result = ctcGreedyDecode(logits, 4, 4, dict)
    expect(result.text).toBe('ab')
  })

  it('drops blank (class 0) entirely, including between repeats to produce a doubled letter', () => {
    const logits = logitsFromClasses([1, 0, 1], 4)
    const result = ctcGreedyDecode(logits, 3, 4, dict)
    expect(result.text).toBe('aa')
  })

  it('returns an empty string and zero confidence for an all-blank sequence', () => {
    const logits = logitsFromClasses([0, 0, 0], 4)
    const result = ctcGreedyDecode(logits, 3, 4, dict)
    expect(result.text).toBe('')
    expect(result.confidence).toBe(0)
  })

  it('averages confidence over the kept (non-blank, non-repeat) characters only', () => {
    // class 1 at t=0 with logit 10 among [10,0,0,0] -> softmax prob close to 1
    // class 1 repeated at t=1 is dropped from the average (it's a collapsed repeat)
    const numClasses = 4
    const logits = new Float32Array(2 * numClasses)
    logits.set([0, 10, 0, 0], 0)
    logits.set([0, 10, 0, 0], numClasses)
    const result = ctcGreedyDecode(logits, 2, numClasses, dict)
    expect(result.text).toBe('a')
    expect(result.confidence).toBeGreaterThan(0.9)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ocr/paddle/__tests__/ctcDecode.test.ts`
Expected: FAIL — module doesn't exist.

- [x] **Step 3: Write the implementation**

```typescript
// src/main/ocr/paddle/ctcDecode.ts
const BLANK_CLASS = 0

const softmaxMax = (logitsForStep: Float32Array): { classIdx: number; prob: number } => {
  let maxVal = -Infinity
  let classIdx = 0
  for (let c = 0; c < logitsForStep.length; c++) {
    if (logitsForStep[c] > maxVal) {
      maxVal = logitsForStep[c]
      classIdx = c
    }
  }
  let sumExp = 0
  for (let c = 0; c < logitsForStep.length; c++) {
    sumExp += Math.exp(logitsForStep[c] - maxVal)
  }
  const prob = 1 / sumExp // exp(maxVal - maxVal) / sumExp
  return { classIdx, prob }
}

export const ctcGreedyDecode = (
  logits: Float32Array,
  timeSteps: number,
  numClasses: number,
  dict: readonly string[]
): { text: string; confidence: number } => {
  let text = ''
  let lastClass = -1
  const confidences: number[] = []

  for (let t = 0; t < timeSteps; t++) {
    const stepLogits = logits.subarray(t * numClasses, (t + 1) * numClasses)
    const { classIdx, prob } = softmaxMax(stepLogits)

    if (classIdx === BLANK_CLASS) {
      lastClass = BLANK_CLASS
      continue
    }
    if (classIdx === lastClass) {
      continue
    }
    text += dict[classIdx - 1]
    confidences.push(prob)
    lastClass = classIdx
  }

  const confidence = confidences.length === 0 ? 0 : confidences.reduce((a, b) => a + b, 0) / confidences.length
  return { text, confidence }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ocr/paddle/__tests__/ctcDecode.test.ts`
Expected: PASS (5 tests)

- [x] **Step 5: Commit**

```bash
git add src/main/ocr/paddle/ctcDecode.ts src/main/ocr/paddle/__tests__/ctcDecode.test.ts
git commit -m "feat(ocr): add CTC greedy decode for the recognizer"
```

---

## Task 5: Text recognition

Per Task 0's config: input shape `[1, 3, 48, W]` with `W` dynamic, BGR decode. This plan resizes each detected line crop to a fixed height of 48px keeping aspect ratio and feeds whatever width results — the source model's dynamic-width support (visible in its `trt_dynamic_shapes` entries) means no fixed-width padding/bucketing is required for plain CPU execution; that bucketing exists in PaddleX only to pre-compile fixed TensorRT engine shapes, which is irrelevant here.

**Files:**
- Create: `src/main/ocr/paddle/recognize.ts`
- Test: `src/main/ocr/paddle/__tests__/recognize.test.ts`

**Interfaces:**
- Consumes: `rgbaToChwFloat32` (Task 1), `ctcGreedyDecode` (Task 4), `DetectedBox` (Task 3).
- Produces: `loadDictionary(fileContents: string): string[]`, `runRecognition(session: InferenceSession, imagePath: string, box: DetectedBox, dict: readonly string[]): Promise<{ text: string; confidence: number }>` — consumed by Task 8 (worker pool orchestration).

- [ ] **Step 1: Write the failing test for `loadDictionary`**

```typescript
// src/main/ocr/paddle/__tests__/recognize.test.ts
import { describe, it, expect } from 'vitest'
import { loadDictionary } from '../recognize'

describe('loadDictionary', () => {
  it('splits one character per line and drops a trailing blank line', () => {
    const contents = 'a\nb\nc\n'
    expect(loadDictionary(contents)).toEqual(['a', 'b', 'c'])
  })

  it('preserves a literal space character as its own dictionary entry', () => {
    const contents = 'a\n \nb\n'
    expect(loadDictionary(contents)).toEqual(['a', ' ', 'b'])
  })

  it('strips a trailing carriage return from CRLF line endings without losing a real trailing space', () => {
    // guards against git's core.autocrlf rewriting resources/eslav-dict.txt despite
    // the .gitattributes entry Task 0 adds — this file is read byte-by-byte as
    // meaningful characters, so a stray \r would silently corrupt every entry
    const contents = 'a\r\n \r\nb\r\n'
    expect(loadDictionary(contents)).toEqual(['a', ' ', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ocr/paddle/__tests__/recognize.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

`loadDictionary` cannot simply `.filter(Boolean)` on a line split (that was `ctcDecode.test.ts`'s own dict, hand-built) — the real file can contain a line that is a single space character, which is falsy-looking but meaningful; only the trailing empty line from the file's final newline should be dropped. Split on `\r?\n` (not a plain `'\n'`) so a stray `\r` from CRLF line endings is never left attached to a character.

```typescript
// src/main/ocr/paddle/recognize.ts
import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import { Tensor } from 'onnxruntime-node'
import { rgbaToChwFloat32 } from './tensor'
import { ctcGreedyDecode } from './ctcDecode'
import type { DetectedBox } from './detect'

export const RECOGNIZER_HEIGHT = 48
const REC_MEAN: readonly [number, number, number] = [0.5, 0.5, 0.5]
const REC_STD: readonly [number, number, number] = [0.5, 0.5, 0.5]

export const loadDictionary = (fileContents: string): string[] => {
  const lines = fileContents.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export const runRecognition = async (
  session: InferenceSession,
  imagePath: string,
  box: DetectedBox,
  dict: readonly string[]
): Promise<{ text: string; confidence: number }> => {
  const cropWidth = Math.max(1, Math.round(box.x1 - box.x0))
  const cropHeight = Math.max(1, Math.round(box.y1 - box.y0))
  const targetWidth = Math.max(1, Math.round((cropWidth / cropHeight) * RECOGNIZER_HEIGHT))

  const { data } = await sharp(imagePath)
    .extract({ left: Math.round(box.x0), top: Math.round(box.y0), width: cropWidth, height: cropHeight })
    .resize(targetWidth, RECOGNIZER_HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const tensorData = rgbaToChwFloat32(data, targetWidth, RECOGNIZER_HEIGHT, 3, REC_MEAN, REC_STD, true)
  const inputName = session.inputNames[0]
  const feeds = { [inputName]: new Tensor('float32', tensorData, [1, 3, RECOGNIZER_HEIGHT, targetWidth]) }
  const output = await session.run(feeds)
  const outputName = session.outputNames[0]
  const logitsResult = output[outputName]
  const dims = logitsResult.dims
  const timeSteps = dims[1]
  const numClasses = dims[2]

  return ctcGreedyDecode(logitsResult.data as Float32Array, timeSteps, numClasses, dict)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ocr/paddle/__tests__/recognize.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Verify `runRecognition` end-to-end against the real exported model**

```typescript
// scratch check, not committed — run with: npx tsx <this file>
import fs from 'fs'
import { InferenceSession } from 'onnxruntime-node'
import { runRecognition, loadDictionary } from './src/main/ocr/paddle/recognize'

const main = async (): Promise<void> => {
  const session = await InferenceSession.create('resources/models/rec.onnx')
  const dict = loadDictionary(fs.readFileSync('resources/eslav-dict.txt', 'utf-8'))
  // box coordinates below are a guess at the title line on this fixture; adjust
  // after Task 3's detection step reports real boxes for this image, or crop
  // visually to find a line's approximate box for this one-off check.
  const result = await runRecognition(
    session,
    'src/main/ocr/__tests__/fixtures/images/pork-two-column.png',
    { x0: 60, y0: 10, x1: 400, y1: 60 },
    dict
  )
  console.log(result)
}

main()
```

Expected: recognizable Cyrillic text (the title "Свинина со свитой" per the spec's Investigation section), not garbage or an empty string. If output is empty, check `dims` ordering — some ONNX exports put the class dimension before the time dimension (`[1, numClasses, T]` instead of `[1, T, numClasses]`); if so, `runRecognition` needs `dims[1]`/`dims[2]` swapped and the stride in `ctcGreedyDecode`'s caller adjusted to match.

- [ ] **Step 6: Commit**

```bash
git add src/main/ocr/paddle/recognize.ts src/main/ocr/paddle/__tests__/recognize.test.ts
git commit -m "feat(ocr): add text recognition against the eslav ONNX recognizer"
```

---

## Task 6: Layout detection

**Verified empirically during plan execution** (superseding the discovery-step framing this task originally had): `layout.onnx` is PaddleDetection's standard three-input serving contract, not a bare DETR output.

- Inputs: `image` (`[N,3,800,800]` float32, resized via plain stretch — `"keep_ratio": false` in `PP-DocLayout_plus-L/config.json` — and scaled to `[0,1]` only, no mean/std subtraction per `norm_type: "none"`), `im_shape` (`[N,2]` float32, always `[800,800]`), `scale_factor` (`[N,2]` float32, `[800/originalHeight, 800/originalWidth]`).
- Output `fetch_name_0`: `[M,6]` float32, each row `[labelId, score, x0, y0, x1, y1]`, **already in original image pixel coordinates** — the graph applies `scale_factor` internally. There is no manual rescale step in this task's code.
- Output `fetch_name_1`: `[N]` int32, a `bbox_num`-per-image count. Not used — this app always calls with a single image, so it's always `[M]`.
- `labelId` is a direct 0-indexed index into `LAYOUT_LABELS` below (confirmed: `labelId=1` → `'image'` matched the real photo region; `labelId=2` → `'text'` matched every real text region on the beef fixture).
- The model emits many overlapping low-score candidates per real region (e.g. the beef fixture's title region appeared three times: label `text` score 0.70, `paragraph_title` score 0.46, `doc_title` score 0.32) — this is pre-final-threshold output, not NMS'd across classes. A plain `score >= 0.5` filter resolved this correctly: exactly six rows survived on the beef fixture, one per real region, with coordinates matching the regions already recorded in the spec's Investigation section (e.g. `[48.6, 472.4, 423.0, 951.0]` vs. the recorded step-1 region `[48, 472, 423, 951]`). No additional per-region deduplication is needed.
- On the beef fixture, the **title region's own top-scoring label after thresholding is `text`** (0.70), not `title` — `paragraph_title` (0.46) and `doc_title` (0.32) both score below 0.5 for that exact box. This is harmless: `LABEL_MAP` below treats `text` and `title` identically everywhere downstream (`assemble.ts` only special-cases `image`), so the region still produces a correct OCR'd paragraph — it's just not specially flagged as a title. Don't "fix" this by lowering the threshold for `paragraph_title`/`doc_title` specifically; that would resurface the overlapping-candidate problem for every other region too.

Per the spec's Investigation, `PP-DocBlockLayout` is **not** used by this plan — re-running the layout pipeline with `use_region_detection=False` produced byte-identical output on the beef fixture image, confirming it's not needed for `text`/`title`/`image` region labels.

**Files:**
- Create: `src/main/ocr/paddle/layout.ts`
- Test: `src/main/ocr/paddle/__tests__/layout.test.ts`

**Interfaces:**
- Produces: `interface LayoutRegion { x0: number; y0: number; x1: number; y1: number; label: 'text' | 'title' | 'image' }`, `decodeLayout(rows: Float32Array, numRows: number, threshold?: number): LayoutRegion[]`, `runLayout(session: InferenceSession, imagePath: string): Promise<LayoutRegion[]>` — `LayoutRegion[]` is consumed by Task 7 (reading order) and Task 8 (assembly).

- [ ] **Step 1: Write the failing test**

`LAYOUT_LABELS` is the `label_list` recorded verbatim from `PP-DocLayout_plus-L/config.json` during Task 0's investigation; `rows` is the flattened `fetch_name_0` output — row `i`'s six values live at `rows[i*6 .. i*6+5]`.

```typescript
// src/main/ocr/paddle/__tests__/layout.test.ts
import { describe, it, expect } from 'vitest'
import { decodeLayout, LAYOUT_LABELS } from '../layout'

const makeRow = (labelId: number, score: number, x0: number, y0: number, x1: number, y1: number): number[] => [
  labelId, score, x0, y0, x1, y1
]

describe('decodeLayout', () => {
  it('keeps a row labeled "text" above threshold', () => {
    const textId = LAYOUT_LABELS.indexOf('text')
    const rows = new Float32Array(makeRow(textId, 0.9, 10, 20, 100, 200))
    const regions = decodeLayout(rows, 1, 0.5)
    expect(regions).toEqual([{ x0: 10, y0: 20, x1: 100, y1: 200, label: 'text' }])
  })

  it('maps paragraph_title and doc_title both to label "title"', () => {
    const paragraphTitleId = LAYOUT_LABELS.indexOf('paragraph_title')
    const rows = new Float32Array(makeRow(paragraphTitleId, 0.9, 10, 20, 100, 200))
    expect(decodeLayout(rows, 1, 0.5)[0].label).toBe('title')
  })

  it('drops a row whose label is a Non-goal (e.g. table)', () => {
    const tableId = LAYOUT_LABELS.indexOf('table')
    const rows = new Float32Array(makeRow(tableId, 0.9, 10, 20, 100, 200))
    expect(decodeLayout(rows, 1, 0.5)).toEqual([])
  })

  it('drops a row below the score threshold', () => {
    const textId = LAYOUT_LABELS.indexOf('text')
    const rows = new Float32Array(makeRow(textId, 0.3, 10, 20, 100, 200))
    expect(decodeLayout(rows, 1, 0.5)).toEqual([])
  })

  it('resolves overlapping multi-class candidates for the same region via the threshold alone', () => {
    // mirrors the real beef-fixture title region: three labels for one box,
    // only the top one clears 0.5
    const textId = LAYOUT_LABELS.indexOf('text')
    const titleId = LAYOUT_LABELS.indexOf('paragraph_title')
    const docTitleId = LAYOUT_LABELS.indexOf('doc_title')
    const rows = new Float32Array([
      ...makeRow(textId, 0.70, 78, 18, 391, 130),
      ...makeRow(titleId, 0.46, 78, 18, 391, 130),
      ...makeRow(docTitleId, 0.32, 78, 18, 391, 130)
    ])
    const regions = decodeLayout(rows, 3, 0.5)
    expect(regions).toEqual([{ x0: 78, y0: 18, x1: 391, y1: 130, label: 'text' }])
  })

  it('passes coordinates through unchanged — the graph already rescaled them', () => {
    const imageId = LAYOUT_LABELS.indexOf('image')
    const rows = new Float32Array(makeRow(imageId, 0.9, 445.4, 26.2, 1279.8, 654.5))
    const region = decodeLayout(rows, 1, 0.5)[0]
    expect(region.x0).toBeCloseTo(445.4, 1)
    expect(region.x1).toBeCloseTo(1279.8, 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ocr/paddle/__tests__/layout.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/ocr/paddle/layout.ts
import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import { Tensor } from 'onnxruntime-node'

export const LAYOUT_INPUT_SIZE = 800

export const LAYOUT_LABELS = [
  'paragraph_title', 'image', 'text', 'number', 'abstract', 'content',
  'figure_title', 'formula', 'table', 'reference', 'doc_title', 'footnote',
  'header', 'algorithm', 'footer', 'seal', 'chart', 'formula_number',
  'aside_text', 'reference_content'
] as const

const LABEL_MAP: Record<string, 'text' | 'title' | 'image'> = {
  text: 'text',
  paragraph_title: 'title',
  doc_title: 'title',
  image: 'image'
}

export interface LayoutRegion {
  x0: number
  y0: number
  x1: number
  y1: number
  label: 'text' | 'title' | 'image'
}

export const decodeLayout = (rows: Float32Array, numRows: number, threshold = 0.5): LayoutRegion[] => {
  const regions: LayoutRegion[] = []

  for (let i = 0; i < numRows; i++) {
    const base = i * 6
    const labelId = rows[base]
    const score = rows[base + 1]
    if (score < threshold) continue

    const rawLabel = LAYOUT_LABELS[labelId]
    const mappedLabel = LABEL_MAP[rawLabel]
    if (mappedLabel === undefined) continue

    regions.push({
      x0: rows[base + 2],
      y0: rows[base + 3],
      x1: rows[base + 4],
      y1: rows[base + 5],
      label: mappedLabel
    })
  }

  return regions
}

export const runLayout = async (session: InferenceSession, imagePath: string): Promise<LayoutRegion[]> => {
  const metadata = await sharp(imagePath).metadata()
  const originalWidth = metadata.width ?? 0
  const originalHeight = metadata.height ?? 0

  const { data } = await sharp(imagePath)
    .resize(LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixelCount = LAYOUT_INPUT_SIZE * LAYOUT_INPUT_SIZE
  const imageTensorData = new Float32Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    const base = i * 3
    imageTensorData[i] = data[base] / 255
    imageTensorData[pixelCount + i] = data[base + 1] / 255
    imageTensorData[pixelCount * 2 + i] = data[base + 2] / 255
  }

  const feeds = {
    image: new Tensor('float32', imageTensorData, [1, 3, LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE]),
    im_shape: new Tensor('float32', new Float32Array([LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE]), [1, 2]),
    scale_factor: new Tensor(
      'float32',
      new Float32Array([LAYOUT_INPUT_SIZE / originalHeight, LAYOUT_INPUT_SIZE / originalWidth]),
      [1, 2]
    )
  }

  const output = await session.run(feeds)
  const rowsOutput = output['fetch_name_0']
  const numRows = rowsOutput.dims[0]

  return decodeLayout(rowsOutput.data as Float32Array, numRows)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ocr/paddle/__tests__/layout.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Verify `runLayout` against the real model**

```typescript
// scratch check, not committed — run with: npx tsx <this file>
import { InferenceSession } from 'onnxruntime-node'
import { runLayout } from './src/main/ocr/paddle/layout'

const main = async (): Promise<void> => {
  const session = await InferenceSession.create('resources/models/layout.onnx')
  const regions = await runLayout(session, 'src/main/ocr/__tests__/fixtures/images/beef-three-column.png')
  console.log(regions)
}

main()
```

Expected: six regions matching the ones already recorded in the spec's Investigation section: title ~(78,18)-(391,130) label `text` (not `title` — see this task's note above), ingredients ~(66,166)-(393,434) label `text`, photo ~(445,26)-(1280,654) label `image`, step 1 ~(49,472)-(423,951) label `text`, and two step-2 regions ~(440,679)-(816,950) and ~(832,683)-(1203,950), both label `text`.

- [ ] **Step 6: Commit**

```bash
git add src/main/ocr/paddle/layout.ts src/main/ocr/paddle/__tests__/layout.test.ts
git commit -m "feat(ocr): add layout region detection against the ONNX layout model"
```

---

## Task 7: Reading order (ported recursive XY-cut)

Ported from `paddlex/inference/pipelines/layout_parsing/xycut_enhanced/utils.py`'s `projection_by_bboxes`, `split_projection_profile`, and `recursive_yx_cut` — the classical recursive XY-cut core, not the 615-line "enhanced" wrapper (`xycuts.py`) that also handles headers/footers/doc-title hierarchies/cross-references/footnotes, none of which apply to a recipe photo (per this plan's layout labels: only `text`/`title`/`image` ever appear). This plan also skips the Python source's negative-coordinate mirroring trick (used there for right-to-left text direction) since recipe pages read top-to-bottom, left-to-right.

**Files:**
- Create: `src/main/ocr/paddle/readingOrder.ts`
- Test: `src/main/ocr/paddle/__tests__/readingOrder.test.ts`

**Interfaces:**
- Consumes: `LayoutRegion` (Task 6, for the bbox shape only — this module works on plain `[x0,y0,x1,y1]` tuples so it stays testable without importing Task 6).
- Produces: `sortReadingOrder(boxes: ReadonlyArray<readonly [number, number, number, number]>): number[]` (returns an array of indices into the input, in reading order) — consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Two cases: a synthetic 2x2 grid (the classical textbook XY-cut example), and the **real region boxes measured from the beef fixture image** in the spec's Investigation section — this second case is the important one, since it's checking the port against output already verified correct, not a made-up case.

```typescript
// src/main/ocr/paddle/__tests__/readingOrder.test.ts
import { describe, it, expect } from 'vitest'
import { sortReadingOrder } from '../readingOrder'

describe('sortReadingOrder', () => {
  it('orders a simple 2x2 grid top-to-bottom, left-to-right within each row', () => {
    const boxes: Array<[number, number, number, number]> = [
      [100, 100, 200, 150], // bottom-right
      [0, 0, 100, 50],      // top-left
      [0, 100, 100, 150],   // bottom-left
      [100, 0, 200, 50]     // top-right
    ]
    const order = sortReadingOrder(boxes)
    expect(order).toEqual([1, 3, 2, 0])
  })

  it('orders the real beef-fixture layout regions as title, ingredients, image, step1, step2a, step2b', () => {
    // bboxes as measured and recorded in the 2026-10-02 spec's Investigation
    // section (PPStructureV3, use_region_detection=False)
    const boxes: Array<[number, number, number, number]> = [
      [440, 678, 816, 950],  // step2a
      [78, 17, 391, 130],    // title
      [831, 682, 1203, 950], // step2b
      [66, 165, 392, 434],   // ingredients
      [48, 472, 423, 951],   // step1
      [445, 26, 1279, 654]   // image
    ]
    const order = sortReadingOrder(boxes)
    const labels = ['step2a', 'title', 'step2b', 'ingredients', 'step1', 'image']
    const orderedLabels = order.map((i) => labels[i])
    expect(orderedLabels).toEqual(['title', 'ingredients', 'image', 'step1', 'step2a', 'step2b'])
  })

  it('returns a single index unchanged for one box', () => {
    expect(sortReadingOrder([[0, 0, 10, 10]])).toEqual([0])
  })

  it('returns an empty array for no boxes', () => {
    expect(sortReadingOrder([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ocr/paddle/__tests__/readingOrder.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/ocr/paddle/readingOrder.ts
type Box = readonly [number, number, number, number] // [x0, y0, x1, y1]

const projectionByBoxes = (boxes: Box[], axis: 0 | 1): Int32Array => {
  let maxLength = 0
  for (const box of boxes) {
    maxLength = Math.max(maxLength, box[axis], box[axis + 2])
  }
  const projection = new Int32Array(maxLength)
  for (const box of boxes) {
    const start = Math.max(0, Math.round(box[axis]))
    const end = Math.max(start, Math.round(box[axis + 2]))
    for (let i = start; i < end && i < maxLength; i++) projection[i]++
  }
  return projection
}

const splitProjectionProfile = (values: Int32Array, minGap: number): Array<[number, number]> => {
  const significant: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (values[i] > 0) significant.push(i)
  }
  if (significant.length === 0) return []

  const segments: Array<[number, number]> = []
  let segStart = significant[0]
  let prev = significant[0]
  for (let i = 1; i < significant.length; i++) {
    const idx = significant[i]
    if (idx - prev > minGap) {
      segments.push([segStart, prev + 1])
      segStart = idx
    }
    prev = idx
  }
  segments.push([segStart, prev + 1])
  return segments
}

interface IndexedBox {
  box: Box
  index: number
}

const recursiveYxCut = (boxes: IndexedBox[], res: number[], minGap: number): void => {
  if (boxes.length === 0) return

  const ySorted = [...boxes].sort((a, b) => a.box[1] - b.box[1])
  const yProjection = projectionByBoxes(ySorted.map((b) => b.box), 1)
  const yIntervals = splitProjectionProfile(yProjection, 1)
  if (yIntervals.length === 0) return

  for (const [yStart, yEnd] of yIntervals) {
    const rowBoxes = ySorted.filter((b) => b.box[1] >= yStart && b.box[1] < yEnd)
    const xSorted = [...rowBoxes].sort((a, b) => a.box[0] - b.box[0])
    const xProjection = projectionByBoxes(xSorted.map((b) => b.box), 0)
    const xIntervals = splitProjectionProfile(xProjection, minGap)
    if (xIntervals.length === 0) continue

    if (xIntervals.length === 1) {
      res.push(...xSorted.map((b) => b.index))
      continue
    }

    for (const [xStart, xEnd] of xIntervals) {
      const columnBoxes = xSorted.filter((b) => b.box[0] >= xStart && b.box[0] < xEnd)
      recursiveYxCut(columnBoxes, res, minGap)
    }
  }
}

export const sortReadingOrder = (boxes: ReadonlyArray<Box>): number[] => {
  const indexed = boxes.map((box, index) => ({ box, index }))
  const res: number[] = []
  recursiveYxCut(indexed, res, 1)
  return res
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ocr/paddle/__tests__/readingOrder.test.ts`
Expected: PASS (4 tests). If the second test (real beef-fixture boxes) fails with a different order, check first whether the title/ingredients Y-band and the image/step1 Y-band are being split correctly — the title+ingredients (x 66-392) and the image (x 445-1279) share no Y-overlap-free band on their own; they must land in the same first Y-interval (y spans roughly 17-654 for all three) and then separate on the X-cut within that band. Print `yIntervals` and `xIntervals` at each recursion level to debug.

- [ ] **Step 5: Commit**

```bash
git add src/main/ocr/paddle/readingOrder.ts src/main/ocr/paddle/__tests__/readingOrder.test.ts
git commit -m "feat(ocr): port recursive XY-cut reading order from PaddleX"
```

---

## Task 8: Assembly — group detected lines into ordered blocks

Assigns each detected text line (Task 3's boxes, each recognized via Task 5) to the layout region (Task 6) whose box contains it, orders regions via Task 7, orders lines within a region top-to-bottom, and builds the `TessBlock[]` shape `src/main/ocr/blocks.ts` already consumes — one paragraph per region (per the spec's Design: layout regions don't carry Tesseract's finer paragraph sub-structure, and `blocksToLines` already degrades gracefully to that).

**Files:**
- Create: `src/main/ocr/paddle/assemble.ts`
- Test: `src/main/ocr/paddle/__tests__/assemble.test.ts`

**Interfaces:**
- Consumes: `DetectedBox` (Task 3), `LayoutRegion` (Task 6), `sortReadingOrder` (Task 7), `TessBlock`/`TessParagraph`/`TessLine`/`OcrWord` (existing `src/main/ocr/blocks.ts`, unmodified).
- Produces: `interface RecognizedLine { box: DetectedBox; text: string; confidence: number }`, `assembleBlocks(lines: RecognizedLine[], regions: LayoutRegion[]): TessBlock[]` — consumed by Task 9 (worker pool orchestration).

- [ ] **Step 1: Write the failing test**

A region contains a line when the line's box center falls inside the region's box — simpler than DB's IoU-based assignment (which exists in the Python reference to handle partial-overlap edge cases this plan's axis-aligned, non-rotated boxes are less prone to) and sufficient for this app's non-adversarial layouts. A region with no assigned line produces no block (an empty `image` region, or a `text` region the detector found nothing in, contributes nothing — matching the existing `blocksToLines` contract where empty blocks contribute nothing).

```typescript
// src/main/ocr/paddle/__tests__/assemble.test.ts
import { describe, it, expect } from 'vitest'
import { assembleBlocks } from '../assemble'
import type { LayoutRegion } from '../layout'
import type { RecognizedLine } from '../assemble'

describe('assembleBlocks', () => {
  it('groups lines into their containing region, one paragraph per region', () => {
    const regions: LayoutRegion[] = [
      { x0: 0, y0: 0, x1: 100, y1: 100, label: 'title' },
      { x0: 0, y0: 200, x1: 100, y1: 400, label: 'text' }
    ]
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 10, x1: 90, y1: 30 }, text: 'Title line', confidence: 0.9 },
      { box: { x0: 10, y0: 210, x1: 90, y1: 230 }, text: 'Body line one', confidence: 0.9 },
      { box: { x0: 10, y0: 240, x1: 90, y1: 260 }, text: 'Body line two', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, regions)
    expect(blocks).toEqual([
      { paragraphs: [{ lines: [{ words: [{ text: 'Title line', confidence: 0.9 }] }] }] },
      {
        paragraphs: [
          {
            lines: [
              { words: [{ text: 'Body line one', confidence: 0.9 }] },
              { words: [{ text: 'Body line two', confidence: 0.9 }] }
            ]
          }
        ]
      }
    ])
  })

  it('orders lines within a region top-to-bottom regardless of input order', () => {
    const regions: LayoutRegion[] = [{ x0: 0, y0: 0, x1: 100, y1: 400, label: 'text' }]
    const lines: RecognizedLine[] = [
      { box: { x0: 10, y0: 240, x1: 90, y1: 260 }, text: 'second', confidence: 0.9 },
      { box: { x0: 10, y0: 10, x1: 90, y1: 30 }, text: 'first', confidence: 0.9 }
    ]
    const blocks = assembleBlocks(lines, regions)
    expect(blocks[0].paragraphs[0].lines.map((l) => l.words[0].text)).toEqual(['first', 'second'])
  })

  it('produces no block for an image region or a region with no assigned line', () => {
    const regions: LayoutRegion[] = [
      { x0: 0, y0: 0, x1: 100, y1: 100, label: 'image' },
      { x0: 0, y0: 200, x1: 100, y1: 300, label: 'text' } // no lines fall here
    ]
    const lines: RecognizedLine[] = []
    expect(assembleBlocks(lines, regions)).toEqual([])
  })

  it('drops a line whose center falls outside every region', () => {
    const regions: LayoutRegion[] = [{ x0: 0, y0: 0, x1: 100, y1: 100, label: 'text' }]
    const lines: RecognizedLine[] = [{ box: { x0: 500, y0: 500, x1: 600, y1: 520 }, text: 'orphan', confidence: 0.9 }]
    expect(assembleBlocks(lines, regions)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ocr/paddle/__tests__/assemble.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/ocr/paddle/assemble.ts
import { sortReadingOrder } from './readingOrder'
import type { DetectedBox } from './detect'
import type { LayoutRegion } from './layout'
import type { TessBlock } from '../blocks'

export interface RecognizedLine {
  box: DetectedBox
  text: string
  confidence: number
}

const boxCenter = (box: DetectedBox): { cx: number; cy: number } => ({
  cx: (box.x0 + box.x1) / 2,
  cy: (box.y0 + box.y1) / 2
})

const regionContains = (region: LayoutRegion, cx: number, cy: number): boolean =>
  cx >= region.x0 && cx <= region.x1 && cy >= region.y0 && cy <= region.y1

export const assembleBlocks = (lines: RecognizedLine[], regions: LayoutRegion[]): TessBlock[] => {
  const linesByRegion: RecognizedLine[][] = regions.map(() => [])

  for (const line of lines) {
    const { cx, cy } = boxCenter(line.box)
    const regionIdx = regions.findIndex((region) => region.label !== 'image' && regionContains(region, cx, cy))
    if (regionIdx !== -1) linesByRegion[regionIdx].push(line)
  }

  const order = sortReadingOrder(regions.map((r) => [r.x0, r.y0, r.x1, r.y1] as const))

  const blocks: TessBlock[] = []
  for (const regionIdx of order) {
    const regionLines = linesByRegion[regionIdx]
    if (regionLines.length === 0) continue

    const sortedLines = [...regionLines].sort((a, b) => a.box.y0 - b.box.y0)
    blocks.push({
      paragraphs: [
        {
          lines: sortedLines.map((line) => ({
            words: [{ text: line.text, confidence: line.confidence }]
          }))
        }
      ]
    })
  }

  return blocks
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ocr/paddle/__tests__/assemble.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/ocr/paddle/assemble.ts src/main/ocr/paddle/__tests__/assemble.test.ts
git commit -m "feat(ocr): assemble detected lines and layout regions into TessBlock order"
```

---

## Task 9: Worker pool — replace tesseract.js in `worker.ts`

`onnxruntime-node`'s `session.run` blocks the calling thread (CLAUDE.md's "don't block the main event loop" invariant), so each pool entry becomes a Node `worker_thread` that loads all three ONNX sessions once at startup and processes one image at a time — same `POOL_SIZE`/`acquireWorker` shape `worker.ts` already has, different primitive underneath.

**Files:**
- Create: `src/main/ocr/paddle/ocrWorkerThread.ts` (the code that runs *inside* each worker thread)
- Modify: `src/main/ocr/worker.ts` (the pool manager, runs on the main/ingestion thread)
- Test: `src/main/ocr/__tests__/worker.test.ts` (new — the previous `worker-lang.test.ts` tested a `DEFAULT_LANG` constant that no longer exists once `tesseract.js`'s per-call language switching is gone; this plan's recognizer is Cyrillic-only by construction, so there is no language parameter left to test)

**Interfaces:**
- Consumes: `runDetection` (Task 3), `runRecognition`+`loadDictionary` (Task 5), `runLayout` (Task 6), `assembleBlocks`+`RecognizedLine` (Task 8), `blocksToLines` (existing `src/main/ocr/blocks.ts`), `joinLines` (existing `src/main/ocr/postprocess.ts`).
- Produces: `runOcr(imagePath: string): Promise<OcrResult>` where `interface OcrResult { text: string; confidence: number }` — **this is the same shape `src/main/ingest/pipeline.ts` and `src/main/ipc/recipes.ts` already call**, so neither of those files needs to change. (The pre-existing `lang` parameter on `runOcr` is removed — there is only one language now; grep the codebase for every call site passing a `lang` argument and remove it as part of this task, per Modify entries below.)

**Note:** `src/main/ingest/pipeline.ts` and `src/main/ipc/recipes.ts` both currently pass a `lang` argument to `runOcr` and write it to `recipes.ocr_lang` (per the 2026-09-18 spec's language plumbing). Since this plan's recognizer has no language parameter, those two call sites need their `lang`-passing removed — check `recipes.ocr_lang`'s column usage; if nothing else depends on per-recipe language selection, the simplest change is to stop passing `lang` into `runOcr` and leave `ocr_lang` writes as a fixed literal (e.g. `'ru'`) — this is a mechanical follow-on edit, not a design decision, and should be done in this task's Step 6 once `runOcr`'s new signature is in place.

- [ ] **Step 1: Write the worker-thread entry point**

This file is the `workerData`/`parentPort` side — it never runs on the main thread.

```typescript
// src/main/ocr/paddle/ocrWorkerThread.ts
import fs from 'fs'
import path from 'path'
import { parentPort } from 'worker_threads'
import { InferenceSession } from 'onnxruntime-node'
import { runDetection } from './detect'
import { runRecognition, loadDictionary } from './recognize'
import { runLayout } from './layout'
import { assembleBlocks } from './assemble'
import { blocksToLines } from '../blocks'
import { joinLines } from '../postprocess'
import type { RecognizedLine } from './assemble'

interface Sessions {
  det: InferenceSession
  rec: InferenceSession
  layout: InferenceSession
  dict: string[]
}

let sessionsPromise: Promise<Sessions> | null = null

const loadSessions = async (modelsDir: string): Promise<Sessions> => {
  const [det, rec, layout] = await Promise.all([
    InferenceSession.create(path.join(modelsDir, 'det.onnx')),
    InferenceSession.create(path.join(modelsDir, 'rec.onnx')),
    InferenceSession.create(path.join(modelsDir, 'layout.onnx'))
  ])
  const dict = loadDictionary(fs.readFileSync(path.join(modelsDir, '..', 'eslav-dict.txt'), 'utf-8'))
  return { det, rec, layout, dict }
}

const processImage = async (sessions: Sessions, imagePath: string): Promise<{ text: string; confidence: number }> => {
  const [boxes, regions] = await Promise.all([runDetection(sessions.det, imagePath), runLayout(sessions.layout, imagePath)])

  const recognized: RecognizedLine[] = []
  for (const box of boxes) {
    const { text, confidence } = await runRecognition(sessions.rec, imagePath, box, sessions.dict)
    if (text.trim().length > 0) recognized.push({ box, text, confidence })
  }

  const blocks = assembleBlocks(recognized, regions)
  const text = joinLines(blocksToLines(blocks))
  const confidence =
    recognized.length === 0 ? 0 : recognized.reduce((sum, r) => sum + r.confidence, 0) / recognized.length

  return { text, confidence }
}

if (parentPort) {
  parentPort.on('message', (msg: { id: number; imagePath: string; modelsDir: string }) => {
    sessionsPromise ??= loadSessions(msg.modelsDir)
    sessionsPromise
      .then((sessions) => processImage(sessions, msg.imagePath))
      .then((result) => parentPort?.postMessage({ id: msg.id, result }))
      .catch((error: Error) => parentPort?.postMessage({ id: msg.id, error: error.message }))
  })
}
```

- [ ] **Step 2: Rewrite the pool manager**

```typescript
// src/main/ocr/worker.ts
import os from 'os'
import path from 'path'
import { Worker } from 'worker_threads'
import { app } from 'electron'

const POOL_SIZE = Math.max(1, Math.min(os.cpus().length - 1, 4))
const WORKER_SCRIPT = path.join(__dirname, 'paddle', 'ocrWorkerThread.js')
const MODELS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'models')
  : path.join(__dirname, '..', '..', '..', 'resources', 'models')

export interface OcrResult {
  text: string
  confidence: number
}

interface PoolEntry {
  worker: Worker
  busy: boolean
}

let pool: PoolEntry[] = []
let nextMessageId = 0
const pending = new Map<number, { resolve: (r: OcrResult) => void; reject: (e: Error) => void }>()

const buildPool = (): PoolEntry[] =>
  Array.from({ length: POOL_SIZE }, () => {
    const worker = new Worker(WORKER_SCRIPT)
    worker.on('message', (msg: { id: number; result?: OcrResult; error?: string }) => {
      const task = pending.get(msg.id)
      if (!task) return
      pending.delete(msg.id)
      if (msg.error) task.reject(new Error(msg.error))
      else if (msg.result) task.resolve(msg.result)
    })
    return { worker, busy: false }
  })

const ensurePool = (): PoolEntry[] => {
  if (pool.length === 0) pool = buildPool()
  return pool
}

export const terminateOcrPool = async (): Promise<void> => {
  if (pool.length === 0) return
  await Promise.all(pool.map((e) => e.worker.terminate()))
  pool = []
}

const acquireWorker = (): Promise<PoolEntry> => {
  return new Promise((resolve) => {
    const tryFind = (): void => {
      const entry = ensurePool().find((e) => !e.busy)
      if (entry) {
        entry.busy = true
        resolve(entry)
      } else {
        setTimeout(tryFind, 50)
      }
    }
    tryFind()
  })
}

export const runOcr = async (imagePath: string): Promise<OcrResult> => {
  const entry = await acquireWorker()
  const id = nextMessageId++
  try {
    return await new Promise<OcrResult>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      entry.worker.postMessage({ id, imagePath, modelsDir: MODELS_DIR })
    })
  } finally {
    entry.busy = false
  }
}
```

- [ ] **Step 3: Write the new worker test**

```typescript
// src/main/ocr/__tests__/worker.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: (): string => '/tmp/meal-planner-test' } }))

describe('runOcr', () => {
  afterEach(async () => {
    const { terminateOcrPool } = await import('../worker')
    await terminateOcrPool()
  })

  it('returns text and confidence for a real fixture image', async () => {
    const { runOcr } = await import('../worker')
    const result = await runOcr('src/main/ocr/__tests__/fixtures/images/pork-two-column.png')
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  }, 30000)
})
```

- [ ] **Step 4: Delete the now-obsolete test**

`DEFAULT_LANG` no longer exists — `runOcr` has no language parameter.

```bash
rm src/main/ocr/__tests__/worker-lang.test.ts
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/ocr/__tests__/worker.test.ts`
Expected: PASS (1 test; it is slow — loading three ONNX sessions inside a freshly spawned worker thread — the 30-second timeout in Step 3 accounts for that).

- [ ] **Step 6: Remove `lang` from the two call sites that still pass it**

Find them:

```bash
grep -rn "runOcr(" src/main --include="*.ts" | grep -v __tests__
```

For each match outside `worker.ts` (expected: `src/main/ingest/pipeline.ts` and `src/main/ipc/recipes.ts`), remove the second argument from the call, and change wherever `ocr_lang` was written from the removed result/parameter to the literal `'ru'`. Run that area's existing tests (e.g. `npx vitest run src/main/ipc/__tests__/recipes.detail.test.ts`) to confirm nothing else referenced the old `lang` plumbing.

- [ ] **Step 7: Commit**

```bash
git add src/main/ocr/paddle/ocrWorkerThread.ts src/main/ocr/worker.ts src/main/ocr/__tests__/worker.test.ts src/main/ingest/pipeline.ts src/main/ipc/recipes.ts
git rm src/main/ocr/__tests__/worker-lang.test.ts
git commit -m "feat(ocr): replace tesseract.js worker pool with onnxruntime-node worker_threads"
```

---

## Task 10: Regenerate fixtures and update the recorder

Mirrors the existing `npm run ocr:record` pattern, now driving the new pipeline instead of `tesseract.js`.

**Files:**
- Modify: `src/main/ocr/__tests__/record-fixtures.record.ts`
- Modify: `src/main/ocr/__tests__/fixtures/beef-three-column.blocks.json` (regenerated, not hand-edited)
- Modify: `src/main/ocr/__tests__/fixtures/pork-two-column.blocks.json` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: the same pipeline pieces Task 9's `ocrWorkerThread.ts` composes (`runDetection`, `runRecognition`+`loadDictionary`, `runLayout`, `assembleBlocks`), called directly rather than through the worker-thread/pool machinery (the recorder is a one-off script, not production ingest).

- [ ] **Step 1: Rewrite the recorder**

```typescript
// src/main/ocr/__tests__/record-fixtures.record.ts
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { describe, it } from 'vitest'
import { InferenceSession } from 'onnxruntime-node'
import { runDetection } from '../paddle/detect'
import { runRecognition, loadDictionary } from '../paddle/recognize'
import { runLayout } from '../paddle/layout'
import { assembleBlocks } from '../paddle/assemble'
import type { RecognizedLine } from '../paddle/assemble'

const FIXTURES = path.join(process.cwd(), 'src/main/ocr/__tests__/fixtures')
const MODELS_DIR = path.join(process.cwd(), 'resources/models')
const PAGES = ['beef-three-column', 'pork-two-column']

describe('record OCR fixtures', () => {
  it('regenerates block fixtures from the committed source images', async () => {
    const det = await InferenceSession.create(path.join(MODELS_DIR, 'det.onnx'))
    const rec = await InferenceSession.create(path.join(MODELS_DIR, 'rec.onnx'))
    const layout = await InferenceSession.create(path.join(MODELS_DIR, 'layout.onnx'))
    const dict = loadDictionary(fsSync.readFileSync(path.join(process.cwd(), 'resources/eslav-dict.txt'), 'utf-8'))

    for (const page of PAGES) {
      const imagePath = path.join(FIXTURES, 'images', `${page}.png`)
      const [boxes, regions] = await Promise.all([runDetection(det, imagePath), runLayout(layout, imagePath)])

      const recognized: RecognizedLine[] = []
      for (const box of boxes) {
        const { text, confidence } = await runRecognition(rec, imagePath, box, dict)
        if (text.trim().length > 0) recognized.push({ box, text, confidence })
      }

      const blocks = assembleBlocks(recognized, regions)
      await fs.writeFile(path.join(FIXTURES, `${page}.blocks.json`), `${JSON.stringify(blocks, null, 1)}\n`, 'utf-8')
      console.log(`recorded ${page}: ${blocks.length} blocks`)
    }
  })
})
```

- [ ] **Step 2: Run the recorder**

Run: `npm run ocr:record`
Expected: two `*.blocks.json` files written, one `recorded <page>: N blocks` line per page with `N` matching what Task 6 Step 6 found (6 blocks for `beef-three-column`, fewer for `pork-two-column`).

- [ ] **Step 3: Run the existing reconstruction test against the new fixtures**

Run: `npx vitest run src/main/ocr/__tests__/reconstruction.test.ts`
Expected: this file already asserts the three body columns of the beef image appear in order and that specific hyphenated words rejoin correctly (`кусоч-ками`, `бульо-на`, etc. — see the 2026-09-18 spec). If it fails, read the actual diff: a difference here means either the new pipeline's recognition genuinely differs from Tesseract's wording (expected and fine — this plan's Investigation section already shows several words changing for the better) or the new blocks are in the wrong order (not fine — revisit Task 7/8). Update the test's literal expected strings only for the former case.

- [ ] **Step 4: Run the full OCR test suite**

Run: `npx vitest run src/main/ocr`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/ocr/__tests__/record-fixtures.record.ts src/main/ocr/__tests__/fixtures/beef-three-column.blocks.json src/main/ocr/__tests__/fixtures/pork-two-column.blocks.json src/main/ocr/__tests__/reconstruction.test.ts
git commit -m "test(ocr): regenerate OCR fixtures through the ONNX pipeline"
```

---

## Task 11: Remove tesseract.js, package the models, update CLAUDE.md

**Files:**
- Modify: `package.json` (remove `tesseract.js`)
- Modify: `electron-builder` config (wherever it lives in this repo — check `electron-builder.yml` or the `build` key in `package.json`)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove `tesseract.js`**

```bash
grep -rn "tesseract.js" src/main --include="*.ts"
```

Expected: no remaining matches (Task 9 already removed every import).

```bash
npm uninstall tesseract.js
```

- [ ] **Step 2: Add the models to `extraResources`**

Find the electron-builder config:

```bash
grep -rln "extraResources\|\"build\"" package.json electron-builder.yml electron-builder.yaml 2>/dev/null
```

Add an entry so `resources/models/*.onnx` and `resources/eslav-dict.txt` end up at `process.resourcesPath` in the packaged app (matching `src/main/ocr/worker.ts`'s `MODELS_DIR` computation from Task 9 Step 2):

```yaml
extraResources:
  - from: "resources/models"
    to: "models"
  - from: "resources/eslav-dict.txt"
    to: "eslav-dict.txt"
```

(Adjust the exact YAML/JSON location and indentation to match whatever this repo's existing `extraResources`/`build` block already contains — don't duplicate an existing key, extend it.)

- [ ] **Step 3: Build and verify packaging**

```bash
npm run build
npm run dist
```

Expected: both succeed. Then inspect the packaged output's resources directory (path depends on platform — on Windows, typically `dist/win-unpacked/resources/`) and confirm `models/det.onnx`, `models/rec.onnx`, `models/layout.onnx`, and `eslav-dict.txt` are present.

- [ ] **Step 4: Update CLAUDE.md**

Replace the `tesseract.js`/Tesseract-specific entries in "Common pitfalls to avoid" that no longer apply (the `PSM.AUTO` pitfall, the `rus`-only language pitfall, the block-reconstruction pitfall referencing `blocks.ts`'s relationship to Tesseract specifically) with their ONNX-pipeline equivalents:

- The "Don't rely on tesseract.js's default page segmentation" and "Don't re-derive page layout from word geometry" entries both still apply in spirit but now point at `src/main/ocr/paddle/layout.ts` + `readingOrder.ts` instead of Tesseract's `PSM.AUTO`.
- Add: "Don't port PaddleX's full `xycut_enhanced` wrapper — `readingOrder.ts` ports only the core recursive cut (`recursive_yx_cut`), because this app's layout labels are only ever `text`/`title`/`image`, with none of the headers/footers/doc-title-hierarchy/cross-reference cases that wrapper exists for."
- Add: "Don't add `PP-DocBlockLayout` back as a second layout model — verified during the 2026-10-02 investigation that `PP-DocLayout_plus-L` alone reproduces identical reading order on both fixture images; it's a 124 MB model this app doesn't use."
- Update the stack list ("`tesseract.js` for OCR") to read "`onnxruntime-node` running exported PaddleOCR detector/recognizer/layout models for OCR".
- Update "Status" section to reflect the OCR engine swap once this plan's tasks are all merged.

- [ ] **Step 5: Run full verification**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron-builder.yml CLAUDE.md
git commit -m "build(ocr): remove tesseract.js, package ONNX models, update CLAUDE.md"
```

---

## Self-Review Notes

- **Spec coverage:** Task 0 covers model export; Tasks 1-8 cover each pipeline stage the spec's Design section lists (`tensor.ts`→shared preprocessing, `detect.ts`, `recognize.ts`, `layout.ts`, `readingOrder.ts`, `assemble.ts`); Task 9 covers the `worker_threads` pool migration; Task 10 covers the spec's Testing section (fixture regeneration, integration test); Task 11 covers packaging and the Non-goals' "no runtime model download" requirement (verified via Task 11 Step 3's packaged-output inspection) and removes `tesseract.js` per the spec's Decisions.
- **Deferred-but-flagged items carried over from the spec, now with concrete resolution steps:** which layout model is required (resolved in this plan's research — `PP-DocLayout_plus-L` alone, confirmed and written into Task 6 directly, not deferred further); exact preprocessing constants (resolved — read from the real `config.json` files and written into Tasks 3/5/6 directly); the layout ONNX model's exact output tensor shape (genuinely cannot be resolved without the exported file in hand — Task 6 Step 1 is an explicit, concrete discovery step with a documented fallback path, not a placeholder).
- **Type consistency check:** `DetectedBox` (Task 3) is the type threaded through Task 5's `runRecognition`, Task 8's `RecognizedLine.box`, and Task 9's orchestration — same shape (`x0,y0,x1,y1`) everywhere. `LayoutRegion` (Task 6) is threaded through Task 7 (as a plain tuple, to keep that module dependency-free) and Task 8 — consistent. `TessBlock`/`TessParagraph`/`TessLine`/`OcrWord` are imported from the existing `blocks.ts`, never redefined.
