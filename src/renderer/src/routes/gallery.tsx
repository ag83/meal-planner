import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback
} from 'react'
import { Link } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { vault, recipes } from '../lib/ipc'
import { useRecipesStore } from '../stores/useRecipesStore'
import { useTagFilterStore } from '../stores/useTagFilterStore'
import { TagCombobox } from '../components/TagCombobox'
import type { IngestProgress, IngestStatus, RecipeSummary } from '../../../shared/types'

// Electron sets `.path` on File objects from drag-and-drop
interface ElectronFile extends File {
  path: string
}

// ── Ingest progress ────────────────────────────────────────────────────────

interface ProgressItem extends IngestProgress {
  fileName: string
}

const STATUS_LABEL: Record<IngestStatus, string> = {
  hashing: 'Hashing…',
  copying: 'Copying…',
  thumbnail: 'Thumbnail…',
  ocr: 'OCR…',
  tagging: 'Tagging…',
  done: 'Done',
  duplicate: 'Duplicate',
  error: 'Error'
}

const STATUS_COLOR: Record<IngestStatus, string> = {
  hashing: 'text-stone-400',
  copying: 'text-stone-400',
  thumbnail: 'text-stone-400',
  ocr: 'text-amber-500',
  tagging: 'text-amber-500',
  done: 'text-emerald-600',
  duplicate: 'text-sky-500',
  error: 'text-red-500'
}

// ── Recipe card ─────────────────────────────────────────────────────────────

function RecipeCard({ item }: { item: RecipeSummary }): React.JSX.Element {
  return (
    <Link
      to={`/recipe/${item.id}`}
      className="group relative flex-1 overflow-hidden rounded-xl bg-stone-100"
    >
      <img
        src={`recipe-thumb://thumb/${item.id}`}
        alt={item.title ?? ''}
        draggable={false}
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
      />
      {item.tagCount > 0 && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-2 pt-6">
          <span className="text-xs text-white/90">
            {item.tagCount} {item.tagCount === 1 ? 'tag' : 'tags'}
          </span>
        </div>
      )}
    </Link>
  )
}

// ── Sort ────────────────────────────────────────────────────────────────────

type SortKey = 'newest' | 'oldest' | 'title'

function sortItems(items: RecipeSummary[], key: SortKey): RecipeSummary[] {
  return [...items].sort((a, b) => {
    if (key === 'newest') return b.createdAt - a.createdAt
    if (key === 'oldest') return a.createdAt - b.createdAt
    return (a.title ?? '').localeCompare(b.title ?? '', 'ru')
  })
}

// ── Gallery ─────────────────────────────────────────────────────────────────

const ITEM_H = 200
const GAP = 8

