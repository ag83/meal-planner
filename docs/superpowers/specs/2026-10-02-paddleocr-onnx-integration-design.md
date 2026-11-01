# Replacing tesseract.js with PaddleOCR via ONNX Runtime

**Date:** 2026-10-02
**Status:** Approved, not yet implemented
**Supersedes:** the "No engine change" non-goal in `2026-09-18-ocr-block-reconstruction-design.md`

## Problem

`2026-09-18-ocr-block-reconstruction-design.md` fixed Tesseract's reading-order and
`rus+eng`-homoglyph defects, but left several residue defects as deliberately accepted:
`ГТОматов` (lost `томат` match), `тлук-порей`, `®`/`е` standing in for `•`. That spec's
investigation evaluated PaddleOCR and EasyOCR and rejected both, reasoning that they are
"detection + recognition only" and adopting either "would discard the block segmentation this
design proves is already correct."

Upgrading `tesseract.js` 4.1.4 → 7.0.0 (branch `upgrade-tesseractjs`, committed) was tried first
as the cheap option. It fixed exactly one defect (a stray-period artifact,
`сбалансированны.м` → `сбалансированным`) and left every catalogued defect above unchanged on
the same two fixture images. This confirms the remaining quality ceiling is the Tesseract
recognition engine itself, not the JS wrapper version — which is what justifies re-opening the
engine-change question this spec supersedes.

## Investigation

All measurements below were run against the two images already committed at
`src/main/ocr/__tests__/fixtures/images/` (`beef-three-column.png`, `pork-two-column.png`), via
a throwaway Python venv (`paddleocr` 3.7.0, `paddlepaddle` 3.3.1) — no app code involved. The
venv and its downloaded models are not part of this repo.

### PaddleOCR has an official Russian/Cyrillic model

`PaddleOCR(lang="ru")` resolves to `eslav_PP-OCRv5_mobile_rec` — a recognizer trained on East
Slavic languages (Russian/Ukrainian/Belarusian), not a generic multilingual fallback. This was
the open question the 09-18 spec didn't have evidence for; it exists and is officially
distributed.

### Raw recognition quality is better, line for line

Same two fixture images, `ocr.predict()` (detection + recognition only, no layout):

| Tesseract (rus, v7) | PaddleOCR (eslav rec) | |
|---|---|---|
| `® 500 г МЯКОТИ ГОВЯДИ-` | `500 г мякоти говяди-` | bullet residue gone |
| `ны е тлук-порей е 4 зуб-` | `ны • 1 лук-порей • 4 зуб-` | `•` recognized as `•`, not `е`; `лук-порей` not `тлук-порей` |
| `чика чеснока ® 400 ГТО-` / `матов в собственном` | `чика чеснока • 4оо г то-` / `матов в собственном` | `то-`/`матов` rejoins to `томатов` under existing de-hyphenation — recovers a tag `ГТОматов` currently drops entirely. (`4оо` trades a severe defect for a minor digit/letter homoglyph — still imperfect, clearly better.) |
| `сбалансированны.м` (pre-upgrade) | `сбалансированным` | matches the post-upgrade tesseract.js fix |

Full line-by-line transcripts are in the chat history of the brainstorming session that produced
this spec; not reproduced in full here since the table above covers every defect the 09-18 spec
catalogued.

### Raw recognition has no reading order — exactly the bug already fixed once

`ocr.predict()` does detection + recognition only. On the three-column beef image it interleaves
columns on the same vertical band, e.g.:

```
2.Томаты в собственном поперчить и всыпать сахар
```

— the start of step 2 (left column) spliced with unrelated step-1 text (right column). This is
the 09-18 spec's defect 1, reintroduced. Confirms that specific non-goal's reasoning was correct
*for the raw OCR API* — but the next finding supersedes its conclusion.

### `PPStructureV3` already solves reading order, with a real (not hand-rolled) algorithm

Reading PaddleX's installed source (`paddlex/inference/pipelines/layout_parsing/pipeline_v2.py`)
shows the actual algorithm:

1. Text detection runs **once** over the whole page (`PP-OCRv5_server_det`, DB algorithm).
2. Layout detection runs **once** over the whole page (`PP-DocLayout_plus-L` and/or
   `PP-DocBlockLayout` — object-detection style, boxes + labels + scores, NMS).
3. Each detected text line is assigned to the layout region whose box contains it
   (`get_bbox_intersection` + IoU). A layout region with no assigned line falls back to
   cropping and re-recognizing it directly.
4. Regions are ordered by a **recursive XY-cut** algorithm
   (`layout_parsing/xycut_enhanced/xycuts.py`, 615 lines) — a classical, documented
   document-layout reading-order technique (recursive horizontal/vertical projection-profile
   cuts), not a black-box model and not bespoke PaddleOCR logic.
