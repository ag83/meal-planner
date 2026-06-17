import React, { useState, useEffect, useRef, useCallback } from 'react'
import { tags as tagsIpc } from '../lib/ipc'
import type { TagSuggestion, TagKind } from '../../../shared/types'

// ── Debounce ────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

// ── Kind badge ───────────────────────────────────────────────────────────────

const KIND_LABEL: Record<TagKind, string> = {
  ingredient: 'ингредиент',
  dish_type: 'блюдо',
  cuisine: 'кухня',
  user: 'моё'
}

const KIND_COLOR: Record<TagKind, string> = {
  ingredient: 'bg-emerald-100 text-emerald-700',
  dish_type: 'bg-amber-100 text-amber-700',
  cuisine: 'bg-sky-100 text-sky-700',
  user: 'bg-violet-100 text-violet-700'
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  selectedIds: Set<number>
  onSelect: (tag: TagSuggestion) => void
  placeholder?: string
}

export function TagCombobox({
  selectedIds,
  onSelect,
  placeholder = 'Поиск тегов…'
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const debouncedQuery = useDebounce(query, 100)

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (!q) {
      setSuggestions([])
      setOpen(false)
      return
    }
    tagsIpc.suggest(q).then((results) => {
      const filtered = results.filter((r) => !selectedIds.has(r.id))
      setSuggestions(filtered)
      setOpen(filtered.length > 0)
    })
  }, [debouncedQuery, selectedIds])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = useCallback(
    (tag: TagSuggestion): void => {
      onSelect(tag)
      setQuery('')
      setSuggestions([])
      setOpen(false)
      inputRef.current?.focus()
    },
    [onSelect]
  )

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          if (e.target.value.trim()) setOpen(true)
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true)
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-300"
      />

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg bg-white shadow-lg ring-1 ring-stone-200">
          {suggestions.map((tag) => (
            <li
              key={tag.id}
              onMouseDown={(e) => {
                e.preventDefault() // prevent input blur before click fires
                handleSelect(tag)
              }}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-stone-50"
            >
              <span className="flex-1 font-medium text-stone-800">{tag.label}</span>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs ${KIND_COLOR[tag.kind]}`}
              >
                {KIND_LABEL[tag.kind]}
              </span>
              {tag.recipeCount > 0 && (
                <span className="shrink-0 text-xs text-stone-400">{tag.recipeCount}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
