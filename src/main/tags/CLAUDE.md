# CLAUDE.md — Tags

Tag-specific guidance, split out of the root `CLAUDE.md`. Read that first for the overall picture.

## Tag search (SPECS §7)

- Tags are first-class. `tags` rows are canonical concepts (one label per concept); `tag_aliases` rows are all the recognized forms (lemmas) that resolve to a tag.
- **The dropdown shows only `tags.label`** — alias matches are silent. Typing `том` returns `Помидор` because `томат` is an alias, but the user never sees the word `томат` in the dropdown.
- All normalization (lowercase, NFC, ё→е, `Intl.Segmenter` word split, `PorterStemmerRu` stem) goes through **one** module: `src/main/tags/normalize.ts`. Do not duplicate this logic — every code path that handles Russian text for matching must call it.
- Multi-word ingredients (`оливковое масло`, `болгарский перец`) are stored as space-joined stems in `tag_aliases.lemma`. The ingest matcher scans 1–3-token sliding windows over the stemmed OCR stream.
- **No FTS5 in v1.** `ocr_text` is retained on `recipes` for display and the v2 free-text feature.