5. Lines within a region sort top-to-bottom.

Running this on the beef image produced correctly separated, correctly ordered regions:

```
block 0: text  "Говядина в соусе из лука-порея"        (title)
block 1: text  "500 г мякоти говядины • 1 лук-порей..." (ingredients)
block 2: image                                          (photo — correctly excluded from OCR)
block 3: text  "1. Говядину нарезать кусочками..."      (step 1, complete, no interleaving)
block 4: text  "2.Томаты в собственном... Посолить,"    (step 2, part a)
block 5: text  "поперчить и всыпать сахар... гарниром." (step 2, part b, same column, in order)
```

This is the real reason the 09-18 non-goal is being revisited: that spec's objection was to
*rebuilding column grouping from raw boxes* with ad hoc logic — exactly what its own `layout.ts`
had tried and failed at (`detectColumnCuts`, a single-threshold split). XY-cut is the correct
generalization of that idea to N columns, done by a long-established algorithm we can port
directly rather than reinvent.

One remaining nit: `PPStructureV3`'s convenience `content` string concatenates wrapped lines
without re-inserting a space (`собственномсоку` instead of `собственном соку`). The
implementation must read per-line results inside each region and join them the way
`blocksToLines()` already does for Tesseract — not consume the pre-joined markdown string.

### ONNX export tooling: a known, non-blocking rough edge

`paddle2onnx` 2.1.0 (latest) failed to import on this Windows machine
(`ImportError: DLL load failed... paddle2onnx_cpp2py_export`). This does not block the design:
export is a **one-time, developer-side** step that produces portable `.onnx` files to commit and
ship — it does not run on end-user machines. If Windows tooling stays broken, the export runs
once in WSL/Linux/CI instead.

### Model footprint (measured, pre-ONNX-export sizes)

Sizes of the PaddleX "inference model" directories actually needed (excludes doc-orientation
classifier, textline-orientation, and UVDoc dewarping — recipe photos are flat, not warped scans,
so these are disabled and not part of this design):

| model | size | role |
|---|---|---|
| `PP-OCRv5_server_det` | 85 MB | text detection |
| `eslav_PP-OCRv5_mobile_rec` | 7.8 MB | Cyrillic recognition |
| `PP-DocLayout_plus-L` | 125 MB | layout detection |
| `PP-DocBlockLayout` | 124 MB | layout detection |

`PPStructureV3` loaded both layout models; which one(s) the pipeline actually requires for this
design's scope (text/title/image region labels — no tables, no formulas) is not yet confirmed
and is the first implementation task, not guessed here. Worst case, bundled weight is
**~340 MB**; best case (one layout model, lighter `det` variant swapped in later)
substantially less. ONNX export typically shrinks this somewhat (no training-only ops), but the
real number is only known after export. Optimizing model choice (mobile vs. server detector,
quantization) is an explicit follow-up, not part of this design — ship the combination already
measured to work, then shrink if the installer-size cost proves unacceptable in practice.

## Decisions (made with the user during brainstorming)

- **Integration mechanism: ONNX Runtime in Node (`onnxruntime-node`), not a bundled Python
  subprocess.** Rejected the Python path explicitly even knowing it costs more engineering
  (reimplementing pre/postprocessing ourselves) because it keeps the app Electron-native with no
  Python runtime to ship, test, or version across platforms.
- **Replace `tesseract.js` entirely.** No dual-engine mode, no per-recipe engine choice, no
  settings UI for it. One pipeline to maintain, matching the existing single-pipeline shape of
  `worker.ts`. Revisit only if real-world use turns up a recipe style PaddleOCR handles worse —
  no such evidence exists today.

## Non-goals

- **No table, formula, seal, or chart recognition.** Recipe images don't have them;
  `PPStructureV3`'s modules for these are disabled in the reference pipeline this design is based
  on and have no equivalent in the ONNX reimplementation.
- **No document-orientation classification or dewarping (`UVDoc`).** Recipe photos are flat;
  this class of preprocessing is for scanned/warped documents.
- **No runtime model download.** Unlike `tesseract.js`'s traineddata (fetched over HTTPS on first
  use today), the ONNX models are fixed at build time and bundled via `electron-builder`
  `extraResources`. This is a deliberate behavior change: OCR no longer needs network access on
  first use, for any recipe, ever.
- **No bulk re-OCR / migration of existing vault rows.** Existing recipes keep their current
  `ocr_text` until individually re-run, same as every prior OCR change in this project's history.
  No `schemaVersion` bump — this design does not touch the database.