export default function Gallery(): React.JSX.Element {
  const store = useRecipesStore()
  const tagFilter = useTagFilterStore()

  // Vault tracking — reload recipes when the active vault changes
  const [vaultPath, setVaultPath] = useState<string | null>(null)

  useEffect(() => {
    vault.getCurrent().then((v) => setVaultPath(v?.path ?? null))
  }, [])

  useEffect(() => {
    if (vaultPath !== null) store.load()
  }, [vaultPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tag-filtered results
  const [filteredItems, setFilteredItems] = useState<RecipeSummary[]>([])
  const [filterLoading, setFilterLoading] = useState(false)

  useEffect(() => {
    if (tagFilter.selectedTags.length === 0) {
      setFilteredItems([])
      return
    }
    setFilterLoading(true)
    recipes
      .filterByTags(
        tagFilter.selectedTags.map((t) => t.id),
        tagFilter.mode
      )
      .then(setFilteredItems)
      .catch(() => setFilteredItems([]))
      .finally(() => setFilterLoading(false))
  }, [tagFilter.selectedTags, tagFilter.mode])

  const baseItems = tagFilter.selectedTags.length > 0 ? filteredItems : store.items
  const isLoading = store.loading || filterLoading

  // Sort
  const [sort, setSort] = useState<SortKey>('newest')
  const sortedItems = useMemo(() => sortItems(baseItems, sort), [baseItems, sort])

  // Virtual grid — responsive column count via ResizeObserver
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(960)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const cols = Math.max(2, Math.floor((containerWidth + GAP) / (180 + GAP)))
  const rowCount = Math.ceil(sortedItems.length / cols)

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ITEM_H + GAP,
    overscan: 4
  })

  // Drag-and-drop
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  // Ingest progress
  const [isIngesting, setIsIngesting] = useState(false)
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([])
  const [showProgress, setShowProgress] = useState(false)

  useEffect(() => {
    return recipes.onProgress((p) => {
      setProgressItems((prev) => {
        const idx = prev.findIndex((x) => x.filePath === p.filePath)
        const item: ProgressItem = {
          ...p,
          fileName: p.filePath.split(/[/\\]/).pop() ?? p.filePath
        }
        return idx >= 0
          ? prev.map((x, i) => (i === idx ? item : x))
          : [...prev, item]
      })
    })
  }, [])

  const ingestPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      setIsIngesting(true)
      setProgressItems([])
      setShowProgress(true)
      try {
        await recipes.ingest(paths)
        await store.load()
      } finally {
        setIsIngesting(false)
      }
    },
    [store]
  )

  const handleDragEnter = (e: React.DragEvent): void => {
    e.preventDefault()
    dragCounter.current++
    setIsDragging(true)
  }
  const handleDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    if (--dragCounter.current === 0) setIsDragging(false)
  }
  const handleDragOver = (e: React.DragEvent): void => e.preventDefault()
  const handleDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDragging(false)
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => (f as ElectronFile).path)
        .filter(Boolean)
      await ingestPaths(paths)
    },
    [ingestPaths]
  )

  const handlePickFiles = useCallback(async () => {
    const paths = await recipes.pickFiles()
    await ingestPaths(paths)
  }, [ingestPaths])

  const handleSwitchVault = useCallback(async () => {
    const info = await vault.pick()
    if (info) setVaultPath(info.path)
  }, [])

  const doneCount = progressItems.filter((i) => i.status === 'done').length
  const dupCount = progressItems.filter((i) => i.status === 'duplicate').length
  const errCount = progressItems.filter((i) => i.status === 'error').length

  const selectedIds = useMemo(
    () => new Set(tagFilter.selectedTags.map((t) => t.id)),
    [tagFilter.selectedTags]
  )

  const totalCount = tagFilter.selectedTags.length > 0 ? filteredItems.length : store.items.length

  return (
    <div
      className="flex h-screen flex-col bg-stone-50"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-white/80 bg-stone-900/60 px-16 py-12 text-center text-white">
            <p className="text-2xl font-semibold">Drop recipe photos</p>
            <p className="mt-1 text-sm text-white/70">JPG · PNG · WebP</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-stone-200 px-5">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-stone-800">My Recipes</h1>
          {totalCount > 0 && (
            <span className="text-sm text-stone-400">
              {totalCount} recipe{totalCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {store.items.length > 1 && (
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 focus:outline-none"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="title">Title A–Z</option>
            </select>
          )}
          <button
            onClick={handlePickFiles}
            disabled={isIngesting}
            className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {isIngesting ? 'Adding…' : '+ Add Recipes'}
          </button>
          <button
            onClick={handleSwitchVault}
            className="text-xs text-stone-400 underline underline-offset-2 hover:text-stone-600"
          >
            Switch vault
          </button>
        </div>
      </header>

      {/* Tag filter bar */}
      <div className="flex-shrink-0 border-b border-stone-200 bg-white px-5 py-2">
        <div className="flex items-center gap-2">
          <TagCombobox selectedIds={selectedIds} onSelect={tagFilter.addTag} />

          {tagFilter.selectedTags.length >= 2 && (
            <div className="flex flex-shrink-0 items-center rounded-lg border border-stone-200 text-xs">
              <button
                onClick={() => tagFilter.setMode('and')}
                className={`rounded-l-lg px-2.5 py-1.5 font-medium transition-colors ${
                  tagFilter.mode === 'and'
                    ? 'bg-stone-800 text-white'
                    : 'text-stone-500 hover:bg-stone-50'
                }`}
              >
                AND
              </button>
              <button
                onClick={() => tagFilter.setMode('or')}
                className={`rounded-r-lg px-2.5 py-1.5 font-medium transition-colors ${
                  tagFilter.mode === 'or'
                    ? 'bg-stone-800 text-white'
                    : 'text-stone-500 hover:bg-stone-50'
                }`}
              >
                OR
              </button>
            </div>
          )}
        </div>

        {/* Selected tag pills */}
        {tagFilter.selectedTags.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tagFilter.selectedTags.map((tag) => (
              <span
                key={tag.id}
                className="flex items-center gap-1 rounded-full bg-stone-800 px-2.5 py-0.5 text-xs font-medium text-white"
              >
                {tag.label}
                <button
                  onClick={() => tagFilter.removeTag(tag.id)}
                  className="ml-0.5 opacity-70 hover:opacity-100"
                  aria-label={`Remove ${tag.label}`}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              onClick={tagFilter.clear}
              className="text-xs text-stone-400 hover:text-stone-600"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Main area */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {/* Scroll container */}
        <div ref={scrollRef} className="h-full overflow-y-auto px-5 py-4">
          {/* Empty state */}
          {!isLoading && sortedItems.length === 0 && store.items.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-100">
                <svg
                  className="h-7 w-7 text-stone-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4-4a3 3 0 014.243 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <p className="text-stone-500">
                Drop photos here or click <strong>+ Add Recipes</strong>
              </p>
              <p className="text-xs text-stone-400">
                JPG · PNG · WebP — duplicates are skipped automatically
              </p>
            </div>
          )}

          {/* No results for current filter */}
          {!isLoading && sortedItems.length === 0 && store.items.length > 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-stone-500">No recipes match the selected tags</p>
              <button
                onClick={tagFilter.clear}
                className="text-xs text-stone-400 underline underline-offset-2 hover:text-stone-600"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading && (
            <div className="flex h-40 items-center justify-center">
              <span className="text-sm text-stone-400">Loading…</span>
            </div>
          )}

          {/* Virtualized grid */}
          {!isLoading && sortedItems.length > 0 && (
            <div
              style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const start = virtualRow.index * cols
                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: 'absolute',
                      top: virtualRow.start,
                      left: 0,
                      right: 0,
                      height: ITEM_H,
                      display: 'flex',
                      gap: GAP
                    }}
                  >
                    {Array.from({ length: cols }, (_, ci) => {
                      const item = sortedItems[start + ci]
                      if (!item) {
                        return <div key={ci} style={{ flex: 1 }} />
                      }
                      return <RecipeCard key={item.id} item={item} />
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Ingest progress panel — bottom-right overlay */}
        {showProgress && (
          <div className="absolute bottom-4 right-4 z-40 w-72 rounded-xl bg-white shadow-xl ring-1 ring-stone-200">
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2">
              <span className="text-xs font-medium text-stone-600">
                {isIngesting
                  ? 'Adding recipes…'
                  : `${doneCount} added${dupCount ? `, ${dupCount} dup` : ''}${errCount ? `, ${errCount} err` : ''}`}
              </span>
              {!isIngesting && (
                <button
                  onClick={() => setShowProgress(false)}
                  className="text-xs text-stone-400 hover:text-stone-600"
                >
                  ✕
                </button>
              )}
            </div>
            <ul className="max-h-56 divide-y divide-stone-50 overflow-y-auto">
              {progressItems.map((item) => (
                <li
                  key={item.filePath}
                  className="flex items-center justify-between px-4 py-1.5"
                >
                  <span
                    className="truncate text-xs text-stone-700"
                    title={item.filePath}
                  >
                    {item.fileName}
                  </span>
                  <span
                    className={`ml-3 shrink-0 text-xs font-medium ${STATUS_COLOR[item.status]}`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
