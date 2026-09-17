# CLAUDE.md

Guidance for future Claude Code sessions working in this repo. Read `docs/SPECS.md` and `docs/IMPLEMENTATION_PLAN.md` for the full picture; this file is the quick orientation.

## What this is

**Meal Planner** — a local-first Electron + React + Tailwind desktop app. Users add recipes as photos; the app OCRs them, **auto-extracts tags** from a curated Russian-first dictionary, and offers tag-based search via a multi-select combobox.

No server, no accounts, no telemetry. Everything lives in the vault folder the user picks on first run. **Russian-first**: OCR defaults to `rus+eng`, tag library and matching are morphology-aware (Snowball Russian stemmer).

## Stack at a glance

- **Electron** (main + preload + renderer, strict isolation)
- **React 19 + TypeScript**, **Tailwind v4**, Radix primitives, lucide icons
- **[electron-vite](https://electron-vite.org/)** for the build (main / preload / renderer all bundled via Vite)
- **better-sqlite3** — relational storage for recipes, tags, aliases, recipe_tags
- **tesseract.js** for OCR (worker pool in main, default `rus+eng`)
- **`natural`** (`PorterStemmerRu`) for Russian stemming; `Intl.Segmenter` for Unicode word boundaries
- **`js-yaml`** for parsing the bundled `resources/seed-tags.yaml`
- **sharp** for thumbnails and image dimensions
- **Zustand** for renderer state, **React Router** for screens
- **@tanstack/react-virtual** for the gallery grid

## Repo layout (target — see IMPLEMENTATION_PLAN §1)

```
src/
  main/      # Electron main: IPC, DB, OCR, ingestion, vault management
  preload/   # contextBridge → window.api
  renderer/  # React UI (gallery, detail, settings, first-run)
docs/        # SPECS.md, IMPLEMENTATION_PLAN.md
```

The renderer never touches `fs`, `path`, sqlite, or `child_process`. All side effects go through IPC.

## Commands (once Phase 1 is bootstrapped)

```bash
npm run dev         # electron-vite dev with HMR
npm run build       # type-check + bundle
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest
npm run dist        # electron-builder, current platform
```

Until Phase 1 lands, `package.json` is a stub — don't run scripts expecting them to exist.

## Conventions

- **TypeScript everywhere**; no `.js` in `src/`.
- **Named arrow functions, not `function` declarations**: `const foo = (x: T): R => { ... }`, including default-exported components (`const Foo = (): React.JSX.Element => {...}; export default Foo`). No `function`/`async function` declarations or anonymous `function` expressions anywhere in `src/`.
- **IPC is the only main↔renderer channel**. Add new handlers in `src/main/ipc/<domain>.ts` and mirror the type in `src/preload/api.d.ts`. Renderer imports the typed `window.api` only.
- **Electron security non-negotiables**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the renderer, CSP header set in the main window. Never relax these without a written justification.
- **DB writes go through prepared statements**, wrapped in a transaction when touching > 1 row.
- **Vault paths**: never persist absolute paths inside `recipes` rows — store the id/ext and reconstruct paths from the current vault root. (Survives folder-rename and OS-reinstall.)
- **No comments narrating WHAT** — code names should carry that. Comment WHY only when it's non-obvious.

## Git workflow

### Branching — GitHub Flow

**`develop` is the trunk.** It is always in a working, releasable state: `typecheck`,
`lint`, `test` and `build` all pass on every commit. `master` holds released snapshots
only.

1. Branch off `develop` for any change — feature, fix, docs, chore alike.
2. Commit in small steps, pushing early so the work is visible.
3. Open a PR back into `develop` when ready for review.
4. Merge once green, then delete the branch.
5. Release by merging `develop` into `master` and tagging.

- **Never commit directly to `develop` or `master`** — always branch first, even for a
  one-line fix.
- Branch names are kebab-case and describe the outcome, no type prefix required:
  `ocr-reading-order`, `thumbnail-crash-fix`, `tag-rule-corrections`.
- Branches are **short-lived** — hours or days, not weeks. A long-running branch means
  the change should have been split.
- Merge with `--no-ff` so the branch boundary stays visible in history.
- Tag releases on `master` as `v<major>.<minor>.<patch>`, matching `package.json`.

There are no `release/*` or `hotfix/*` branches. An urgent fix is just another short
branch off `develop`, merged and released the same way.

### Commit messages — Conventional Commits

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **Type** — one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scope** — optional, the area touched. This repo's usual scopes: `ocr`, `tags`, `db`, `ipc`, `vault`, `ui`, `seed`.
- **Subject** — imperative mood, lower case, no trailing period, ≤ 72 chars.
- **Body** — the *why*, not the what. Wrap at 72 columns.
- **Breaking changes** — append `!` after the type/scope and add a `BREAKING CHANGE:` footer. A `schemaVersion` bump is always breaking.

```
feat(ocr): reconstruct column order from word geometry

tesseract.js defaults to PSM 6, which does no layout analysis and reads
multi-column pages straight across the columns.

fix(tags): stop печень matching Десерт via the печенье stem
docs(claude): record the OCR page-segmentation invariant
feat(db)!: add tag_aliases.match_mode

BREAKING CHANGE: schemaVersion 1 → 2; older builds refuse the vault.
```

- Keep the `Co-Authored-By:` trailer on assistant-authored commits.
- One logical change per commit; do not mix a refactor with a behaviour change.

## Data flow cheatsheet

1. User drops images on the gallery → renderer collects paths → `window.api.recipes.ingest(paths)`.
2. Main ingestion pipeline: hash → dedupe → copy to `pictures/` → thumb to `thumbs/` → OCR (2× upscale → PSM 3 → `ocr/layout.ts` reorders columns → `ocr/postprocess.ts` de-hyphenates) → **`tags/matcher.ts` extracts tag IDs** → INSERT `recipes` + `recipe_tags` → emit `ingest:progress`.
3. Renderer listens for `ingest:progress`, `vault:changed`, `tags:changed` to refresh the relevant stores.
4. Search: user types in the `TagCombobox` → IPC `tags.suggest(prefix)` returns canonical tags (label only, never aliases) → user picks tags → `useTagFilterStore` holds selected IDs → IPC `recipes.filterByTags(ids, mode)` returns the filtered gallery. **AND is the default** mode; OR is a toggle.

## Tag search (SPECS §7)

- Tags are first-class. `tags` rows are canonical concepts (one label per concept); `tag_aliases` rows are all the recognized forms (lemmas) that resolve to a tag.
- **The dropdown shows only `tags.label`** — alias matches are silent. Typing `том` returns `Помидор` because `томат` is an alias, but the user never sees the word `томат` in the dropdown.
- All normalization (lowercase, NFC, ё→е, `Intl.Segmenter` word split, `PorterStemmerRu` stem) goes through **one** module: `src/main/tags/normalize.ts`. Do not duplicate this logic — every code path that handles Russian text for matching must call it.
- Multi-word ingredients (`оливковое масло`, `болгарский перец`) are stored as space-joined stems in `tag_aliases.lemma`. The ingest matcher scans 1–3-token sliding windows over the stemmed OCR stream.
- **No FTS5 in v1.** `ocr_text` is retained on `recipes` for display and the v2 free-text feature.

## What lives where in the vault

```
<vault>/meal-planner.db        # SQLite (with -wal/-shm in WAL mode)
<vault>/pictures/<id>.<ext>    # originals (id = nanoid(12))
<vault>/thumbs/<id>.webp       # 512px webp thumbs
<vault>/vault.json             # { schemaVersion, createdAt, appVersion }
```

The `vault.json` `schemaVersion` is the source of truth for migrations — bump it in `main/db/migrations.ts` when you change the schema.

## Schema cheatsheet (SPECS §6)

- `recipes` — one row per recipe; holds `ocr_text` (display + v2), `sha256` (dedupe), and metadata.
- `tags` — canonical concepts. `label` is the UI text. `kind` ∈ `ingredient | dish_type | cuisine | user`. `source` ∈ `builtin | user`. Built-in rows are flagged `disabled`, never deleted.
- `tag_aliases` — every recognized form (already stemmed) that resolves to a tag. `is_primary=1` for the one that matches the canonical label. Multi-word aliases stored as space-joined stems. `match_mode` ∈ `stem | exact`; `exact` rows are matched against the raw normalized surface (no stemming) and exist for words the stemmer collapses onto a homonym.
- `recipe_tags` — M:N. `source` ∈ `ocr | user`. `confidence` is normalized occurrence weight at ingest (1.0 for user-set).
- `recipe_tag_suppressions` — per-recipe "don't re-add this OCR tag on re-OCR." Written when a user removes an OCR-extracted chip.

Seed re-application on upgrade is **strictly additive**: insert missing built-in slugs/aliases; never overwrite, delete, or re-enable user-disabled rows.

## Common pitfalls to avoid

- **Don't import `better-sqlite3` or `sharp` in the renderer** — they're native modules and only work in main. The renderer will compile fine and crash at runtime.
- **Don't use `file://` URLs** for thumbnails — register a custom protocol (`recipe-thumb://<id>`) in main so the renderer's strict CSP and origin rules don't fight you.
- **Don't block the main event loop** with synchronous OCR — use the tesseract.js worker pool.
- **Don't trust paths from the renderer**. Every IPC handler that takes a path validates it stays within the current vault root.
- **Don't store user OCR-text edits as part of `ocr_text`** if you want "Re-run OCR" to be non-destructive — keep `ocr_text` (machine) separate from `notes` (human). Current schema follows this.
- **Don't show alias surface forms in the UI.** The dropdown, the chips, the tag library — all display `tags.label`. Aliases are an implementation detail of matching. (See SPECS §3.4 FR-S2.)
- **Don't write a second Russian normalizer.** Every code path that compares Russian text against the tag library must go through `src/main/tags/normalize.ts`. Duplicating the rules (a stemmer call here, a `ё→е` there) silently breaks recall.
- **Don't rely on tesseract.js's default page segmentation.** It ships `PSM.SINGLE_BLOCK` (6), which performs no page layout analysis and reads multi-column pages straight across the columns. `src/main/ocr/worker.ts` sets `PSM.AUTO` (3) explicitly. Never remove that call.
- **Don't put OCR text repair in `tags/normalize.ts`.** De-hyphenation and line joining live in `src/main/ocr/postprocess.ts`, upstream of both display and matching, so the single-normalizer rule survives.
- **Don't verify OCR changes with unit tests alone.** `layout.ts` and `postprocess.ts` each passed their own tests while their *composition* produced one run-on paragraph. Run real screenshots end to end before believing an OCR change works.
- **Don't assume a stem uniquely identifies a word.** `печень` (liver) and `печенье` (cookie) both stem to `печен`; `сладкий` and `сладкое` both to `сладк`. When a seed alias collides with a common word, move it to `exact_aliases` (matched verbatim) rather than deleting it.
- **Migration v6 hard-deletes 13 builtin ingredient tags** (`garlic, carrot, tomato_paste, beet, fish, butter, oil, flour, sugar, rice, pasta, bread, dill`) instead of disabling them — a deliberate, one-off exception to the disable-don't-delete rule below, made at explicit user request with full awareness it destroys `recipe_tags` history for those tags on existing vaults. Картофель, Лук, Бекон, Петрушка, and Дрожжи were on the original candidate list too but were kept at explicit user request (across two rounds of follow-up) despite not being part of the curated 55-word list. Don't treat any of this as a new default: every other retirement (Соль, Соус, Чёрный перец, and any future one) should still disable, not delete.
- **Don't re-add bare `перец`, bare `масло`, or a `Соль` tag to the seed.** All three were removed deliberately: unqualified `перец` means Чёрный перец (Болгарский перец requires `сладкий`/`болгарский`), unqualified `масло` matches nothing so it cannot swallow `оливковое масло`, and Соль appears in nearly every recipe so it carries no filtering value. See migration v3.
- **Editing `resources/seed-tags.yaml` cannot remove anything from an existing vault.** The seed loader is additive by design, so deletions and alias re-assignments need a migration that disables the old `source='builtin'` rows. After a rules change, users must run **Retag all** in Settings for existing recipes to pick it up.
- **Don't delete built-in tags or aliases on seed re-apply.** Only insert missing ones; respect `disabled` flags. User trust depends on this.

## When making changes

- Schema change → bump `schemaVersion` in `vault.json`, add a migration, write a test that runs old → new on a fixture vault.
- New IPC handler → add to `preload/api.d.ts`, validate inputs, write a Vitest unit for the main-side handler.
- New UI screen → add a route, lazy-load it, follow the existing Tailwind + Radix patterns.
- Touching `tags/normalize.ts` → assume **every existing alias and recipe tag becomes stale**. Add a migration that re-normalizes `tag_aliases.lemma` and triggers a re-tag run, or leave the algorithm alone.
- Adding to `resources/seed-tags.yaml` → add slug + canonical label + aliases (raw surface forms; the seed loader stems them). Pick a stable slug; aliases can change, slug cannot.

## Status

**Phase 2 complete.** Vault lifecycle is fully wired.

- Cold start with no config → First Run screen (folder picker).
- Pick empty folder → `vault.json` + `pictures/` + `thumbs/` created, config saved to `userData/config.json`, navigates to Gallery.
- Restart → vault loaded from config, navigates directly to Gallery.
- Pick existing Meal Planner folder → adopted cleanly (subdirs ensured, VaultInfo returned).
- Gallery has a "Switch vault" link that re-opens the picker.

All scripts pass: `typecheck`, `lint`, `build` (main 4.6 kB, preload 0.6 kB, renderer 781 kB + 10 kB CSS).

Next: **Phase 3** — DB schema, migrations, tag seed, reconciliation.

## Gotchas found in Phase 1

- `@electron-toolkit/tsconfig/tsconfig.node.json` uses `moduleResolution: node` but `@tailwindcss/vite` ships `.d.mts`. Override with `"moduleResolution": "bundler"` in `tsconfig.node.json`. Already done.
- `@electron-toolkit/eslint-config-ts` and `@electron-toolkit/eslint-config-prettier` are legacy `.eslintrc` format — not usable in ESLint 9 flat config. Replaced with `typescript-eslint` v8 meta-package + `eslint-plugin-react` + `eslint-plugin-react-hooks`. See `eslint.config.mjs`.
- React 19 removed the global `JSX` namespace. Use `React.JSX.Element` for explicit return types (or omit the return type and let TypeScript infer). Already applied to `App.tsx`.

## Gotchas found in Phase 2

- `src/shared/api.d.ts` and `src/preload/index.d.ts` must both end with `export {}` to be treated as modules, making `declare global { interface Window { ... } }` a proper ambient augmentation.
- The node tsconfig has no DOM lib, so `Window.electron` is not visible in the preload's `else` branch (non-`contextIsolation` fallback). One `@ts-expect-error` on that line is correct and intentional — do not remove it.
- `@ts-expect-error` (unlike `@ts-ignore`) causes a compile error if the suppressed line has NO type error. Use `@ts-ignore` only to silence; use `@ts-expect-error` when you want TypeScript to enforce that the line IS erroneous.
- **Do NOT import `@electron-toolkit/preload` in the preload script.** It is listed in `dependencies` and gets externalized by `externalizeDepsPlugin`, which means the bundled preload tries `require('@electron-toolkit/preload')` at runtime. In `sandbox: true` mode, `require` of npm packages fails silently inside a `try/catch`, leaving `window.api` undefined in the renderer. The preload only imports `contextBridge` and `ipcRenderer` from `'electron'` — both are always available as Electron built-ins.