- **No model-size optimization in v1.** Ship the detector/recognizer/layout combination already
  measured to produce correct output. Swapping to lighter model variants or quantizing is a
  follow-up, done only if the ~340 MB bundle proves a real problem.

## Design

### Pipeline

```
preprocess (per-model resize/normalize)
  → text detection (ONNX, DB algorithm)         — once, whole page
  → layout detection (ONNX, NMS)                — once, whole page
  → assign lines to regions (bbox intersection)
  → order regions (ported XY-cut)
  → order lines within a region (top-to-bottom)
  → text recognition (ONNX, CTC decode)         — once per detected line crop
  → assemble into TessBlock[] shape
blocksToLines(blocks)      UNCHANGED — src/main/ocr/blocks.ts
joinLines(lines)           UNCHANGED — src/main/ocr/postprocess.ts
```

`blocksToLines` and `joinLines` are untouched because the new pipeline's final step produces the
same `TessBlock { paragraphs: { lines: { words: { text, confidence } } } }` shape Tesseract's
`recognize()` already produced. Everything downstream of block assembly — de-hyphenation,
paragraph joining, `tags/matcher.ts` — needs zero changes. This is the design's central property:
only the "turn an image into ordered blocks" boundary changes.

**Paragraph granularity is coarser than Tesseract's.** Tesseract returns explicit paragraphs
within a block; the layout-region model does not. Each layout region of label `text` or `title`
is treated as exactly one paragraph. `blocksToLines` already inserts a blank separator between
blocks regardless of paragraph count per block, so this degrades gracefully — recipes read as
slightly larger paragraph units than before, with no code change required to accept that.

### Module layout

