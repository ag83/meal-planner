import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { recipes } from '../lib/ipc'
import { TagCombobox } from '../components/TagCombobox'
import type { RecipeFull, RecipeTag, TagSuggestion } from '../../../shared/types'

// ── Tag chip ─────────────────────────────────────────────────────────────────

const TagChip = ({
  tag,
  onRemove
}: {
  tag: RecipeTag
  onRemove: () => void
}): React.JSX.Element => {
  return (
    <span
      title={tag.source === 'ocr' ? 'Auto-extracted' : 'Added by you'}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        tag.source === 'user'
          ? 'bg-stone-800 text-white'
          : 'border border-stone-200 bg-stone-100 text-stone-600'
      }`}
    >
      {tag.label}
      <button
        onClick={onRemove}
        className="ml-0.5 opacity-60 hover:opacity-100"
        aria-label={`Remove ${tag.label}`}
      >
        ×
      </button>
    </span>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────

const Detail = (): React.JSX.Element => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [recipe, setRecipe] = useState<RecipeFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [reOcrLang, setReOcrLang] = useState('rus+eng')
  const [reOcring, setReOcring] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    recipes.get(id).then((r) => {
      if (r) {
        setRecipe(r)
        setTitle(r.title ?? '')
        setNotes(r.notes ?? '')
      }
      setLoading(false)
    })
  }, [id])

  const handleSave = useCallback(() => {
    if (!recipe) return
    recipes.update(recipe.id, {
      title: title.trim() || null,
      notes: notes.trim() || null
    })
  }, [recipe, title, notes])

  const handleRemoveTag = useCallback(
    async (tag: RecipeTag) => {
      if (!recipe) return
      await recipes.setTag(recipe.id, tag.tagId, false)
      setRecipe((prev) =>
        prev ? { ...prev, tags: prev.tags.filter((t) => t.tagId !== tag.tagId) } : prev
      )
    },
    [recipe]
  )

  const handleAddTag = useCallback(
    async (suggestion: TagSuggestion) => {
      if (!recipe) return
      await recipes.setTag(recipe.id, suggestion.id, true)
      const updated = await recipes.get(recipe.id)
      if (updated) setRecipe(updated)
    },
    [recipe]
  )

  const handleReOcr = useCallback(async () => {
    if (!recipe) return
    setReOcring(true)
    try {
      await recipes.reOcr(recipe.id, reOcrLang)
      const updated = await recipes.get(recipe.id)
      if (updated) setRecipe(updated)
    } finally {
      setReOcring(false)
    }
  }, [recipe, reOcrLang])

  const handleDelete = useCallback(async () => {
    if (!recipe || deleting) return
    setDeleting(true)
    try {
      await recipes.delete(recipe.id)
      navigate('/gallery')
    } finally {
      setDeleting(false)
    }
  }, [recipe, deleting, navigate])

  const tagIds = useMemo(
    () => new Set(recipe?.tags.map((t) => t.tagId) ?? []),
    [recipe?.tags]
  )

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50">
        <span className="text-sm text-stone-400">Loading…</span>
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-stone-50">
        <p className="text-stone-500">Recipe not found.</p>
        <button
          onClick={() => navigate('/gallery')}
          className="text-sm text-stone-400 underline underline-offset-2 hover:text-stone-600"
        >
          Back to gallery
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-stone-50">
      {/* Header */}
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-stone-200 bg-white px-5">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800"
        >
          ← Back
        </button>
        <button
          onClick={() => setDeleteConfirm(true)}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
        >
          Delete
        </button>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: full-size image */}
        <div className="flex flex-1 items-center justify-center overflow-hidden bg-stone-900">
          <img
            src={`recipe-thumb://full/${recipe.id}`}
            alt={recipe.title ?? ''}
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        </div>

        {/* Right: details panel */}
        <div className="w-96 flex-shrink-0 overflow-y-auto border-l border-stone-200 bg-white">
          <div className="space-y-5 p-5">
            {/* Title */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-400">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleSave}
                placeholder="Untitled recipe"
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-400">
                Tags
              </label>
              {recipe.tags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {recipe.tags.map((tag) => (
                    <TagChip
                      key={tag.tagId}
                      tag={tag}
                      onRemove={() => handleRemoveTag(tag)}
                    />
                  ))}
                </div>
              )}
              <TagCombobox
                selectedIds={tagIds}
                onSelect={handleAddTag}
                placeholder="Add tag…"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-400">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={handleSave}
                rows={4}
                placeholder="Your notes…"
                className="w-full resize-none rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
            </div>

            {/* OCR text */}
            {recipe.ocrText && (
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-400">
                  OCR Text
                </label>
                <pre className="max-h-44 overflow-y-auto rounded-lg bg-stone-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-stone-500">
                  {recipe.ocrText}
                </pre>
              </div>
            )}

            {/* Re-OCR */}
            <div className="border-t border-stone-100 pt-4">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-400">
                Re-run OCR
              </label>
              <div className="flex gap-2">
                <select
                  value={reOcrLang}
                  onChange={(e) => setReOcrLang(e.target.value)}
                  className="flex-1 rounded-lg border border-stone-200 px-2 py-1.5 text-xs text-stone-600 focus:outline-none"
                >
                  <option value="rus+eng">Russian + English</option>
                  <option value="rus">Russian only</option>
                  <option value="eng">English only</option>
                </select>
                <button
                  onClick={handleReOcr}
                  disabled={reOcring}
                  className="rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-200 disabled:opacity-50"
                >
                  {reOcring ? 'Running…' : 'Re-run'}
                </button>
              </div>
            </div>

            {/* Meta */}
            <div className="border-t border-stone-100 pt-4 text-xs text-stone-400 space-y-1">
              {recipe.ocrConf != null && (
                <p>OCR confidence: {Math.round(recipe.ocrConf)}%</p>
              )}
              <p>
                {recipe.width} × {recipe.height}px
              </p>
              <p>Added {new Date(recipe.createdAt).toLocaleDateString('ru-RU')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-xl">
            <p className="font-semibold text-stone-800">Delete this recipe?</p>
            <p className="mt-1 text-sm text-stone-500">
              The image and all tags will be permanently removed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm text-stone-600 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Detail
