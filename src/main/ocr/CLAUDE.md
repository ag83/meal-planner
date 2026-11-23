# CLAUDE.md — OCR

OCR-specific guidance, split out of the root `CLAUDE.md`. Read that first for the overall picture.

## Engine

`onnxruntime-node` running exported PaddleOCR detector / `eslav` recognizer / layout models (`resources/models/`, bundled via `extraResources`). tesseract.js was replaced by this pipeline (2026-10); see `docs/superpowers/specs/2026-10-02-paddleocr-onnx-integration-design.md`.

## Pipeline

`ocr/paddle/`: DB detection + layout regions → XY-cut reading order → per-line CTC recognition → `assembleBlocks` → `ocr/blocks.ts` → `ocr/postprocess.ts` de-hyphenates. The output feeds `tags/matcher.ts` during ingestion.

## Pitfalls

- **Don't block the main event loop** with synchronous OCR — use the `worker_threads` pool in `ocr/worker.ts`.
- **Reading order comes from layout regions, not word geometry.** `ocr/paddle/layout.ts` finds `text`/`title`/`image` regions, `readingOrder.ts` orders them (ported recursive XY-cut), `assemble.ts` drops each detected line into its region. Don't flatten this and rebuild columns from line boxes — an earlier design did that and glued adjacent columns.
- **Detector input must be upscaled to a ≥1600px long side** (`detectionInputSize` in `paddle/detect.ts`). At 960 and 1280px the ~16px gutter between columns bridged into one wide box per row, whose centre fell outside every region and silently dropped the line. Don't "restore" the config.json `resize_long=960`.
- **The recognizer is Cyrillic-only by construction** (`resources/eslav-dict.txt`); there is no language parameter. `recipes.ocr_lang` is written as the fixed `OCR_LANG` (`'ru'`). Latin look-alikes still appear in stylised text (`B coyce` for `в соусе`).
- **Known OCR residue, deliberately not fixed:** stylised titles read with Latin look-alikes; `4оо` for `400` (Cyrillic о); bullets `•` are recognised but dropped by `tokenize` (single-character tokens).
- **Don't port PaddleX's full `xycut_enhanced` wrapper.** `readingOrder.ts` ports only the core recursive cut — this app's layout labels are only `text`/`title`/`image`, with none of the header/footer/doc-title/footnote cases the wrapper handles. It rounds boxes at entry: layout output is fractional and unrounded boxes fall out of their own projection interval.
- **Don't add `PP-DocBlockLayout` back as a second layout model.** `PP-DocLayout_plus-L` alone gives identical reading order on both fixtures; the other is 124 MB this app doesn't use.
- **Don't change `blocks.ts` confidence handling to suit the new engine.** `assemble.ts` rescales the recognizer's 0–1 probabilities to the 0–100 scale `DEFAULT_MIN_CONFIDENCE` expects.
- **Don't put OCR text repair in `tags/normalize.ts`.** De-hyphenation and line joining live in `src/main/ocr/postprocess.ts`, upstream of both display and matching, so the single-normalizer rule survives.
- **Don't verify OCR changes with unit tests alone.** The former `layout.ts` and `postprocess.ts` each passed their own tests while their *composition* produced one run-on paragraph. `src/main/ocr/__tests__/reconstruction.test.ts` now exercises the real composition against recorded fixtures; run `npm run ocr:record` and re-check them after any change to detector sizing, layout, assembly, or the models.