| file | responsibility |
|---|---|
| `src/main/ocr/paddle/detect.ts` | DB-detector ONNX inference + box decode (binarize probability map → contours → unclip-expand → quad boxes) |
| `src/main/ocr/paddle/recognize.ts` | per-line-crop ONNX inference + CTC greedy decode against the `eslav` character dictionary |
| `src/main/ocr/paddle/layout.ts` | layout-model ONNX inference + NMS → labeled region boxes (`text` / `title` / `image`, others ignored per Non-goals) |
| `src/main/ocr/paddle/readingOrder.ts` | ported XY-cut: orders region boxes into reading order |
| `src/main/ocr/paddle/assemble.ts` | bbox-intersection assignment of detected lines into regions; builds `TessBlock[]` |
| `src/main/ocr/paddle/preprocess.ts` | per-model resize/pad/normalize (detector, recognizer, and layout model each have distinct input requirements — exact resize/normalize constants come from each model's shipped `inference.yml`/`config.json`, read during implementation, not guessed here) |
| `resources/eslav-dict.txt` | recognizer's character set for CTC decode, bundled the way `seed-tags.yaml` already is |
| `resources/models/*.onnx` | exported model weights, bundled via `electron-builder` `extraResources` |
| `src/main/ocr/worker.ts` | rewritten: orchestrates the pipeline above inside a `worker_threads` pool, replacing all `tesseract.js` calls |
| `src/main/ocr/blocks.ts` | unchanged |
| `src/main/ocr/postprocess.ts` | unchanged |
| `src/main/ocr/preprocess.ts` (existing `sharp` one) | unchanged — the pre-detection image prep (upscale/greyscale/normalize) stays; the new `ocr/paddle/preprocess.ts` is per-model tensor prep layered on top |

### Worker pool moves from tesseract.js's workers to Node `worker_threads`

CLAUDE.md's standing invariant — don't block the main event loop with synchronous OCR — is
currently satisfied by tesseract.js's own worker pool. `onnxruntime-node`'s `InferenceSession.run`
blocks the calling thread (it's internally multi-threaded for a single inference, not
non-blocking for the caller), so the pool primitive changes: each pool entry becomes a Node
`worker_thread` that loads all ONNX sessions once at startup (session creation is the expensive
part) and processes one image at a time, mirroring today's `POOL_SIZE` / `acquireWorker` shape in
`worker.ts` with a different underlying primitive.

### Model export (developer-side, one-time)

`paddle2onnx` against the cached PaddleX "inference model" files (`inference.json` +
`inference.pdiparams`) for the detector, recognizer, and whichever layout model(s) implementation
confirms are required. Run in WSL/Linux/CI if Windows tooling stays broken (see Investigation).
Exported files and the `eslav` character dictionary get committed to `resources/models/` and
`resources/eslav-dict.txt` respectively. Exact dictionary file location inside the PaddleX model
package is an implementation-time lookup, not researched here.

### Reading-order port

Direct TypeScript port of `xycut_enhanced/xycuts.py` (615 lines in the Python source) — the
single highest-line-count, highest-fidelity-risk piece of new code in this design. Verified
correct by construction (it's a direct port of working reference code), not reinvented.

## File structure

| file | change |
|---|---|
| `src/main/ocr/paddle/detect.ts` | new |
| `src/main/ocr/paddle/recognize.ts` | new |
| `src/main/ocr/paddle/layout.ts` | new |
| `src/main/ocr/paddle/readingOrder.ts` | new |
| `src/main/ocr/paddle/assemble.ts` | new |
| `src/main/ocr/paddle/preprocess.ts` | new |
| `src/main/ocr/worker.ts` | rewritten — orchestrates the ONNX pipeline via `worker_threads`, no more `tesseract.js` |
| `src/main/ocr/blocks.ts` | unchanged |
| `src/main/ocr/postprocess.ts` | unchanged |
| `src/main/ocr/preprocess.ts` | unchanged |
| `resources/eslav-dict.txt` | new |
| `resources/models/*.onnx` | new |
| `src/main/ocr/__tests__/paddle/*.test.ts` | new — unit tests per algorithmic module (see Testing) |
| `src/main/ocr/__tests__/fixtures/*.blocks.json` | regenerated against the new pipeline (same `TessBlock` shape, same two committed images) |
| `src/main/ocr/__tests__/record-fixtures.record.ts` | rewritten to drive the ONNX pipeline instead of `tesseract.js` |
| `package.json` | remove `tesseract.js`; add `onnxruntime-node` |
| `electron-builder` config | add `resources/models/` to `extraResources` |
| `CLAUDE.md` | replace the `tesseract.js`/Tesseract-specific pitfalls with ONNX-pipeline equivalents once implemented |

## Testing

1. **Unit, per new algorithmic module** — these are the parts with real correctness risk, each
   gets isolated tests against known input/output:
   - DB box decode: a synthetic probability map → expected quad boxes.
   - CTC decode: a synthetic logits array → expected decoded string, including repeated-character
     collapsing.
   - Layout NMS: overlapping synthetic boxes → expected surviving set.
   - XY-cut ordering: the exact region boxes measured from the beef fixture image (recorded during
     this investigation) → the exact order already observed (title, ingredients, image, step 1,
     step 2a, step 2b). This is the most important test in the set — it's checking the port
     against a real, already-verified reference output, not a made-up case.
   - Bbox-assignment: synthetic detected lines + regions → expected grouping, including a region
     with no assigned line.
2. **Integration** — same pattern as today: `npm run ocr:record`-equivalent regenerates
   `*.blocks.json` fixtures from the two committed real images via the actual ONNX pipeline;
   `reconstruction.test.ts`-equivalent exercises the real composition (preprocessing → detect →
   layout → assemble → order → recognize → `blocksToLines` → `joinLines`) against those fixtures.
3. **Packaging** — `npm run dist` must produce an installer that launches and runs OCR with no
   network access (verifies the "no runtime model download" non-goal is actually true, not just
   intended).
4. **Performance** — no numeric target exists yet; this design does not set one. Implementation
   should measure per-image latency against the current tesseract.js pool as a sanity check
   (multiple model passes per image vs. one), and flag to the user if it regresses ingest UX
   noticeably. Not a blocking gate for this spec.

## Risks

- **XY-cut port fidelity.** The biggest single risk. Mitigated by testing directly against the
  real reference ordering already measured from the beef fixture, not synthetic cases alone.
- **Bundle size (~340 MB worst case).** Installer size and first-install disk/download cost grow
  substantially. Accepted for v1 per Non-goals; revisit with lighter model variants if it proves a
  real problem in practice.
- **`paddle2onnx` Windows tooling is flaky.** Developer-time inconvenience only (see
  Investigation); mitigated by exporting via WSL/Linux/CI.
- **Which layout model(s) are actually required is unconfirmed.** `PPStructureV3` loads both
  `PP-DocBlockLayout` and `PP-DocLayout_plus-L`; implementation starts by reading
  `pp_structurev3.py`'s wiring to confirm the minimal set before spending export effort on both.
- **`onnxruntime-node` + `worker_threads` is a new concurrency combination for this codebase.**
  No prior art here to lean on (tesseract.js managed its own worker pool internally). Testing must
  verify the main thread is never blocked, matching the existing CLAUDE.md invariant.
- **Model-level preprocessing constants (resize limits, normalization mean/std, NMS thresholds)
  are not yet extracted from the shipped model configs.** Implementation reads them from each
  model's `inference.yml`/`config.json` rather than guessing from PaddleOCR documentation, which
  may lag the actual shipped model version.
