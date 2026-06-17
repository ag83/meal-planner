# Meal Planner — Implementation Plan

## 0. Stack decision

| Concern | Choice | Why |
|---|---|---|
| Shell | **Electron** (latest LTS) | required by spec |
| Bundler | **[electron-vite](https://electron-vite.org/)** | official Vite-based toolchain for Electron (main + preload + renderer), HMR for renderer, fast main/preload builds, TS out of the box |
| UI | **React 19** + **TypeScript** | latest stable; `use()`, ref-as-prop, async transitions — useful for our IPC-heavy renderer |
| Styling | **Tailwind CSS v4** | required; v4 has zero-config and faster builds |
| Headless UI | **Radix UI** primitives + **shadcn/ui**-style components | accessible, unstyled, pairs cleanly with Tailwind |
| Icons | **lucide-react** | tree-shakable, matches shadcn |
| State | **Zustand** | tiny, no boilerplate, fine for this scope |
| Routing | **React Router** (data router) | gallery / detail / settings is enough screens to want it |
| DB | **better-sqlite3** | sync API in main process, FTS5, blazing fast |
| Schema migrations | hand-rolled (`PRAGMA user_version`) | trivial schema; no need for a tool |
| OCR | **tesseract.js** | pure JS, offline once language pack cached, MIT |
| Image handling | **sharp** | thumbnails, dimensions, EXIF strip |
| File hashing | Node `crypto.createHash('sha256')` | no dep |
| IDs | **nanoid** | URL-safe, collision-resistant at 12 chars |
| Russian stemming | **`natural`** (`PorterStemmerRu`) | Snowball Russian, drives the tag matching pipeline (SPECS §7) |
| Stronger morphology (optional) | **`az.js`** | Full Russian morphology if Snowball stem proves too aggressive |
| Tokenization | `Intl.Segmenter` (built-in) | Unicode-correct Russian word boundaries, no dep |
| Seed loader | **`js-yaml`** | parses `resources/seed-tags.yaml` at first-run and on upgrade |
| Drag & drop | native HTML5 + `electron`'s `webContents` paths | no dep |
| Virtualization | **@tanstack/react-virtual** | required for 1k+ thumbnails |
| Testing | **Vitest** (unit) + **Playwright** (E2E via `electron-playwright`) | standard combo |
| Linting / format | **ESLint** + **Prettier** + `eslint-config-prettier` | standard |
| Packaging | **electron-builder** | nsis/dmg/AppImage out of the box |
| Logging | **electron-log** | rotating file logs in userData |

> **Sharp on Electron**: needs `npm rebuild --runtime=electron --target=<ver>`. electron-builder handles this via `app/` install, but expect a one-time setup wrinkle.

> **HEIC**: defer. Add `heic-convert` later behind a feature flag.

---

## 1. Repo layout (target)

```
meal-planner/
  package.json
  electron.vite.config.ts
  tsconfig.json  tsconfig.node.json
  tailwind.config.ts  postcss.config.cjs
  src/
    main/                   # Electron main process
      index.ts              # app lifecycle, window creation
      ipc/                  # one file per domain (vault, recipes, tags, settings)
      db/
        connection.ts       # better-sqlite3 singleton per vault
        schema.sql
        migrations.ts
      ocr/
        worker.ts           # tesseract worker pool
      tags/
        normalize.ts        # single source of truth for stemming/normalization (SPECS §7.1)
        matcher.ts          # 1..3-token window matcher for ingest (SPECS §7.2)
        seed.ts             # loads resources/seed-tags.yaml, additive upsert
      ingest/
        pipeline.ts         # hash → copy → thumb → ocr → extractTags → insert
      vault/
        manager.ts          # pick / open / reconcile
      services/
        thumbnailer.ts      # sharp wrapper
        hasher.ts
        logger.ts
    preload/
      index.ts              # contextBridge: window.api
      api.d.ts              # shared types
    renderer/
      index.html  main.tsx  app.tsx
      routes/
        gallery.tsx  detail.tsx  settings.tsx  first-run.tsx
      components/
        Gallery/ TagCombobox/ TagChips/ RecipeCard/ Lightbox/ ...
      stores/
        useRecipesStore.ts  useTagFilterStore.ts  useSettingsStore.ts
      lib/
        ipc.ts              # typed wrapper over window.api
      styles/
        index.css
  resources/
    seed-tags.yaml          # Russian-first canonical tag library (SPECS §7)
    icons/  splash/
  docs/
    SPECS.md  IMPLEMENTATION_PLAN.md
  CLAUDE.md
```

---

## 2. Phased delivery

Each phase ends with something runnable. Don't move on until acceptance criteria pass.

### Phase 1 — Bootstrap (½ day)
- Scaffold with the official electron-vite starter: `npm create @quick-start/electron@latest meal-planner -- --template react-ts` (see https://electron-vite.org/guide/).
- Pin React to **19.x** (`react`, `react-dom`) and `@types/react`, `@types/react-dom` to the matching v19 line. Verify Radix UI is on a version that declares React 19 in `peerDependencies` (Radix ≥ 1.1.x).
- Add Tailwind v4 (`@tailwindcss/vite` plugin in `electron.vite.config.ts`), Radix primitives scaffolding, ESLint/Prettier, Vitest.
- CI-style scripts: `dev`, `build`, `lint`, `typecheck`, `test`.
- **Acceptance**: `npm run dev` opens an Electron window rendering a Tailwind-styled placeholder; `react` resolves to a 19.x version in the renderer; no `peer dep` warnings about React 19 mismatch.

### Phase 2 — Vault lifecycle (1 day)
- First-run screen: "Pick folder" / "Open existing folder".
- `vault/manager.ts`: validate, create layout (`pictures/`, `thumbs/`, `vault.json`).
- Persist `vaultPath` in `config.json` (Electron `userData`).
- "Switch vault" in Settings; app restarts internal state on switch.
- **Acceptance**: cold start with no config → wizard. Pick empty folder → layout created. Restart → loads same vault. Pick a previously-used folder on another fake "machine" → adopted cleanly.

### Phase 3 — DB + tag seed + reconciliation (1 day)
- better-sqlite3 connection per vault, WAL mode, foreign keys on.
- Schema (SPECS §6: `recipes`, `tags`, `tag_aliases`, `recipe_tags`, `recipe_tag_suppressions`), migrations via `user_version`.
- `tags/normalize.ts` implemented and unit-tested (NFC, lowercase, ё→е, Intl.Segmenter, PorterStemmerRu).
- `tags/seed.ts` parses `resources/seed-tags.yaml`, stems aliases via the same `normalize.ts`, additive upsert (never destroys user data; flags only).
- Reconcile on open: files-without-row → queue for ingest; rows-without-file → mark missing.
- **Acceptance**: tests for migration upgrade, reconcile both directions, seed idempotency (run twice → no duplicates), normalization round-trip (`Помидоры` → `помидор`).

### Phase 4 — Ingestion pipeline with tag extraction (2 days)
- Drag-and-drop zone + "Add recipe" button + folder import.
- Pipeline in main, progress events streamed to renderer.
- Tesseract worker pool (size = `os.cpus().length - 1`, max 4), default `rus+eng`.
- Duplicate detection by sha256 before copy.
- Thumbnail via sharp.
- **Tag extraction** (`tags/matcher.ts`): stem OCR text → 1–3-token sliding windows → look up in `tag_aliases.lemma` → write `recipe_tags(source='ocr', confidence=…)`, skipping rows in `recipe_tag_suppressions`.
- **Acceptance**: drop 20 mixed Russian recipe pictures → all appear in gallery with thumbnails, OCR text, and a sensible auto-tag set (smoke-tested by eye against a fixture); duplicates rejected with a toast.

### Phase 5 — Gallery (1 day)
- Virtualized grid via `@tanstack/react-virtual`.
- Sort dropdown, recipe count, empty state.
- Thumbnail served via custom protocol `recipe-thumb://<id>` registered in main (avoids `file://` CORS).
- **Acceptance**: 1000-recipe stress test scrolls smooth; cold load < 500 ms to first paint.

### Phase 6 — Tag combobox + filtered gallery (1–1.5 days)
- `TagCombobox` component (Radix Combobox or `downshift`), used by both gallery search and recipe detail.
- IPC `tags.suggest(prefix)` → SPECS §7.3 query. Returned rows show canonical `label` only; aliases never leak to the UI.
- Selected tags persist in `useTagFilterStore`; rendered as removable pills above the gallery.
- IPC `recipes.filterByTags(ids, mode)` → SPECS §7.4 SQL. **AND is the default**; toggle switches to OR.
- Debounced (≈100 ms) suggest calls.
- **Acceptance**: typing `том` shows `Помидор` in the dropdown (no `томат` leak); selecting `Помидор` + `Базилик` shows only recipes auto-tagged with both; toggling to OR widens results; clearing pills restores full gallery.

### Phase 7 — Recipe detail + tag chips (1 day)
- Full-image viewer, editable title/notes, raw OCR text editor (display only in v1; stored for v2 search).
- **Tag chips**: OCR-extracted vs. user-added visually distinct. Add via `TagCombobox`. Remove writes to `recipe_tag_suppressions` if the tag was OCR-extracted.
- Re-OCR button with language picker; re-runs OCR and tag extraction, honoring suppressions and preserving user-added tags.
- Delete with confirm.
- **Acceptance**: chip edits round-trip; re-OCR does not resurrect a suppressed chip; deleted recipe removes file + thumb + row + recipe_tags.

### Phase 8 — Settings + tag library management + polish (1 day)
- Theme (light/dark via `prefers-color-scheme` + override).
- OCR language list (download additional `tessdata` on demand). Default `rus+eng`.
- **Tag library panel** (SPECS §3.6): list canonical tags by kind with recipe counts; add/edit/disable canonical tags; add/remove aliases. Built-in rows are flagged disabled, never deleted.
- **"Re-tag all recipes"** action (`tags.retagAll`) — re-runs the matcher (§7.2) over stored `ocr_text` against the current dictionary, no OCR re-run.
- "Open vault folder" button. Switch-vault flow.
- App-wide error boundary, toast system, electron-log.
- **Acceptance**: theme persists; language download works offline-after-first-time; adding a new alias and re-tagging surfaces that ingredient in previously-ingested recipes; disabling a built-in alias hides it from the dropdown without losing user-added aliases.

### Phase 9 — Packaging (½ day)
- electron-builder config: NSIS (Windows), DMG (mac), AppImage (Linux).
- Code signing left as a follow-up (out of scope unless certs available).
- Auto-update deferred.
- **Acceptance**: `npm run dist` produces installers on the host platform that launch cleanly.

### Phase 10 — Hardening (ongoing)
- E2E happy path via electron-playwright.
- Crash reporter to local file only.
- Performance budget tests in CI.

**Total estimated effort**: ~7–9 focused days for a solo developer to a shippable v1.

---

## 3. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `better-sqlite3` / `sharp` native rebuild pain on Electron | Pin Electron version; document `postinstall` script; rebuild in CI matrix |
| Tesseract accuracy on photographed Russian recipes | Pre-process via sharp (greyscale, contrast, deskew) before OCR; expose "Re-run with preprocessing" toggle; default lang `rus+eng` |
| Large vault performance | WAL + indices on `created_at`, `sha256`, `tag_aliases.lemma`, `recipe_tags.tag_id`; thumbnails; virtualization |
| Vault path moved/renamed | Detect missing root → re-prompt with "Locate" dialog |
| Cold-start tag library too thin | Ship a curated seed (target: ≥150 ingredients, ≥20 dish types, ≥15 cuisines); make "add missing tag" one click from recipe detail |
| Snowball over-stems Russian (e.g. drops too much) | Keep `az.js` as a swap-in behind the `normalize.ts` interface; tag matcher is the only call site |
| Electron security regressions | Lock `contextIsolation`, no `nodeIntegration`, CSP header, audit every IPC handler input |

---

## 4. Proposed v2 features (revisit after v1 ships)

1. **Free-text search over `ocr_text`** (FTS5 + Snowball + trigram fallback). The column is already retained; this is purely additive.
2. **Smarter tag extraction**: context-aware disambiguation (`перец` near `чили`), confidence thresholds, configurable stopword list (соль, сахар, …).
3. **Ingredient quantities** parsed from OCR (`2 ст. л.`, `300 г`) — enables shopping list.
4. **Meal scheduling**: drag recipes onto a week calendar; export as iCal.
5. **Shopping list**: union of selected recipes' detected ingredients × quantities.
6. **Nutrition lookup**: optional online enrichment against an open food DB; cached locally.
7. **Perceptual-hash dedupe** (pHash via `sharp.raw()` + bit-distance).
8. **Vault sync** via user-supplied folder on Dropbox/OneDrive/Syncthing.
9. **Multi-vault** with quick switcher.
10. **Mobile read-only viewer** (PWA pointed at a shared folder).
11. **Voice search** via Web Speech API → tag dropdown.
12. **Print / export recipe as PDF** (electron `printToPDF`).
